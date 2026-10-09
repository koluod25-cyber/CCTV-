import * as Crypto from "expo-crypto";

export type ReplayCredentials = {
  username?: string;
  password?: string;
};

export type OnvifReplayServices = {
  replayUrl?: string;
  recordingUrl?: string;
  searchUrl?: string;
};

const DEVICE_NS = "http://www.onvif.org/ver10/device/wsdl";
const REPLAY_NS = "http://www.onvif.org/ver10/replay/wsdl";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripXml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

function elements(xml: string, name: string): string[] {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `<(?:[\\w-]+:)?${safe}\\b[^>]*>[\\s\\S]*?</(?:[\\w-]+:)?${safe}>`,
    "gi",
  );
  return xml.match(regex) ?? [];
}

function tag(xml: string, name: string): string {
  return stripXml(elements(xml, name)[0] ?? "");
}

function serviceAddress(xml: string, serviceName: string): string | undefined {
  for (const service of elements(xml, serviceName)) {
    const address = tag(service, "XAddr");
    if (/^https?:\/\//i.test(address)) return address;
  }
  return undefined;
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    result += alphabet[(triple >> 18) & 63];
    result += alphabet[(triple >> 12) & 63];
    result += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    result += i + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return result;
}

async function wsSecurity(credentials: ReplayCredentials): Promise<string> {
  if (!credentials.username || !credentials.password) return "";
  const nonce = await Crypto.getRandomBytesAsync(20);
  const created = new Date().toISOString();
  const createdBytes = new TextEncoder().encode(created);
  const passwordBytes = new TextEncoder().encode(credentials.password);
  const input = new Uint8Array(nonce.length + createdBytes.length + passwordBytes.length);
  input.set(nonce, 0);
  input.set(createdBytes, nonce.length);
  input.set(passwordBytes, nonce.length + createdBytes.length);
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA1,
    input as unknown as BufferSource,
  );
  return `<wsse:Security soap:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${escapeXml(credentials.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.1#PasswordDigest">${bytesToBase64(new Uint8Array(digest))}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#Base64Binary">${bytesToBase64(nonce)}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security>`;
}

async function soapRequest(
  endpoint: string, action: string, body: string, credentials: ReplayCredentials,
): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="${DEVICE_NS}" xmlns:trp="${REPLAY_NS}" xmlns:tt="http://www.onvif.org/ver10/schema"><s:Header>${await wsSecurity(credentials)}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"` },
    body: envelope,
  });
  const responseText = await response.text();
  if (!response.ok || /<(?:[\w-]+:)?Fault\b/i.test(responseText)) {
    const fault = tag(responseText, "Text") || tag(responseText, "Reason");
    throw new Error(`ONVIF Replay HTTP ${response.status}${fault ? `: ${fault}` : ""}: ${responseText.slice(0, 220)}`);
  }
  return responseText;
}

/** Discovers optional ONVIF Recording/Search/Replay services from a camera or NVR. */
export async function discoverOnvifReplayServices(
  deviceServiceUrl: string, credentials: ReplayCredentials = {},
): Promise<OnvifReplayServices> {
  if (!/^https?:\/\//i.test(deviceServiceUrl.trim())) {
    throw new Error("Alamat layanan ONVIF harus berupa URL HTTP/HTTPS.");
  }
  const xml = await soapRequest(
    deviceServiceUrl.trim(), `${DEVICE_NS}/GetCapabilities`,
    "<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>",
    credentials,
  );
  const services: OnvifReplayServices = {
    replayUrl: serviceAddress(xml, "Replay"),
    recordingUrl: serviceAddress(xml, "Recording"),
    searchUrl: serviceAddress(xml, "Search"),
  };
  if (!services.replayUrl) {
    throw new Error("Kamera/decoder tidak mengumumkan layanan ONVIF Replay. Periksa dukungan Profile G atau API resmi perangkat.");
  }
  return services;
}

/**
 * Converts a recording token obtained from the camera/NVR's Recording/Search
 * service into the RTSP URI used to play the stored recording.
 */
export async function getOnvifReplayUri(
  replayServiceUrl: string, recordingToken: string, credentials: ReplayCredentials = {},
): Promise<string> {
  if (!/^https?:\/\//i.test(replayServiceUrl.trim())) {
    throw new Error("Alamat layanan Replay tidak valid.");
  }
  if (!recordingToken.trim()) throw new Error("Token rekaman belum dipilih.");
  const xml = await soapRequest(
    replayServiceUrl.trim(), `${REPLAY_NS}/GetReplayUri`,
    `<trp:GetReplayUri><trp:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trp:StreamSetup><trp:RecordingToken>${escapeXml(recordingToken.trim())}</trp:RecordingToken></trp:GetReplayUri>`,
    credentials,
  );
  const uri = tag(xml, "Uri");
  if (!/^rtsps?:\\/\\//i.test(uri)) {
    throw new Error("Perangkat tidak mengembalikan URI RTSP Playback yang valid.");
  }
  return uri;
}
