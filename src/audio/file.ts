import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { resolvePath } from "../utils/path";
import { formatError } from "../utils/text";

const mimeTypes: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".webm": "audio/webm",
};

export const audioFileFromPath = (path: string) => {
  const extension = extname(path).toLowerCase();
  const mimeType = mimeTypes[extension];
  if (!mimeType) throw new Error(`Unsupported audio format for "${path}". Supported: ${Object.keys(mimeTypes).join(", ")}.`);
  return { path, filename: basename(path), extension, mimeType };
};

export const validateAudioFile = async (input: string, cwd: string) => {
  const localPath = input.startsWith("@") ? input.slice(1) : input;
  if (!localPath.trim()) throw new Error("An audio file path is required.");
  if (/^[a-z][a-z\d+.-]*:/i.test(localPath) && !/^[a-z]:[\\/]/i.test(localPath)) {
    throw new Error(`Only local audio files are supported: "${input}".`);
  }
  const path = resolvePath(localPath, cwd);
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Path is not a regular file.");
    await access(path, constants.R_OK);
    return { ...audioFileFromPath(path), size: info.size };
  } catch (error) {
    throw new Error(`Cannot read audio file "${path}": ${formatError(error)}`, { cause: error });
  }
};
