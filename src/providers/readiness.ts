import { endpointRequiresAuth } from "../config/endpoint";
import type { ProviderConfig } from "../config/types";

const providerDisplayName = (type: ProviderConfig["type"]): string => {
  switch (type) {
    case "mistral":
      return "Mistral";
    case "openai-compatible":
      return "OpenAI-compatible";
    case "deepgram":
      return "Deepgram";
    case "elevenlabs":
      return "ElevenLabs";
    case "gladia":
      return "Gladia";
    case "assemblyai":
      return "AssemblyAI";
  }
};

export const assertProviderReady = (config: ProviderConfig): void => {
  if (config.type === "openai-compatible") {
    if (endpointRequiresAuth(config.endpoint) && !config.apiKey) {
      throw new Error("Missing STT API key for non-local OpenAI-compatible endpoint. Set provider.apiKeyEnv, provider.apiKeyFile, or provider.apiKey.");
    }
    return;
  }

  if (!config.apiKey) {
    throw new Error(`Missing ${providerDisplayName(config.type)} API key. Set provider.apiKeyEnv, provider.apiKeyFile, provider.apiKey, or macOS Keychain settings.`);
  }
};
