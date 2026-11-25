import { SpeechError } from '../../../types/speech';
import { Downsampler, SPEECH_SAMPLE_RATE } from './wav';

/** 20 ms frames at 16 kHz. */
export const FRAME_SAMPLES = 320;

// AudioWorklet that forwards raw microphone samples in ~43 ms blocks.
const WORKLET_SOURCE = `
class InkflowPcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(2048); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('inkflow-pcm-tap', InkflowPcmTap);
`;

type AudioContextCtor = typeof AudioContext;

/**
 * Microphone → 16 kHz mono Float32 frames. Must be started from a user gesture
 * (iPad Safari requires it for both the permission prompt and the AudioContext).
 * stop() releases the microphone so the OS recording indicator turns off.
 */
export class AudioCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private downsampler: Downsampler | null = null;
  private pending = new Float32Array(0);
  private paused = false;

  constructor(private readonly onFrame: (frame: Float32Array) => void) {}

  async start(): Promise<void> {
    // iOS only lets audio start inside the user's tap, so the AudioContext is
    // created *before* awaiting the permission prompt.
    const Ctor: AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;
    void ctx.resume().catch(() => undefined);
    if (!navigator.mediaDevices?.getUserMedia) {
      void ctx.close().catch(() => undefined);
      this.ctx = null;
      throw new SpeechError(
        'unsupported',
        window.isSecureContext
          ? 'This browser cannot record audio.'
          : 'Microphone access needs a secure (https) page. Open the app over https or on localhost.',
      );
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (e) {
      void ctx.close().catch(() => undefined);
      this.ctx = null;
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError')
        throw new SpeechError('permission', 'Microphone permission was denied. Allow microphone access for this site in your browser settings.');
      if (name === 'NotFoundError' || name === 'OverconstrainedError')
        throw new SpeechError('no-device', 'No microphone was found.');
      throw new SpeechError('unknown', `Could not start the microphone: ${(e as Error)?.message ?? e}`);
    }

    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    this.downsampler = new Downsampler(ctx.sampleRate, SPEECH_SAMPLE_RATE);
    const source = ctx.createMediaStreamSource(this.stream);
    const sink = ctx.createGain();
    sink.gain.value = 0; // keep the graph running without playing the mic back
    sink.connect(ctx.destination);

    let tap: AudioNode;
    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(ctx, 'inkflow-pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (e: MessageEvent<Float32Array>) => this.handle(e.data);
      tap = node;
    } else {
      // Older Safari fallback.
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => this.handle(e.inputBuffer.getChannelData(0).slice());
      tap = proc;
    }
    source.connect(tap);
    tap.connect(sink);
    this.nodes = [source, tap, sink];
  }

  private handle(block: Float32Array) {
    if (this.paused || !this.downsampler) return;
    const down = this.downsampler.process(block);
    const data = new Float32Array(this.pending.length + down.length);
    data.set(this.pending);
    data.set(down, this.pending.length);
    let i = 0;
    for (; i + FRAME_SAMPLES <= data.length; i += FRAME_SAMPLES) this.onFrame(data.slice(i, i + FRAME_SAMPLES));
    this.pending = data.slice(i);
  }

  pause() {
    this.paused = true;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = false));
    void this.ctx?.suspend().catch(() => undefined);
  }

  resume() {
    this.paused = false;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = true));
    void this.ctx?.resume().catch(() => undefined);
  }

  async stop() {
    this.paused = true;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
