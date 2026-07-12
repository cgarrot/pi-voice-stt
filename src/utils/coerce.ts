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

export const stringMapFrom = (value: unknown, fallback: Record<string, string> = {}): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, val]) => typeof val === "string" && key.trim().length > 0)
    .map(([key, val]) => [key.trim(), val as string] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : fallback;
};
