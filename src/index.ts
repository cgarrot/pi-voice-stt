import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { checkBridgeRecorderHealth } from "./audio/bridge-recorder";
import { createRecorder } from "./audio/factory";
import { loadConfig, readConfigFile } from "./config/load-config";
import { resolveStartupOptions } from "./config/startup";
import { DEFAULT_PROFILE, isKnownProfile, listProfileNames, resolveEffectiveProfile, writeProfileState } from "./config/profiles";
import { createDictationController, type DictationToast } from "./core/dictation-controller";
import { DEFAULT_MODE, isKnownMode, listModeNames } from "./core/modes";
import { createProvider } from "./providers/factory";
import { createCleanup } from "./cleanup/factory";
import { assertProviderReady } from "./providers/readiness";
import { createInputIndicator, createVoiceEditorFactory } from "./ui/input-indicator";
import { resolveStrings } from "./i18n/strings";
import { formatError } from "./utils/text";
import { textFrom } from "./utils/coerce";
import { kittyCtrlShiftLetterRegex } from "./utils/keybind";
import type { KeyId } from "@earendil-works/pi-tui";

const toastType = (variant: DictationToast["variant"]): "info" | "warning" | "error" => {
  if (variant === "error") return "error";
  if (variant === "warning") return "warning";
  return "info";
};

const notify = (ctx: ExtensionContext | undefined, toast: DictationToast): void => {
  if (!ctx?.hasUI) return;
  const message = toast.title ? `${toast.title}: ${toast.message}` : toast.message;
  ctx.ui.notify(message, toastType(toast.variant));
};

const reportError = (ctx: ExtensionContext | undefined, error: unknown): void => {
  notify(ctx, { title: "Pi Voice STT", message: formatError(error), variant: "error" });
};

export default function piVoiceSttExtension(pi: ExtensionAPI) {
  const startup = resolveStartupOptions();
  const keybind = startup.keybind;
  const profileKeybind = startup.profileKeybind;
  const strings = resolveStrings(startup.locale);
  const inputIndicator = createInputIndicator(keybind, strings);
  let activeMode = startup.mode || DEFAULT_MODE;
  let activeProfile = startup.profile;
  const terminalInputCleanup: Array<() => void> = [];

  // Apply the persisted last-selection (sidecar state) once loaded; env and
  // the config `profile` key are already folded into startup.profile.
  const profileReady = (async () => {
    const fileConfig = await readConfigFile(startup.configPath).catch(() => ({}));
    const effective = await resolveEffectiveProfile({
      configPath: startup.configPath,
      envProfile: textFrom(process.env.PI_STT_PROFILE),
      configProfile: startup.profile,
    });
    const safe = isKnownProfile(fileConfig, effective) ? effective : isKnownProfile(fileConfig, startup.profile) ? startup.profile : DEFAULT_PROFILE;
    if (safe !== activeProfile) {
      activeProfile = safe;
      inputIndicator.setProfile(activeProfile);
    }
  })().catch(() => {});

  const getConfig = async () => {
    await profileReady;
    return loadConfig({ configPath: startup.configPath, mode: activeMode, profile: activeProfile });
  };

  const controller = createDictationController({
    keybind,
    strings,
    loadConfig: getConfig,
    createRecorder: (config) => createRecorder(config.capture),
    createProvider: (config) => createProvider(config.provider),
    createCleanup: (config) => createCleanup(config.cleanup),
    appendPrompt: async (ctx, text) => {
      const current = ctx.ui.getEditorText();
      ctx.ui.setEditorText(`${current}${text}`);
    },
    submitPrompt: async (ctx) => {
      const prompt = ctx.ui.getEditorText().trimEnd();
      if (!prompt) {
        notify(ctx, { title: "Pi Voice STT", message: strings.toast.emptyTranscript, variant: "warning" });
        return;
      }

      ctx.ui.setEditorText("");
      if (ctx.isIdle()) pi.sendUserMessage(prompt);
      else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    },
    notify,
    onModeChange: (mode) => inputIndicator.setMode(mode),
    onError: reportError,
  });

  const switchProfile = async (ctx: ExtensionContext, next: string): Promise<void> => {
    await profileReady;
    if (controller.getMode() === "processing") {
      notify(ctx, { title: "Pi Voice STT", message: strings.profile.busy, variant: "warning" });
      return;
    }
    activeProfile = next;
    inputIndicator.setProfile(next);
    try {
      await writeProfileState(startup.configPath, next);
    } catch {
      notify(ctx, { title: "Pi Voice STT", message: strings.profile.persistFailed, variant: "warning" });
    }
    notify(ctx, { title: "Pi Voice STT", message: strings.profile.set(next), variant: "success" });
  };

  const showProfileMenu = async (ctx: ExtensionContext): Promise<void> => {
    const fileConfig = await readConfigFile(startup.configPath).catch(() => ({}));
    const names = listProfileNames(fileConfig);
    if (names.length <= 1) {
      notify(ctx, { title: "Pi Voice STT", message: strings.profile.none, variant: "warning" });
      return;
    }
    const labels = names.map((name) => (name === activeProfile ? `${name} (${strings.profile.activeMarker})` : name));
    const byLabel = new Map(labels.map((label, index) => [label, names[index] ?? ""]));
    const chosen = await ctx.ui.select(strings.profile.menuTitle, labels);
    if (!chosen) return;
    const next = byLabel.get(chosen) ?? "";
    if (!next || next === activeProfile) return;
    if (!isKnownProfile(fileConfig, next)) {
      notify(ctx, { title: "Pi Voice STT", message: strings.profile.unknown(next), variant: "error" });
      return;
    }
    await switchProfile(ctx, next);
  };

  pi.registerTool({
    name: "transcribe_audio",
    label: "Transcribe Audio",
    description: "Transcribe a local audio file using the configured Pi Voice STT provider.",
    promptSnippet: "Transcribe a local audio file with the active STT profile and mode.",
    // Pi accepts JSON Schema directly; no additional runtime dependency is needed.
    parameters: {
      type: "object",
      properties: { path: { type: "string", minLength: 1, description: "Local audio file path, relative to the session working directory or absolute." } },
      required: ["path"],
      additionalProperties: false,
    } as const,
    async execute(_toolCallId, { path }, signal, _onUpdate, ctx) {
      const result = await controller.transcribeFile(ctx, path, { signal: signal ?? ctx.signal });
      return { content: [{ type: "text", text: result.text }], details: result };
    },
  });

  pi.registerCommand("stt", {
    description: "Speech-to-text controls: start, stop, send, file <path>, cancel, mode, profile, status, doctor.",
    getArgumentCompletions: (prefix) => {
      const commands = ["start", "stop", "send", "file", "cancel", "mode", "profile", "status", "doctor"];
      return commands
        .filter((command) => command.startsWith(prefix.trim().toLowerCase()))
        .map((command) => ({ value: command, label: command }));
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const first = trimmed.split(/\s+/, 1)[0] ?? "";
      const action = (first || "status").toLowerCase();
      const param = trimmed.slice(first.length).trim();

      if (action === "file") {
        try {
          if (!param) throw new Error("Usage: /stt file <path>");
          if ((param.startsWith('"') || param.startsWith("'")) && (param.length < 2 || !param.endsWith(param[0]!))) {
            throw new Error("Unclosed quote in audio file path.");
          }
          const path = param.replace(/^(["'])(.*)\1$/s, "$2");
          await controller.transcribeFile(ctx, path, { signal: ctx.signal, insertIntoPrompt: true });
        } catch (error) {
          reportError(ctx, error);
        }
        return;
      }

      if (action === "start") {
        if (controller.getMode() === "idle") await controller.toggle(ctx).catch((error: unknown) => reportError(ctx, error));
        else ctx.ui.notify(`Pi Voice STT is already ${controller.getMode()}.`, "warning");
        return;
      }

      if (action === "stop") {
        await controller.stop(ctx).catch((error: unknown) => reportError(ctx, error));
        return;
      }

      if (action === "send") {
        await controller.stopAndSubmit(ctx).catch((error: unknown) => reportError(ctx, error));
        return;
      }

      if (action === "cancel") {
        await controller.cancel(ctx).catch((error: unknown) => reportError(ctx, error));
        return;
      }

      if (action === "mode") {
        const fileConfig = await readConfigFile(startup.configPath).catch(() => ({}));
        const names = listModeNames(fileConfig);
        if (!param) {
          ctx.ui.notify(`Pi Voice STT mode: ${activeMode} · available: ${names.join(", ")}`, "info");
          return;
        }
        const next = param.toLowerCase();
        if (!isKnownMode(fileConfig, next)) {
          ctx.ui.notify(`Unknown mode "${next}". Available: ${names.join(", ")}`, "error");
          return;
        }
        activeMode = next;
        ctx.ui.notify(`Pi Voice STT mode set to "${activeMode}".`, "info");
        return;
      }

      if (action === "profile") {
        const fileConfig = await readConfigFile(startup.configPath).catch(() => ({}));
        const names = listProfileNames(fileConfig);
        if (!param) {
          ctx.ui.notify(strings.profile.list(activeProfile, names), "info");
          return;
        }
        const next = param.toLowerCase();
        if (!isKnownProfile(fileConfig, next)) {
          ctx.ui.notify(strings.profile.unknown(next), "error");
          return;
        }
        if (next === activeProfile) {
          ctx.ui.notify(`Pi Voice STT profile is already "${activeProfile}".`, "info");
          return;
        }
        await switchProfile(ctx, next);
        return;
      }

      if (action === "doctor") {
        try {
          const config = await getConfig();
          assertProviderReady(config.provider);
          if (config.capture.type === "bridge") {
            await checkBridgeRecorderHealth(config.capture);
          } else {
            const ffmpeg = await pi.exec(config.capture.ffmpegPath, ["-version"], { timeout: 5000 });
            if (ffmpeg.code !== 0) throw new Error(`ffmpeg check failed: ${ffmpeg.stderr || ffmpeg.stdout}`);
          }
          ctx.ui.notify(`Pi Voice STT ready (${config.capture.type}, ${config.provider.type}/${config.provider.model}).`, "info");
        } catch (error) {
          reportError(ctx, error);
        }
        return;
      }

      if (action !== "status") {
        ctx.ui.notify("Usage: /stt [start|stop|send|file <path>|cancel|mode <name>|profile <name>|status|doctor]", "error");
        return;
      }

      const configPath = startup.configPath || "defaults only (set PI_STT_CONFIG or ~/.pi/agent/stt.json)";
      ctx.ui.notify(`Pi Voice STT: ${controller.getMode()} · mode ${activeMode} · profile ${activeProfile} · keybind ${keybind} · config ${configPath}`, "info");
    },
  });


  pi.registerShortcut(startup.profileKeybind as KeyId, {
    description: "Pi Voice STT: switch profile",
    handler: async (ctx) => {
      if (!ctx.hasUI) return;
      await showProfileMenu(ctx).catch((error: unknown) => reportError(ctx, error));
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    // Raw Kitty CSI-u fallback for ctrl+shift+<letter> keybinds: pi-tui's key
    // parser misreads Kitty modifier 5 (shift+ctrl) as ctrl-only, so match the
    // raw sequence here. Works when the terminal (and tmux, with
    // `set -s extended-keys on`) forwards the Kitty keyboard protocol.
    const kittyRegex = kittyCtrlShiftLetterRegex(profileKeybind);
    const unsubscribeTerminal = kittyRegex
      ? ctx.ui.onTerminalInput((data) => {
          if (kittyRegex.test(data)) {
            void showProfileMenu(ctx).catch((error: unknown) => reportError(ctx, error));
            return { consume: true };
          }
          return undefined;
        })
      : undefined;
    if (unsubscribeTerminal) terminalInputCleanup.push(unsubscribeTerminal);

    const uiRecord = ctx.ui as unknown as Record<string, unknown> | undefined;
    const getEditorFn = typeof uiRecord?.getEditorComponent === "function" ? (uiRecord.getEditorComponent as () => unknown) : undefined;
    const previousEditor = getEditorFn ? getEditorFn() : undefined;
    const setEditorFn = typeof uiRecord?.setEditorComponent === "function" ? (uiRecord.setEditorComponent as (factory: unknown) => void) : undefined;

    if (setEditorFn) {
      const previousFactory = typeof previousEditor === "function"
        ? (previousEditor as Parameters<typeof createVoiceEditorFactory>[0])
        : undefined;
      setEditorFn(createVoiceEditorFactory(previousFactory, {
        keybind,
        profileKeybind,
        ctx,
        getMode: () => controller.getMode(),
        renderLabel: (theme) => inputIndicator.renderLabel(theme),
        attachTui: (tui) => inputIndicator.attach(tui),
        onToggle: (handlerCtx) => {
          void (async () => {
            if (controller.getMode() === "idle") {
              await controller.toggle(handlerCtx);
              return;
            }
            const submitOnStop = await getConfig()
              .then((config) => config.output.submitOnStop)
              .catch(() => false);
            if (submitOnStop) await controller.stopAndSubmit(handlerCtx);
            else await controller.toggle(handlerCtx);
          })().catch((error: unknown) => reportError(handlerCtx, error));
        },
        onCancel: (handlerCtx) => {
          void controller.cancel(handlerCtx).catch((error: unknown) => reportError(handlerCtx, error));
        },
        onSend: (handlerCtx) => {
          void controller.stopAndSubmit(handlerCtx).catch((error: unknown) => reportError(handlerCtx, error));
        },
        onShowProfileMenu: (handlerCtx) => {
          void showProfileMenu(handlerCtx).catch((error: unknown) => reportError(handlerCtx, error));
        },
      }));
    } else {
      console.warn("Pi Voice STT voice editor UI skipped: host ExtensionUI has no setEditorComponent.");
    }
  });

  pi.on("session_shutdown", async () => {
    for (const unsubscribe of terminalInputCleanup) unsubscribe();
    terminalInputCleanup.length = 0;
    await controller.dispose();
    inputIndicator.dispose();
  });
}
