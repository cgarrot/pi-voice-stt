const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Recursively merge plain objects. Nested objects are merged; arrays and
 * scalars from `override` replace those in `base`. Inputs are not mutated.
 */
export const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return result;
};
