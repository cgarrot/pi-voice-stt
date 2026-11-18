import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultAssemblyAiProviderConfig } from "../src/config/defaults";
import { buildSpeechModels, createAssemblyAiProvider } from "../src/providers/assemblyai";
import { audioFixture } from "./helpers";

test("defaults route assemblyai-stt-3-7 with the universal-2 fallback", () => {
  assert.deepEqual(buildSpeechModels(defaultAssemblyAiProviderConfig.model), ["assemblyai-stt-3-7", "universal-2"]);
});

for (const [language, expected] of [
  ["auto", { language_detection: true }],
  ["pt", { language_code: "pt" }],
  ["en, pt", { language_codes: ["en", "pt"] }],
] as const) {
  test(`transcript request for language "${language}" keeps disfluencies off`, async (t) => {
    const { path } = await audioFixture(t, "recording.wav");
    let body: Record<string, unknown> = {};
    t.mock.method(globalThis, "fetch", async (url: string | URL, init: RequestInit) => {
      if (String(url).endsWith("/upload")) return Response.json({ upload_url: "https://audio.example/test" });
      if (init.method === "POST") {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ id: "test" });
      }
      return Response.json({ status: "completed", text: "ok" });
    });
    const provider = createAssemblyAiProvider({ ...defaultAssemblyAiProviderConfig, apiKey: "k", language });
    await provider.transcribe({ audioPath: path, signal: new AbortController().signal });
    assert.deepEqual(body, {
      audio_url: "https://audio.example/test",
      speech_models: ["assemblyai-stt-3-7", "universal-2"],
      disfluencies: false,
      ...expected,
    });
  });
}

test("buildSpeechModels maps the legacy universal alias to universal-2", () => {
  assert.deepEqual(buildSpeechModels("universal"), ["universal-2"]);
});

test("buildSpeechModels appends universal-2 as the fallback tier", () => {
  assert.deepEqual(buildSpeechModels("universal-3-5-pro"), ["universal-3-5-pro", "universal-2"]);
});

test("buildSpeechModels passes a comma-separated preference list through", () => {
  assert.deepEqual(buildSpeechModels("universal-3-5-pro, universal-2"), ["universal-3-5-pro", "universal-2"]);
});

test("buildSpeechModels trims entries and drops empties", () => {
  assert.deepEqual(buildSpeechModels("  universal-3-5-pro ,, "), ["universal-3-5-pro", "universal-2"]);
});

test("buildSpeechModels does not duplicate universal-2", () => {
  assert.deepEqual(buildSpeechModels("universal-2"), ["universal-2"]);
  assert.deepEqual(buildSpeechModels("universal-2, universal"), ["universal-2"]);
});

test("buildSpeechModels falls back to universal-2 for an empty model", () => {
  assert.deepEqual(buildSpeechModels(""), ["universal-2"]);
});
