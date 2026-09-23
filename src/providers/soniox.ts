import type { SonioxProviderConfig } from "../config/types";
import { arrayAt, audioBlobFromPath, fetchJson, normalizeLanguage, sleep, textAt } from "./helpers";
import type { SttProvider } from "./types";

const sonioxHeaders = (apiKey: string): Record<string, string> => ({
  Accept: "application/json",
  Authorization: `Bearer ${apiKey}`,
});

const trimSlash = (url: string): string => url.replace(/\/$/, "");

const transcriptTextFrom = (payload: unknown): string => {
  const direct = textAt(payload, "text");
  if (direct) return direct;
  return arrayAt(payload, "tokens").map((token) => textAt(token, "text")).join("").trim();
};

const waitForTranscription = async (base: string, id: string, config: SonioxProviderConfig, signal: AbortSignal): Promise<void> => {
  const deadline = Date.now() + config.timeoutSeconds * 1000;
  const url = `${base}/v1/transcriptions/${id}`;
  while (Date.now() < deadline) {
    const payload = await fetchJson(url, { method: "GET", headers: sonioxHeaders(config.apiKey), signal, redirect: "error" }, "Soniox transcription status");
    const status = textAt(payload, "status").toLowerCase();
    if (status === "completed") return;
    if (status === "error" || status === "failed") {
      throw new Error(`Soniox transcription failed: ${textAt(payload, "error_message") || "unknown Soniox error"}`);
    }
    await sleep(config.pollIntervalMs, signal);
  }
  throw new Error("Soniox transcription timed out.");
};

const deleteQuietly = async (url: string, apiKey: string): Promise<void> => {
  try {
    await fetch(url, { method: "DELETE", headers: sonioxHeaders(apiKey), redirect: "error" });
  } catch {
    // best-effort cleanup
  }
};

export const createSonioxProvider = (config: SonioxProviderConfig): SttProvider => ({
  id: "soniox",
  async transcribe(input) {
    const base = trimSlash(config.baseUrl);
    const uploadForm = new FormData();
    uploadForm.append("file", await audioBlobFromPath(input.audioPath), "recording.wav");
    const uploadPayload = await fetchJson(`${base}/v1/files`, { method: "POST", headers: sonioxHeaders(config.apiKey), body: uploadForm, signal: input.signal, redirect: "error" }, "Soniox audio upload");
    const fileId = textAt(uploadPayload, "id");
    if (!fileId) throw new Error("Soniox upload response did not include id.");
    let transcriptionId = "";
    try {
      const language = normalizeLanguage(input.language ?? config.language);
      const body: Record<string, unknown> = { model: config.model, file_id: fileId };
      if (language) body.language_hints = [language];
      const createPayload = await fetchJson(`${base}/v1/transcriptions`, { method: "POST", headers: { ...sonioxHeaders(config.apiKey), "Content-Type": "application/json" }, body: JSON.stringify(body), signal: input.signal, redirect: "error" }, "Soniox transcription request");
      transcriptionId = textAt(createPayload, "id");
      if (!transcriptionId) throw new Error("Soniox transcription response did not include id.");
      await waitForTranscription(base, transcriptionId, config, input.signal);
      const transcriptPayload = await fetchJson(`${base}/v1/transcriptions/${transcriptionId}/transcript`, { method: "GET", headers: sonioxHeaders(config.apiKey), signal: input.signal, redirect: "error" }, "Soniox transcript");
      const text = transcriptTextFrom(transcriptPayload);
      if (!text) throw new Error("Soniox transcript response did not include text.");
      return { text };
    } finally {
      if (transcriptionId) await deleteQuietly(`${base}/v1/transcriptions/${transcriptionId}`, config.apiKey);
      await deleteQuietly(`${base}/v1/files/${fileId}`, config.apiKey);
    }
  },
});
