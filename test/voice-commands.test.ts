import test from "node:test";
import assert from "node:assert/strict";
import { parseVoiceCommand } from "../src/core/voice-commands";
import { defaultVoiceCommandsConfig } from "../src/config/defaults";

const enabled = { ...defaultVoiceCommandsConfig, enabled: true };

test("parseVoiceCommand is a no-op when disabled", () => {
  const result = parseVoiceCommand("hello send", defaultVoiceCommandsConfig);
  assert.deepEqual(result, { command: null, text: "hello send" });
});

test("parseVoiceCommand detects a trailing send keyword and strips it", () => {
  assert.deepEqual(parseVoiceCommand("ship the feature send", enabled), { command: "send", text: "ship the feature" });
  assert.deepEqual(parseVoiceCommand("ship it send it.", enabled), { command: "send", text: "ship it" });
});

test("parseVoiceCommand ignores trailing punctuation", () => {
  assert.deepEqual(parseVoiceCommand("forget it scratch that.", enabled), { command: "clear", text: "forget it" });
});

test("parseVoiceCommand returns empty text when the whole utterance is the command", () => {
  assert.deepEqual(parseVoiceCommand("send", enabled), { command: "send", text: "" });
});

test("parseVoiceCommand requires a word boundary before the keyword", () => {
  assert.deepEqual(parseVoiceCommand("godsend", enabled), { command: null, text: "godsend" });
});

test("parseVoiceCommand leaves non-command transcripts untouched", () => {
  assert.deepEqual(parseVoiceCommand("just a normal sentence", enabled), { command: null, text: "just a normal sentence" });
});
