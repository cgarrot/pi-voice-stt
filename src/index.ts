import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { checkBridgeRecorderHealth } from "./audio/bridge-recorder";
import { createRecorder } from "./audio/factory";
import { loadConfig, readConfigFile } from "./config/load-config";
import { resolveStartupOptions } from "./config/startup";
import { createDictationController, type DictationToast } from "./core/dictation-controller";
import { DEFAULT_MODE, isKnownMode, listModeNames } from "./core/modes";
import { createProvider } from "./providers/factory";
import { createCleanup } from "./cleanup/factory";
import { assertProviderReady } from "./providers/readiness";
import { createInputIndicator, createVoiceEditorFactory } from "./ui/input-indicator";
import { resolveStrings } from "./i18n/strings";
import { formatError } from "./utils/text";

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
  const strings = resolveStrings(startup.locale);
  const inputIndicator = createInputIndicator(keybind, strings);
  let activeMode = startup.mode || DEFAULT_MODE;

  const getConfig = () => loadConfig({ configPath: startup.configPath, mode: activeMode });

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

  pi.registerCommand("stt", {
    description: "Voice dictation controls: start, stop, send, cancel, mode, status, doctor.",
    getArgumentCompletions: (prefix) => {
      const commands = ["start", "stop", "send", "cancel", "mode", "status", "doctor"];
      return commands
        .filter((command) => command.startsWith(prefix.trim().toLowerCase()))
        .map((command) => ({ value: command, label: command }));
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const [first, ...rest] = trimmed.split(/\s+/);
      const action = (first || "status").toLowerCase();
      const param = rest.join(" ").trim();

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
        ctx.ui.notify("Usage: /stt [start|stop|send|cancel|mode <name>|status|doctor]", "error");
        return;
      }

      const configPath = startup.configPath || "defaults only (set PI_STT_CONFIG or ~/.pi/agent/stt.json)";
      ctx.ui.notify(`Pi Voice STT: ${controller.getMode()} · mode ${activeMode} · keybind ${keybind} · config ${configPath}`, "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    const previousEditor = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent(createVoiceEditorFactory(previousEditor, {
      keybind,
      ctx,
      getMode: () => controller.getMode(),
      renderLabel: (theme) => inputIndicator.renderLabel(theme),
      attachTui: (tui) => inputIndicator.attach(tui),
      onToggle: (handlerCtx) => {
        void (async () => {
          // Idle -> start recording. While recording/processing -> stop. The
          // stop path honors output.submitOnStop: when enabled, Ctrl+R also
          // sends the transcript to chat (like Enter), instead of only
          // inserting it into the prompt.
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
    }));
  });

  pi.on("session_shutdown", async () => {
    await controller.dispose();
    inputIndicator.dispose();
  });
}
