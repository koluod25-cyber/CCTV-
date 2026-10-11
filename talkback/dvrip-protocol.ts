
/**
 * CCTV Universal Monitor
 * DVRIP Talkback protocol utilities for iCSee/Xiongmai cameras.
 *
 * Verified protocol details:
 * - DVRIP header: 20 bytes, little-endian fields.
 * - OPTalk claim: message 1434, response 1435.
 * - Audio: message 1432 (phone -> camera).
 * - Audio: message 1433 (camera -> phone).
 * - G.711 A-law, 8 kHz, 8-bit, 320-byte audio frames.
 *
 * IMPORTANT:
 * This file builds and parses protocol frames only.
 * It does not open TCP sockets or capture Android microphone audio.
 */

export const DVRIP = {
  HEADER_SIZE: 20,
  MAGIC: 0xff,
  FRAME_TYPE: 0x01,

  LOGIN_REQUEST: 1000,
  LOGIN_RESPONSE: 1001,
  
  TALK_AUDIO_TO_CAMERA: 1432,
  TALK_AUDIO_FROM_CAMERA: 1433,

  TALK_START: 1430,
  TALK_STOP: 1431,
  TALK_CLAIM: 1434,
  TALK_CLAIM_RESPONSE: 1435,

  AUDIO_SAMPLE_RATE: 8000,
  AUDIO_BITS_PER_SAMPLE: 8,
  AUDIO_FRAME_SIZE: 320,
  AUDIO_HEADER_SIZE: 8,
  AUDIO_PAYLOAD_SIZE: 328,
} as const;

export type DvripHeader = {
  sessionId: number;
  sequence: number;
  messageId: number;
  payloadLength: number;
};

export type TalkClaimOptions = {
  sessionId: string | number;
  sampleRate?: number;
  sampleBit?: number;
  bitRate?: number;
};

export type DvripFrame = {
  header: DvripHeader;
  payload: Uint8Array;
};

const MAX_PAYLOAD_SIZE = 16 * 1024 * 1024;

/**
 * Accepts numeric session IDs or hexadecimal strings such as
 * "0x0000001b".
 */
export function parseSessionId(
  value: string | number,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > 0xffffffff
  ) {
    throw new Error("Session ID DVRIP tidak valid.");
  }

  return parsed;
}

/**
 * Encodes a complete 20-byte DVRIP header and payload.
 *
 * JSON messages use UTF-8 and terminate with LF + NUL.
 * Binary audio messages must not receive a JSON terminator.
 */
export function encodeDvripFrame(
  messageId: number,
  sessionId: string | number,
  sequence: number,
  payload: Uint8Array,
): Uint8Array {
  if (
    !Number.isInteger(messageId) ||
    messageId < 0 ||
    messageId > 0xffff
  ) {
    throw new Error("Message ID DVRIP tidak valid.");
  }

  if (
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    sequence > 0xffffffff
  ) {
    throw new Error("Sequence DVRIP tidak valid.");
  }

  if (payload.length > MAX_PAYLOAD_SIZE) {
    throw new Error("Payload DVRIP terlalu besar.");
  }

  const buffer = new ArrayBuffer(
    DVRIP.HEADER_SIZE + payload.length,
  );

  const view = new DataView(buffer);

  // Header byte 0: magic.
  view.setUint8(0, DVRIP.MAGIC);

  // Header byte 1: frame type.
  view.setUint8(1, DVRIP.FRAME_TYPE);

  // Reserved fields.
  view.setUint16(2, 0, true);

  // Session ID, little-endian.
  view.setUint32(
    4,
    parseSessionId(sessionId),
    true,
  );

  // Sequence, little-endian.
  view.setUint32(8, sequence, true);

  view.setUint16(12, 0, true);

  // Message ID, little-endian.
  view.setUint16(14, messageId, true);

  // Payload length, little-endian.
  view.setUint32(16, payload.length, true);

  const result = new Uint8Array(buffer);
  result.set(payload, DVRIP.HEADER_SIZE);

  return result;
}

/**
 * Builds a plaintext JSON DVRIP message.
 */
export function encodeDvripJson(
  messageId: number,
  sessionId: string | number,
  sequence: number,
  body: Record<string, unknown>,
): Uint8Array {
  const json = JSON.stringify(body);

  const jsonBytes = new TextEncoder().encode(
    json + "\n\u0000",
  );

  return encodeDvripFrame(
    messageId,
    sessionId,
    sequence,
    jsonBytes,
  );
}

/**
 * Creates an OPTalk Claim request.
 *
 * A successful Claim response is not proof that audio is playing.
 * The TCP connection and authenticated session must remain alive.
 */
export function createTalkClaim(
  options: TalkClaimOptions,
  sequence = 1,
): Uint8Array {
  const sessionId = parseSessionId(
    options.sessionId,
  );

  const sessionText =
    "0x" +
    sessionId.toString(16).padStart(8, "0");

  return encodeDvripJson(
    DVRIP.TALK_CLAIM,
    sessionId,
    sequence,
    {
      Name: "OPTalk",
      OPTalk: {
        Action: "Claim",
        AudioFormat: {
          BitRate: options.bitRate ?? 0,
          EncodeType: "G711_ALAW",
          SampleBit:
            options.sampleBit ??
            DVRIP.AUDIO_BITS_PER_SAMPLE,
          SampleRate:
            options.sampleRate ??
            8,
        },
      },
      SessionID: sessionText,
    },
  );
}

/**
 * Builds a 320-byte G.711 A-law audio frame.
 *
 * Input must already be encoded G.711 A-law.
 * Raw PCM microphone samples cannot be passed directly.
 */

/**
 * Membuat perintah OPTalk Start.
 * Jalankan setelah respons Claim menyatakan Ret: 100.
 */
export function createTalkStart(
  sessionId: string | number,
  sequence = 2,
): Uint8Array {
  const id = parseSessionId(sessionId);

  const sessionText =
    "0x" + id.toString(16).padStart(8, "0");

  return encodeDvripJson(
    DVRIP.TALK_START,
    id,
    sequence,
    {
      Name: "OPTalk",
      OPTalk: {
        Action: "Start",
      },
      SessionID: sessionText,
    },
  );
}

export function createTalkAudioFrame(
  encodedAudio: Uint8Array,
  sessionId: string | number,
  sequence: number,
): Uint8Array {
  if (
    encodedAudio.length !==
    DVRIP.AUDIO_FRAME_SIZE
  ) {
    throw new Error(
      "Audio G.711 A-law harus berukuran tepat 320 byte.",
    );
  }

  const payload = new Uint8Array(
    DVRIP.AUDIO_PAYLOAD_SIZE,
  );

  // Observed iCSee audio-unit prefix:
  // 00 00 01 FA 0E 02 40 01
  payload.set(
    [0x00, 0x00, 0x01, 0xfa, 0x0e, 0x02, 0x40, 0x01],
    0,
  );

  payload.set(
    encodedAudio,
    DVRIP.AUDIO_HEADER_SIZE,
  );

  return encodeDvripFrame(
    DVRIP.TALK_AUDIO_TO_CAMERA,
    sessionId,
    sequence,
    payload,
  );
}

/**
 * Parses one complete DVRIP frame.
 *
 * The caller must first reassemble TCP bytes and extract a complete
 * frame using the payload length in its header. TCP reads do not
 * necessarily align with DVRIP frame boundaries.
 */
export function decodeDvripFrame(
  bytes: Uint8Array,
): DvripFrame {
  if (bytes.length < DVRIP.HEADER_SIZE) {
    throw new Error("Header DVRIP belum lengkap.");
  }

  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );

  if (
    view.getUint8(0) !== DVRIP.MAGIC
  ) {
    throw new Error("Magic DVRIP tidak valid.");
  }

  const payloadLength =
    view.getUint32(16, true);

  if (
    payloadLength > MAX_PAYLOAD_SIZE
  ) {
    throw new Error("Panjang payload DVRIP tidak aman.");
  }

  if (
    bytes.length !==
    DVRIP.HEADER_SIZE + payloadLength
  ) {
    throw new Error(
      "Data bukan satu frame DVRIP lengkap.",
    );
  }

  const payload = bytes.slice(
    DVRIP.HEADER_SIZE,
  );

  return {
    header: {
      sessionId: view.getUint32(4, true),
      sequence: view.getUint32(8, true),
      messageId: view.getUint16(14, true),
      payloadLength,
    },
    payload,
  };
}

/**
 * Parses JSON payloads from DVRIP responses.
 * The trailing LF and NUL are removed before parsing.
 */
export function decodeDvripJson(
  payload: Uint8Array,
): Record<string, unknown> {
  const text = new TextDecoder()
    .decode(payload)
    .replace(/[\u0000\s]+$/g, "");

  const value: unknown = JSON.parse(text);

  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "Respons DVRIP bukan objek JSON.",
    );
  }

  return value as Record<string, unknown>;
}

/**
 * Returns whether the OPTalk claim response reports success.
 */
export function isTalkClaimSuccessful(
  frame: DvripFrame,
): boolean {
  if (
    frame.header.messageId !==
    DVRIP.TALK_CLAIM_RESPONSE
  ) {
    return false;
  }

  const response = decodeDvripJson(
    frame.payload,
  );

  return response.Ret === 100;
}
