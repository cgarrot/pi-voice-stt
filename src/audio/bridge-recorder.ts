import { mkdtempSync } from "node:fs";
import { rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BridgeCaptureConfig } from "../config/types";
import { formatError, truncate } from "../utils/text";
import type { AudioRecorder, RecordingHandle } from "./types";

const bridgeUrl = (endpoint: string, path: string) => `${endpoint.replace(/\/+$/, "")}${path}`;

const headersFrom = (config: BridgeCaptureConfig): Record<string, string> => {
  if (!config.token) return {};
  return { authorization: `Bearer ${config.token}` };
};

const maxPcm16LeAmplitude = (audio: Buffer): number | undefined => {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") return undefined;

  let offset = 12;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(dataStart + chunkSize, audio.length);

    if (chunkId === "data") {
      let max = 0;
      for (let index = dataStart; index + 1 < dataEnd; index += 2) {
        const sample = Math.abs(audio.readInt16LE(index));
        if (sample > max) max = sample;
      }
      return max;
    }

    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  return undefined;
};

type BridgeRequestOptions = {
  method: "GET" | "POST";
  timeoutSeconds: number;
};

const requestBridge = async (config: BridgeCaptureConfig, path: string, options: BridgeRequestOptions): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutSeconds * 1000);
  try {
    const response = await fetch(bridgeUrl(config.endpoint, path), {
      method: options.method,
      headers: headersFrom(config),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`STT bridge ${options.method} ${path} failed (${response.status}): ${truncate(body)}`);
    }
    return response;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`STT bridge ${options.method} ${path} timed out after ${options.timeoutSeconds}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const discardBody = async (response: Response): Promise<void> => {
  await response.arrayBuffer().catch(() => {});
};

export const checkBridgeRecorderHealth = async (config: BridgeCaptureConfig): Promise<void> => {
  const response = await requestBridge(config, "/health", { method: "GET", timeoutSeconds: Math.min(config.requestTimeoutSeconds, 10) });
  await discardBody(response);
};

export const createBridgeRecorder = (config: BridgeCaptureConfig): AudioRecorder => ({
  async start() {
    const tempDir = mkdtempSync(join(tmpdir(), "pi-voice-stt-"));
    const outputPath = join(tempDir, "recording.wav");
    let finished = false;

    try {
      const response = await requestBridge(config, "/start", { method: "POST", timeoutSeconds: config.requestTimeoutSeconds });
      await discardBody(response);
    } catch (error) {
      await rm(tempDir, { force: true, recursive: true }).catch(() => {});
      throw error;
    }

    const stop = async () => {
      if (finished) return outputPath;

      let response: Response;
      try {
        response = await requestBridge(config, "/stop", { method: "POST", timeoutSeconds: config.requestTimeoutSeconds });
      } catch (error) {
        throw new Error(`STT bridge could not stop recording: ${formatError(error)}`);
      }

      const audio = Buffer.from(await response.arrayBuffer());
      await writeFile(outputPath, audio);
      const size = (await stat(outputPath)).size;
      if (size < config.minBytes) {
        throw new Error(`Bridge recording is too small (${size} bytes). Check Mac microphone permission/device.`);
      }

      const maxAmplitude = maxPcm16LeAmplitude(audio);
      if (maxAmplitude !== undefined && maxAmplitude <= 3) {
        throw new Error("Bridge recording is silent. On macOS, make sure the bridge is launched by an app with microphone permission (Terminal/cmux) and that the selected input device is correct.");
      }

      finished = true;
      return outputPath;
    };

    const dispose = async () => {
      if (!finished) {
        const response = await requestBridge(config, "/cancel", { method: "POST", timeoutSeconds: Math.min(config.requestTimeoutSeconds, 10) }).catch((error: unknown) => {
          console.warn(`Pi Voice STT bridge cleanup failed: ${formatError(error)}`);
          return undefined;
        });
        if (response) await discardBody(response);
        finished = true;
      }

      await rm(tempDir, { force: true, recursive: true }).catch((error: unknown) => {
        console.warn(`Pi Voice STT bridge temp cleanup failed: ${formatError(error)}`);
      });
    };

    return {
      outputPath,
      stop,
      dispose,
    } satisfies RecordingHandle;
  },
});
