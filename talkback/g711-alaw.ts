
const SEGMENT_END = [
  0x00ff, 0x01ff, 0x03ff, 0x07ff,
  0x0fff, 0x1fff, 0x3fff, 0x7fff,
];

export function encodeSampleALaw(sample: number): number {
  let pcm = Math.max(-32768, Math.min(32767, Math.trunc(sample)));
  let mask: number;

  if (pcm >= 0) {
    mask = 0xd5;
  } else {
    mask = 0x55;
    pcm = -pcm - 1;
  }

  pcm >>= 3;

  let segment = 0;
  while (segment < 8 && pcm > SEGMENT_END[segment]) {
    segment++;
  }

  if (segment >= 8) {
    return 0x7f ^ mask;
  }

  let encoded = segment << 4;

  if (segment < 2) {
    encoded |= (pcm >> 1) & 0x0f;
  } else {
    encoded |= (pcm >> segment) & 0x0f;
  }

  return (encoded ^ mask) & 0xff;
}

export function encodePcm16ToALaw(
  samples: Int16Array,
): Uint8Array {
  const output = new Uint8Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    output[i] = encodeSampleALaw(samples[i]);
  }

  return output;
}

export function splitPcmIntoTalkFrames(
  samples: Int16Array,
): Uint8Array[] {
  const frameSize = 320;
  const frames: Uint8Array[] = [];

  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const count = Math.min(frameSize, samples.length - offset);
    const block = new Int16Array(frameSize);

    block.set(samples.subarray(offset, offset + count));

    const encoded = encodePcm16ToALaw(block);

    for (let i = count; i < frameSize; i++) {
      encoded[i] = 0xd5;
    }

    frames.push(encoded);
  }

  return frames;
}
