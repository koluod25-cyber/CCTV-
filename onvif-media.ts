import * as Crypto from "expo-crypto";

export type OnvifMediaProfile = {
  token: string;
  name: string;
  videoSourceToken?: string;
  videoEncoderToken?: string;
};

export type OnvifMediaResult = {
  ok: boolean;
  mediaServiceUrl?: string;
  profile?: OnvifMediaProfile;
  streamUri?: string;
  message: string;
};

export type OnvifCredentials = {
  username?: string;
  password?: string;
};

const DEVICE_SERVICE_ACTION =
  "http://www.onvif.org/ver10/device/wsdl/GetCapabilities";

const MEDIA_SERVICE_ACTION =
  "http://www.onvif.org/ver10/media/wsdl/GetProfiles";

const STREAM_URI_ACTION =
  "http://www.onvif.org/ver10/media/wsdl/GetStreamUri";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTag(
  xml: string,
  tagName: string
): string {
  const escaped = escapeRegex(tagName);

  const regex = new RegExp(
    `<(?:[\\w-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${escaped}>`,
    "i"
  );

  return regex.exec(xml)?.[1]?.trim() ?? "";
}

function getAttribute(
  xml: string,
  tagName: string,
  attributeName: string
): string {
  const escapedTag = escapeRegex(tagName);
  const escapedAttribute = escapeRegex(attributeName);

  const regex = new RegExp(
    `<(?:[\\w-]+:)?${escapedTag}\\b[^>]*\\b${escapedAttribute}=["']([^"']+)["']`,
    "i"
  );

  return regex.exec(xml)?.[1] ?? "";
}

function getAllElements(
  xml: string,
  tagName: string
): string[] {
  const escaped = escapeRegex(tagName);

  const regex = new RegExp(
    `<(?:[\\w-]+:)?${escaped}\\b[^>]*>[\\s\\S]*?</(?:[\\w-]+:)?${escaped}>`,
    "gi"
  );

  return xml.match(regex) ?? [];
}

function bytesToBase64(
  bytes: Uint8Array
): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  let result = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b =
      i + 1 < bytes.length
        ? bytes[i + 1]
        : 0;
    const c =
      i + 2 < bytes.length
        ? bytes[i + 2]
        : 0;

    const triple =
      (a << 16) |
      (b << 8) |
      c;

    result +=
      alphabet[(triple >> 18) & 63];

    result +=
      alphabet[(triple >> 12) & 63];

    result +=
      i + 1 < bytes.length
        ? alphabet[(triple >> 6) & 63]
        : "=";

    result +=
      i + 2 < bytes.length
        ? alphabet[triple & 63]
        : "=";
  }

  return result;
}

function stringToUtf8(
  value: string
): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(
  ...arrays: Uint8Array[]
): Uint8Array {
  const totalLength = arrays.reduce(
    (sum, item) => sum + item.length,
    0
  );

  const result =
    new Uint8Array(totalLength);

  let offset = 0;

  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}

async function buildWsSecurityHeader(
  credentials: OnvifCredentials
): Promise<string> {
  if (
    !credentials.username ||
    !credentials.password
  ) {
    return "";
  }

  const nonce =
    await Crypto.getRandomBytesAsync(20);

  const created =
    new Date().toISOString();

  /*
   * ONVIF UsernameToken PasswordDigest:
   *
   * Base64(
   *   SHA1(
   *     rawNonce +
   *     Created +
   *     Password
   *   )
   * )
   *
   * Nonce harus berupa byte mentah,
   * bukan string Base64.
   */
  const digestInput =
    concatBytes(
      nonce,
      stringToUtf8(created),
      stringToUtf8(
        credentials.password
      )
    );

  const digestBuffer =
    await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA1,
      digestInput
    );

  const passwordDigest =
    bytesToBase64(
      new Uint8Array(digestBuffer)
    );

  const nonceBase64 =
    bytesToBase64(nonce);

  return `
    <wsse:Security
      soap:mustUnderstand="1"
      xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
      xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">

      <wsse:UsernameToken>

        <wsse:Username>${escapeXml(
          credentials.username
        )}</wsse:Username>

        <wsse:Password
          Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.1#PasswordDigest">
          ${passwordDigest}
        </wsse:Password>

        <wsse:Nonce
          EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">
          ${nonceBase64}
        </wsse:Nonce>

        <wsu:Created>${created}</wsu:Created>

      </wsse:UsernameToken>

    </wsse:Security>
  `;
}

async function soapRequest(
  endpoint: string,
  action: string,
  body: string,
  credentials: OnvifCredentials
): Promise<string> {
  const security =
    await buildWsSecurityHeader(
      credentials
    );

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>

<s:Envelope
  xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
  xmlns:tt="http://www.onvif.org/ver10/schema"
  xmlns:soap="http://www.w3.org/2003/05/soap-envelope">

  <s:Header>
    ${security}
  </s:Header>

  <s:Body>
    ${body}
  </s:Body>

</s:Envelope>`;

  const response =
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type":
          `application/soap+xml; charset=utf-8; action="${action}"`,
      },
      body: envelope,
    });

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `ONVIF HTTP ${response.status}: ${
        text.slice(0, 300)
      }`
    );
  }

  if (
    /<[^>]*Fault\b/i.test(text)
  ) {
    const reason =
      getTag(text, "Text") ||
      getTag(text, "Reason") ||
      "ONVIF SOAP Fault";

    throw new Error(reason);
  }

  return text;
}

async function getCapabilities(
  deviceUrl: string,
  credentials: OnvifCredentials
): Promise<string> {
  const body = `
    <tds:GetCapabilities>
      <tds:Category>Media</tds:Category>
    </tds:GetCapabilities>
  `;

  return soapRequest(
    deviceUrl,
    DEVICE_SERVICE_ACTION,
    body,
    credentials
  );
}

function extractAllXAddrs(
  xml: string
): string[] {
  const matches =
    xml.match(
      /<[^>]*XAddr[^>]*>([\s\S]*?)<\/[^>]*XAddr>/gi
    ) ?? [];

  return matches
    .map((item) =>
      item
        .replace(/<[^>]+>/g, "")
        .trim()
    )
    .filter(Boolean);
}

function extractMediaServiceUrl(
  capabilitiesXml: string,
  fallbackUrl: string
): string {
  const xaddrs =
    extractAllXAddrs(
      capabilitiesXml
    );

  const media =
    xaddrs.find((value) =>
      /\/media2?(?:[/?]|$)/i.test(value)
    );

  if (media) {
    return media;
  }

  const httpEndpoint =
    xaddrs.find((value) =>
      /^https?:\/\//i.test(value)
    );

  return (
    httpEndpoint ||
    fallbackUrl
  );
}

async function getProfiles(
  mediaUrl: string,
  credentials: OnvifCredentials
): Promise<string> {
  const body = `
    <trt:GetProfiles />
  `;

  return soapRequest(
    mediaUrl,
    MEDIA_SERVICE_ACTION,
    body,
    credentials
  );
}

function parseProfiles(
  xml: string
): OnvifMediaProfile[] {
  const profileElements =
    getAllElements(
      xml,
      "Profile"
    );

  const profiles: OnvifMediaProfile[] =
    [];

  for (
    const element of profileElements
  ) {
    const token =
      getAttribute(
        element,
        "Profile",
        "token"
      );

    if (!token) {
      continue;
    }

    const name =
      getTag(
        element,
        "Name"
      ) || token;

    const sourceElements =
      getAllElements(
        element,
        "VideoSourceConfiguration"
      );

    const encoderElements =
      getAllElements(
        element,
        "VideoEncoderConfiguration"
      );

    const sourceElement =
      sourceElements[0] ?? "";

    const encoderElement =
      encoderElements[0] ?? "";

    const videoSourceToken =
      sourceElement
        ? getTag(
            sourceElement,
            "SourceToken"
          )
        : "";

    const videoEncoderToken =
      encoderElement
        ? getAttribute(
            encoderElement,
            "VideoEncoderConfiguration",
            "token"
          )
        : "";

    profiles.push({
      token,
      name,
      videoSourceToken:
        videoSourceToken ||
        undefined,
      videoEncoderToken:
        videoEncoderToken ||
        undefined,
    });
  }

  return profiles;
}

function chooseProfile(
  profiles: OnvifMediaProfile[]
): OnvifMediaProfile | undefined {
  if (!profiles.length) {
    return undefined;
  }

  return (
    profiles.find(
      (profile) =>
        Boolean(
          profile.videoEncoderToken
        )
    ) ??
    profiles[0]
  );
}

async function getStreamUri(
  mediaUrl: string,
  profileToken: string,
  credentials: OnvifCredentials
): Promise<string> {
  const body = `
    <trt:GetStreamUri>

      <trt:StreamSetup>

        <tt:Stream>
          RTP-Unicast
        </tt:Stream>

        <tt:Transport>
          <tt:Protocol>
            RTSP
          </tt:Protocol>
        </tt:Transport>

      </trt:StreamSetup>

      <trt:ProfileToken>${escapeXml(
        profileToken
      )}</trt:ProfileToken>

    </trt:GetStreamUri>
  `;

  return soapRequest(
    mediaUrl,
    STREAM_URI_ACTION,
    body,
    credentials
  );
}

function normalizeStreamUri(
  value: string,
  fallbackUrl: string
): string {
  const trimmed =
    value.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parsed =
      new URL(trimmed);

    return parsed.toString();
  } catch {
    if (
      trimmed.startsWith("/")
    ) {
      try {
        return new URL(
          trimmed,
          fallbackUrl
        ).toString();
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }
}

function addCredentialsToRtspUri(
  uri: string,
  credentials: OnvifCredentials
): string {
  if (
    !credentials.username &&
    !credentials.password
  ) {
    return uri;
  }

  try {
    const parsed =
      new URL(uri);

    if (
      credentials.username &&
      !parsed.username
    ) {
      parsed.username =
        credentials.username;
    }

    if (
      credentials.password &&
      !parsed.password
    ) {
      parsed.password =
        credentials.password;
    }

    return parsed.toString();
  } catch {
    return uri;
  }
}

export async function getOnvifStreamUri(
  deviceServiceUrl: string,
  credentials: OnvifCredentials = {}
): Promise<OnvifMediaResult> {
  if (!deviceServiceUrl) {
    return {
      ok: false,
      message:
        "Endpoint layanan ONVIF tidak tersedia.",
    };
  }

  try {
    const capabilitiesXml =
      await getCapabilities(
        deviceServiceUrl,
        credentials
      );

    const mediaServiceUrl =
      extractMediaServiceUrl(
        capabilitiesXml,
        deviceServiceUrl
      );

    const profilesXml =
      await getProfiles(
        mediaServiceUrl,
        credentials
      );

    const profiles =
      parseProfiles(
        profilesXml
      );

    const profile =
      chooseProfile(
        profiles
      );

    if (!profile) {
      return {
        ok: false,
        mediaServiceUrl,
        message:
          "Kamera tidak mengembalikan Media Profile ONVIF.",
      };
    }

    const streamXml =
      await getStreamUri(
        mediaServiceUrl,
        profile.token,
        credentials
      );

    const rawUri =
      getTag(
        streamXml,
        "Uri"
      );

    const normalizedUri =
      normalizeStreamUri(
        rawUri,
        mediaServiceUrl
      );

    if (!normalizedUri) {
      return {
        ok: false,
        mediaServiceUrl,
        profile,
        message:
          "Kamera tidak mengembalikan URI stream RTSP.",
      };
    }

    const streamUri =
      addCredentialsToRtspUri(
        normalizedUri,
        credentials
      );

    return {
      ok: true,
      mediaServiceUrl,
      profile,
      streamUri,
      message:
        "URI stream RTSP berhasil diperoleh dari ONVIF.",
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Gagal mengambil URI stream ONVIF.";

    return {
      ok: false,
      message,
    };
  }
}