import { describe, expect, it, vi } from 'vitest';
import { RecognitionManager, type PageInkSnapshot, type RecognitionUpdate } from '../src/recognition/RecognitionManager';
import type { HandwritingRecognitionProvider } from '../src/recognition/HandwritingRecognitionProvider';
import { RecognitionError, type RecognitionRequest } from '../src/types/recognition';
import type { Stroke } from '../src/types/handwriting';

const mk = (id: string): Stroke => ({ id, pageId: 'p', x: [0, 1], y: [0, 1], t: [0, 1], color: '#000', width: 2, pointerType: 'pen', createdAt: 0 });

function provider(impl: (r: RecognitionRequest) => Promise<string>): HandwritingRecognitionProvider & { calls: number } {
  const p = {
    id: 'fake',
    displayName: 'Fake',
    capabilities: { incremental: false, requiresNetwork: true, wordStrokeMapping: true, languages: ['en_US'] },
    calls: 0,
    async checkAvailability() {
      return { available: true, requiresNetwork: true };
    },
    async recognizePage(r: RecognitionRequest) {
      p.calls++;
      const text = await impl(r);
      return {
        pageId: r.pageId,
        revision: r.revision,
        signature: r.strokes.map((s) => s.id).sort().join(','),
        lines: [{ text, strokeIds: r.strokes.map((s) => s.id), words: [], bbox: null }],
        rawText: text,
        provider: 'fake',
        recognizedAt: 0,
      };
    },
  };
  return p;
}

function harness(p: HandwritingRecognitionProvider, online = true) {
  const page: PageInkSnapshot = { pageId: 'p', revision: 0, strokes: [], width: 100, height: 100 };
  const updates: RecognitionUpdate[] = [];
  const m = new RecognitionManager({
    provider: p,
    debounceMs: 50,
    initiallyOnline: online,
    getPage: () => ({ ...page }),
    onUpdate: (u) => updates.push(u),
  });
  return { page, updates, m };
}

describe('RecognitionManager', () => {
  it('debounces, then recognises once', async () => {
    vi.useFakeTimers();
    const p = provider(async () => 'text');
    const { page, updates, m } = harness(p);
    page.strokes = [mk('a')];
    page.revision = 1;
    m.schedule('p');
    page.strokes = [mk('a'), mk('b')];
    page.revision = 2;
    m.schedule('p');
    await vi.advanceTimersByTimeAsync(100);
    expect(p.calls).toBe(1);
    const done = updates.filter((u) => u.status === 'recognized');
    expect(done.at(-1)?.revision).toBe(2);
    vi.useRealTimers();
  });

  it('queues while offline and recognises when back online', async () => {
    vi.useFakeTimers();
    const p = provider(async () => 'text');
    const { page, updates, m } = harness(p, false);
    page.strokes = [mk('a')];
    page.revision = 1;
    m.schedule('p');
    await vi.advanceTimersByTimeAsync(100);
    expect(updates.at(-1)?.status).toBe('pending-offline');
    expect(p.calls).toBe(0);
    m.setOnline(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(p.calls).toBe(1);
    expect(updates.at(-1)?.status).toBe('recognized');
    vi.useRealTimers();
  });

  it('drops results for outdated revisions and serves undo from cache', async () => {
    vi.useFakeTimers();
    let release: (v: string) => void = () => undefined;
    const p = provider(() => new Promise<string>((r) => (release = r)));
    const { page, updates, m } = harness(p);
    page.strokes = [mk('a')];
    page.revision = 1;
    m.schedule('p');
    await vi.advanceTimersByTimeAsync(60); // request in flight for revision 1
    page.strokes = [mk('a'), mk('b')];
    page.revision = 2;
    m.schedule('p'); // aborts revision 1
    release('old');
    await vi.advanceTimersByTimeAsync(60);
    release('new');
    await vi.advanceTimersByTimeAsync(10);
    const recognized = updates.filter((u) => u.status === 'recognized');
    expect(recognized.every((u) => u.revision === 2)).toBe(true);

    // "Undo" back to the same stroke set → cache hit, no new request.
    const calls = p.calls;
    page.revision = 3;
    m.schedule('p');
    expect(p.calls).toBe(calls);
    expect(updates.at(-1)?.status).toBe('recognized');
    vi.useRealTimers();
  });

  it('reports non-retryable errors', async () => {
    vi.useFakeTimers();
    const p = provider(async () => {
      throw new RecognitionError('auth', 'bad keys');
    });
    const { page, updates, m } = harness(p);
    page.strokes = [mk('a')];
    page.revision = 1;
    m.schedule('p');
    await vi.advanceTimersByTimeAsync(100);
    expect(updates.at(-1)).toMatchObject({ status: 'error', error: 'bad keys' });
    vi.useRealTimers();
  });

  it('retries transient failures silently before reporting', async () => {
    vi.useFakeTimers();
    let n = 0;
    const p = provider(async () => {
      if (++n < 3) throw new RecognitionError('network', 'Load failed', true);
      return 'ok';
    });
    const { page, updates, m } = harness(p);
    page.strokes = [mk('a')];
    page.revision = 1;
    m.schedule('p');
    await vi.advanceTimersByTimeAsync(2000);
    expect(p.calls).toBe(3);
    expect(updates.some((u) => u.status === 'pending-offline' || u.status === 'error')).toBe(false);
    expect(updates.at(-1)?.status).toBe('recognized');
    vi.useRealTimers();
  });
});
