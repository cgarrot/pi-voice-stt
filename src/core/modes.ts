import { objectFrom } from "../utils/coerce";
import { deepMerge } from "../utils/merge";

/**
 * Modes are named presets that override any part of the configuration. They
 * are applied on top of the base config (deep-merged) before parsing, so a
 * mode can change the provider, cleanup, language, replacements, etc.
 *
 * Built-in modes work without any user configuration. User-defined modes live
 * under the `modes` config key and override a built-in mode of the same name.
 */
export const DEFAULT_MODE = "default";

export const BUILTIN_MODES: Record<string, Record<string, unknown>> = {
  // No overrides: the base configuration as-is.
  [DEFAULT_MODE]: {},
  // Pure transcript: skip the AI cleanup pass.
  raw: { cleanup: { enabled: false } },
};

/** List of available mode names (built-in plus user-defined). */
export const listModeNames = (fileConfig: Record<string, unknown>): string[] => {
  const userModes = objectFrom(fileConfig.modes);
  return Array.from(new Set([...Object.keys(BUILTIN_MODES), ...Object.keys(userModes)]));
};

/** Whether a mode name is known (built-in or user-defined). */
export const isKnownMode = (fileConfig: Record<string, unknown>, name: string): boolean =>
  listModeNames(fileConfig).includes(name);

/**
 * Resolve the override object for a mode by merging the user definition over
 * the built-in one (user wins). Unknown modes yield an empty override.
 */
export const modeOverrideFrom = (fileConfig: Record<string, unknown>, name: string): Record<string, unknown> => {
  const builtin = BUILTIN_MODES[name] ?? {};
  const userMode = objectFrom(objectFrom(fileConfig.modes)[name]);
  return deepMerge(builtin, userMode);
};
