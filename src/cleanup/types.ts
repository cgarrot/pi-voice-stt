export type CleanupInput = {
  text: string;
  signal: AbortSignal;
};

export type CleanupClient = {
  clean(input: CleanupInput): Promise<string>;
};
