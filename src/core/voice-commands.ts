import type { VoiceCommandsConfig } from "../config/types";

export type VoiceCommand = "send" | "clear" | "newline";

export type VoiceCommandResult = {
  command: VoiceCommand | null;
  text: string;
};

const TRAILING_PUNCTUATION = /[\s.!?,;:]+$/u;

/**
 * Detect a trailing voice command keyword in a transcript. Matching is
 * case-insensitive, ignores trailing punctuation (whisper often adds a period)
 * and requires a word boundary before the phrase. Returns the matched command
 * (if any) and the transcript with the keyword removed. Pure and deterministic.
 */
export const parseVoiceCommand = (text: string, config: VoiceCommandsConfig): VoiceCommandResult => {
  if (!config.enabled) return { command: null, text };

  const order: VoiceCommand[] = ["send", "clear", "newline"];
  const stripped = text.replace(TRAILING_PUNCTUATION, "");
  const lower = stripped.toLowerCase();

  for (const command of order) {
    const phrases = [...config[command]].map((phrase) => phrase.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const phrase of phrases) {
      const lowerPhrase = phrase.toLowerCase();
      if (lower === lowerPhrase) return { command, text: "" };
      if (lower.endsWith(lowerPhrase)) {
        const start = stripped.length - phrase.length;
        const before = stripped[start - 1];
        if (before === undefined || /\s/u.test(before)) {
          return { command, text: stripped.slice(0, start).replace(TRAILING_PUNCTUATION, "") };
        }
      }
    }
  }

  return { command: null, text };
};
