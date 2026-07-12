import test from "node:test";
import assert from "node:assert/strict";
import { formatTranscriptForPrompt } from "../src/core/output";

test("formatTranscriptForPrompt trims and appends a trailing space by default", () => {
  assert.equal(formatTranscriptForPrompt("  hello world  ", { appendTrailingSpace: true, submitOnStop: false }), "hello world ");
});

test("formatTranscriptForPrompt can omit trailing space", () => {
  assert.equal(formatTranscriptForPrompt("  hello world  ", { appendTrailingSpace: false, submitOnStop: false }), "hello world");
});

test("formatTranscriptForPrompt returns empty text for empty transcripts", () => {
  assert.equal(formatTranscriptForPrompt("   ", { appendTrailingSpace: true, submitOnStop: false }), "");
});
