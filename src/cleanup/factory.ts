import type { CleanupConfig } from "../config/types";
import { createOpenAiCompatibleCleanup } from "./openai-compatible";
import type { CleanupClient } from "./types";

/**
 * Build a cleanup client from config, or `null` when cleanup is disabled so
 * callers can cheaply skip the pass.
 */
export const createCleanup = (config: CleanupConfig): CleanupClient | null => {
  if (!config.enabled) return null;
  return createOpenAiCompatibleCleanup(config);
};
