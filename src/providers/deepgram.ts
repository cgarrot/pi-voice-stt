import type { DeepgramProviderConfig } from "../config/types";
import { arrayAt, audioBlobFromPath, fetchJson, normalizeLanguage, objectAt, textAt } from "./helpers";
import type { SttProvider } from "./types";

const transcriptFromDeepgram = (payload: unknown): string => {
  const results = objectAt(payload, "results");
  const channel = arrayAt(results, "channels")[0];
  const alternative = arrayAt(channel, "alternatives")[0];
  return textAt(alternative, "transcript");
};

const endpointWithQuery = (config: DeepgramProviderConfig, language?: string): string => {
  const url = new URL(config.endpoint);
  if (config.model) url.searchParams.set("model", config.model);
  const lang = normalizeLanguage(language ?? config.language);
  if (lang) url.searchParams.set("language", lang);
  if (config.smartFormat) url.searchParams.set("smart_format", "true");
  return url.toString();
};

export const createDeepgramProvider = (config: DeepgramProviderConfig): SttProvider => ({
  id: "deepgram",
  async transcribe(input) {
    const payload = await fetchJson(
      endpointWithQuery(config, input.language),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Token ${config.apiKey}`,
          "Content-Type": "audio/wav",
        },
        body: await audioBlobFromPath(input.audioPath),
        signal: input.signal,
        redirect: "error",
      },
      "Deepgram transcription",
    );

    const text = transcriptFromDeepgram(payload);
    if (!text) throw new Error("Deepgram transcription response did not include text.");
    return { text };
  },
});
