import type { CleanupConfig } from "../config/types";

/** Light, deterministic repository context injected into the cleanup prompt. */
export type RepoContext = {
  branch?: string;
};

/**
 * Build the system prompt for the cleanup pass. Pure and deterministic so it
 * can be unit tested: the base instruction is augmented with the target
 * language, the project glossary and any repository context.
 */
export const buildCleanupSystemPrompt = (config: CleanupConfig, context: RepoContext = {}): string => {
  const parts = [config.prompt];

  if (config.language && config.language.trim().toLowerCase() !== "auto") {
    parts.push(`Always write the cleaned transcript in ${config.language.trim()}.`);
  }

  if (config.projectTerms.length > 0) {
    parts.push(`Spell these project-specific terms exactly when they occur: ${config.projectTerms.join(", ")}.`);
  }

  if (config.useRepoContext && context.branch) {
    parts.push(`For context, the user is working in the git branch "${context.branch}".`);
  }

  return parts.join("\n");
};
