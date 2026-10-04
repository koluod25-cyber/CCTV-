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

const MEDIA1_NAMESPACE =
  "http://www.onvif.org/ver10/media/wsdl";

const MEDIA2_NAMESPACE =
  "http://www.onvif.org/ver20/media/wsdl";

const MEDIA1_GET_PROFILES =
  `${MEDIA1_NAMESPACE}/GetProfiles`;

const MEDIA1_GET_STREAM_URI =
  `${MEDIA1_NAMESPACE}/GetStreamUri`;

const MEDIA2_GET_PROFILES =
  `${MEDIA2_NAMESPACE}/GetProfiles`;

const MEDIA2_GET_STREAM_URI =
  `${MEDIA2_NAMESPACE}/GetStreamUri`;

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
  tagName: string,
): string {
  const escaped = escapeRegex(tagName);

  const regex = new RegExp(
    `<(?:[\\w-]+:)?${escaped}\\b[^>]*>` +
      `([\\s\\S]*?)` +
      `</(?:[\\w-]+:)?${escaped}>`,
    "i",
  );

  return regex.exec(xml)?.[1]?.trim() ?? "";
}

function getAttribute(
  xml: string,
  tagName: string,
  attributeName: string,
): string {
  const escapedTag =
    escapeRegex(tagName);

  const escapedAttribute =
    escapeRegex(attributeName);

  const regex = new RegExp(
    `<(?:[\\w-]+:)?${escapedTag}\\b` +
      `[^>]*\\b${escapedAttribute}\\s*=\\s*["']([^"']+)["']`,
    "i",
  );

  return regex.exec(xml)?.[1] ?? "";
}

function getAttributeAnyCase(
  xml: string,
  tagName: string,
  attributeNames: string[],
): string {
  for (const name of attributeNames) {
    const value =
      getAttribute(
        xml,
        tagName,
        name,
      );

    if (value) {
      return value;
    }
  }

  return "";
}

function getAllElements(
  xml: string,
  tagName: string,
): string[] {
  const escaped =
    escapeRegex(tagName);

  const regex = new RegExp(
    `<(?:[\\w-]+:)?${escaped}\\b[^>]*>` +
      `[\\s\\S]*?` +
      `</(?:[\\w-]+:)?${escaped}>`,
    "gi",
  );

  return xml.match(regex) ?? [];
}

function stripXml(
  value: string,
): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function bytesToBase64(
  bytes: Uint8Array,
): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  let result = "";

  for (
    let i = 0;
    i < bytes.length;
    i += 3
  ) {
    const a =
      bytes[i] ?? 0;

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
      alphabet[
        (triple >> 18) & 63
      ];

    result +=
      alphabet[
        (triple >> 12) & 63
      ];

    result +=
      i + 1 < bytes.length
        ? alphabet[
            (triple >> 6) & 63
          ]
        : "=";

    result +=
      i + 2 < bytes.length
        ? alphabet[
            triple & 63
          ]
        : "=";
  }

  return result;
}

function stringToUtf8(
  value: string,
): Uint8Array {
  return new TextEncoder().encode(
    value,
  );
}

function concatBytes(
  ...arrays: Uint8Array[]
): Uint8Array {
  const totalLength =
    arrays.reduce(
      (sum, item) =>
        sum + item.length,
      0,
    );

  const result =
    new Uint8Array(
      totalLength,
    );

  let offset = 0;

  for (const array of arrays) {
    result.set(
      array,
      offset,
    );

    offset +=
      array.length;
  }

  return result;
}

async function buildWsSecurityHeader(
  credentials: OnvifCredentials,
): Promise<string> {
  if (
    !credentials.username ||
    !credentials.password
  ) {
    return "";
  }

  const nonce =
    await Crypto.getRandomBytesAsync(
      20,
    );

  const created =
    new Date().toISOString();

  const digestInput =
    concatBytes(
      nonce,
      stringToUtf8(created),
      stringToUtf8(
        credentials.password,
      ),
    );

  const digestBuffer =
    await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA1,
      digestInput as unknown as BufferSource,
    );

  const passwordDigest =
    bytesToBase64(
      new Uint8Array(
        digestBuffer,
      ),
    );

  const nonceBase64 =
    bytesToBase64(
      nonce,
    );

  return `
    <wsse:Security
      soap:mustUnderstand="1"
      xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
      xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">

      <wsse:UsernameToken>

        <wsse:Username>${escapeXml(
          credentials.username,
        )}</wsse:Username>

        <wsse:Password
          Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.1#PasswordDigest">${passwordDigest}</wsse:Password>

        <wsse:Nonce
          EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#Base64Binary">${nonceBase64}</wsse:Nonce>

        <wsu:Created>${created}</wsu:Created>

      </wsse:UsernameToken>

    </wsse:Security>
  `;
}

/* ============================================================
 * HTTP DIGEST AUTHENTICATION
 * ============================================================ */

function parseDigestChallenge(
  header: string,
): Record<string, string> {
  const result: Record<
    string,
    string
  > = {};

  const value =
    header.replace(
      /^\s*Digest\s*/i,
      "",
    );

  const regex =
    /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;

  let match:
    RegExpExecArray | null;

  while (
    (match = regex.exec(value)) !==
    null
  ) {
    result[
      match[1].toLowerCase()
    ] =
      match[2] !== undefined
        ? match[2]
        : match[3];
  }

  return result;
}

function randomHex(
  length: number,
): string {
  let value = "";

  while (
    value.length < length
  ) {
    value += Math.floor(
      Math.random() *
        0xffffffff,
    )
      .toString(16)
      .padStart(8, "0");
  }

  return value.slice(
    0,
    length,
  );
}

async function md5Hex(
  value: string,
): Promise<string> {
  const digest =
    await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.MD5,
      value,
    );

  const bytes =
    new Uint8Array(
      digest,
    );

  return Array.from(
    bytes,
  )
    .map(
      (byte) =>
        byte
          .toString(16)
          .padStart(2, "0"),
    )
    .join("");
}

function quoteDigestValue(
  value: string,
): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}

async function buildDigestAuthorization(
  challengeHeader: string,
  username: string,
  password: string,
  method: string,
  requestUri: string,
): Promise<string> {
  const challenge =
    parseDigestChallenge(
      challengeHeader,
    );

  const realm =
    challenge.realm;

  const nonce =
    challenge.nonce;

  if (
    !realm ||
    !nonce
  ) {
    throw new Error(
      "HTTP Digest challenge tidak lengkap.",
    );
  }

  const algorithm =
    (
      challenge.algorithm ||
      "MD5"
    ).toUpperCase();

  if (
    algorithm !== "MD5" &&
    algorithm !== "MD5-SESS"
  ) {
    throw new Error(
      `HTTP Digest algorithm ${algorithm} belum didukung.`,
    );
  }

  const qopOptions =
    (
      challenge.qop ||
      ""
    )
      .split(",")
      .map(
        (item) =>
          item
            .trim()
            .toLowerCase(),
      )
      .filter(Boolean);

  if (
    qopOptions.length > 0 &&
    !qopOptions.includes(
      "auth",
    )
  ) {
    throw new Error(
      "HTTP Digest kamera tidak menyediakan qop=auth.",
    );
  }

  const qop =
    qopOptions.length > 0
      ? "auth"
      : "";

  const cnonce =
    randomHex(32);

  const nc =
    "00000001";

  let ha1 =
    await md5Hex(
      `${username}:${realm}:${password}`,
    );

  if (
    algorithm ===
    "MD5-SESS"
  ) {
    ha1 =
      await md5Hex(
        `${ha1}:${nonce}:${cnonce}`,
      );
  }

  const ha2 =
    await md5Hex(
      `${method}:${requestUri}`,
    );

  const response =
    qop
      ? await md5Hex(
          `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`,
        )
      : await md5Hex(
          `${ha1}:${nonce}:${ha2}`,
        );

  const parts = [
    `username=${quoteDigestValue(username)}`,
    `realm=${quoteDigestValue(realm)}`,
    `nonce=${quoteDigestValue(nonce)}`,
    `uri=${quoteDigestValue(requestUri)}`,
    `response=${quoteDigestValue(response)}`,
  ];

  if (algorithm) {
    parts.push(
      `algorithm=${algorithm}`,
    );
  }

  if (
    challenge.opaque
  ) {
    parts.push(
      `opaque=${quoteDigestValue(
        challenge.opaque,
      )}`,
    );
  }

  if (qop) {
    parts.push(
      `qop=${qop}`,
    );

    parts.push(
      `nc=${nc}`,
    );

    parts.push(
      `cnonce=${quoteDigestValue(
        cnonce,
      )}`,
    );
  }

  return `Digest ${parts.join(
    ", ",
  )}`;
}

function getRequestUri(
  endpoint: string,
): string {
  try {
    const parsed =
      new URL(endpoint);

    return (
      parsed.pathname ||
      "/"
    ) + (
      parsed.search ||
      ""
    );
  } catch {
    return endpoint;
  }
}

/* ============================================================
 * SOAP
 * ============================================================ */

type SoapVersion = 1 | 2;

async function soapRequest(
  endpoint: string,
  action: string,
  body: string,
  credentials: OnvifCredentials,
): Promise<string> {
  const security =
    await buildWsSecurityHeader(
      credentials,
    );

  const attempts: Array<{
    version: SoapVersion;
    envelope: string;
    headers: Record<
      string,
      string
    >;
  }> = [
    {
      version: 2,

      envelope: `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope
  xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
  xmlns:t2="http://www.onvif.org/ver20/media/wsdl"
  xmlns:tt="http://www.onvif.org/ver10/schema">

  <s:Header>
    ${security}
  </s:Header>

  <s:Body>
    ${body}
  </s:Body>

</s:Envelope>`,

      headers: {
        "Content-Type":
          `application/soap+xml; charset=utf-8; action="${action}"`,

        SOAPAction:
          `"${action}"`,
      },
    },

    {
      version: 1,

      envelope: `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope
  xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
  xmlns:t2="http://www.onvif.org/ver20/media/wsdl"
  xmlns:tt="http://www.onvif.org/ver10/schema">

  <s:Header>
    ${security}
  </s:Header>

  <s:Body>
    ${body}
  </s:Body>

</s:Envelope>`,

      headers: {
        "Content-Type":
          "text/xml; charset=utf-8",

        SOAPAction:
          `"${action}"`,
      },
    },
  ];

  const errors: string[] =
    [];

  const hasCredentials =
    Boolean(
      credentials.username,
    ) &&
    Boolean(
      credentials.password,
    );

  for (
    const attempt of attempts
  ) {
    try {
      const baseHeaders =
        {
          ...attempt.headers,
        };

      let response =
        await fetch(
          endpoint,
          {
            method: "POST",
            headers:
              baseHeaders,
            body:
              attempt.envelope,
          },
        );

      /*
       * Jika kamera meminta HTTP Digest,
       * lakukan request kedua dengan Authorization Digest.
       */
      if (
        response.status === 401 &&
        hasCredentials
      ) {
        const challenge =
          response.headers.get(
            "WWW-Authenticate",
          ) ||
          response.headers.get(
            "www-authenticate",
          ) ||
          "";

        if (
          /Digest\s/i.test(
            challenge,
          )
        ) {
          const authorization =
            await buildDigestAuthorization(
              challenge,
              credentials.username!,
              credentials.password!,
              "POST",
              getRequestUri(
                endpoint,
              ),
            );

          response =
            await fetch(
              endpoint,
              {
                method:
                  "POST",

                headers: {
                  ...baseHeaders,

                  Authorization:
                    authorization,
                },

                body:
                  attempt.envelope,
              },
            );
        }
      }

      const text =
        await response.text();

      if (
        !response.ok
      ) {
        const challenge =
          response.headers.get(
            "WWW-Authenticate",
          ) ||
          response.headers.get(
            "www-authenticate",
          ) ||
          "";

        errors.push(
          `SOAP ${attempt.version}.0 HTTP ${response.status}` +
            (
              challenge
                ? ` [Auth: ${challenge.slice(
                    0,
                    180,
                  )}]`
                : ""
            ) +
            `: ${text.slice(
              0,
              300,
            )}`,
        );

        continue;
      }

      if (
        /<(?:[\w-]+:)?Fault\b/i.test(
          text,
        )
      ) {
        const reason =
          getTag(
            text,
            "Text",
          ) ||
          getTag(
            text,
            "Reason",
          ) ||
          getTag(
            text,
            "Subcode",
          ) ||
          "ONVIF SOAP Fault";

        errors.push(
          `SOAP ${attempt.version}.0 Fault: ${stripXml(
            reason,
          )}`,
        );

        continue;
      }

      return text;
    } catch (
      error
    ) {
      errors.push(
        `SOAP ${attempt.version}.0: ${
          error instanceof Error
            ? error.message
            : "Network error"
        }`,
      );
    }
  }

  throw new Error(
    errors.join(
      " | ",
    ) ||
      "ONVIF SOAP request gagal.",
  );
}

/* ============================================================
 * CAPABILITIES
 * ============================================================ */

async function getCapabilities(
  deviceUrl: string,
  credentials: OnvifCredentials,
): Promise<string> {
  const body = `
    <tds:GetCapabilities>
      <tds:Category>All</tds:Category>
    </tds:GetCapabilities>
  `;

  return soapRequest(
    deviceUrl,
    DEVICE_SERVICE_ACTION,
    body,
    credentials,
  );
}

function extractAllXAddrs(
  xml: string,
): string[] {
  const elements =
    getAllElements(
      xml,
      "XAddr",
    );

  const values: string[] =
    [];

  for (
    const element of elements
  ) {
    const value =
      stripXml(
        element,
      );

    if (
      value &&
      /^https?:\/\//i.test(
        value,
      )
    ) {
      values.push(
        value,
      );
    }
  }

  return Array.from(
    new Set(values),
  );
}

function getMediaServiceCandidates(
  capabilitiesXml: string,
  fallbackUrl: string,
): string[] {
  const xaddrs =
    extractAllXAddrs(
      capabilitiesXml,
    );

  const mediaCandidates =
    xaddrs.filter(
      (value) =>
        /\/media(?:2)?(?:[/?#:]|$)/i.test(
          value,
        ),
    );

  const remaining =
    xaddrs.filter(
      (value) =>
        !mediaCandidates.includes(
          value,
        ),
    );

  return Array.from(
    new Set([
      ...mediaCandidates,
      ...remaining,
      fallbackUrl,
    ]),
  );
}

/* ============================================================
 * PROFILES
 * ============================================================ */

async function getProfiles(
  mediaUrl: string,
  credentials: OnvifCredentials,
  mediaVersion: 1 | 2,
): Promise<string> {
  if (
    mediaVersion === 2
  ) {
    return soapRequest(
      mediaUrl,
      MEDIA2_GET_PROFILES,
      `
        <t2:GetProfiles />
      `,
      credentials,
    );
  }

  return soapRequest(
    mediaUrl,
    MEDIA1_GET_PROFILES,
    `
      <trt:GetProfiles />
    `,
    credentials,
  );
}

function parseProfiles(
  xml: string,
): OnvifMediaProfile[] {
  const profileElements =
    getAllElements(
      xml,
      "Profiles",
    );

  const directProfiles =
    getAllElements(
      xml,
      "Profile",
    );

  const allElements =
    [
      ...profileElements,
      ...directProfiles,
    ];

  const profiles:
    OnvifMediaProfile[] =
    [];

  const seenTokens =
    new Set<string>();

  for (
    const element of allElements
  ) {
    const token =
      getAttributeAnyCase(
        element,
        "Profiles",
        [
          "token",
          "Token",
        ],
      ) ||
      getAttributeAnyCase(
        element,
        "Profile",
        [
          "token",
          "Token",
        ],
      );

    if (
      !token ||
      seenTokens.has(
        token,
      )
    ) {
      continue;
    }

    const name =
      getTag(
        element,
        "Name",
      ) ||
      token;

    const sourceElements =
      getAllElements(
        element,
        "VideoSourceConfiguration",
      );

    const encoderElements =
      getAllElements(
        element,
        "VideoEncoderConfiguration",
      );

    const sourceElement =
      sourceElements[0] ??
      "";

    const encoderElement =
      encoderElements[0] ??
      "";

    const videoSourceToken =
      sourceElement
        ? getTag(
            sourceElement,
            "SourceToken",
          )
        : "";

    const videoEncoderToken =
      encoderElement
        ? getAttributeAnyCase(
            encoderElement,
            "VideoEncoderConfiguration",
            [
              "token",
              "Token",
            ],
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

    seenTokens.add(
      token,
    );
  }

  return profiles;
}

function chooseProfile(
  profiles: OnvifMediaProfile[],
): OnvifMediaProfile | undefined {
  if (
    !profiles.length
  ) {
    return undefined;
  }

  return (
    profiles.find(
      (profile) =>
        Boolean(
          profile.videoEncoderToken,
        ),
    ) ??
    profiles.find(
      (profile) =>
        Boolean(
          profile.videoSourceToken,
        ),
    ) ??
    profiles[0]
  );
}

/* ============================================================
 * STREAM URI
 * ============================================================ */

async function getStreamUri(
  mediaUrl: string,
  profileToken: string,
  credentials: OnvifCredentials,
  mediaVersion: 1 | 2,
): Promise<string> {
  const body =
    mediaVersion === 2
      ? `
        <t2:GetStreamUri>

          <t2:StreamSetup>

            <tt:Stream>
              RTP-Unicast
            </tt:Stream>

            <tt:Transport>

              <tt:Protocol>
                RTSP
              </tt:Protocol>

            </tt:Transport>

          </t2:StreamSetup>

          <t2:ProfileToken>${escapeXml(
            profileToken,
          )}</t2:ProfileToken>

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
            profileToken,
          )}</trt:ProfileToken>

        </trt:GetStreamUri>
      `;

  const action =
    mediaVersion === 2
      ? MEDIA2_GET_STREAM_URI
      : MEDIA1_GET_STREAM_URI;

  return soapRequest(
    mediaUrl,
    action,
    body,
    credentials,
  );
}

function normalizeStreamUri(
  value: string,
  fallbackUrl: string,
): string {
  const trimmed =
    stripXml(value);

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
          fallbackUrl,
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
  credentials: OnvifCredentials,
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

async function tryMediaEndpoint(
  mediaUrl: string,
  credentials: OnvifCredentials,
  mediaVersion: 1 | 2,
): Promise<OnvifMediaResult> {
  const profilesXml =
    await getProfiles(
      mediaUrl,
      credentials,
      mediaVersion,
    );

  const profiles =
    parseProfiles(
      profilesXml,
    );

  const profile =
    chooseProfile(
      profiles,
    );

  if (!profile) {
    return {
      ok: false,
      mediaServiceUrl:
        mediaUrl,
      message:
        "Endpoint ONVIF merespons, tetapi tidak ada Media Profile yang dapat dibaca.",
    };
  }

  const streamXml =
    await getStreamUri(
      mediaUrl,
      profile.token,
      credentials,
      mediaVersion,
    );

  const rawUri =
    getTag(
      streamXml,
      "Uri",
    );

  const normalizedUri =
    normalizeStreamUri(
      rawUri,
      mediaUrl,
    );

  if (!normalizedUri) {
    return {
      ok: false,
      mediaServiceUrl:
        mediaUrl,
      profile,
      message:
        "Media Profile ditemukan, tetapi kamera tidak mengembalikan URI stream RTSP.",
    };
  }

  const streamUri =
    addCredentialsToRtspUri(
      normalizedUri,
      credentials,
    );

  return {
    ok: true,
    mediaServiceUrl:
      mediaUrl,
    profile,
    streamUri,
    message:
      `ONVIF Media${mediaVersion} berhasil memperoleh URI stream RTSP.`,
  };
}

export async function getOnvifStreamUri(
  deviceServiceUrl: string,
  credentials: OnvifCredentials = {},
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
        credentials,
      );

    const mediaCandidates =
      getMediaServiceCandidates(
        capabilitiesXml,
        deviceServiceUrl,
      );

    const errors: string[] = [];

    for (
      const mediaUrl of mediaCandidates
    ) {
      for (
        const mediaVersion of [
          1,
          2,
        ] as const
      ) {
        try {
          const result =
            await tryMediaEndpoint(
              mediaUrl,
              credentials,
              mediaVersion,
            );

          if (result.ok) {
            return result;
          }

          errors.push(
            `Media${mediaVersion} ${mediaUrl}: ${result.message}`,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "gagal";

          errors.push(
            `Media${mediaVersion} ${mediaUrl}: ${message}`,
          );
        }
      }
    }

    return {
      ok: false,
      message:
        errors.length > 0
          ? `Kamera terdeteksi, tetapi Media Profile ONVIF belum berhasil diperoleh. ${errors[0]}`
          : "Kamera terdeteksi, tetapi Media Profile ONVIF belum berhasil diperoleh.",
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Gagal mengambil informasi ONVIF.";

    return {
      ok: false,
      message,
    };
  }
}