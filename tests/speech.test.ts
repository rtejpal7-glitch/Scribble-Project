import { describe, expect, it } from 'vitest';
import { UtteranceSegmenter, type SegmenterEvent } from '../src/recognition/speech/audio/UtteranceSegmenter';
import { Downsampler, encodeWav, decodeWav } from '../src/recognition/speech/audio/wav';
import { dedupeFinal, punctuate } from '../src/recognition/speech/postprocess';
import { score, scriptMismatch } from '../src/recognition/speech/evaluation';
import { createVoiceDocument, initialVoiceState, voiceReducer, type VoiceState, type NewSegment } from '../src/state/voiceReducer';
import { transcriptText } from '../src/state/voiceText';

const FRAME = 320; // 20 ms at 16 kHz

function frame(amplitude: number, seed = 1): Float32Array {
  const f = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) f[i] = amplitude * Math.sin((i + seed) * 0.37) + (Math.random() - 0.5) * 0.002;
  return f;
}

/** Feeds `ms` of audio at an amplitude; returns emitted events. */
function feed(seg: UtteranceSegmenter, t: { ms: number }, ms: number, amp: number): SegmenterEvent[] {
  const out: SegmenterEvent[] = [];
  for (let i = 0; i < ms / 20; i++) {
    out.push(...seg.push(frame(amp, i), t.ms));
    t.ms += 20;
  }
  return out;
}

describe('utterance segmentation (VAD)', () => {
  it('splits speech at pauses without overlap or loss', () => {
    const seg = new UtteranceSegmenter();
    const t = { ms: 0 };
    const events = [
      ...feed(seg, t, 600, 0.001), // room noise
      ...feed(seg, t, 1500, 0.2), // utterance 1
      ...feed(seg, t, 1000, 0.001),
      ...feed(seg, t, 900, 0.15), // utterance 2
      ...feed(seg, t, 1000, 0.001),
    ];
    const ends = events.filter((e): e is Extract<SegmenterEvent, { type: 'end' }> => e.type === 'end');
    expect(ends).toHaveLength(2);
    expect(ends[0].startMs).toBeGreaterThan(200);
    expect(ends[0].startMs).toBeLessThan(700);
    expect(ends[0].endMs).toBeLessThan(ends[1].startMs);
    const secs = ends[0].audio.length / 16000;
    expect(secs).toBeGreaterThan(1.4);
    expect(secs).toBeLessThan(2.4);
  });

  it('ignores short clicks and adapts to steady background noise', () => {
    const seg = new UtteranceSegmenter();
    const t = { ms: 0 };
    const events = [...feed(seg, t, 3000, 0.01), ...feed(seg, t, 60, 0.3), ...feed(seg, t, 1500, 0.01)];
    expect(events.filter((e) => e.type === 'end')).toHaveLength(0);
  });

  it('splits very long monologues and flushes on stop', () => {
    const seg = new UtteranceSegmenter({ maxUtteranceMs: 3000 });
    const t = { ms: 0 };
    const events = [...feed(seg, t, 200, 0.001), ...feed(seg, t, 7000, 0.2)];
    expect(events.filter((e) => e.type === 'end').length).toBe(2);
    const flushed = seg.flush(t.ms);
    expect(flushed[0]?.type).toBe('end');
  });
});

describe('audio utilities', () => {
  it('downsamples 48 kHz to 16 kHz in streaming chunks', () => {
    const d = new Downsampler(48000);
    let n = 0;
    for (let i = 0; i < 10; i++) n += d.process(new Float32Array(4800).fill(0.5)).length;
    expect(Math.abs(n - 16000)).toBeLessThan(3);
  });

  it('WAV round-trips', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.25]);
    const { samples: back, sampleRate } = await decodeWav(encodeWav([samples]));
    expect(sampleRate).toBe(16000);
    expect(Math.abs(back[1] - 0.5)).toBeLessThan(0.001);
    expect(back.length).toBe(4);
  });
});

describe('post-processing', () => {
  it('punctuates by script without translating', () => {
    expect(punctuate('patient ko fever nahi hai')).toBe('Patient ko fever nahi hai.');
    expect(punctuate('मरीज को खुजली हो रही है')).toBe('मरीज को खुजली हो रही है।');
    expect(punctuate('Kya dard hai?')).toBe('Kya dard hai?');
  });

  it('drops duplicate and cumulative finals', () => {
    expect(dedupeFinal('Patient ko itching hai.', 'patient ko itching hai')).toBeNull();
    expect(dedupeFinal('Patient ko itching hai', 'Patient ko itching hai aur redness bhi hai')).toBe('aur redness bhi hai');
    expect(dedupeFinal('first', 'second sentence')).toBe('second sentence');
    expect(dedupeFinal(null, '  hello  ')).toBe('hello');
  });
});

describe('accuracy scoring', () => {
  it('computes WER / CER ignoring case and punctuation (incl. danda)', () => {
    const s = score('Patient ko fever nahi hai, lekin mild headache hai.', 'patient ko fever nahin hai lekin mild headache hai');
    expect(s.referenceWords).toBe(9);
    expect(s.substitutions).toBe(1);
    expect(Math.abs(s.wer - 1 / 9)).toBeLessThan(1e-9);
    expect(score('मरीज को खुजली है।', 'मरीज को खुजली है').wer).toBe(0);
  });

  it('flags script mismatches', () => {
    expect(scriptMismatch('मरीज को खुजली है', 'mareez ko khujli hai')).toBe(true);
    expect(scriptMismatch('Patient ko itching hai', 'patient ko itching')).toBe(false);
  });
});

describe('voice transcript reducer', () => {
  const speech = (text: string, extra: Partial<NewSegment> = {}): NewSegment => ({
    recordingId: 'r1',
    text,
    source: 'speech',
    status: 'final',
    startMs: 0,
    endMs: 1000,
    language: 'hinglish',
    engine: 'test',
    paragraphStart: false,
    ...extra,
  });
  const load = (): VoiceState => voiceReducer(initialVoiceState, { type: 'load', doc: createVoiceDocument('t') });
  const text = (s: VoiceState) => transcriptText(s.doc!.segments);

  it('appends finals in order and builds paragraphs', () => {
    let s = load();
    s = voiceReducer(s, { type: 'appendSegment', segment: speech('Patient ko itching hai.') });
    s = voiceReducer(s, { type: 'appendSegment', segment: speech('Redness bhi hai.') });
    s = voiceReducer(s, { type: 'appendSegment', segment: speech('मरीज को बुखार नहीं है।', { paragraphStart: true }) });
    expect(text(s)).toBe('Patient ko itching hai. Redness bhi hai.\n\nमरीज को बुखार नहीं है।');
  });

  it('undo of an edit does not remove text recognised afterwards', () => {
    let s = load();
    s = voiceReducer(s, { type: 'appendSegment', segment: speech('Fever nahi hai.') });
    const id = s.doc!.segments[0].id;
    s = voiceReducer(s, { type: 'editSegment', segmentId: id, text: 'Fever nahi hai, ' });
    s = voiceReducer(s, { type: 'editSegment', segmentId: id, text: 'Fever nahi hai, lekin' }); // coalesced
    s = voiceReducer(s, { type: 'appendSegment', segment: speech('Mild headache hai.') });
    expect(s.doc!.segments[0].edited).toBe(true);
    s = voiceReducer(s, { type: 'undo' });
    expect(text(s)).toBe('Fever nahi hai. Mild headache hai.');
    expect(s.doc!.segments[0].edited).toBe(false);
    s = voiceReducer(s, { type: 'redo' });
    expect(text(s)).toBe('Fever nahi hai, lekin Mild headache hai.');
  });

  it('clear and delete are undoable; failed parts are excluded from text', () => {
    let s = load();
    s = voiceReducer(s, { type: 'appendSegment', segment: speech('One.') });
    s = voiceReducer(s, { type: 'appendSegment', segment: speech('', { status: 'failed', error: 'x' }) });
    s = voiceReducer(s, { type: 'appendSegment', segment: speech('Two.') });
    expect(text(s)).toBe('One. Two.');
    s = voiceReducer(s, { type: 'deleteSegment', segmentId: s.doc!.segments[0].id });
    s = voiceReducer(s, { type: 'clearTranscript' });
    expect(text(s)).toBe('');
    s = voiceReducer(s, { type: 'undo' });
    s = voiceReducer(s, { type: 'undo' });
    expect(text(s)).toBe('One. Two.');
  });

  it('retry fills a failed part in place', () => {
    let s = load();
    s = voiceReducer(s, { type: 'appendSegment', segment: speech('', { id: 'f1', status: 'failed', error: 'net' }) });
    s = voiceReducer(s, { type: 'retrySucceeded', segmentId: 'f1', text: 'Recovered.' });
    expect(text(s)).toBe('Recovered.');
    expect(s.doc!.segments[0].status).toBe('final');
  });
});
