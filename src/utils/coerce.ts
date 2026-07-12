export const objectFrom = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export const textFrom = (value: unknown, fallback = ""): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed;
};

export const numberFrom = (value: unknown, fallback: number): number => {
  if (typeof value !== "number") return fallback;
  if (!Number.isFinite(value)) return fallback;
  return value;
};

export const positiveIntegerFrom = (value: unknown, fallback: number): number => {
  const resolved = Math.floor(numberFrom(value, fallback));
  if (resolved < 1) return fallback;
  return resolved;
};

export const booleanFrom = (value: unknown, fallback: boolean): boolean => {
  if (typeof value !== "boolean") return fallback;
  return value;
};

export const stringArrayFrom = (value: unknown, fallback: string[] = []): string[] => {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
};
