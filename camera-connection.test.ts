import { describe, expect, it, vi } from "vitest";
import { getEndpointDetails, testCameraConnection } from "../lib/camera-connection";

describe("camera connection helpers", () => {
  it("parses RTSP endpoint and default port", () => {
    expect(getEndpointDetails("rtsp://192.168.1.20/stream1")).toMatchObject({ protocol: "RTSP", host: "192.168.1.20", port: 554 });
  });

  it("returns unsupported for RTSP probe without native bridge", async () => {
    const result = await testCameraConnection({ id: "1", name: "Gate", url: "rtsp://192.168.1.20/stream1" });
    expect(result.status).toBe("unsupported");
  });

  it("reports HTTP latency and success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await testCameraConnection({ id: "1", name: "Lobby", url: "http://192.168.1.20/live" });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("online");
    expect(result.latencyMs).toBeDefined();
    vi.unstubAllGlobals();
  });
});
