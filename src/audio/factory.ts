import type { CaptureConfig } from "../config/types";
import type { AudioRecorder } from "./types";
import { createBridgeRecorder } from "./bridge-recorder";
import { createFfmpegRecorder } from "./ffmpeg-recorder";

export const createRecorder = (config: CaptureConfig): AudioRecorder => {
  if (config.type === "bridge") return createBridgeRecorder(config);
  return createFfmpegRecorder(config);
};
