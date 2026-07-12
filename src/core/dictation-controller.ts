import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AudioRecorder, RecordingHandle } from "../audio/types";
import type { PluginConfig } from "../config/types";
import { assertProviderReady } from "../providers/readiness";
import type { Strings } from "../i18n/strings";
import { formatTranscriptForPrompt } from "./output";

export type DictationMode = "idle" | "recording" | "processing";

export type DictationToast = {
  variant?: "info" | "success" | "warning" | "error";
  title?: string;
  message: string;
  duration?: number;
};

export type DictationControllerOptions = {
  keybind: string;
  strings: Strings;
  loadConfig(): Promise<PluginConfig>;
  createRecorder(config: PluginConfig): AudioRecorder;
  createProvider(config: PluginConfig): { transcribe(input: { audioPath: string; language?: string; signal: AbortSignal }): Promise<{ text: string }> };
  appendPrompt(ctx: ExtensionContext, text: string): Promise<unknown>;
  submitPrompt(ctx: ExtensionContext): Promise<unknown>;
  notify(ctx: ExtensionContext | undefined, toast: DictationToast): void;
  onModeChange?(mode: DictationMode, ctx: ExtensionContext | undefined): void;
  onError(ctx: ExtensionContext | undefined, error: unknown): void;
};

type StopRecordingOptions = {
  submitAfterAppend?: boolean;
};

const PROMPT_APPEND_FLUSH_DELAY_MS = 30;

const waitForPromptAppendFlush = () => new Promise<void>((resolve) => setTimeout(resolve, PROMPT_APPEND_FLUSH_DELAY_MS));

export const createDictationController = (options: DictationControllerOptions) => {
  let recording: RecordingHandle | undefined;
  let recordingConfig: PluginConfig | undefined;
  let activeRecordingHandle: RecordingHandle | undefined;
  let activeOperation: Promise<void> | undefined;
  let transcriptionController: AbortController | undefined;
  let processing = false;
  let cancelRequested = false;
  let mode: DictationMode = "idle";
  let disposed = false;
  let lastContext: ExtensionContext | undefined;

  const rememberContext = (ctx: ExtensionContext | undefined) => {
    if (ctx) lastContext = ctx;
  };

  const setMode = (nextMode: DictationMode, ctx?: ExtensionContext) => {
    if (disposed && nextMode !== "idle") return;
    rememberContext(ctx);
    mode = nextMode;
    options.onModeChange?.(nextMode, ctx ?? lastContext);
  };

  const notify = (ctx: ExtensionContext | undefined, toast: DictationToast) => {
    if (!disposed) options.notify(ctx ?? lastContext, toast);
  };

  const appendPrompt = async (ctx: ExtensionContext, text: string) => {
    if (disposed || !text) return;
    await options.appendPrompt(ctx, text);
  };

  const submitPrompt = async (ctx: ExtensionContext) => {
    if (disposed) return;
    await options.submitPrompt(ctx);
  };

  const stopActiveRecording = async (ctx: ExtensionContext, active: RecordingHandle, config: PluginConfig, stopOptions: StopRecordingOptions) => {
    const provider = options.createProvider(config);
    const controller = new AbortController();
    transcriptionController = controller;
    const timeout = setTimeout(() => controller.abort(), config.provider.timeoutSeconds * 1000);

    try {
      notify(ctx, { title: "Pi Voice STT", message: options.strings.toast.stopping, variant: "info" });
      const audioPath = await active.stop();
      if (disposed) return;
      const result = await provider.transcribe({ audioPath, language: config.provider.language, signal: controller.signal });
      if (cancelRequested || disposed) return;
      await appendPrompt(ctx, formatTranscriptForPrompt(result.text, config.output));
      if (stopOptions.submitAfterAppend) {
        await waitForPromptAppendFlush();
        await submitPrompt(ctx);
      }
      if (!cancelRequested) {
        notify(ctx, {
          title: "Pi Voice STT",
          message: stopOptions.submitAfterAppend ? options.strings.toast.sent : options.strings.toast.inserted,
          variant: "success",
        });
      }
    } finally {
      clearTimeout(timeout);
      if (transcriptionController === controller) transcriptionController = undefined;
      await active.dispose();
    }
  };

  const stopRecording = async (ctx: ExtensionContext, stopOptions: StopRecordingOptions = {}) => {
    rememberContext(ctx);
    if (disposed) return;
    if (processing) {
      notify(ctx, { title: "Pi Voice STT", message: options.strings.toast.stillProcessing, variant: "warning" });
      return;
    }

    if (!recording) return;

    processing = true;
    setMode("processing", ctx);
    const active = recording;
    const activeConfig = recordingConfig;
    recording = undefined;
    recordingConfig = undefined;
    activeRecordingHandle = active;
    if (active.timeout) clearTimeout(active.timeout);

    const operation = activeConfig
      ? stopActiveRecording(ctx, active, activeConfig, stopOptions)
      : Promise.reject(new Error("Recording config was not available."));
    activeOperation = operation;
    try {
      await operation;
    } catch (error) {
      if (!cancelRequested && !disposed) throw error;
    } finally {
      if (activeOperation === operation) activeOperation = undefined;
      activeRecordingHandle = undefined;
      processing = false;
      cancelRequested = false;
      setMode("idle", ctx);
    }
  };

  const cancelActiveRecording = async (active: RecordingHandle) => {
    if (active.timeout) clearTimeout(active.timeout);
    await active.dispose();
  };

  const cancel = async (ctx?: ExtensionContext) => {
    rememberContext(ctx);
    if (disposed) return;

    if (recording && !processing) {
      cancelRequested = true;
      const active = recording;
      recording = undefined;
      recordingConfig = undefined;
      await cancelActiveRecording(active);
      cancelRequested = false;
      setMode("idle", ctx);
      notify(ctx, { title: "Pi Voice STT", message: options.strings.toast.recordingCancelled, variant: "info" });
      return;
    }

    if (processing) {
      cancelRequested = true;
      transcriptionController?.abort();
      if (activeRecordingHandle) {
        await activeRecordingHandle.dispose().catch(() => {});
      }
      notify(ctx, { title: "Pi Voice STT", message: options.strings.toast.transcriptionCancelled, variant: "info" });
      try {
        await activeOperation;
      } catch {
        // stopRecording handles aborted transcription.
      }
    }
  };

  const startRecording = async (ctx: ExtensionContext) => {
    if (disposed) return;
    processing = true;
    try {
      const config = await options.loadConfig();
      if (disposed) return;
      assertProviderReady(config.provider);
      const recorder = options.createRecorder(config);
      recording = recorder.start();
      recordingConfig = config;
      recording.timeout = setTimeout(() => {
        if (!recording || processing || disposed) return;
        const timeoutContext = lastContext;
        if (!timeoutContext) return;
        void stopRecording(timeoutContext).catch((error) => options.onError(timeoutContext, error));
      }, config.capture.maxSeconds * 1000);
      setMode("recording", ctx);
      notify(ctx, {
        title: "Pi Voice STT",
        message: options.strings.toast.startRecording(options.keybind),
        variant: "info",
        duration: 5000,
      });
    } finally {
      processing = false;
    }
  };

  const toggle = async (ctx: ExtensionContext) => {
    rememberContext(ctx);
    if (recording || processing) {
      await stopRecording(ctx);
      return;
    }
    await startRecording(ctx);
  };

  const dispose = async () => {
    disposed = true;
    transcriptionController?.abort();
    const operation = activeOperation;
    if (!recording) {
      await operation?.catch(() => {});
      setMode("idle", lastContext);
      return;
    }
    const active = recording;
    recording = undefined;
    recordingConfig = undefined;
    if (active.timeout) clearTimeout(active.timeout);
    await active.dispose();
    await operation?.catch(() => {});
    setMode("idle", lastContext);
  };

  return {
    toggle,
    stop: (ctx: ExtensionContext) => stopRecording(ctx),
    stopAndSubmit: (ctx: ExtensionContext) => stopRecording(ctx, { submitAfterAppend: true }),
    cancel,
    dispose,
    getMode: () => mode,
  };
};
