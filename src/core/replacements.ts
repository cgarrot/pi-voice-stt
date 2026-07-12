/**
 * Apply a user-defined dictionary of literal replacements to a transcript.
 * Matching is case-insensitive and word-boundary aware; longer keys are
 * applied first so multi-word terms win over their substrings. Pure and
 * deterministic so it can be unit tested.
 */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const applyReplacements = (text: string, replacements: Record<string, string>): string => {
  if (!text) return text;
  const keys = Object.keys(replacements)
    .filter((key) => key.trim().length > 0)
    .sort((a, b) => b.length - a.length);

  let result = text;
  for (const key of keys) {
    const pattern = new RegExp(`\\b${escapeRegExp(key)}\\b`, "gi");
    result = result.replace(pattern, replacements[key] ?? "");
  }
  return result;
};
