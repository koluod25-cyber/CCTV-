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

type OnvifCredentials = {
  username?: string;
  password?: string;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getTag(
  xml: string,
  tagName: string
): string {
  const escaped = tagName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

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
  const escapedTag = tagName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const escapedAttribute =
    attributeName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

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
  const escaped = tagName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const regex = new RegExp(
    `<(?:[\\w-]+:)?${escaped}\\b[^>]*>[\\s\\S]*?</(?:[\\w-]+:)?${escaped}>`,
    "gi"
  );

  return xml.match(regex) ?? [];
}

function normalizeUrl(
  value: string,
  fallbackUrl: string
) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);

    if (
      parsed.protocol === "rtsp:" ||
      parsed.protocol === "rtsps:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "https:"
    ) {
      return parsed.toString();
    }
  } catch {
    // Some cameras return malformed but usable URIs.
  }

  if (
    trimmed.startsWith("/") &&
    fallbackUrl
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

function extractMediaServiceUrl(
  capabilitiesXml: string
) {
  const candidates = [
    getTag(
      capabilitiesXml,
      "XAddr"
    ),
  ];

  const allXAddrMatches =
    capabilitiesXml.match(
      /<[^>]*XAddr[^>]*>([\s\S]*?)<\/[^>]*XAddr>/gi
    ) ?? [];

  for (const match of allXAddrMatches) {
    const value =
      match
        .replace(
          /<[^>]+>/g,
          ""
        )
        .trim();

    if (value) {
      candidates.push(value);
    }
  }

  const mediaCandidate =
    candidates.find((value) =>
      /\/media(?:2)?(?:[/?]|$)/i.test(
        value
      )
    );

  if (mediaCandidate) {
    return mediaCandidate;
  }

  return candidates.find((value) =>
    /^https?:\/\//i.test(value)
  ) ?? "";
}

async function sha1Base64(
  value: string
) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA1,
    value,
    {
      encoding:
        Crypto.CryptoEncoding.BASE64,
    }
  );
}

async function buildWsSecurityHeader(
  credentials: OnvifCredentials
) {
  if (
    !credentials.username ||
    !credentials.password
  ) {
    return "";
  }

  const randomBytes =
    await Crypto.getRandomBytesAsync(20);

  const nonce = Uint8Array.from(
    randomBytes
  );

  let binary = "";

  for (const byte of nonce) {
    binary += String.fromCharCode(byte);
  }

  const nonceBase64 =
    globalThis.btoa
      ? globalThis.btoa(binary)
      : "";

  const created =
    new Date().toISOString();

  const digestSource =
    binary +
    created +
    credentials.password;

  const passwordDigest =
    await sha1Base64(
      digestSource
    );

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
) {
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
          "application/soap+xml; charset=utf-8",
        SOAPAction: action,
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
) {
  const body = `
    <tds:GetCapabilities>
      <tds:Category>Media</tds:Category>
    </tds:GetCapabilities>
  `;

  return soapRequest(
    deviceUrl,
    "http://www.onvif.org/ver10/device/wsdl/GetCapabilities",
    body,
    credentials
  );
}

async function getProfiles(
  mediaUrl: string,
  credentials: OnvifCredentials
) {
  const body = `
    <trt:GetProfiles />
  `;

  return soapRequest(
    mediaUrl,
    "http://www.onvif.org/ver10/media/wsdl/GetProfiles",
    body,
    credentials
  );
}

async function getStreamUri(
  mediaUrl: string,
  profileToken: string,
  credentials: OnvifCredentials
) {
  const body = `
    <trt:GetStreamUri>
      <trt:StreamSetup>
        <tt:Stream>RTP-Unicast</tt:Stream>
        <tt:Transport>
          <tt:Protocol>RTSP</tt:Protocol>
        </tt:Transport>
      </trt:StreamSetup>
      <trt:ProfileToken>${escapeXml(
        profileToken
      )}</trt:ProfileToken>
    </trt:GetStreamUri>
  `;

  return soapRequest(
    mediaUrl,
    "http://www.onvif.org/ver10/media/wsdl/GetStreamUri",
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

  for (const element of profileElements) {
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

    const videoSourceElement =
      getAllElements(
        element,
        "VideoSourceConfiguration"
      )[0] ?? "";

    const videoEncoderElement =
      getAllElements(
        element,
        "VideoEncoderConfiguration"
      )[0] ?? "";

    const videoSourceToken =
      videoSourceElement
        ? getTag(
            videoSourceElement,
            "SourceToken"
          )
        : "";

    const videoEncoderToken =
      videoEncoderElement
        ? getAttribute(
            videoEncoderElement,
            "VideoEncoderConfiguration",
            "token"
          )
        : "";

    profiles.push({
      token,
      name,
      videoSourceToken:
        videoSourceToken || undefined,
      videoEncoderToken:
        videoEncoderToken || undefined,
    });
  }

  return profiles;
}

function chooseProfile(
  profiles: OnvifMediaProfile[]
) {
  if (!profiles.length) {
    return undefined;
  }

  /*
   * Prioritaskan profile yang memiliki
   * konfigurasi video encoder.
   */
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

function parseStreamUri(
  xml: string,
  fallbackUrl: string
) {
  const uri =
    getTag(
      xml,
      "Uri"
    );

  return normalizeUrl(
    uri,
    fallbackUrl
  );
}

function addCredentialsToRtspUri(
  uri: string,
  credentials: OnvifCredentials
) {
  if (
    !credentials.username &&
    !credentials.password
  ) {
    return uri;
  }

  try {
    const parsed = new URL(uri);

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

    let mediaUrl =
      extractMediaServiceUrl(
        capabilitiesXml
      );

    /*
     * Beberapa kamera hanya mengembalikan
     * endpoint media dengan format berbeda.
     */
    if (!mediaUrl) {
      mediaUrl =
        deviceServiceUrl;
    }

    const profilesXml =
      await getProfiles(
        mediaUrl,
        credentials
      );

    const profiles =
      parseProfiles(
        profilesXml
      );

    const profile =
      chooseProfile(profiles);

    if (!profile) {
      return {
        ok: false,
        mediaServiceUrl: mediaUrl,
        message:
          "Kamera tidak mengembalikan Media Profile ONVIF.",
      };
    }

    const streamXml =
      await getStreamUri(
        mediaUrl,
        profile.token,
        credentials
      );

    const rawStreamUri =
      parseStreamUri(
        streamXml,
        mediaUrl
      );

    if (!rawStreamUri) {
      return {
        ok: false,
        mediaServiceUrl: mediaUrl,
        profile,
        message:
          "Kamera tidak mengembalikan URI stream.",
      };
    }

    const streamUri =
      addCredentialsToRtspUri(
        rawStreamUri,
        credentials
      );

    return {
      ok: true,
      mediaServiceUrl: mediaUrl,
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