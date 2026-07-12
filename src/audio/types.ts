export type RecordingHandle = {
  outputPath: string;
  stop(): Promise<string>;
  dispose(): Promise<void>;
  timeout?: ReturnType<typeof setTimeout>;
};

export type AudioRecorder = {
  start(): RecordingHandle | Promise<RecordingHandle>;
};
