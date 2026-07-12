#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = process.env;
const HOST = env.PI_STT_BRIDGE_HOST || "127.0.0.1";
const PORT = Number.parseInt(env.PI_STT_BRIDGE_PORT || "18765", 10);
const FFMPEG = env.PI_STT_BRIDGE_FFMPEG || "ffmpeg";
const INPUT_FORMAT = env.PI_STT_BRIDGE_INPUT_FORMAT || "avfoundation";
const INPUT = env.PI_STT_BRIDGE_INPUT || ":0";
const SAMPLE_RATE = Number.parseInt(env.PI_STT_BRIDGE_SAMPLE_RATE || "16000", 10);
const CHANNELS = Number.parseInt(env.PI_STT_BRIDGE_CHANNELS || "1", 10);
const MIN_BYTES = Number.parseInt(env.PI_STT_BRIDGE_MIN_BYTES || "4096", 10);
const MAX_SECONDS = Number.parseInt(env.PI_STT_BRIDGE_MAX_SECONDS || "120", 10);
const TOKEN_FILE = env.PI_STT_BRIDGE_TOKEN_FILE || "";
const TOKEN = (env.PI_STT_BRIDGE_TOKEN || (TOKEN_FILE ? await readFile(TOKEN_FILE, "utf8").catch(() => "") : "")).trim();
const MAX_STDERR_BYTES = 24 * 1024;

let active;

const json = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
};

const noContent = (res) => {
  res.writeHead(204);
  res.end();
};

const collectStderr = (stream) => {
  let stderr = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    stderr += chunk;
    if (Buffer.byteLength(stderr, "utf8") > MAX_STDERR_BYTES) stderr = stderr.slice(-MAX_STDERR_BYTES);
  });
  return () => stderr;
};

const waitForExit = (process) => new Promise((resolve) => {
  process.once("error", (error) => resolve(`process error: ${error?.message || String(error)}`));
  process.once("close", (code, signal) => resolve(signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`));
});

const isAuthorized = (req) => {
  if (!TOKEN) return true;
  const header = req.headers.authorization || "";
  return header === `Bearer ${TOKEN}`;
};

const terminate = (recording) => {
  if (!recording || recording.process.exitCode !== null || recording.process.killed) return;
  recording.process.kill("SIGTERM");
  setTimeout(() => {
    if (recording.process.exitCode === null && !recording.process.killed) recording.process.kill("SIGKILL");
  }, 2000).unref();
};

const cleanupRecording = async (recording) => {
  if (!recording) return;
  clearTimeout(recording.timeout);
  await rm(recording.tempDir, { recursive: true, force: true }).catch(() => {});
};

const startRecording = () => {
  if (active) return { ok: false, status: 409, error: "recording already active" };

  const tempDir = mkdtempSync(join(tmpdir(), "pi-voice-stt-bridge-"));
  const outputPath = join(tempDir, "recording.wav");
  const process = spawn(FFMPEG, [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-f",
    INPUT_FORMAT,
    "-i",
    INPUT,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    String(CHANNELS),
    "-y",
    outputPath,
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const recording = {
    process,
    tempDir,
    outputPath,
    getStderr: collectStderr(process.stderr),
    exited: waitForExit(process),
    startedAt: Date.now(),
    timeout: undefined,
  };

  recording.timeout = setTimeout(() => terminate(recording), Math.max(1, MAX_SECONDS) * 1000);
  recording.timeout.unref();
  active = recording;
  return { ok: true, status: 200, outputPath };
};

const stopRecording = async () => {
  const recording = active;
  if (!recording) return { ok: false, status: 409, error: "no active recording" };
  active = undefined;
  clearTimeout(recording.timeout);
  terminate(recording);
  const exitResult = await recording.exited;
  const stderr = recording.getStderr();

  try {
    const size = (await stat(recording.outputPath)).size;
    if (size < MIN_BYTES) {
      await cleanupRecording(recording);
      return { ok: false, status: 422, error: `recording too small (${size} bytes). ${stderr}`.trim() };
    }

    const audio = await readFile(recording.outputPath);
    await cleanupRecording(recording);
    return { ok: true, status: 200, audio, size, exitResult };
  } catch (error) {
    await cleanupRecording(recording);
    return { ok: false, status: 500, error: `ffmpeg did not create a valid audio file (${exitResult}). ${stderr || error?.message || String(error)}`.trim() };
  }
};

const cancelRecording = async () => {
  const recording = active;
  active = undefined;
  if (!recording) return;
  clearTimeout(recording.timeout);
  terminate(recording);
  await recording.exited.catch(() => {});
  await cleanupRecording(recording);
};

const readBody = (req) => new Promise((resolve) => {
  req.resume();
  req.on("end", resolve);
});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname === "/health" && req.method === "GET") {
      if (!isAuthorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
      return json(res, 200, {
        ok: true,
        active: Boolean(active),
        ffmpeg: FFMPEG,
        inputFormat: INPUT_FORMAT,
        input: INPUT,
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        tokenRequired: Boolean(TOKEN),
      });
    }

    if (!["/start", "/stop", "/cancel"].includes(url.pathname) || req.method !== "POST") {
      return json(res, 404, { ok: false, error: "not found" });
    }

    if (!isAuthorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
    await readBody(req);

    if (url.pathname === "/start") {
      const result = startRecording();
      if (!result.ok) return json(res, result.status, { ok: false, error: result.error });
      return json(res, 200, { ok: true, startedAt: Date.now() });
    }

    if (url.pathname === "/stop") {
      const result = await stopRecording();
      if (!result.ok) return json(res, result.status, { ok: false, error: result.error });
      res.writeHead(200, {
        "content-type": "audio/wav",
        "content-length": result.audio.length,
        "x-pi-voice-stt-bridge-size": String(result.size),
      });
      return res.end(result.audio);
    }

    await cancelRecording();
    return noContent(res);
  } catch (error) {
    return json(res, 500, { ok: false, error: error?.message || String(error) });
  }
});

server.on("error", (error) => {
  console.error(`[pi-voice-stt-bridge] server error: ${error?.message || String(error)}`);
  process.exitCode = 1;
});

const shutdown = async () => {
  await cancelRecording();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

server.listen(PORT, HOST, () => {
  console.log(`[pi-voice-stt-bridge] listening on http://${HOST}:${PORT} (${INPUT_FORMAT} ${INPUT})`);
});
