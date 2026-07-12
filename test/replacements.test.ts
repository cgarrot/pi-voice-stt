import test from "node:test";
import assert from "node:assert/strict";
import { applyReplacements } from "../src/core/replacements";

test("applyReplacements is case-insensitive and word-boundary aware", () => {
  assert.equal(applyReplacements("I deployed to super base today", { "super base": "Supabase" }), "I deployed to Supabase today");
  assert.equal(applyReplacements("Super Base rocks", { "super base": "Supabase" }), "Supabase rocks");
  assert.equal(applyReplacements("superbase", { "super base": "Supabase" }), "superbase");
});

test("applyReplacements applies longer keys first", () => {
  const replacements = { "react": "React", "react native": "React Native" };
  assert.equal(applyReplacements("I use react native daily", replacements), "I use React Native daily");
});

test("applyReplacements is a no-op for empty input or empty map", () => {
  assert.equal(applyReplacements("", { a: "b" }), "");
  assert.equal(applyReplacements("unchanged text", {}), "unchanged text");
});
