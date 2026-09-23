import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { defaultCaptureConfig, defaultCleanupConfig, defaultMistralProviderConfig, defaultOutputConfig, defaultVoiceCommandsConfig } from "../src/config/defaults";
import type { PluginConfig } from "../src/config/types";

export const testConfig = (): PluginConfig => ({
  capture: { ...defaultCaptureConfig },
  provider: { ...defaultMistralProviderConfig, apiKey: "test-key", language: "fr" },
  output: { ...defaultOutputConfig, replacements: { "super base": "Supabase" } },
  cleanup: { ...defaultCleanupConfig },
  commands: { ...defaultVoiceCommandsConfig, enabled: true, clear: ["clear"] },
});

export const audioFixture = async (t: TestContext, filename = "meeting.mp3") => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-stt-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const path = join(cwd, filename);
  await writeFile(path, "fake audio");
  return { cwd, path };
};

export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
