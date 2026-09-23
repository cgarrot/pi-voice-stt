export type FfmpegCaptureConfig = {
  type: "ffmpeg";
  ffmpegPath: string;
  inputFormat: string;
  input: string;
  sampleRate: number;
  channels: number;
  maxSeconds: number;
  minBytes: number;
};

export type BridgeCaptureConfig = {
  type: "bridge";
  endpoint: string;
  token: string;
  tokenEnv: string;
  tokenFile: string;
  requestTimeoutSeconds: number;
  maxSeconds: number;
  minBytes: number;
};

export type CaptureConfig = FfmpegCaptureConfig | BridgeCaptureConfig;

export type SecretConfig = {
  apiKey: string;
  apiKeyEnv: string;
  apiKeyFile: string;
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

export type SonioxProviderConfig = SecretConfig & {
  type: "soniox";
  baseUrl: string;
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
  | AssemblyAiProviderConfig
  | SonioxProviderConfig;

export type OutputConfig = {
  appendTrailingSpace: boolean;
  /**
   * When true, stopping a recording with the toggle shortcut (Ctrl+R) also
   * sends the transcript straight to chat instead of only inserting it into
   * the prompt. Mirrors the Enter-while-recording behavior.
   */
  submitOnStop: boolean;
  /**
   * Literal dictionary applied to the raw transcript (before cleanup), e.g.
   * { "super base": "Supabase" }. Case-insensitive, word-boundary aware.
   */
  replacements: Record<string, string>;
};

/**
 * Optional AI cleanup pass applied to the raw transcript before it is inserted
 * into the prompt. Disabled by default. Because Pi exposes no one-shot
 * inference API, cleanup calls its own configurable OpenAI-compatible chat
 * endpoint, reusing the same secret-resolution infrastructure as the STT
 * providers.
 */
export type CleanupConfig = SecretConfig & {
  enabled: boolean;
  endpoint: string;
  model: string;
  /** Target language for the cleaned text: "auto" keeps the spoken language. */
  language: string;
  /** Base system prompt; language, glossary and repo context are appended. */
  prompt: string;
  /** Glossary of project-specific terms the model should spell correctly. */
  projectTerms: string[];
  /** When true, include light git context (current branch) in the prompt. */
  useRepoContext: boolean;
  maxTokens: number;
  timeoutSeconds: number;
};

export type PluginConfig = {
  capture: CaptureConfig;
  provider: ProviderConfig;
  output: OutputConfig;
  cleanup: CleanupConfig;
  commands: VoiceCommandsConfig;
};

/**
 * Spoken keywords detected at the end of a transcript. Disabled by default.
 * Keys map a command to the list of phrases that trigger it.
 */
export type VoiceCommandsConfig = {
  enabled: boolean;
  send: string[];
  clear: string[];
  newline: string[];
};

/**
 * Named profiles: partial configs deep-merged over the base config, selected
 * by the top-level `profile` key, the PI_STT_PROFILE env var, or the persisted
 * last-selection state file. Profiles are the persistent counterpart of
 * runtime modes: switching a profile changes provider/capture/output and the
 * last selection is reused as the default for every session.
 */
export type ProfilesConfig = {
  profiles: Record<string, Record<string, unknown>>;
  profile: string;
};

/** Persisted last-selection state, stored as <configPath>.profile.json. */
export type ProfileState = {
  profile: string;
};
