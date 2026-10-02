export type ConnectionProtocol = "RTSP" | "HTTP" | "HTTPS" | "HLS" | "ONVIF";
export type ConnectionResult = { ok: boolean; status: "online" | "offline" | "unsupported"; latencyMs?: number; message: string; checkedAt: string };
export type CameraNetworkConfig = { id: string; name: string; url: string; username?: string; password?: string; vendor?: string; online?: boolean };

const TEST_TIMEOUT_MS = 6500;

export function getEndpointDetails(url: string) {
  try {
    const normalized = url.includes("://") ? url : `rtsp://${url}`;
    const parsed = new URL(normalized);
    const protocol = parsed.protocol.replace(":", "").toUpperCase() as ConnectionProtocol;
    const defaultPort = protocol === "RTSP" ? 554 : protocol === "HTTPS" ? 443 : 80;
    return { protocol, host: parsed.hostname, port: Number(parsed.port) || defaultPort, path: parsed.pathname || "/" };
  } catch {
    return null;
  }
}

export async function testCameraConnection(camera: CameraNetworkConfig): Promise<ConnectionResult> {
  const checkedAt = new Date().toISOString();
  const endpoint = getEndpointDetails(camera.url);
  if (!endpoint) return { ok: false, status: "offline", message: "URL kamera tidak valid.", checkedAt };
  if (endpoint.protocol === "RTSP" || endpoint.protocol === "ONVIF") {
    return { ok: false, status: "unsupported", message: "Tes RTSP/ONVIF memerlukan native network probe pada Android build.", checkedAt };
  }
  const started = Date.now();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), TEST_TIMEOUT_MS) : undefined;
  try {
    const response = await fetch(camera.url, { method: "HEAD", signal: controller?.signal });
    if (timer) clearTimeout(timer);
    const latencyMs = Date.now() - started;
    return { ok: response.ok || response.status === 401 || response.status === 403, status: response.ok || response.status === 401 || response.status === 403 ? "online" : "offline", latencyMs, message: response.ok ? `Terhubung • HTTP ${response.status}` : `Endpoint merespons HTTP ${response.status}`, checkedAt };
  } catch (error) {
    if (timer) clearTimeout(timer);
    return { ok: false, status: "offline", latencyMs: Date.now() - started, message: error instanceof Error && error.name === "AbortError" ? "Timeout saat menghubungi kamera." : "Kamera tidak dapat dihubungi dari jaringan saat ini.", checkedAt };
  }
}
