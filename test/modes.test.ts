import test from "node:test";
import assert from "node:assert/strict";
import { deepMerge } from "../src/utils/merge";
import { BUILTIN_MODES, isKnownMode, listModeNames, modeOverrideFrom } from "../src/core/modes";
import { loadConfig } from "../src/config/load-config";

test("deepMerge merges nested objects and replaces arrays/scalars", () => {
  const merged = deepMerge(
    { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] },
    { a: 2, nested: { y: 3, z: 4 }, list: [9] },
  );
  assert.deepEqual(merged, { a: 2, nested: { x: 1, y: 3, z: 4 }, list: [9] });
});

test("built-in raw mode disables cleanup", () => {
  assert.deepEqual(BUILTIN_MODES.raw, { cleanup: { enabled: false } });
});

test("listModeNames combines built-in and user modes without duplicates", () => {
  const names = listModeNames({ modes: { commit: {}, raw: {} } });
  assert.ok(names.includes("default"));
  assert.ok(names.includes("raw"));
  assert.ok(names.includes("commit"));
  assert.equal(names.filter((n) => n === "raw").length, 1);
});

test("modeOverrideFrom lets user modes override built-ins of the same name", () => {
  const override = modeOverrideFrom({ modes: { raw: { cleanup: { enabled: true } } } }, "raw");
  assert.deepEqual(override, { cleanup: { enabled: true } });
  assert.equal(isKnownMode({}, "raw"), true);
  assert.equal(isKnownMode({}, "nope"), false);
});

test("loadConfig applies the active mode override", async () => {
  const base = {
    cleanup: { enabled: true },
    modes: { raw: { cleanup: { enabled: false } } },
  };
  const withCleanup = await loadConfig({ ...base, mode: "default" });
  assert.equal(withCleanup.cleanup.enabled, true);
  const raw = await loadConfig({ ...base, mode: "raw" });
  assert.equal(raw.cleanup.enabled, false);
});
