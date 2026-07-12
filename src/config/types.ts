export type CaptureConfig = {
  type: "ffmpeg";
  ffmpegPath: string;
  inputFormat: string;
  input: string;
  sampleRate: number;
  channels: number;
  maxSeconds: number;
  minBytes: number;
};

export type SecretConfig = {
  apiKey: string;
  apiKeyEnv: string;
  keychainService: string;
  keychainAccount: string;
};

export type MistralProviderConfig = SecretConfig & {
  type: "mistral";
  endpoint: string;
  model: string;
  language: string;
  timeoutSeconds: number;
};

export type OpenAiCompatibleProviderConfig = SecretConfig & {
  type: "openai-compatible";
  endpoint: string;
  model: string;
  language: string;
  timeoutSeconds: number;
  responseFormat: "json";
};

export type DeepgramProviderConfig = SecretConfig & {
  type: "deepgram";
  endpoint: string;
  model: string;
  language: string;
  timeoutSeconds: number;
  smartFormat: boolean;
};

export type ElevenLabsProviderConfig = SecretConfig & {
  type: "elevenlabs";
  endpoint: string;
  model: string;
  language: string;
  timeoutSeconds: number;
};

export type GladiaProviderConfig = SecretConfig & {
  type: "gladia";
  uploadEndpoint: string;
  transcriptionEndpoint: string;
  model: string;
  language: string;
  timeoutSeconds: number;
  pollIntervalMs: number;
};

export type AssemblyAiProviderConfig = SecretConfig & {
  type: "assemblyai";
  uploadEndpoint: string;
  transcriptEndpoint: string;
  model: string;
  language: string;
  timeoutSeconds: number;
  pollIntervalMs: number;
};

export type ProviderConfig =
  | MistralProviderConfig
  | OpenAiCompatibleProviderConfig
  | DeepgramProviderConfig
  | ElevenLabsProviderConfig
  | GladiaProviderConfig
  | AssemblyAiProviderConfig;

export type OutputConfig = {
  appendTrailingSpace: boolean;
  /**
   * When true, stopping a recording with the toggle shortcut (Ctrl+R) also
   * sends the transcript straight to chat instead of only inserting it into
   * the prompt. Mirrors the Enter-while-recording behavior.
   */
  submitOnStop: boolean;
};

export type PluginConfig = {
  capture: CaptureConfig;
  provider: ProviderConfig;
  output: OutputConfig;
};
