import { createSocket } from "@isvend/expo-udp";

const WS_DISCOVERY_ADDRESS = "239.255.255.250";
const WS_DISCOVERY_PORT = 3702;

export type DiscoveredCamera = {
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
    <w:Action>http://schemas.xmlsoap.org/ws/2005:04/discovery/Probe</w:Action>
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
    new RegExp(`<[^>]*${escaped}[^>]*>([\\s\\S]*?)</[^>]*${escaped}>`, "i")
  );
  return match?.[1]?.trim() ?? "";
}

function getAllXAddrs(xml: string): string[] {
  const value = getXmlTag(xml, "XAddrs");
  if (!value) return [];

  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractHostPort(xaddr: string): { host: string; port: number } | null {
  try {
    const url = new URL(xaddr);
    const port = url.port
      ? Number(url.port)
      : url.protocol === "https:"
        ? 443
        : 80;

    if (!url.hostname || !Number.isFinite(port)) return null;

    return { host: url.hostname, port };
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
    .find((value): value is { host: string; port: number } => Boolean(value));

  if (!first) return null;

  return {
    host: first.host,
    port: first.port,
    xaddrs,
    types: getXmlTag(payload, "Types"),
    scopes: getXmlTag(payload, "Scopes"),
    address: getXmlTag(payload, "Address") || fallbackAddress,
  };
}

export async function discoverOnvifCameras(
  timeoutMs = 7000
): Promise<DiscoveredCamera[]> {
  const socket = await createSocket({
    type: "udp4",
    reuseAddress: true,
  });

  const discovered = new Map<string, DiscoveredCamera>();

  return new Promise<DiscoveredCamera[]>(async (resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { remove: () => void } | undefined;
    let finished = false;

    const finish = async (error?: unknown) => {
      if (finished) return;
      finished = true;

      if (timer) clearTimeout(timer);
      subscription?.remove();

      try {
        await socket.close();
      } catch {
        // ignore close errors
      }

      if (error) {
        reject(error);
      } else {
        resolve(Array.from(discovered.values()));
      }
    };

    try {
      subscription = socket.addListener("message", (event: any) => {
        const raw = event?.data ?? event?.message;
        if (raw == null) return;

        let data: string;

        if (typeof raw === "string") {
          data = raw;
        } else if (raw instanceof Uint8Array) {
          data = new TextDecoder().decode(raw);
        } else if (raw instanceof ArrayBuffer) {
          data = new TextDecoder().decode(new Uint8Array(raw));
        } else {
          return;
        }

        if (!data) return;

        const camera = parseProbeMatch(
          data,
          String(
            event?.remoteAddress ??
              event?.address ??
              event?.host ??
              ""
          )
        );

        if (!camera) return;

        const key = `${camera.host}:${camera.port}`;
        if (!discovered.has(key)) {
          discovered.set(key, camera);
        }
      });

      await socket.bind({
        port: 0,
        address: "0.0.0.0",
      });

      try {
        await socket.joinMulticastGroup(WS_DISCOVERY_ADDRESS);
      } catch {
        // Some Android implementations do not require explicit group join.
      }

      await socket.send(createProbeMessage(), {
        host: WS_DISCOVERY_ADDRESS,
        port: WS_DISCOVERY_PORT,
      });

      timer = setTimeout(() => {
        void finish();
      }, timeoutMs);
    } catch (error) {
      await finish(error);
    }
  });
}
