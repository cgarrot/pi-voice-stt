import { readFile } from "node:fs/promises";
import {
  defaultAssemblyAiProviderConfig,
  defaultCaptureConfig,
  defaultCleanupConfig,
  defaultDeepgramProviderConfig,
  defaultElevenLabsProviderConfig,
  defaultGladiaProviderConfig,
  defaultMistralProviderConfig,
  defaultOpenAiCompatibleProviderConfig,
  defaultOutputConfig,
  defaultVoiceCommandsConfig,
} from "./defaults";
import { secureEndpointFrom } from "./endpoint";
import type {
  AssemblyAiProviderConfig,
  CaptureConfig,
  CleanupConfig,
  DeepgramProviderConfig,
  ElevenLabsProviderConfig,
  GladiaProviderConfig,
  MistralProviderConfig,
  OpenAiCompatibleProviderConfig,
  PluginConfig,
  ProviderConfig,
  VoiceCommandsConfig,
} from "./types";
import { resolveApiKey } from "../secrets/resolve-api-key";
import { booleanFrom, objectFrom, positiveIntegerFrom, stringArrayFrom, stringMapFrom, textFrom } from "../utils/coerce";
import { resolvePath } from "../utils/path";
import { deepMerge } from "../utils/merge";
import { modeOverrideFrom } from "../core/modes";
import { formatError } from "../utils/text";

export const readConfigFile = async (filePath: string): Promise<Record<string, unknown>> => {
  if (!filePath) return {};
  const resolved = resolvePath(filePath);
  try {
    return objectFrom(JSON.parse(await readFile(resolved, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`STT config file does not exist: ${resolved}`);
    throw new Error(`Cannot parse STT config ${resolved}: ${formatError(error)}`);
  }
};

const mergedInput = async (options: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const fileConfig = await readConfigFile(textFrom(options.configPath));
  const modeName = textFrom(options.mode, textFrom(fileConfig.mode, "default"));
  const merged = { ...options, ...fileConfig };
  return deepMerge(merged, modeOverrideFrom(fileConfig, modeName));
};

const captureFrom = (merged: Record<string, unknown>): CaptureConfig => {
  const capture = objectFrom(merged.capture);
  return {
    type: "ffmpeg",
    ffmpegPath: textFrom(capture.ffmpegPath, textFrom(capture.ffmpeg, textFrom(merged.ffmpeg, defaultCaptureConfig.ffmpegPath))),
    inputFormat: textFrom(capture.inputFormat, textFrom(merged.inputFormat, defaultCaptureConfig.inputFormat)),
    input: textFrom(capture.input, textFrom(merged.input, defaultCaptureConfig.input)),
    sampleRate: positiveIntegerFrom(capture.sampleRate ?? merged.sampleRate, defaultCaptureConfig.sampleRate),
    channels: positiveIntegerFrom(capture.channels ?? merged.channels, defaultCaptureConfig.channels),
    maxSeconds: positiveIntegerFrom(capture.maxSeconds ?? merged.maxSeconds, defaultCaptureConfig.maxSeconds),
    minBytes: Math.max(44, positiveIntegerFrom(capture.minBytes ?? merged.minBytes, defaultCaptureConfig.minBytes)),
  };
};

const secretSourceFrom = (merged: Record<string, unknown>, provider: Record<string, unknown>): Record<string, unknown> => ({
  apiKey: provider.apiKey ?? merged.apiKey,
  apiKeyEnv: provider.apiKeyEnv ?? merged.apiKeyEnv,
  keychainService: provider.keychainService ?? merged.keychainService,
  keychainAccount: provider.keychainAccount ?? merged.keychainAccount,
});

const envNameFrom = (value: unknown, fallback: string): string => {
  if (typeof value === "string") return value.trim();
  return fallback;
};

const commonProviderFields = async <TDefault extends { apiKeyEnv: string; timeoutSeconds: number }>(
  merged: Record<string, unknown>,
  provider: Record<string, unknown>,
  defaults: TDefault,
) => {
  const secrets = secretSourceFrom(merged, provider);
  return {
    timeoutSeconds: positiveIntegerFrom(provider.timeoutSeconds ?? merged.requestTimeoutSeconds, defaults.timeoutSeconds),
    apiKey: await resolveApiKey(secrets, defaults.apiKeyEnv),
    apiKeyEnv: envNameFrom(secrets.apiKeyEnv, defaults.apiKeyEnv),
    keychainService: textFrom(secrets.keychainService),
    keychainAccount: textFrom(secrets.keychainAccount),
  };
};

const mistralProviderFrom = async (merged: Record<string, unknown>, provider: Record<string, unknown>): Promise<MistralProviderConfig> => ({
  type: "mistral",
  endpoint: secureEndpointFrom(provider.endpoint ?? merged.endpoint, defaultMistralProviderConfig.endpoint),
  model: textFrom(provider.model, textFrom(merged.model, defaultMistralProviderConfig.model)),
  language: textFrom(provider.language, textFrom(merged.language, defaultMistralProviderConfig.language)),
  ...(await commonProviderFields(merged, provider, defaultMistralProviderConfig)),
});

const openAiCompatibleProviderFrom = async (
  merged: Record<string, unknown>,
  provider: Record<string, unknown>,
): Promise<OpenAiCompatibleProviderConfig> => ({
  type: "openai-compatible",
  endpoint: secureEndpointFrom(provider.endpoint ?? merged.endpoint, defaultOpenAiCompatibleProviderConfig.endpoint),
  model: textFrom(provider.model, textFrom(merged.model, defaultOpenAiCompatibleProviderConfig.model)),
  language: textFrom(provider.language, textFrom(merged.language, defaultOpenAiCompatibleProviderConfig.language)),
  responseFormat: "json",
  ...(await commonProviderFields(merged, provider, defaultOpenAiCompatibleProviderConfig)),
});

const deepgramProviderFrom = async (merged: Record<string, unknown>, provider: Record<string, unknown>): Promise<DeepgramProviderConfig> => ({
  type: "deepgram",
  endpoint: secureEndpointFrom(provider.endpoint ?? merged.endpoint, defaultDeepgramProviderConfig.endpoint),
  model: textFrom(provider.model, textFrom(merged.model, defaultDeepgramProviderConfig.model)),
  language: textFrom(provider.language, textFrom(merged.language, defaultDeepgramProviderConfig.language)),
  smartFormat: booleanFrom(provider.smartFormat ?? merged.smartFormat, defaultDeepgramProviderConfig.smartFormat),
  ...(await commonProviderFields(merged, provider, defaultDeepgramProviderConfig)),
});

const elevenLabsProviderFrom = async (
  merged: Record<string, unknown>,
  provider: Record<string, unknown>,
): Promise<ElevenLabsProviderConfig> => ({
  type: "elevenlabs",
  endpoint: secureEndpointFrom(provider.endpoint ?? merged.endpoint, defaultElevenLabsProviderConfig.endpoint),
  model: textFrom(provider.model, textFrom(merged.model, defaultElevenLabsProviderConfig.model)),
  language: textFrom(provider.language, textFrom(merged.language, defaultElevenLabsProviderConfig.language)),
  ...(await commonProviderFields(merged, provider, defaultElevenLabsProviderConfig)),
});

const gladiaProviderFrom = async (merged: Record<string, unknown>, provider: Record<string, unknown>): Promise<GladiaProviderConfig> => ({
  type: "gladia",
  uploadEndpoint: secureEndpointFrom(provider.uploadEndpoint ?? provider.upload_endpoint ?? merged.uploadEndpoint, defaultGladiaProviderConfig.uploadEndpoint),
  transcriptionEndpoint: secureEndpointFrom(
    provider.transcriptionEndpoint ?? provider.transcription_endpoint ?? merged.transcriptionEndpoint,
    defaultGladiaProviderConfig.transcriptionEndpoint,
  ),
  model: textFrom(provider.model, textFrom(merged.model, defaultGladiaProviderConfig.model)),
  language: textFrom(provider.language, textFrom(merged.language, defaultGladiaProviderConfig.language)),
  pollIntervalMs: positiveIntegerFrom(provider.pollIntervalMs ?? merged.pollIntervalMs, defaultGladiaProviderConfig.pollIntervalMs),
  ...(await commonProviderFields(merged, provider, defaultGladiaProviderConfig)),
});

const assemblyAiProviderFrom = async (
  merged: Record<string, unknown>,
  provider: Record<string, unknown>,
): Promise<AssemblyAiProviderConfig> => ({
  type: "assemblyai",
  uploadEndpoint: secureEndpointFrom(provider.uploadEndpoint ?? provider.upload_endpoint ?? merged.uploadEndpoint, defaultAssemblyAiProviderConfig.uploadEndpoint),
  transcriptEndpoint: secureEndpointFrom(
    provider.transcriptEndpoint ?? provider.transcript_endpoint ?? merged.transcriptEndpoint,
    defaultAssemblyAiProviderConfig.transcriptEndpoint,
  ),
  model: textFrom(provider.model, textFrom(merged.model, defaultAssemblyAiProviderConfig.model)),
  language: textFrom(provider.language, textFrom(merged.language, defaultAssemblyAiProviderConfig.language)),
  pollIntervalMs: positiveIntegerFrom(provider.pollIntervalMs ?? merged.pollIntervalMs, defaultAssemblyAiProviderConfig.pollIntervalMs),
  ...(await commonProviderFields(merged, provider, defaultAssemblyAiProviderConfig)),
});

const providerFrom = async (merged: Record<string, unknown>): Promise<ProviderConfig> => {
  const provider = objectFrom(merged.provider);
  const providerType = textFrom(provider.type, textFrom(merged.provider, defaultMistralProviderConfig.type)).toLowerCase();

  if (providerType === "mistral" || providerType === "voxtral") return mistralProviderFrom(merged, provider);

  if (providerType === "openai-compatible" || providerType === "openai" || providerType === "groq" || providerType === "local") {
    const providerDefaults = providerType === "groq"
      ? { endpoint: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo", apiKeyEnv: "GROQ_API_KEY" }
      : providerType === "local"
        ? { endpoint: "http://localhost:10301/v1/audio/transcriptions", model: "whisper-1", apiKeyEnv: "" }
        : providerType === "openai"
          ? { endpoint: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe", apiKeyEnv: "OPENAI_API_KEY" }
          : {};
    return openAiCompatibleProviderFrom({ ...merged, ...providerDefaults }, provider);
  }

  if (providerType === "deepgram") return deepgramProviderFrom(merged, provider);
  if (providerType === "elevenlabs" || providerType === "eleven-labs" || providerType === "scribe") return elevenLabsProviderFrom(merged, provider);
  if (providerType === "gladia" || providerType === "gradium") return gladiaProviderFrom(merged, provider);
  if (providerType === "assemblyai" || providerType === "assembly-ai") return assemblyAiProviderFrom(merged, provider);

  throw new Error(`Unsupported STT provider: ${providerType}`);
};

const outputFrom = (merged: Record<string, unknown>) => {
  const output = objectFrom(merged.output);
  return {
    appendTrailingSpace: booleanFrom(output.appendTrailingSpace ?? merged.appendTrailingSpace, defaultOutputConfig.appendTrailingSpace),
    submitOnStop: booleanFrom(output.submitOnStop ?? merged.submitOnStop, defaultOutputConfig.submitOnStop),
    replacements: stringMapFrom(output.replacements ?? merged.replacements, defaultOutputConfig.replacements),
  };
};

const cleanupFrom = async (merged: Record<string, unknown>): Promise<CleanupConfig> => {
  const cleanup = objectFrom(merged.cleanup);
  return {
    enabled: booleanFrom(cleanup.enabled, defaultCleanupConfig.enabled),
    endpoint: secureEndpointFrom(cleanup.endpoint, defaultCleanupConfig.endpoint),
    model: textFrom(cleanup.model, defaultCleanupConfig.model),
    language: textFrom(cleanup.language, defaultCleanupConfig.language),
    prompt: textFrom(cleanup.prompt, defaultCleanupConfig.prompt),
    projectTerms: stringArrayFrom(cleanup.projectTerms, defaultCleanupConfig.projectTerms),
    useRepoContext: booleanFrom(cleanup.useRepoContext, defaultCleanupConfig.useRepoContext),
    maxTokens: positiveIntegerFrom(cleanup.maxTokens, defaultCleanupConfig.maxTokens),
    timeoutSeconds: positiveIntegerFrom(cleanup.timeoutSeconds, defaultCleanupConfig.timeoutSeconds),
    apiKey: await resolveApiKey(cleanup, defaultCleanupConfig.apiKeyEnv),
    apiKeyEnv: textFrom(cleanup.apiKeyEnv, defaultCleanupConfig.apiKeyEnv),
    keychainService: textFrom(cleanup.keychainService),
    keychainAccount: textFrom(cleanup.keychainAccount),
  };
};

const commandsFrom = (merged: Record<string, unknown>): VoiceCommandsConfig => {
  const commands = objectFrom(merged.commands);
  return {
    enabled: booleanFrom(commands.enabled, defaultVoiceCommandsConfig.enabled),
    send: stringArrayFrom(commands.send, defaultVoiceCommandsConfig.send),
    clear: stringArrayFrom(commands.clear, defaultVoiceCommandsConfig.clear),
    newline: stringArrayFrom(commands.newline, defaultVoiceCommandsConfig.newline),
  };
};

export const loadConfig = async (options: Record<string, unknown> = {}): Promise<PluginConfig> => {
  const merged = await mergedInput(options);
  return {
    capture: captureFrom(merged),
    provider: await providerFrom(merged),
    output: outputFrom(merged),
    cleanup: await cleanupFrom(merged),
    commands: commandsFrom(merged),
  };
};
