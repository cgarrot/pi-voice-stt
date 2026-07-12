import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { endpointRequiresAuth, secureEndpointFrom } from "../src/config/endpoint";
import { loadConfig } from "../src/config/load-config";

test("secureEndpointFrom accepts HTTPS endpoints", () => {
  assert.equal(secureEndpointFrom("https://example.com/v1/audio/transcriptions", ""), "https://example.com/v1/audio/transcriptions");
});

test("secureEndpointFrom accepts localhost HTTP endpoints", () => {
  assert.equal(secureEndpointFrom("http://localhost:10301/v1/audio/transcriptions", ""), "http://localhost:10301/v1/audio/transcriptions");
});

test("secureEndpointFrom rejects non-local HTTP endpoints", () => {
  assert.throws(() => secureEndpointFrom("http://example.com/v1/audio/transcriptions", ""), /HTTPS/);
});

test("endpointRequiresAuth skips auth for local HTTP", () => {
  assert.equal(endpointRequiresAuth("http://localhost:10301/v1/audio/transcriptions"), false);
  assert.equal(endpointRequiresAuth("https://api.openai.com/v1/audio/transcriptions"), true);
});

const withConfig = async (payload: unknown, run: (configPath: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-voice-stt-test-"));
  const configPath = join(dir, "config.json");
  await writeFile(configPath, JSON.stringify(payload), "utf8");

  try {
    await run(configPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test("loadConfig supports bridge capture", async () => {
  await withConfig({
    capture: {
      type: "bridge",
      endpoint: "http://127.0.0.1:18765",
      token: "bridge-secret",
      requestTimeoutSeconds: 3,
      maxSeconds: 30,
    },
    provider: { type: "groq", apiKey: "test", language: "fr" },
  }, async (configPath) => {
    const config = await loadConfig({ configPath });
    assert.equal(config.capture.type, "bridge");
    assert.equal(config.capture.endpoint, "http://127.0.0.1:18765");
    assert.equal(config.capture.token, "bridge-secret");
    assert.equal(config.capture.requestTimeoutSeconds, 3);
    assert.equal(config.capture.maxSeconds, 30);
    assert.equal(config.provider.apiKey, "test");
  });
});

test("loadConfig supports API key files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-voice-stt-test-"));
  const apiKeyPath = join(dir, "provider.env");
  const configPath = join(dir, "config.json");
  await writeFile(apiKeyPath, "export MISTRAL_API_KEY='file-secret'\n", "utf8");
  await writeFile(configPath, JSON.stringify({ provider: { type: "mistral", apiKeyFile: apiKeyPath } }), "utf8");
  const previousKey = process.env.MISTRAL_API_KEY;
  delete process.env.MISTRAL_API_KEY;

  try {
    const config = await loadConfig({ configPath });
    assert.equal(config.provider.type, "mistral");
    assert.equal(config.provider.apiKey, "file-secret");
  } finally {
    if (previousKey === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previousKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig supports Groq convenience provider", async () => {
  await withConfig({ provider: { type: "groq", apiKey: "test", language: "fr" } }, async (configPath) => {
    const config = await loadConfig({ configPath });
    assert.equal(config.provider.type, "openai-compatible");
    assert.equal(config.provider.endpoint, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(config.provider.model, "whisper-large-v3-turbo");
    assert.equal(config.provider.language, "fr");
    assert.equal(config.provider.apiKey, "test");
  });
});

test("loadConfig supports OpenAI convenience provider", async () => {
  await withConfig({ provider: { type: "openai", apiKey: "test" } }, async (configPath) => {
    const config = await loadConfig({ configPath });
    assert.equal(config.provider.type, "openai-compatible");
    assert.equal(config.provider.endpoint, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(config.provider.model, "gpt-4o-mini-transcribe");
    assert.equal(config.provider.apiKey, "test");
  });
});

test("loadConfig supports Deepgram", async () => {
  await withConfig({ provider: { type: "deepgram", apiKey: "test", language: "en" } }, async (configPath) => {
    const config = await loadConfig({ configPath });
    assert.equal(config.provider.type, "deepgram");
    assert.equal(config.provider.model, "nova-3");
    assert.equal(config.provider.language, "en");
    assert.equal(config.provider.apiKey, "test");
  });
});

test("loadConfig supports ElevenLabs", async () => {
  await withConfig({ provider: { type: "elevenlabs", apiKey: "test" } }, async (configPath) => {
    const config = await loadConfig({ configPath });
    assert.equal(config.provider.type, "elevenlabs");
    assert.equal(config.provider.model, "scribe_v1");
    assert.equal(config.provider.apiKey, "test");
  });
});

test("loadConfig supports Gladia and Gradium alias", async () => {
  await withConfig({ provider: { type: "gradium", apiKey: "test", language: "fr" } }, async (configPath) => {
    const config = await loadConfig({ configPath });
    assert.equal(config.provider.type, "gladia");
    assert.equal(config.provider.language, "fr");
    assert.equal(config.provider.apiKey, "test");
  });
});

test("loadConfig supports AssemblyAI", async () => {
  await withConfig({ provider: { type: "assemblyai", apiKey: "test", model: "universal" } }, async (configPath) => {
    const config = await loadConfig({ configPath });
    assert.equal(config.provider.type, "assemblyai");
    assert.equal(config.provider.model, "universal");
    assert.equal(config.provider.apiKey, "test");
  });
});
