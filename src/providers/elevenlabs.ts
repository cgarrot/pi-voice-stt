import type { ElevenLabsProviderConfig } from "../config/types";
import { audioBlobFromPath, fetchJson, normalizeLanguage, textAt } from "./helpers";
import type { SttProvider } from "./types";

export const createElevenLabsProvider = (config: ElevenLabsProviderConfig): SttProvider => ({
  id: "elevenlabs",
  async transcribe(input) {
    const form = new FormData();
    form.append("model_id", config.model);
    form.append("file", await audioBlobFromPath(input.audioPath), "recording.wav");
    const language = normalizeLanguage(input.language ?? config.language);
    if (language) form.append("language_code", language);

    const payload = await fetchJson(
      config.endpoint,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "xi-api-key": config.apiKey,
        },
        body: form,
        signal: input.signal,
        redirect: "error",
      },
      "ElevenLabs transcription",
    );

    const text = textAt(payload, "text");
    if (!text) throw new Error("ElevenLabs transcription response did not include text.");
    return { text };
  },
});
