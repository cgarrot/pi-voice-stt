import test from "node:test";
import assert from "node:assert/strict";
import { buildCleanupSystemPrompt } from "../src/cleanup/prompt";
import { loadConfig } from "../src/config/load-config";
import { defaultCleanupConfig } from "../src/config/defaults";
import type { CleanupConfig } from "../src/config/types";

const baseConfig: CleanupConfig = { ...defaultCleanupConfig };

test("buildCleanupSystemPrompt keeps only the base prompt for auto language and no extras", () => {
  const prompt = buildCleanupSystemPrompt(baseConfig);
  assert.equal(prompt, defaultCleanupConfig.prompt);
  assert.doesNotMatch(prompt, /git branch/);
});

test("buildCleanupSystemPrompt adds a target language when not auto", () => {
  const prompt = buildCleanupSystemPrompt({ ...baseConfig, language: "fr" });
  assert.match(prompt, /in fr/);
});

test("buildCleanupSystemPrompt lists project terms", () => {
  const prompt = buildCleanupSystemPrompt({ ...baseConfig, projectTerms: ["Supabase", "HyperFrames"] });
  assert.match(prompt, /Supabase, HyperFrames/);
});

test("buildCleanupSystemPrompt includes branch only when useRepoContext is on", () => {
  assert.doesNotMatch(buildCleanupSystemPrompt({ ...baseConfig }, { branch: "main" }), /branch/);
  assert.match(buildCleanupSystemPrompt({ ...baseConfig, useRepoContext: true }, { branch: "feat/x" }), /feat\/x/);
});

test("loadConfig disables cleanup by default", async () => {
  const config = await loadConfig({});
  assert.equal(config.cleanup.enabled, false);
  assert.equal(config.cleanup.model, "gpt-4o-mini");
  assert.deepEqual(config.cleanup.projectTerms, []);
});

test("loadConfig parses cleanup overrides", async () => {
  const config = await loadConfig({
    cleanup: {
      enabled: true,
      model: "gpt-4.1-mini",
      language: "fr",
      projectTerms: ["Tikerama", 42, ""],
      useRepoContext: true,
    },
  });
  assert.equal(config.cleanup.enabled, true);
  assert.equal(config.cleanup.model, "gpt-4.1-mini");
  assert.equal(config.cleanup.language, "fr");
  assert.deepEqual(config.cleanup.projectTerms, ["Tikerama"]);
  assert.equal(config.cleanup.useRepoContext, true);
});
