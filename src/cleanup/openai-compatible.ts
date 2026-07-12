import { endpointRequiresAuth } from "../config/endpoint";
import type { CleanupConfig } from "../config/types";
import { objectFrom, textFrom } from "../utils/coerce";
import { buildCleanupSystemPrompt } from "./prompt";
import { gatherRepoContext } from "./repo-context";
import type { CleanupClient } from "./types";

/**
 * Cleanup client backed by an OpenAI-compatible chat completions endpoint.
 * Works with OpenAI, Groq, Mistral and local servers exposing the same shape.
 */
export const createOpenAiCompatibleCleanup = (config: CleanupConfig): CleanupClient => ({
  async clean({ text, signal }) {
    const needsAuth = endpointRequiresAuth(config.endpoint);
    if (needsAuth && !config.apiKey) {
      throw new Error("Missing API key for cleanup endpoint. Set cleanup.apiKeyEnv or use a localhost endpoint.");
    }

    const context = await gatherRepoContext(config);
    const system = buildCleanupSystemPrompt(config, context);

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (needsAuth) headers.authorization = `Bearer ${config.apiKey}`;

    const response = await fetch(config.endpoint, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Cleanup request failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    const payload = objectFrom(await response.json());
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const message = objectFrom(objectFrom(choices[0]).message);
    const cleaned = textFrom(message.content);
    if (!cleaned) throw new Error("Cleanup response did not include any text.");
    return cleaned;
  },
});
