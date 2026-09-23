import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createSonioxProvider } from "../src/providers/soniox";
import { defaultSonioxProviderConfig } from "../src/config/defaults";

type RecordedRequest = {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
};

// Build a fetch mock that returns each response in `responses` in order and
// records every request. Leftover calls resolve to a generic 200 JSON body.
const mockFetch = (responses: Array<{ status: number; body: unknown }>) => {
  const calls: RecordedRequest[] = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else if (init?.body && typeof (init.body as Blob).arrayBuffer === "function") {
      body = { __blob__: true };
    }
    calls.push({
      method: String(init?.method ?? "GET"),
      url: String(input),
      headers: new Headers(init?.headers),
      body,
    });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchMock };
};

test("Soniox provider runs the async upload/create/poll/fetch flow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-voice-stt-soniox-"));
  const audioPath = join(dir, "audio.wav");
  await writeFile(audioPath, Buffer.from("fake-wav-bytes"), "utf8");

  const { calls, fetchMock } = mockFetch([
    { status: 200, body: { id: "file-1", filename: "recording.wav", size: 14, created_at: "now" } },
    { status: 200, body: { id: "job-1", status: "queued" } },
    { status: 200, body: { status: "processing" } },
    { status: 200, body: { status: "completed" } },
    { status: 200, body: { id: "job-1", text: "hello world", tokens: [] } },
    { status: 204, body: {} },
    { status: 204, body: {} },
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as typeof fetch;
  try {
    const provider = createSonioxProvider({ ...defaultSonioxProviderConfig, apiKey: "k", pollIntervalMs: 1 });
    const result = await provider.transcribe({
      audioPath,
      language: "en",
      signal: new AbortController().signal,
    });
    assert.equal(result.text, "hello world");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }

  const methods = calls.map((c) => c.url);
  assert.ok(methods.some((u) => u.endsWith("/v1/files")), "expected a POST to /v1/files");
  assert.ok(methods.some((u) => u.endsWith("/v1/transcriptions")), "expected a POST to /v1/transcriptions");
  assert.ok(methods.some((u) => u.endsWith("/v1/transcriptions/job-1")), "expected a poll GET to /v1/transcriptions/job-1");
  assert.ok(methods.some((u) => u.endsWith("/v1/transcriptions/job-1/transcript")), "expected a GET to the transcript URL");

  const order = calls.map((c) => c.url);
  const fileIndex = order.findIndex((u) => u.endsWith("/v1/files"));
  const createIndex = order.findIndex((u) => u.endsWith("/v1/transcriptions") && !u.endsWith("/job-1"));
  assert.ok(fileIndex >= 0 && createIndex > fileIndex, "upload must precede transcription creation");

  assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/v1/transcriptions/job-1")), "expected DELETE of the transcription");
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/v1/files/file-1")), "expected DELETE of the file");

  const createCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/transcriptions"));
  assert.ok(createCall, "expected transcription create request");
  const createBody = createCall && typeof createCall.body === "object" && createCall.body !== null ? (createCall.body as Record<string, unknown>) : {};
  assert.equal(createBody.model, "stt-async-v5");
  assert.equal(createBody.file_id, "file-1");
  assert.deepEqual(createBody.language_hints, ["en"]);

  assert.ok(calls.some((c) => c.method === "POST" && c.url.endsWith("/v1/files")), "upload must be a POST");
});
