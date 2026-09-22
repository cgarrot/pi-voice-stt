import type { CleanupClient } from "../cleanup/types";
import type { PluginConfig } from "../config/types";
import type { SttProvider } from "../providers/types";
import { applyReplacements } from "./replacements";
import { parseVoiceCommand, type VoiceCommandResult } from "./voice-commands";

export type TranscriptionServices = {
  createProvider(config: PluginConfig): Pick<SttProvider, "transcribe">;
  createCleanup(config: PluginConfig): CleanupClient | null;
};

type TranscribeAudioOptions = TranscriptionServices & {
  audioPath: string;
  config: PluginConfig;
  signal: AbortSignal;
  processVoiceCommands: boolean;
  onPolishing?(): void;
  onCleanupFailed?(): void;
};

const withTimeout = async <T>(signal: AbortSignal, seconds: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, seconds * 1000);
  try {
    const result = await run(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
};

/** Shared STT/replacements/cleanup pipeline; editor actions stay in the controller. */
export const transcribeAudioPath = async (options: TranscribeAudioOptions): Promise<VoiceCommandResult> => {
  const { audioPath, config, signal } = options;
  const provider = options.createProvider(config);
  const result = await withTimeout(signal, config.provider.timeoutSeconds, (providerSignal) =>
    provider.transcribe({ audioPath, language: config.provider.language, signal: providerSignal }),
  );
  signal.throwIfAborted();
  const replaced = applyReplacements(result.text, config.output.replacements);
  const voice = options.processVoiceCommands
    ? parseVoiceCommand(replaced, config.commands)
    : { text: replaced, command: null };
  if (voice.command === "clear") return voice;

  let text = voice.text;
  const cleanup = options.createCleanup(config);
  if (cleanup && text.trim()) {
    options.onPolishing?.();
    try {
      const cleaned = await withTimeout(signal, config.cleanup.timeoutSeconds, (cleanupSignal) =>
        cleanup.clean({ text, signal: cleanupSignal }),
      );
      if (cleaned.trim()) text = cleaned;
    } catch {
      signal.throwIfAborted();
      options.onCleanupFailed?.();
    }
  }
  signal.throwIfAborted();
  return { text, command: voice.command };
};
