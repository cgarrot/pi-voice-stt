import type { MistralProviderConfig } from "../config/types";
import { objectFrom, textFrom } from "../utils/coerce";
import { normalizeLanguage } from "./helpers";
import { postMultipartTranscription } from "./multipart";
import type { SttProvider } from "./types";

export const createMistralProvider = (config: MistralProviderConfig): SttProvider => ({
  id: "mistral",
  async transcribe(input) {
    const payload = await postMultipartTranscription({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      authHeader: "bearer",
      model: config.model,
      audioPath: input.audioPath,
      language: normalizeLanguage(input.language ?? config.language),
      signal: input.signal,
      missingKeyMessage: "Missing Mistral API key. Set MISTRAL_API_KEY or configure provider.apiKeyEnv/keychainService/keychainAccount.",
    });
    const text = textFrom(objectFrom(payload).text);
    if (!text) throw new Error("Mistral transcription returned empty text. This usually means the audio was silent or the microphone was not captured.");
    return { text };
  },
});
