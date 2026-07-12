import type { AssemblyAiProviderConfig } from "../config/types";
import { audioBlobFromPath, fetchJson, normalizeLanguage, objectAt, sleep, textAt } from "./helpers";
import type { SttProvider } from "./types";

const authHeaders = (apiKey: string): Record<string, string> => ({
  Accept: "application/json",
  Authorization: apiKey,
});

const waitForTranscript = async (id: string, config: AssemblyAiProviderConfig, signal: AbortSignal): Promise<unknown> => {
  const deadline = Date.now() + config.timeoutSeconds * 1000;
  const url = `${config.transcriptEndpoint.replace(/\/$/, "")}/${id}`;

  while (Date.now() < deadline) {
    const payload = await fetchJson(
      url,
      {
        method: "GET",
        headers: authHeaders(config.apiKey),
        signal,
        redirect: "error",
      },
      "AssemblyAI transcript status",
    );

    const status = textAt(payload, "status").toLowerCase();
    if (status === "completed") return payload;
    if (status === "error") {
      const error = textAt(payload, "error") || textAt(objectAt(payload, "error"), "message") || "unknown AssemblyAI error";
      throw new Error(`AssemblyAI transcription failed: ${error}`);
    }

    await sleep(config.pollIntervalMs, signal);
  }

  throw new Error("AssemblyAI transcription timed out.");
};

export const createAssemblyAiProvider = (config: AssemblyAiProviderConfig): SttProvider => ({
  id: "assemblyai",
  async transcribe(input) {
    const uploadPayload = await fetchJson(
      config.uploadEndpoint,
      {
        method: "POST",
        headers: {
          ...authHeaders(config.apiKey),
          "Content-Type": "application/octet-stream",
        },
        body: await audioBlobFromPath(input.audioPath),
        signal: input.signal,
        redirect: "error",
      },
      "AssemblyAI audio upload",
    );

    const audioUrl = textAt(uploadPayload, "upload_url");
    if (!audioUrl) throw new Error("AssemblyAI upload response did not include upload_url.");

    const language = normalizeLanguage(input.language ?? config.language);
    const body: Record<string, unknown> = {
      audio_url: audioUrl,
      speech_model: config.model,
    };
    if (language) body.language_code = language;

    const transcriptPayload = await fetchJson(
      config.transcriptEndpoint,
      {
        method: "POST",
        headers: {
          ...authHeaders(config.apiKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: input.signal,
        redirect: "error",
      },
      "AssemblyAI transcript request",
    );

    const id = textAt(transcriptPayload, "id");
    if (!id) throw new Error("AssemblyAI transcript response did not include id.");

    const resultPayload = await waitForTranscript(id, config, input.signal);
    const text = textAt(resultPayload, "text");
    if (!text) throw new Error("AssemblyAI transcription response did not include text.");
    return { text };
  },
});
