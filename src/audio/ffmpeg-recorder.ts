import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FfmpegCaptureConfig } from "../config/types";
import { formatError, truncate } from "../utils/text";
import type { AudioRecorder, RecordingHandle } from "./types";

const MAX_STDERR_BYTES = 24 * 1024;

const collectStderr = (stream: NodeJS.ReadableStream): (() => string) => {
  let stderr = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    stderr += chunk;
    if (Buffer.byteLength(stderr, "utf8") > MAX_STDERR_BYTES) {
      stderr = stderr.slice(-MAX_STDERR_BYTES);
    }
  });
  return () => stderr;
};

const waitForExit = (process: ChildProcess): Promise<string> => {
  return new Promise((resolve) => {
    process.once("error", (error) => resolve(`process error: ${formatError(error)}`));
    process.once("close", (code, signal) => resolve(signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`));
  });
};

export const createFfmpegRecorder = (config: FfmpegCaptureConfig): AudioRecorder => ({
  start() {
    const tempDir = mkdtempSync(join(tmpdir(), "pi-voice-stt-"));
    const outputPath = join(tempDir, "recording.wav");
    const process = spawn(config.ffmpegPath, [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "warning",
      "-f",
      config.inputFormat,
      "-i",
      config.input,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      String(config.sampleRate),
      "-ac",
      String(config.channels),
      "-y",
      outputPath,
    ], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    const getStderr = collectStderr(process.stderr);
    const exited = waitForExit(process);
    let stopped = false;

    const terminate = () => {
      if (process.exitCode !== null) return;
      try { process.kill("SIGINT"); } catch { /* already dead */ }
    };

    const forceKill = () => {
      if (process.exitCode !== null) return;
      try { process.kill("SIGKILL"); } catch { /* already dead */ }
    };

    const stop = async () => {
      if (!stopped) {
        stopped = true;
        terminate();
      }

      const killTimer = setTimeout(forceKill, 3000);
      const exitResult = await exited;
      clearTimeout(killTimer);
      const stderrText = getStderr();

      let size = 0;
      try {
        size = (await stat(outputPath)).size;
      } catch {
        throw new Error(`ffmpeg did not create an audio file (${exitResult}). ${truncate(stderrText)}`);
      }

      if (size < config.minBytes) {
        throw new Error(
          `Recording is too small (${size} bytes) — the audio source produced no data. ` +
            `Check microphone permission and that capture.inputFormat/capture.input point to a real device. ` +
            `On Linux, if the default PulseAudio source is empty, try ALSA (inputFormat "alsa", input "default"; list with: arecord -L). ` +
            truncate(stderrText),
        );
      }

      return outputPath;
    };

    const dispose = async () => {
      if (!stopped) {
        stopped = true;
        terminate();
      }
      const killTimer = setTimeout(forceKill, 3000);
      await exited.catch((error: unknown) => {
        console.warn(`Pi Voice STT recording cleanup failed: ${formatError(error)}`);
      });
      clearTimeout(killTimer);
      await rm(tempDir, { force: true, recursive: true }).catch((error: unknown) => {
        console.warn(`Pi Voice STT temp cleanup failed: ${formatError(error)}`);
      });
    };

    return {
      outputPath,
      stop,
      dispose,
    } satisfies RecordingHandle;
  },
});
