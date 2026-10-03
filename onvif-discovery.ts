import { createSocket } from "@isvend/expo-udp";

const WS_DISCOVERY_ADDRESS = "239.255.255.250";
const WS_DISCOVERY_PORT = 3702;

export type DiscoveredCamera = {
  id: string;
  name: string;
  host: string;
  port: number;
  xaddrs: string[];
  types: string;
  scopes: string;
  address: string;
};

function createProbeMessage(): string {
  const messageId = `uuid:${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope
  xmlns:e="http://www.w3.org/2003/05/soap-envelope"
  xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>${messageId}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`;
}

function getXmlTag(xml: string, tagName: string): string {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const match = xml.match(
    new RegExp(
      `<[^>]*${escaped}[^>]*>([\\s\\S]*?)</[^>]*${escaped}>`,
      "i"
    )
  );

  return match?.[1]?.trim() ?? "";
}

function getAllXAddrs(xml: string): string[] {
  const value = getXmlTag(xml, "XAddrs");

  if (!value) {
    return [];
  }

  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractHostPort(
  xaddr: string
): { host: string; port: number } | null {
  try {
    const url = new URL(xaddr);

    const port = url.port
      ? Number(url.port)
      : url.protocol === "https:"
        ? 443
        : 80;

    if (!url.hostname || !Number.isFinite(port)) {
      return null;
    }

    return {
      host: url.hostname,
      port,
    };
  } catch {
    return null;
  }
}

function parseProbeMatch(
  payload: string,
  fallbackAddress: string
): DiscoveredCamera | null {
  const xaddrs = getAllXAddrs(payload);

  const first = xaddrs
    .map(extractHostPort)
    .find(
      (value): value is { host: string; port: number } =>
        Boolean(value)
    );

  if (!first) {
    return null;
  }

   const address =
  getXmlTag(payload, "Address") || fallbackAddress;

const scopes = getXmlTag(payload, "Scopes");

const name =
  scopes.match(/(?:name|hardware)\/([^ ]+)/i)?.[1] ||
  first.host;

const id = address || `${first.host}:${first.port}`;

return {
  id,
  name,
  host: first.host,
  port: first.port,
  xaddrs,
  types: getXmlTag(payload, "Types"),
  scopes,
  address,
};
}
function decodeMessage(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }

  if (raw instanceof Uint8Array) {
    return new TextDecoder().decode(raw);
  }

  if (raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(
      new Uint8Array(raw)
    );
  }

  return "";
}

export async function discoverOnvifCameras(
  timeoutMs = 7000
): Promise<DiscoveredCamera[]> {
  const socket = await createSocket({
    type: "udp4",
    reuseAddress: true,
  });

  const discovered = new Map<string, DiscoveredCamera>();

  return new Promise<DiscoveredCamera[]>(
    async (resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;

      let subscription:
        | { remove: () => void }
        | undefined;

      let finished = false;

      const finish = async (error?: unknown) => {
        if (finished) {
          return;
        }

        finished = true;

        if (timer) {
          clearTimeout(timer);
        }

        if (retryTimer) {
          clearTimeout(retryTimer);
        }

        subscription?.remove();

        try {
          await socket.close();
        } catch {
          // Ignore close errors.
        }

        if (error) {
          reject(error);
        } else {
          resolve(
            Array.from(discovered.values())
          );
        }
      };

      try {
        /*
         * Penting untuk Android:
         * socket harus bind terlebih dahulu sebelum
         * listener message dipasang.
         */
        await socket.bind({
          port: 0,
          address: "0.0.0.0",
        });

        /*
         * Aktifkan multicast ONVIF.
         */
        try {
          await socket.joinMulticastGroup(
            WS_DISCOVERY_ADDRESS
          );
        } catch {
          /*
           * Pada sebagian perangkat Android,
           * routing multicast sudah ditangani oleh
           * sistem/plugin.
           */
        }

        /*
         * Pasang listener SETELAH bind.
         */
        subscription = socket.addListener(
          "message",
          (event: any) => {
            const raw =
              event?.data ??
              event?.message ??
              event?.buffer;

            if (raw == null) {
              return;
            }

            const data = decodeMessage(raw);

            if (!data.trim()) {
              return;
            }

            const camera = parseProbeMatch(
              data,
              String(
                event?.remoteAddress ??
                  event?.address ??
                  event?.host ??
                  ""
              )
            );

            if (!camera) {
              return;
            }

            const key = `${camera.host}:${camera.port}`;

            if (!discovered.has(key)) {
              discovered.set(key, camera);
            }
          }
        );

        /*
         * Timeout dipasang sebelum Probe dikirim
         * agar proses tidak menunggu tanpa batas.
         */
        timer = setTimeout(() => {
          void finish();
        }, timeoutMs);

        /*
         * Probe pertama.
         */
        await socket.send(
          createProbeMessage(),
          {
            host: WS_DISCOVERY_ADDRESS,
            port: WS_DISCOVERY_PORT,
          }
        );

        /*
         * Probe kedua setelah 350 ms.
         *
         * Ini membantu kamera/AP yang terlambat
         * menerima paket multicast pertama.
         */
        retryTimer = setTimeout(() => {
          if (finished) {
            return;
          }

          void socket
            .send(createProbeMessage(), {
              host: WS_DISCOVERY_ADDRESS,
              port: WS_DISCOVERY_PORT,
            })
            .catch(() => {
              // Probe pertama mungkin sudah berhasil.
            });
        }, 350);
      } catch (error) {
        await finish(error);
      }
    }
  );
}