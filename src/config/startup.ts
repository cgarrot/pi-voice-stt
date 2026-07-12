import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { objectFrom, textFrom } from "../utils/coerce";
import { resolvePath } from "../utils/path";

export type StartupOptions = {
  configPath: string;
  keybind: string;
  locale: string;
  mode: string;
};

export const DEFAULT_CONFIG_PATH = join(homedir(), ".pi", "agent", "stt.json");

const readJsonIfPresent = (path: string): Record<string, unknown> => {
  if (!path || !existsSync(path)) return {};
  return objectFrom(JSON.parse(readFileSync(path, "utf8")));
};

export const resolveStartupOptions = (): StartupOptions => {
  const envConfigPath = textFrom(process.env.PI_STT_CONFIG);
  const configPath = envConfigPath ? resolvePath(envConfigPath) : existsSync(DEFAULT_CONFIG_PATH) ? DEFAULT_CONFIG_PATH : "";
  const config = readJsonIfPresent(configPath);
  const keybind = textFrom(process.env.PI_STT_KEYBIND, textFrom(config.keybind, "ctrl+r"));
  const locale = textFrom(process.env.PI_STT_LOCALE, textFrom(config.locale, "en"));
  const mode = textFrom(process.env.PI_STT_MODE, textFrom(config.mode, "default"));

  return { configPath, keybind, locale, mode };
};
