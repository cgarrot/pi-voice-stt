import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLanguage } from "../src/providers/helpers";

test("normalizeLanguage treats auto and empty values as undefined", () => {
  assert.equal(normalizeLanguage("auto"), undefined);
  assert.equal(normalizeLanguage("AUTO"), undefined);
  assert.equal(normalizeLanguage(" Auto "), undefined);
  assert.equal(normalizeLanguage(""), undefined);
  assert.equal(normalizeLanguage("   "), undefined);
  assert.equal(normalizeLanguage(undefined), undefined);
});

test("normalizeLanguage trims and preserves explicit languages", () => {
  assert.equal(normalizeLanguage("fr"), "fr");
  assert.equal(normalizeLanguage(" en "), "en");
});
