import { describe, expect, it } from "vitest";
import { isSupportedStreamUrl, makeRtspUrl } from "../lib/cctv";

describe("CCTV stream helpers", () => {
  it("accepts RTSP, HTTP and HTTPS camera sources", () => {
    expect(isSupportedStreamUrl("rtsp://192.168.1.20:554/live")).toBe(true);
    expect(isSupportedStreamUrl("http://camera.local/mjpeg")).toBe(true);
    expect(isSupportedStreamUrl("https://camera.local/live.m3u8")).toBe(true);
  });
  it("rejects empty or unsupported source URLs", () => {
    expect(isSupportedStreamUrl("")).toBe(false);
    expect(isSupportedStreamUrl("ftp://camera.local/stream")).toBe(false);
    expect(isSupportedStreamUrl("192.168.1.20:554/live")).toBe(false);
  });
  it("builds vendor-aware RTSP URLs", () => {
    expect(makeRtspUrl("Hikvision", "192.168.1.20", 554, 2)).toContain("Streaming/Channels/201");
    expect(makeRtspUrl("Dahua", "192.168.1.21", 8554, 1, true)).toContain("subtype=1");
    expect(makeRtspUrl("Axis", "cam.local")).toBe("rtsp://cam.local:554/axis-media/media.amp");
  });
});
