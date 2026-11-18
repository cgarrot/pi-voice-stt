import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  AudioStreamHandle,
  AudioStreamer,
} from "../audio/stream-recorder";
import type { OutputConfig, PluginConfig } from "../config/types";
import type {
  RealtimeStream,
  RealtimeStreamEvents,
} from "../providers/assemblyai-stream";
import type { Strings } from "../i18n/strings";
import type { DictationMode, DictationToast } from "./dictation-controller";
import { applyReplacements } from "./replacements";

/** How long to wait for the server to finalize the in-flight turn on stop. */
const FINAL_TURN_GRACE_MS = 1500;
const TOGGLE_DEBOUNCE_MS = 250;
const SILENCE_TIMEOUT_MS = 30_000;

const FALLBACK_OUTPUT: OutputConfig = {
  appendTrailingSpace: true,
  submitOnStop: false,
  replacements: {},
};

export type RealtimeControllerOptions = {
  strings: Strings;
  loadConfig(): Promise<PluginConfig>;
  createStreamer(config: PluginConfig): AudioStreamer;
  openStream(
    config: PluginConfig,
    events: RealtimeStreamEvents,
    signal: AbortSignal,
  ): Promise<RealtimeStream>;
  getEditorText(ctx: ExtensionContext): string;
  setEditorText(ctx: ExtensionContext, text: string): void;
  insertPrompt(
    ctx: ExtensionContext,
    text: string,
    position: "cursor" | "end",
  ): void;
  notify(ctx: ExtensionContext | undefined, toast: DictationToast): void;
  onModeChange?(mode: DictationMode, ctx?: ExtensionContext): void;
  onLive?(text: string | undefined): void;
  onError?(ctx: ExtensionContext | undefined, error: unknown): void;
};

/**
 * Streaming dictation controller.
 *
 * Stable spoken words are inserted once, at the cursor or prompt end.
 * Already inserted words belong to the user: later provider revisions must
 * not rewrite them. Unstable words remain in the live preview until finalized.
 */
export const createRealtimeController = (
  options: RealtimeControllerOptions,
) => {
  let mode: DictationMode = "idle";
  let session: RealtimeStream | undefined;
  let opening: AbortController | undefined;
  let audio: AudioStreamHandle | undefined;
  let config: PluginConfig | undefined;
  let lastContext: ExtensionContext | undefined;
  let baseText = "";
  let committed = "";
  let partial = "";
  const turns = new Map<number, string>();
  let closed = false;
  let audioSeconds: number | undefined;
  let sentBytes = 0;
  let generation = 0;
  let lastWritten: string | undefined;
  let edited = false;
  let partialTurn = 0;
  const deliveredWords = new Map<number, number>();
  const turnSpeakers = new Map<number, string>();
  let lastSpeaker = "";
  let cancelled = false;
  let disposed = false;
  let operation: Promise<void> | undefined;
  let lastToggleAt = 0;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  const finalTurnWaiters = new Set<() => void>();

  const outputConfig = (): OutputConfig => config?.output ?? FALLBACK_OUTPUT;

  const remember = (ctx: ExtensionContext | undefined) => {
    if (ctx) lastContext = ctx;
  };

  const setMode = (next: DictationMode, ctx?: ExtensionContext) => {
    if (disposed && next !== "idle") return;
    remember(ctx);
    mode = next;
    if (next !== "streaming") clearTimeout(silenceTimer);
    options.onModeChange?.(next, ctx ?? lastContext);
  };

  const notify = (ctx: ExtensionContext | undefined, toast: DictationToast) => {
    if (!disposed) options.notify(ctx ?? lastContext, toast);
  };

  const releaseFinalTurnWaiters = () => {
    for (const resolve of [...finalTurnWaiters]) resolve();
  };

  const waitForFinalTurn = (timeoutMs: number): Promise<void> =>
    new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        finalTurnWaiters.delete(finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      finalTurnWaiters.add(finish);
    });

  const deliver = (ctx: ExtensionContext, raw: string, turnOrder: number) => {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    const count = deliveredWords.get(turnOrder) ?? 0;
    if (words.length <= count) return;
    if (options.getEditorText(ctx) !== (lastWritten ?? baseText)) edited = true;
    let text = applyReplacements(
      words.slice(count).join(" "),
      outputConfig().replacements,
    );
    // Label a turn when the speaker changes; UNKNOWN/PENDING (turns under ~1s)/missing stick to the last one.
    const speaker = turnSpeakers.get(turnOrder) ?? "";
    if (count === 0 && speaker && speaker !== "UNKNOWN" && speaker !== "PENDING" && speaker !== lastSpeaker) {
      text = `${lastSpeaker ? "\n" : ""}Speaker ${speaker}: ${text}`;
      lastSpeaker = speaker;
    }
    if (text.trim())
      options.insertPrompt(
        ctx,
        `${text} `,
        config?.realtime.insertionPosition ?? "cursor",
      );
    deliveredWords.set(turnOrder, words.length);
    lastWritten = options.getEditorText(ctx);
  };

  const commitTurn = (
    ctx: ExtensionContext,
    raw: string,
    turnOrder?: number,
    speaker?: string,
  ) => {
    const text = applyReplacements(raw, outputConfig().replacements);
    if (text.trim()) {
      const order = turnOrder ?? partialTurn;
      if (speaker && (config?.realtime.speakers ?? 0) >= 2)
        turnSpeakers.set(order, speaker);
      if (order === partialTurn) partial = "";
      const alreadyFinal = turns.has(order);
      turns.set(order, raw);
      committed = [...turns.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value)
        .join("");
      options.onLive?.(undefined);
      if (!alreadyFinal && config?.realtime.commitOnTurnEnd !== false)
        deliver(ctx, raw, order);
    }
    releaseFinalTurnWaiters();
  };

  const teardown = async () => {
    clearTimeout(silenceTimer);
    generation += 1;
    opening?.abort();
    opening = undefined;
    const handle = audio;
    const active = session;
    audio = undefined;
    session = undefined;
    await Promise.all([
      handle?.dispose().catch((error) => options.onError?.(lastContext, error)),
      active?.close().catch((error) => options.onError?.(lastContext, error)),
    ]);
    releaseFinalTurnWaiters();
    options.onLive?.(undefined);
  };

  const start = async (ctx: ExtensionContext) => {
    if (disposed || mode !== "idle") return;
    if (!ctx.hasUI) {
      notify(ctx, {
        title: "Pi Voice STT",
        message: options.strings.toast.realtimeNeedsUi,
        variant: "warning",
      });
      return;
    }

    const currentGeneration = ++generation;
    const isCurrent = () =>
      currentGeneration === generation && !disposed && !cancelled;
    setMode("connecting", ctx);
    try {
      const loaded = await options.loadConfig();
      if (!isCurrent()) return;
      const realtime = loaded.realtime;
      if (!realtime.enabled)
        throw new Error(options.strings.toast.realtimeDisabled);

      config = loaded;
      committed = "";
      partial = "";
      turns.clear();
      closed = false;
      audioSeconds = undefined;
      sentBytes = 0;
      edited = false;
      partialTurn = 0;
      deliveredWords.clear();
      turnSpeakers.clear();
      lastSpeaker = "";
      lastWritten = undefined;
      cancelled = false;
      baseText = options.getEditorText(ctx);

      const heardSpeech = () => {
        if (!isCurrent() || (mode !== "streaming" && mode !== "connecting")) return;
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (!isCurrent() || mode !== "streaming") return;
          notify(ctx, { title: "Pi Voice STT", message: "Stopping after 30 seconds without detected speech.", variant: "info" });
          void stop(ctx).catch((error) => options.onError?.(ctx, error));
        }, SILENCE_TIMEOUT_MS);
      };
      const connection = new AbortController();
      opening = connection;
      const opened = await options.openStream(loaded, {
        onSpeechStarted: heardSpeech,
        onPartial: (text, turnOrder = 0, stableText = "") => {
          if (!isCurrent()) return;
          heardSpeech();
          partial = text;
          partialTurn = turnOrder;
          options.onLive?.(text);
          // With speaker labels, wait for end of turn: the label only arrives there.
          if (
            config?.realtime.commitOnTurnEnd !== false &&
            (config?.realtime.speakers ?? 0) < 2
          )
            deliver(ctx, stableText, turnOrder);
        },
        onFinal: (text, turnOrder, speaker) => {
          if (isCurrent()) {
            heardSpeech();
            commitTurn(ctx, text, turnOrder, speaker);
          }
        },
        onError: (error) => {
          if (!isCurrent()) return;
          options.onError?.(ctx, error);
          if (mode === "streaming") void stop(ctx);
        },
        onClosed: (info) => {
          if (!isCurrent()) return;
          closed = true;
          audioSeconds = info?.audioSeconds;
          releaseFinalTurnWaiters();
          if (mode === "streaming") void stop(ctx);
        },
      }, connection.signal);
      if (opening === connection) opening = undefined;
      if (!isCurrent() || closed) {
        await opened.close().catch((error) => options.onError?.(ctx, error));
        if (isCurrent()) setMode("idle", ctx);
        return;
      }
      session = opened;

      const handle = options.createStreamer(loaded).start();
      audio = handle;
      handle.onChunk((chunk) => {
        if (!isCurrent() || !session) return;
        sentBytes += chunk.length;
        session.sendAudio(chunk);
      });
      handle.onExit((reason, clean) => {
        if (!isCurrent() || (mode !== "streaming" && mode !== "connecting"))
          return;
        // A zero exit means the source ended on its own (a file input running
        // out); anything else is a real capture failure worth surfacing.
        if (!clean)
          options.onError?.(
            ctx,
            new Error(`Realtime capture stopped: ${reason}`),
          );
        void stop(ctx);
      });

      setMode("streaming", ctx);
      heardSpeech();
      notify(ctx, {
        title: "Pi Voice STT",
        message: options.strings.toast.realtimeStarted(realtime.keybind),
        variant: "info",
        duration: 5000,
      });
    } catch (error) {
      if (!isCurrent()) return;
      await teardown();
      setMode("idle", ctx);
      options.onError?.(ctx, error);
    }
  };

  const stop = async (ctx: ExtensionContext): Promise<void> => {
    remember(ctx);
    if (disposed || mode === "idle") return;
    if (operation) return operation;

    operation = (async () => {
      try {
        setMode("stopping", ctx);
        const handle = audio;
        audio = undefined;
        await handle?.stop().catch(() => {});
        await handle?.dispose().catch(() => {});

        const active = session;
        if (active && !closed) {
          const finalTurn = waitForFinalTurn(FINAL_TURN_GRACE_MS);
          active.forceEndpoint();
          await finalTurn;
          await active.close().catch((error) => options.onError?.(ctx, error));
        }
        if (session === active) session = undefined;

        if (cancelled) return;
        if (partial.trim()) commitTurn(ctx, partial, partialTurn);
        options.onLive?.(undefined);

        const hasText = committed.trim().length > 0;
        if (config?.realtime.commitOnTurnEnd === false) {
          for (const [order, text] of [...turns.entries()].sort(
            ([a], [b]) => a - b,
          ))
            deliver(ctx, text, order);
        }

        notify(ctx, {
          title: "Pi Voice STT",
          message: hasText
            ? options.strings.toast.realtimeStopped
            : `${options.strings.toast.realtimeEmpty} (PCM captured: ${sentBytes} bytes; server audio: ${audioSeconds === undefined ? "unknown" : `${audioSeconds}s`}; dropped chunks: ${active?.droppedChunks ?? 0}.)`,
          variant: hasText ? "success" : "warning",
        });
      } finally {
        await teardown();
        setMode("idle", ctx);
        operation = undefined;
      }
    })();

    return operation;
  };

  const cancel = async (ctx?: ExtensionContext): Promise<void> => {
    remember(ctx);
    if (disposed || mode === "idle") return;
    cancelled = true;
    setMode("stopping", ctx);
    const target = ctx ?? lastContext;
    if (
      target &&
      !edited &&
      options.getEditorText(target) === (lastWritten ?? baseText)
    )
      options.setEditorText(target, baseText);
    await teardown();
    await operation;
    setMode("idle", target);
    notify(target, {
      title: "Pi Voice STT",
      message: options.strings.toast.realtimeCancelled,
      variant: "info",
    });
    cancelled = false;
  };

  const toggle = async (ctx: ExtensionContext): Promise<void> => {
    const now = Date.now();
    if (now - lastToggleAt < TOGGLE_DEBOUNCE_MS) return;
    lastToggleAt = now;
    if (mode === "idle") {
      await start(ctx);
      return;
    }
    await stop(ctx);
  };

  const dispose = async (): Promise<void> => {
    disposed = true;
    cancelled = true;
    await teardown();
    await operation?.catch(() => {});
    mode = "idle";
    options.onLive?.(undefined);
  };

  return {
    toggle,
    start,
    stop,
    cancel,
    dispose,
    getMode: () => mode,
    isActive: () => mode !== "idle",
  };
};
