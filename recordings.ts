export type Recording = {
  id: string;
  cameraId: string;
  cameraName: string;
  vendor: string;
  sourceUrl: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  fileUri?: string;
  faceEvents?: number;
  status: "recording" | "completed";
};

export const RECORDINGS_KEY = "cctv-recording-history";

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0 ? `${hours}j ${String(minutes).padStart(2, "0")}m` : `${minutes}m ${String(remainder).padStart(2, "0")}d`;
}

export function finishRecording(recording: Recording, endedAt: string, now = Date.now()): Recording {
  const started = new Date(recording.startedAt).getTime();
  return { ...recording, endedAt, status: "completed", durationSeconds: Math.max(1, Math.round((now - started) / 1000)) };
}
