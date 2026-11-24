/** 16-bit PCM WAV encoding / decoding for 16 kHz mono speech audio. */

export const SPEECH_SAMPLE_RATE = 16000;

export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function encodeWav(chunks: Array<Int16Array | Float32Array>, sampleRate = SPEECH_SAMPLE_RATE): Blob {
  const pcm = chunks.map((c) => (c instanceof Float32Array ? floatToInt16(c) : c));
  const length = pcm.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const c of pcm) {
    for (let i = 0; i < c.length; i++, offset += 2) view.setInt16(offset, c[i], true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Decodes a WAV produced by `encodeWav` (16-bit mono) into float samples. */
export async function decodeWav(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const view = new DataView(await blob.arrayBuffer());
  const sampleRate = view.getUint32(24, true);
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const n = Math.floor(Math.min(size, view.byteLength - offset - 8) / 2);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = view.getInt16(offset + 8 + i * 2, true) / 0x8000;
      return { samples, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('No audio data in WAV file.');
}

/** Streaming box-filter resampler (e.g. 48 kHz -> 16 kHz) with state across calls. */
export class Downsampler {
  private ratio: number;
  private pos = 0; // fractional position into the pending input
  private carry: Float32Array = new Float32Array(0);

  constructor(inputRate: number, outputRate = SPEECH_SAMPLE_RATE) {
    this.ratio = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice();
    const data = new Float32Array(this.carry.length + input.length);
    data.set(this.carry);
    data.set(input, this.carry.length);
    const out: number[] = [];
    let pos = this.pos;
    while (pos + this.ratio <= data.length) {
      const start = Math.floor(pos);
      const end = Math.floor(pos + this.ratio);
      let sum = 0;
      for (let i = start; i < end; i++) sum += data[i];
      out.push(sum / Math.max(1, end - start));
      pos += this.ratio;
    }
    const consumed = Math.floor(pos);
    this.carry = data.slice(consumed);
    this.pos = pos - consumed;
    return Float32Array.from(out);
  }
}
