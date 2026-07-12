import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PluginConfig } from "../src/config/types";
import { resolveStrings } from "../src/i18n/strings";
import { defaultCleanupConfig, defaultVoiceCommandsConfig } from "../src/config/defaults";
import { createDictationController } from "../src/core/dictation-controller";

const config: PluginConfig = {
  capture: {
    type: "ffmpeg",
    ffmpegPath: "ffmpeg",
    inputFormat: "avfoundation",
    input: ":0",
    sampleRate: 16000,
    channels: 1,
    maxSeconds: 30,
    minBytes: 1,
  },
  provider: {
    type: "mistral",
    endpoint: "https://api.mistral.ai/v1/audio/transcriptions",
    model: "voxtral-mini-latest",
    language: "en",
    timeoutSeconds: 30,
    apiKey: "test-key",
    apiKeyEnv: "MISTRAL_API_KEY",
    apiKeyFile: "",
    keychainService: "",
    keychainAccount: "",
  },
  output: { appendTrailingSpace: true, submitOnStop: false, replacements: {} },
  cleanup: { ...defaultCleanupConfig },
  commands: { ...defaultVoiceCommandsConfig },
};

test("cancel during processing disposes the active recording handle", async () => {
  const ctx = {} as ExtensionContext;
  let stopStarted = false;
  let stopResolve: ((path: string) => void) | undefined;
  let disposeCount = 0;
  let transcribeSawAbort = false;

  const controller = createDictationController({
    keybind: "ctrl+r",
    strings: resolveStrings("en"),
    loadConfig: async () => config,
    createRecorder: () => ({
      start: () => ({
        outputPath: "pending.wav",
        stop: async () => {
          stopStarted = true;
          return new Promise<string>((resolve) => {
            stopResolve = resolve;
          });
        },
        dispose: async () => {
          disposeCount += 1;
          stopResolve?.("audio.wav");
        },
      }),
    }),
    createProvider: () => ({
      transcribe: async ({ signal }) => {
        transcribeSawAbort = signal.aborted;
        throw new Error("aborted");
      },
    }),
    createCleanup: () => null,
    appendPrompt: async () => assert.fail("cancelled transcription should not append"),
    submitPrompt: async () => assert.fail("cancelled transcription should not submit"),
    notify: () => {},
    onError: (_ctx, error) => { throw error; },
  });

  await controller.toggle(ctx);
  const stopPromise = controller.stop(ctx);
  assert.equal(stopStarted, true);

  await controller.cancel(ctx);
  await stopPromise;

  assert.ok(disposeCount >= 1);
  assert.equal(transcribeSawAbort, true);
  assert.equal(controller.getMode(), "idle");
});
