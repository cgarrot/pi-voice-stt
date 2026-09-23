import test from "node:test";
import assert from "node:assert/strict";
import { transcribeAudioPath } from "../src/core/transcribe";
import { createCleanup } from "../src/cleanup/factory";
import { deferred, testConfig } from "./helpers";

test("shared pipeline applies provider, replacements, then cleanup", async () => {
  const config = testConfig();
  const stages: string[] = [];
  const result = await transcribeAudioPath({
    audioPath: "meeting.m4a", config, signal: new AbortController().signal, processVoiceCommands: false,
    createProvider: () => ({ transcribe: async (input) => {
      assert.equal(input.audioPath, "meeting.m4a");
      assert.equal(input.language, "fr");
      stages.push("provider");
      return { text: "super base send" };
    } }),
    createCleanup: () => ({ clean: async ({ text }) => {
      assert.equal(text, "Supabase send");
      stages.push("cleanup");
      return "Supabase send.";
    } }),
    onPolishing: () => { stages.push("polishing"); },
  });
  assert.deepEqual(stages, ["provider", "polishing", "cleanup"]);
  assert.deepEqual(result, { text: "Supabase send.", command: null });
});

test("files keep voice keywords when cleanup is disabled", async () => {
  const config = testConfig();
  for (const command of ["send", "clear", "new line"]) {
    const text = `super base ${command}`;
    const result = await transcribeAudioPath({
      audioPath: "meeting.mp3", config, signal: new AbortController().signal, processVoiceCommands: false,
      createProvider: () => ({ transcribe: async () => ({ text }) }),
      createCleanup: (config) => createCleanup(config.cleanup),
    });
    assert.deepEqual(result, { text: `Supabase ${command}`, command: null });
  }
});

test("microphone voice commands are parsed before cleanup and clear skips cleanup", async () => {
  for (const [keyword, command] of [["send", "send"], ["clear", "clear"], ["new line", "newline"]]) {
    let cleaned = false;
    const result = await transcribeAudioPath({
      audioPath: "recording.wav", config: testConfig(), signal: new AbortController().signal, processVoiceCommands: true,
      createProvider: () => ({ transcribe: async () => ({ text: `super base ${keyword}` }) }),
      createCleanup: () => ({ clean: async ({ text }) => {
        assert.equal(text, "Supabase");
        cleaned = true;
        return `${text}!`;
      } }),
    });
    assert.equal(result.command, command);
    assert.equal(cleaned, command !== "clear");
  }
});

test("cleanup failure keeps the replaced transcript and reports a warning", async () => {
  let warned = false;
  const result = await transcribeAudioPath({
    audioPath: "meeting.mp3", config: testConfig(), signal: new AbortController().signal, processVoiceCommands: false,
    createProvider: () => ({ transcribe: async () => ({ text: "super base" }) }),
    createCleanup: () => ({ clean: async () => { throw new Error("cleanup unavailable"); } }),
    onCleanupFailed: () => { warned = true; },
  });
  assert.equal(result.text, "Supabase");
  assert.equal(warned, true);
});

test("cancellation during cleanup aborts it without returning the raw transcript", async () => {
  const controller = new AbortController();
  const started = deferred<AbortSignal>();
  const operation = transcribeAudioPath({
    audioPath: "meeting.mp3", config: testConfig(), signal: controller.signal, processVoiceCommands: false,
    createProvider: () => ({ transcribe: async () => ({ text: "meeting" }) }),
    createCleanup: () => ({ clean: async ({ signal }) => {
      started.resolve(signal);
      return new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } }),
    onCleanupFailed: () => assert.fail("cancellation must not fall back"),
  });
  const rejection = assert.rejects(operation, { name: "AbortError" });
  const signal = await started.promise;
  controller.abort();
  await rejection;
  assert.equal(signal.aborted, true);
});

test("provider timeout aborts the request without retrying or running cleanup", async () => {
  const config = testConfig();
  config.provider.timeoutSeconds = 0.01;
  let calls = 0;
  await assert.rejects(transcribeAudioPath({
    audioPath: "meeting.mp3", config, signal: new AbortController().signal, processVoiceCommands: false,
    createProvider: () => ({ transcribe: ({ signal }) => {
      calls++;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("provider timed out")), { once: true }));
    } }),
    createCleanup: () => assert.fail("failed provider must not run cleanup"),
  }), /provider timed out/);
  assert.equal(calls, 1);
});

test("cleanup timeout preserves the existing warned fallback", async () => {
  const config = testConfig();
  config.cleanup.timeoutSeconds = 0.01;
  let warned = false;
  const result = await transcribeAudioPath({
    audioPath: "meeting.mp3", config, signal: new AbortController().signal, processVoiceCommands: false,
    createProvider: () => ({ transcribe: async () => ({ text: "super base" }) }),
    createCleanup: () => ({ clean: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cleanup timed out")), { once: true });
    }) }),
    onCleanupFailed: () => { warned = true; },
  });
  assert.equal(result.text, "Supabase");
  assert.equal(warned, true);
});
