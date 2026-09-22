import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDictationController, type DictationControllerOptions } from "../src/core/dictation-controller";
import { resolveStrings } from "../src/i18n/strings";
import { audioFixture, deferred, testConfig } from "./helpers";

const setup = (overrides: Partial<DictationControllerOptions> = {}) => {
  const appended: string[] = [];
  let submitted = 0;
  let recordings = 0;
  const controller = createDictationController({
    keybind: "ctrl+r", strings: resolveStrings("en"), loadConfig: async () => testConfig(),
    createProvider: () => ({ transcribe: async () => ({ text: "super base send" }) }),
    createCleanup: () => null,
    createRecorder: () => ({ start: () => {
      recordings++;
      return { outputPath: "recording.wav", stop: async () => "recording.wav", dispose: async () => {} };
    } }),
    appendPrompt: async (_ctx, text) => { appended.push(text); },
    submitPrompt: async () => { submitted++; },
    notify: () => {}, onError: (_ctx, error) => { throw error; },
    ...overrides,
  });
  return { controller, appended, getSubmitted: () => submitted, getRecordings: () => recordings };
};

test("file returns metadata without editor side effects; command insertion never submits", async (t) => {
  const { cwd, path } = await audioFixture(t);
  const ctx = { cwd } as ExtensionContext;
  const config = testConfig();
  config.output.submitOnStop = true;
  const { controller, appended, getSubmitted, getRecordings } = setup({ loadConfig: async () => config });
  t.after(() => controller.dispose());
  assert.deepEqual(await controller.transcribeFile(ctx, "./meeting.mp3"), {
    text: "Supabase send", provider: "mistral", model: config.provider.model, path,
  });
  assert.deepEqual(appended, []);
  await controller.transcribeFile(ctx, path, { insertIntoPrompt: true });
  assert.deepEqual(appended, ["Supabase send "]);
  assert.equal(getSubmitted(), 0);
  assert.equal(getRecordings(), 0);
  assert.equal(await readFile(path, "utf8"), "fake audio");
  assert.equal(controller.getMode(), "idle");
});

test("provider errors include provider, path, size and original detail without editing or retrying", async (t) => {
  const { cwd, path } = await audioFixture(t);
  let calls = 0;
  const { controller, appended } = setup({ createProvider: () => ({ transcribe: async () => {
    calls++;
    throw new Error("413: upload too large");
  } }) });
  t.after(() => controller.dispose());
  await assert.rejects(controller.transcribeFile({ cwd } as ExtensionContext, path, { insertIntoPrompt: true }), (error: Error) => {
    assert.ok(error.message.includes(path));
    assert.match(error.message, /mistral.*10 bytes.*413: upload too large/);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(appended, []);
  assert.equal(controller.getMode(), "idle");
});

test("file transcription is rejected while recording", async (t) => {
  const { cwd, path } = await audioFixture(t);
  const ctx = { cwd } as ExtensionContext;
  const { controller } = setup();
  t.after(() => controller.dispose());
  await controller.toggle(ctx);
  await assert.rejects(controller.transcribeFile(ctx, path), /busy/);
  assert.equal(controller.getMode(), "recording");
  await controller.cancel(ctx);
});

for (const cancelWith of ["cancel", "signal", "dispose"] as const) {
  test(`${cancelWith} aborts file transcription; concurrent files and recording are blocked`, async (t) => {
    const { cwd, path } = await audioFixture(t);
    const ctx = { cwd } as ExtensionContext;
    const started = deferred<AbortSignal>();
    const external = new AbortController();
    const { controller, appended, getRecordings } = setup({
      createProvider: () => ({ transcribe: async ({ signal }) => {
        started.resolve(signal);
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
      } }),
    });
    t.after(() => controller.dispose());
    const pending = controller.transcribeFile(ctx, path, { signal: external.signal, insertIntoPrompt: true });
    const rejection = assert.rejects(pending, /cancelled/);
    const signal = await started.promise;
    await assert.rejects(controller.transcribeFile(ctx, path), /busy/);
    await controller.toggle(ctx);
    assert.equal(getRecordings(), 0);
    if (cancelWith === "signal") external.abort();
    else if (cancelWith === "cancel") await controller.cancel(ctx);
    else await controller.dispose();
    await rejection;
    assert.equal(signal.aborted, true);
    assert.deepEqual(appended, []);
    assert.equal(controller.getMode(), "idle");
  });
}

test("pre-cancelled requests never call the provider and release processing state", async (t) => {
  const { cwd, path } = await audioFixture(t);
  const { controller } = setup({ createProvider: () => assert.fail("cancelled request") });
  t.after(() => controller.dispose());
  const external = new AbortController();
  external.abort();
  await assert.rejects(controller.transcribeFile({ cwd } as ExtensionContext, path, { signal: external.signal }), { name: "AbortError" });
  assert.equal(controller.getMode(), "idle");
});

test("cancelling while polishing leaves the editor unchanged and blocks other operations", async (t) => {
  const { cwd, path } = await audioFixture(t);
  const ctx = { cwd } as ExtensionContext;
  const started = deferred<AbortSignal>();
  const { controller, appended, getRecordings } = setup({ createCleanup: () => ({ clean: ({ signal }) => {
    started.resolve(signal);
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  } }) });
  t.after(() => controller.dispose());
  const pending = controller.transcribeFile(ctx, path, { insertIntoPrompt: true });
  const rejection = assert.rejects(pending, /aborted/);
  const signal = await started.promise;
  assert.equal(controller.getMode(), "polishing");
  await assert.rejects(controller.transcribeFile(ctx, path), /busy/);
  await controller.toggle(ctx);
  assert.equal(getRecordings(), 0);
  await controller.cancel(ctx);
  await rejection;
  assert.equal(signal.aborted, true);
  assert.deepEqual(appended, []);
  assert.equal(controller.getMode(), "idle");
});

test("microphone still inserts, sends, discards and adds newlines", async (t) => {
  for (const [text, expected, submitted] of [
    ["super base", ["Supabase "], 0],
    ["super base send", ["Supabase "], 1],
    ["super base clear", [], 0],
    ["super base new line", ["Supabase ", "\n"], 0],
  ] as const) {
    const { controller, appended, getSubmitted } = setup({ createProvider: () => ({ transcribe: async () => ({ text }) }) });
    t.after(() => controller.dispose());
    const ctx = {} as ExtensionContext;
    await controller.toggle(ctx);
    await controller.stop(ctx);
    assert.deepEqual(appended, expected);
    assert.equal(getSubmitted(), submitted);
  }
});
