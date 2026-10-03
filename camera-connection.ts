export type ConnectionProtocol =
  | "RTSP"
  | "HTTP"
  | "HTTPS"
  | "HLS"
  | "ONVIF";

export type ConnectionResult = {
  ok: boolean;
  status: "online" | "offline" | "unsupported";
  latencyMs?: number;
  message: string;
  checkedAt: string;
};

export type CameraNetworkConfig = {
  id: string;
  name: string;
  url: string;
  username?: string;
  password?: string;
  vendor?: string;
  online?: boolean;
};

const TEST_TIMEOUT_MS = 6500;

export function getEndpointDetails(url: string) {
  try {
    const value = url.trim();

    if (!value) {
      return null;
    }

    const normalized = value.includes("://")
      ? value
      : `rtsp://${value}`;

    const parsed = new URL(normalized);

    const protocol =
      parsed.protocol
        .replace(":", "")
        .toUpperCase() as ConnectionProtocol;

    if (
      protocol !== "RTSP" &&
      protocol !== "HTTP" &&
      protocol !== "HTTPS" &&
      protocol !== "HLS" &&
      protocol !== "ONVIF"
    ) {
      return null;
    }

    const defaultPort =
      protocol === "RTSP"
        ? 554
        : protocol === "HTTPS"
          ? 443
          : 80;

    return {
      protocol,
      host: parsed.hostname,
      port:
        Number(parsed.port) || defaultPort,
      path: parsed.pathname || "/",
    };
  } catch {
    return null;
  }
}

function getTimeoutError() {
  return {
    ok: false,
    status: "offline" as const,
    message: "Timeout saat menghubungi kamera.",
  };
}

function getNetworkError() {
  return {
    ok: false,
    status: "offline" as const,
    message:
      "Kamera tidak dapat dihubungi dari jaringan saat ini.",
  };
}

export async function testCameraConnection(
  camera: CameraNetworkConfig,
): Promise<ConnectionResult> {
  const checkedAt =
    new Date().toISOString();

  const endpoint =
    getEndpointDetails(camera.url);

  if (!endpoint) {
    return {
      ok: false,
      status: "offline",
      message: "URL kamera tidak valid.",
      checkedAt,
    };
  }

  /*
   * RTSP tidak dapat diuji menggunakan fetch().
   *
   * fetch() hanya cocok untuk HTTP/HTTPS.
   * RTSP membutuhkan native Android networking/player.
   *
   * Jangan menganggap RTSP offline hanya karena fetch()
   * tidak dapat membukanya.
   *
   * Pada tahap ini native react-native-video menjadi
   * pengujian utama untuk RTSP playback.
   */
  if (
    endpoint.protocol === "RTSP" ||
    endpoint.protocol === "ONVIF"
  ) {
    return {
      ok: false,
      status: "unsupported",
      message:
        "RTSP/ONVIF memerlukan native network probe. Gunakan Hubungkan & Tampilkan untuk menguji stream RTSP secara langsung.",
      checkedAt,
    };
  }

  const started = Date.now();

  const controller =
    typeof AbortController !== "undefined"
      ? new AbortController()
      : undefined;

  const timer = controller
    ? setTimeout(() => {
        controller.abort();
      }, TEST_TIMEOUT_MS)
    : undefined;

  try {
    const response = await fetch(
      camera.url,
      {
        method: "HEAD",
        signal: controller?.signal,
      },
    );

    if (timer) {
      clearTimeout(timer);
    }

    const latencyMs =
      Date.now() - started;

    /*
     * HTTP 200-399 dianggap endpoint merespons.
     *
     * 401/403 juga dianggap online karena kamera
     * merespons tetapi meminta autentikasi.
     */
    const reachable =
      response.ok ||
      response.status === 401 ||
      response.status === 403 ||
      (response.status >= 300 &&
        response.status < 400);

    if (reachable) {
      return {
        ok: true,
        status: "online",
        latencyMs,
        message:
          response.status === 401 ||
          response.status === 403
            ? `Kamera online tetapi memerlukan autentikasi • HTTP ${response.status}`
            : `Terhubung • HTTP ${response.status}`,
        checkedAt,
      };
    }

    return {
      ok: false,
      status: "offline",
      latencyMs,
      message:
        `Endpoint merespons HTTP ${response.status}.`,
      checkedAt,
    };
  } catch (error) {
    if (timer) {
      clearTimeout(timer);
    }

    const latencyMs =
      Date.now() - started;

    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      return {
        ...getTimeoutError(),
        latencyMs,
        checkedAt,
      };
    }

    return {
      ...getNetworkError(),
      latencyMs,
      checkedAt,
    };
  }
}