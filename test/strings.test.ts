import test from "node:test";
import assert from "node:assert/strict";
import { availableLocales, DEFAULT_LOCALE, resolveStrings } from "../src/i18n/strings";

test("resolveStrings defaults to English for empty or unknown locales", () => {
  assert.equal(resolveStrings("").indicator.recording, "recording");
  assert.equal(resolveStrings(undefined).indicator.recording, "recording");
  assert.equal(resolveStrings("zz").indicator.recording, "recording");
  assert.equal(DEFAULT_LOCALE, "en");
});

test("resolveStrings returns the requested built-in pack", () => {
  assert.equal(resolveStrings("fr").indicator.recording, "enregistrement");
  assert.ok(availableLocales.includes("fr"));
});

test("resolveStrings is case-insensitive and ignores region suffixes", () => {
  assert.equal(resolveStrings("FR").indicator.transcribing, "transcription");
  assert.equal(resolveStrings("fr-FR").indicator.transcribing, "transcription");
  assert.equal(resolveStrings("fr_CA").indicator.transcribing, "transcription");
});

test("startRecording interpolates the keybind", () => {
  assert.match(resolveStrings("en").toast.startRecording("ctrl+r"), /ctrl\+r/);
  assert.match(resolveStrings("fr").toast.startRecording("ctrl+r"), /ctrl\+r/);
});
