/**
 * Live end-to-end check for the realtime streaming path.
 *
 * Drives the real capture -> websocket -> controller pipeline against a wav
 * file (ffmpeg `-re` paces it at wall-clock speed) with a fake
 * ExtensionContext, so frame chunking, turn handling, live editor writes and
 * the auto-stop on capture exit are all exercised without a TUI or a
 * microphone. Requires ASSEMBLYAI_API_KEY.
 *
 * Usage: npx tsx tools/verify-realtime.mts [path-to-wav] [language]
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFfmpegStreamer } from "../src/audio/stream-recorder";
import { loadConfig } from "../src/config/load-config";
import { createRealtimeController } from "../src/core/realtime-controller";
import { resolveStrings } from "../src/i18n/strings";
import { openAssemblyAiStream } from "../src/providers/assemblyai-stream";

const wavPath = process.argv[2] ?? "/tmp/rt.wav";
const language = process.argv[3] ?? "auto";
const configPath = join(tmpdir(), "pi-voice-stt-realtime-verify.json");

writeFileSync(
  configPath,
  JSON.stringify(
    {
      provider: {
        type: "assemblyai",
        model: "assemblyai-stt-3-7",
        language: "auto",
        apiKeyEnv: "ASSEMBLYAI_API_KEY",
      },
      capture: { type: "ffmpeg", inputFormat: "pulse", input: "default" },
      realtime: {
        enabled: true,
        language,
        keyterms: ["Aika", "AssemblyAI", "pi-voice-stt"],
        capture: { inputFormat: "wav", input: wavPath, realtimeInput: true, chunkMs: 100 },
      },
    },
    null,
    2,
  ),
);

const config = await loadConfig({ configPath });
console.log("--- resolved config ---");
console.log("  provider        :", `${config.provider.type}/${config.provider.model}`);
console.log("  realtime enabled:", config.realtime.enabled);
console.log("  realtime model  :", `${config.realtime.model}/${config.realtime.mode}`);
console.log("  realtime language:", config.realtime.language);
console.log("  realtime capture:", `${config.realtime.capture.inputFormat}:${config.realtime.capture.input} chunk=${config.realtime.capture.chunkMs}ms -re=${config.realtime.capture.realtimeInput}`);
console.log("  api key resolved:", config.realtime.apiKey.length > 0 ? `yes (${config.realtime.apiKey.length} chars)` : "NO");
if (!config.realtime.apiKey) process.exit(2);

const partials: string[] = [];
const finals: string[] = [];
const modes: string[] = [];
let editorText = "";

const controller = createRealtimeController({
  strings: resolveStrings("en"),
  loadConfig: async () => config,
  createStreamer: (loaded) => createFfmpegStreamer(loaded.realtime.capture),
  openStream: (loaded, events, signal) =>
    openAssemblyAiStream(loaded.realtime, {
      ...events,
      onReady: (info) => console.log(`  [ready] ${info.model}/${info.mode} id=${info.id}`),
      onPartial: (text, turnOrder, stableText) => {
        partials.push(text);
        console.log(`  [partial] ${text}`);
        events.onPartial?.(text, turnOrder, stableText);
      },
      onFinal: (text, turnOrder, speaker) => {
        finals.push(text);
        console.log(`  [final  ] ${text}`);
        events.onFinal?.(text, turnOrder, speaker);
      },
      onClosed: (info) => {
        console.log(
          `  [closed] ${info ? `${info.audioSeconds}s audio / ${info.sessionSeconds}s session` : "no Termination received"}`,
        );
        events.onClosed?.(info);
      },
    }, signal),
  getEditorText: () => editorText,
  setEditorText: (_ctx, text) => {
    editorText = text;
  },
  insertPrompt: (_ctx, text) => {
    editorText += text;
  },
  notify: (_ctx, toast) => console.log(`  [toast ${toast.variant ?? "info"}] ${toast.message}`),
  onModeChange: (mode) => modes.push(mode),
  onError: (_ctx, error) => console.log("  [ERROR]", error instanceof Error ? error.message : String(error)),
});

// SAFETY: The controller only reads hasUI; this harness supplies editor and notification callbacks.
const ctx = { hasUI: true, ui: {} } as unknown as ExtensionContext;

console.log("--- streaming ---");
await controller.start(ctx);
const deadline = Date.now() + 90_000;
while (controller.isActive() && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (controller.isActive()) {
  console.log("timed out; forcing cancel");
  await controller.cancel(ctx);
}
await controller.dispose();

console.log("\n--- results ---");
console.log("  partials seen :", partials.length);
console.log("  finals seen   :", finals.length);
console.log("  modes         :", modes.join(" -> "));
console.log("  editor text   :", JSON.stringify(editorText));

const normalized = editorText.toLowerCase().replace(/-/g, "");
const ok = finals.length >= 3 && normalized.includes("realtime streaming test");
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
