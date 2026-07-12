import { readFile } from "node:fs/promises";
import { textFrom } from "../utils/coerce";
import { resolvePath } from "../utils/path";
import { formatError } from "../utils/text";
import { readKeychainSecret } from "./keychain";

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseApiKeyFile = (contents: string, envName: string): string => {
  const raw = contents.trim();
  if (!raw) return "";
  if (!raw.includes("=")) return raw;

  for (const line of raw.split(/\r?\n/)) {
    const withoutComment = line.trim();
    if (!withoutComment || withoutComment.startsWith("#")) continue;
    const normalized = withoutComment.startsWith("export ") ? withoutComment.slice("export ".length).trim() : withoutComment;
    const separator = normalized.indexOf("=");
    if (separator === -1) continue;
    const key = normalized.slice(0, separator).trim();
    if (key !== envName) continue;
    return unquote(normalized.slice(separator + 1));
  }

  return "";
};

const readApiKeyFile = async (filePath: string, envName: string): Promise<string> => {
  const resolved = resolvePath(filePath);
  try {
    return parseApiKeyFile(await readFile(resolved, "utf8"), envName);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`API key file does not exist: ${resolved}`);
    throw new Error(`Cannot read API key file ${resolved}: ${formatError(error)}`);
  }
};

export const resolveApiKey = async (input: Record<string, unknown>, defaultEnv: string): Promise<string> => {
  const explicitKey = textFrom(input.apiKey);
  if (explicitKey) return explicitKey;

  const apiKeyEnv = typeof input.apiKeyEnv === "string" ? input.apiKeyEnv.trim() : defaultEnv;
  const envKey = apiKeyEnv ? textFrom(process.env[apiKeyEnv]) : "";
  if (envKey) return envKey;

  const apiKeyFile = textFrom(input.apiKeyFile);
  const fileKey = apiKeyFile ? textFrom(await readApiKeyFile(apiKeyFile, apiKeyEnv)) : "";
  if (fileKey) return fileKey;

  return readKeychainSecret(textFrom(input.keychainService), textFrom(input.keychainAccount));
};
