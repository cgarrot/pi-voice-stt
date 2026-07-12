import { readFile } from "node:fs/promises";
import { formatError, truncate } from "../utils/text";

export type MultipartTranscriptionRequest = {
  endpoint: string;
  apiKey: string;
  authHeader: "bearer" | "none";
  model: string;
  audioPath: string;
  language?: string | undefined;
  signal: AbortSignal;
  fields?: Record<string, string>;
  missingKeyMessage?: string;
};

export const postMultipartTranscription = async (request: MultipartTranscriptionRequest): Promise<unknown> => {
  if (request.authHeader === "bearer" && !request.apiKey) {
    throw new Error(request.missingKeyMessage ?? "Missing STT API key.");
  }

  const audio = await readFile(request.audioPath);
  const form = new FormData();
  form.append("model", request.model);
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "recording.wav");
  if (request.language) form.append("language", request.language);
  for (const [key, value] of Object.entries(request.fields ?? {})) form.append(key, value);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (request.authHeader === "bearer") headers.Authorization = `Bearer ${request.apiKey}`;

  const response = await fetch(request.endpoint, {
    method: "POST",
    headers,
    body: form,
    signal: request.signal,
    redirect: "error",
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("STT transcription timed out or was cancelled.");
    }
    throw error;
  });

  if (!response.ok) {
    throw new Error(`STT transcription failed (${response.status}): ${truncate(await response.text())}`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`STT transcription returned invalid JSON: ${formatError(error)}`);
  }
};
