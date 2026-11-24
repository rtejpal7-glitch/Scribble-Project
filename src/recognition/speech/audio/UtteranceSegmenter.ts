/**
 * Energy-based voice activity detection that splits a continuous 16 kHz stream
 * into utterances at natural pauses. Each utterance is transcribed on its own,
 * so audio is never sent twice and finished sentences are never re-written
 * (no duplicated text between chunks).
 *
 * The noise floor adapts while nobody is speaking, which keeps it usable with
 * clinic background noise (fans, AC, distant voices).
 */

export interface SegmenterOptions {
  sampleRate: number;
  /** Consecutive loud frames needed to start an utterance. */
  startFrames: number;
  /** Silence that ends an utterance. */
  endSilenceMs: number;
  /** Audio kept from before speech onset (catches soft first syllables). */
  preRollMs: number;
  /** Long monologues are split here so text keeps flowing. */
  maxUtteranceMs: number;
  /** Utterances with less voiced audio than this are dropped (clicks, coughs). */
  minVoicedMs: number;
  /** Absolute minimum RMS treated as speech. */
  minThreshold: number;
  /** Speech threshold = noise floor × this factor. */
  noiseFactor: number;
}

export const DEFAULT_SEGMENTER: SegmenterOptions = {
  sampleRate: 16000,
  startFrames: 3,
  endSilenceMs: 750,
  preRollMs: 300,
  maxUtteranceMs: 18000,
  minVoicedMs: 250,
  minThreshold: 0.006,
  noiseFactor: 3,
};

export type SegmenterEvent =
  | { type: 'start'; startMs: number }
  | { type: 'end'; audio: Float32Array; startMs: number; endMs: number }
  | { type: 'discard' };

export function rms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / Math.max(1, frame.length));
}

export class UtteranceSegmenter {
  private o: SegmenterOptions;
  private noise = 0.003;
  private loudRun = 0;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private frames: Float32Array[] = [];
  private speaking = false;
  private silenceMs = 0;
  private voicedMs = 0;
  private durationMs = 0;
  private startMs = 0;
  private trailingSilenceFrames = 0;
  /** Increments for each new utterance (lets callers detect stale interim results). */
  utteranceId = 0;

  constructor(options: Partial<SegmenterOptions> = {}) {
    this.o = { ...DEFAULT_SEGMENTER, ...options };
  }

  get inSpeech(): boolean {
    return this.speaking;
  }

  get threshold(): number {
    return Math.max(this.o.minThreshold, this.noise * this.o.noiseFactor);
  }

  /** Audio of the utterance in progress (for interim recognition). */
  current(): Float32Array | null {
    return this.speaking ? concat(this.frames) : null;
  }

  currentDurationMs(): number {
    return this.speaking ? this.durationMs : 0;
  }

  /** `timeMs` is the stream time at the *start* of this frame. */
  push(frame: Float32Array, timeMs: number): SegmenterEvent[] {
    const frameMs = (frame.length / this.o.sampleRate) * 1000;
    const level = rms(frame);
    const loud = level > this.threshold;
    const events: SegmenterEvent[] = [];

    if (!this.speaking) {
      this.noise = this.noise * 0.95 + Math.min(level, this.threshold) * 0.05;
      this.preRoll.push(frame);
      this.preRollSamples += frame.length;
      const maxPre = (this.o.preRollMs / 1000) * this.o.sampleRate + frame.length * this.o.startFrames;
      while (this.preRollSamples - this.preRoll[0].length >= maxPre) this.preRollSamples -= this.preRoll.shift()!.length;
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun >= this.o.startFrames) {
        this.speaking = true;
        this.utteranceId++;
        this.frames = this.preRoll;
        const preMs = (this.preRollSamples / this.o.sampleRate) * 1000;
        this.startMs = Math.max(0, timeMs + frameMs - preMs);
        this.durationMs = preMs;
        this.voicedMs = this.loudRun * frameMs;
        this.silenceMs = 0;
        this.trailingSilenceFrames = 0;
        this.preRoll = [];
        this.preRollSamples = 0;
        this.loudRun = 0;
        events.push({ type: 'start', startMs: this.startMs });
      }
      return events;
    }

    this.frames.push(frame);
    this.durationMs += frameMs;
    // Hysteresis: stay "in speech" for slightly quieter frames.
    if (level > this.threshold * 0.7) {
      this.silenceMs = 0;
      this.trailingSilenceFrames = 0;
      this.voicedMs += frameMs;
    } else {
      this.silenceMs += frameMs;
      this.trailingSilenceFrames++;
    }
    const endTime = timeMs + frameMs;
    if (this.silenceMs >= this.o.endSilenceMs) {
      events.push(this.finish(endTime, Math.max(0, this.trailingSilenceFrames - Math.round(200 / frameMs))));
    } else if (this.durationMs >= this.o.maxUtteranceMs) {
      events.push(this.finish(endTime, 0));
      if (loud) {
        // Still talking: continue straight into a new utterance.
        this.speaking = true;
        this.utteranceId++;
        this.startMs = endTime;
        this.frames = [];
        this.durationMs = 0;
        this.voicedMs = 0;
        events.push({ type: 'start', startMs: endTime });
      }
    }
    return events;
  }

  /** Ends the utterance in progress (pause / stop). */
  flush(timeMs: number): SegmenterEvent[] {
    if (!this.speaking) return [];
    return [this.finish(timeMs, 0)];
  }

  private finish(endMs: number, dropTrailingFrames: number): SegmenterEvent {
    const frames = dropTrailingFrames > 0 ? this.frames.slice(0, this.frames.length - dropTrailingFrames) : this.frames;
    const voiced = this.voicedMs;
    const startMs = this.startMs;
    const trimmedMs = frames.reduce((n, f) => n + f.length, 0) / this.o.sampleRate * 1000;
    this.speaking = false;
    this.frames = [];
    this.silenceMs = 0;
    this.voicedMs = 0;
    this.durationMs = 0;
    if (voiced < this.o.minVoicedMs) return { type: 'discard' };
    return { type: 'end', audio: concat(frames), startMs, endMs: Math.min(endMs, startMs + trimmedMs) };
  }
}

export function concat(chunks: Float32Array[]): Float32Array {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
