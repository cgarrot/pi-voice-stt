import test from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { defaultAssemblyAiProviderConfig, defaultDeepgramProviderConfig, defaultElevenLabsProviderConfig, defaultGladiaProviderConfig, defaultMistralProviderConfig, defaultOpenAiCompatibleProviderConfig } from "../src/config/defaults";
import { createProvider } from "../src/providers/factory";
import { audioFixture } from "./helpers";

const configs = [defaultMistralProviderConfig, defaultOpenAiCompatibleProviderConfig, defaultElevenLabsProviderConfig,
  defaultGladiaProviderConfig, defaultDeepgramProviderConfig, defaultAssemblyAiProviderConfig];

for (const config of configs) {
  for (const [filename, mimeType] of [["recording.wav", "audio/wav"], ["My meeting.mp3", "audio/mpeg"], ["My meeting.m4a", "audio/mp4"]] as const) {
    test(`${config.type} uploads ${filename} unchanged with correct metadata`, async (t) => {
      const { path } = await audioFixture(t, filename);
      const controller = new AbortController();
      let uploads = 0;
      t.mock.method(globalThis, "fetch", async (url: string | URL, init: RequestInit) => {
        assert.equal(init.signal, controller.signal);
        if (init.body instanceof FormData) {
          const file = init.body.get(config.type === "gladia" ? "audio" : "file") as File;
          assert.equal(file.name, basename(path));
          assert.equal(file.type, mimeType);
          assert.equal(await file.text(), "fake audio");
          uploads++;
        } else if (init.body instanceof Blob) {
          assert.equal(init.body.type, mimeType);
          assert.equal(await init.body.text(), "fake audio");
          const contentType = new Headers(init.headers).get("Content-Type");
          assert.equal(contentType, config.type === "assemblyai" ? "application/octet-stream" : mimeType);
          uploads++;
        }
        if (String(url).endsWith("/upload")) return Response.json({ audio_url: "https://audio.example/test", upload_url: "https://audio.example/test" });
        if (config.type === "gladia") {
          return Response.json(init.method === "POST" ? { id: "test" } : { status: "done", result: { transcription: { full_transcript: "Meeting" } } });
        }
        if (config.type === "assemblyai") return Response.json(init.method === "POST" ? { id: "test" } : { status: "completed", text: "Meeting" });
        if (config.type === "deepgram") return Response.json({ results: { channels: [{ alternatives: [{ transcript: "Meeting" }] }] } });
        return Response.json({ text: "Meeting" });
      });
      const result = await createProvider({ ...config, apiKey: "test-key" }).transcribe({ audioPath: path, signal: controller.signal });
      assert.deepEqual(result, { text: "Meeting" });
      assert.equal(uploads, 1);
    });
  }
}
