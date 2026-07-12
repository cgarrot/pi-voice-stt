import type { GladiaProviderConfig } from "../config/types";
import { audioBlobFromPath, fetchJson, normalizeLanguage, objectAt, sleep, textAt } from "./helpers";
import type { SttProvider } from "./types";

const gladiaHeaders = (apiKey: string): Record<string, string> => ({
  Accept: "application/json",
  "x-gladia-key": apiKey,
});

const resultUrlFrom = (payload: unknown, config: GladiaProviderConfig): string => {
  const resultUrl = textAt(payload, "result_url");
  if (resultUrl) return resultUrl;

  const id = textAt(payload, "id");
  if (!id) return "";
  return `${config.transcriptionEndpoint.replace(/\/$/, "")}/${id}`;
};

const transcriptFromGladia = (payload: unknown): string => {
  const result = objectAt(payload, "result");
  const transcription = objectAt(result, "transcription");
  const full = textAt(transcription, "full_transcript");
  if (full) return full;

  const direct = textAt(result, "transcript") || textAt(payload, "transcript");
  if (direct) return direct;

  return "";
};

const waitForResult = async (resultUrl: string, config: GladiaProviderConfig, signal: AbortSignal): Promise<unknown> => {
  const deadline = Date.now() + config.timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const payload = await fetchJson(
      resultUrl,
      {
        method: "GET",
        headers: gladiaHeaders(config.apiKey),
        signal,
        redirect: "error",
      },
      "Gladia transcription status",
    );

    const status = textAt(payload, "status").toLowerCase();
    if (status === "done" || status === "completed" || status === "success") return payload;
    if (status === "error" || status === "failed") {
      const error = textAt(payload, "error") || textAt(objectAt(payload, "error"), "message") || "unknown Gladia error";
      throw new Error(`Gladia transcription failed: ${error}`);
    }

    await sleep(config.pollIntervalMs, signal);
  }

  throw new Error("Gladia transcription timed out.");
};

export const createGladiaProvider = (config: GladiaProviderConfig): SttProvider => ({
  id: "gladia",
  async transcribe(input) {
    const uploadForm = new FormData();
    uploadForm.append("audio", await audioBlobFromPath(input.audioPath), "recording.wav");

    const uploadPayload = await fetchJson(
      config.uploadEndpoint,
      {
        method: "POST",
        headers: gladiaHeaders(config.apiKey),
        body: uploadForm,
        signal: input.signal,
        redirect: "error",
      },
      "Gladia audio upload",
    );

    const audioUrl = textAt(uploadPayload, "audio_url");
    if (!audioUrl) throw new Error("Gladia upload response did not include audio_url.");

    const language = normalizeLanguage(input.language ?? config.language);
    const body: Record<string, unknown> = { audio_url: audioUrl };
    if (language) body.language_config = { languages: [language], code_switching: false };

    const transcriptionPayload = await fetchJson(
      config.transcriptionEndpoint,
      {
        method: "POST",
        headers: {
          ...gladiaHeaders(config.apiKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: input.signal,
        redirect: "error",
      },
      "Gladia transcription request",
    );

    const resultUrl = resultUrlFrom(transcriptionPayload, config);
    if (!resultUrl) throw new Error("Gladia transcription response did not include result_url or id.");

    const resultPayload = await waitForResult(resultUrl, config, input.signal);
    const text = transcriptFromGladia(resultPayload);
    if (!text) throw new Error("Gladia transcription response did not include text.");
    return { text };
  },
});
