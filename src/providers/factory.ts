import type { ProviderConfig } from "../config/types";
import { createAssemblyAiProvider } from "./assemblyai";
import { createDeepgramProvider } from "./deepgram";
import { createElevenLabsProvider } from "./elevenlabs";
import { createGladiaProvider } from "./gladia";
import { createMistralProvider } from "./mistral";
import { createOpenAiCompatibleProvider } from "./openai-compatible";
import { createSonioxProvider } from "./soniox";
import type { SttProvider } from "./types";

export const createProvider = (config: ProviderConfig): SttProvider => {
  switch (config.type) {
    case "mistral":
      return createMistralProvider(config);
    case "openai-compatible":
      return createOpenAiCompatibleProvider(config);
    case "deepgram":
      return createDeepgramProvider(config);
    case "elevenlabs":
      return createElevenLabsProvider(config);
    case "gladia":
      return createGladiaProvider(config);
    case "assemblyai":
      return createAssemblyAiProvider(config);
    case "soniox":
      return createSonioxProvider(config);
  }
};
