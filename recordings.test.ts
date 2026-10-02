import { describe, expect, it } from "vitest";
import { finishRecording, formatDuration, type Recording } from "../lib/recordings";

const base: Recording = { id: "r1", cameraId: "c1", cameraName: "Gerbang", vendor: "ONVIF", sourceUrl: "rtsp://camera/live", startedAt: "2026-09-03T10:00:00.000Z", durationSeconds: 0, status: "recording" };

describe("recording history helpers", () => {
  it("formats short and long durations", () => {
    expect(formatDuration(75)).toBe("1m 15d");
    expect(formatDuration(3661)).toBe("1j 01m");
  });
  it("finishes a recording with elapsed duration", () => {
    const result = finishRecording(base, "2026-09-03T10:00:08.000Z", Date.parse("2026-09-03T10:00:08.000Z"));
    expect(result.status).toBe("completed");
    expect(result.durationSeconds).toBe(8);
    expect(result.endedAt).toBe("2026-09-03T10:00:08.000Z");
  });
});
