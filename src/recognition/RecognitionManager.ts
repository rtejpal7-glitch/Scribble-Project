import type { HandwritingRecognitionProvider } from './HandwritingRecognitionProvider';
import type { Stroke } from '../types/handwriting';
import {
  RecognitionError,
  type ProviderAvailability,
  type RecognitionResult,
  type RecognitionStatus,
} from '../types/recognition';
import { strokeSignature } from '../utils/signature';

export interface PageInkSnapshot {
  pageId: string;
  revision: number;
  strokes: Stroke[];
  width: number;
  height: number;
}

export interface RecognitionUpdate {
  pageId: string;
  revision: number;
  status: RecognitionStatus;
  error?: string | null;
  result?: RecognitionResult;
}

export interface RecognitionManagerOptions {
  provider: HandwritingRecognitionProvider;
  /** Pause after the last ink change before recognising (ms). */
  debounceMs: number;
  /** Always returns the *latest* ink for a page (read at run time, not schedule time). */
  getPage(pageId: string): PageInkSnapshot | null;
  onUpdate(update: RecognitionUpdate): void;
  onAvailabilityChange?(availability: ProviderAvailability | null): void;
  maxConcurrent?: number;
  initiallyOnline?: boolean;
}

const RETRY_DELAYS = [3000, 10000, 30000, 60000];
/**
 * Mobile networks and Safari's connection reuse occasionally drop a request
 * ("Load failed"). These quick retries happen while the status still shows
 * "Converting…"; the user only sees a warning if they all fail.
 */
const QUICK_RETRY_DELAYS = [350, 1200];

function isTransient(e: unknown): boolean {
  return e instanceof RecognitionError && (e.kind === 'network' || (e.kind === 'server' && e.retryable));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
const CACHE_PER_PAGE = 40;

/**
 * Orchestrates recognition independently of React:
 *  - debounces per page so recognition runs after a writing pause;
 *  - revision tracking + AbortController: only the newest revision of a page can
 *    write results; an in-flight request for an older revision is cancelled;
 *  - one request per page at a time, limited global concurrency;
 *  - a result cache keyed by stroke-set signature, so undo/redo restores text
 *    immediately without a network round trip;
 *  - offline queue: pages written while offline are recognised when the
 *    connection returns. Ink is never discarded.
 */
export class RecognitionManager {
  private opts: Required<Omit<RecognitionManagerOptions, 'onAvailabilityChange'>> &
    Pick<RecognitionManagerOptions, 'onAvailabilityChange'>;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryCounts = new Map<string, number>();
  private inFlight = new Map<string, { revision: number; controller: AbortController }>();
  private waiting = new Set<string>();
  private offlineQueue = new Set<string>();
  private unavailableQueue = new Set<string>();
  private cache = new Map<string, Map<string, RecognitionResult>>();
  private forced = new Set<string>();
  private online: boolean;
  private disposed = false;
  private availability: ProviderAvailability | null = null;
  private ready: Promise<void>;

  constructor(options: RecognitionManagerOptions) {
    this.opts = { maxConcurrent: 2, initiallyOnline: true, ...options };
    this.online = this.opts.initiallyOnline;
    this.ready = this.refreshAvailability();
  }

  get provider() {
    return this.opts.provider;
  }

  getAvailability() {
    return this.availability;
  }

  /** Called when the user starts writing: lets the provider wake its backend early. */
  warmUp() {
    if (this.disposed || !this.online) return;
    try {
      this.opts.provider.warmUp?.();
    } catch {
      /* best effort */
    }
  }

  setDebounce(ms: number) {
    this.opts.debounceMs = ms;
  }

  async refreshAvailability(): Promise<void> {
    try {
      this.availability = await this.opts.provider.checkAvailability();
    } catch (e) {
      // Unknown (usually offline). Keep previous knowledge.
      if (!(e instanceof RecognitionError && e.kind === 'network')) {
        this.availability = { available: false, requiresNetwork: true, reason: String((e as Error).message ?? e) };
      }
    }
    if (this.disposed) return;
    this.opts.onAvailabilityChange?.(this.availability);
    if (this.availability?.available && this.unavailableQueue.size) {
      const pages = [...this.unavailableQueue];
      this.unavailableQueue.clear();
      pages.forEach((p) => this.schedule(p, { immediate: true }));
    }
  }

  setOnline(online: boolean) {
    const was = this.online;
    this.online = online;
    if (online && !was) {
      void this.refreshAvailability().then(() => this.flushOffline());
    }
  }

  private flushOffline() {
    const pages = [...this.offlineQueue];
    this.offlineQueue.clear();
    pages.forEach((p) => this.schedule(p, { immediate: true }));
  }

  /** Call after every ink change of a page (and on load for pages needing recognition). */
  schedule(pageId: string, options: { immediate?: boolean; force?: boolean } = {}) {
    if (this.disposed) return;
    const snap = this.opts.getPage(pageId);
    if (!snap) return;

    const f = this.inFlight.get(pageId);
    if (f && f.revision !== snap.revision) {
      f.controller.abort();
      this.inFlight.delete(pageId);
    }
    this.clearTimer(this.timers, pageId);
    this.clearTimer(this.retryTimers, pageId);
    if (options.force) this.forced.add(pageId);

    if (snap.strokes.length === 0) {
      this.forced.delete(pageId);
      this.emitResult(snap, this.emptyResult(snap));
      return;
    }

    if (!options.force) {
      const cached = this.cache.get(pageId)?.get(strokeSignature(snap.strokes.map((s) => s.id)));
      if (cached) {
        this.emitResult(snap, cached);
        return;
      }
    }

    this.opts.onUpdate({ pageId, revision: snap.revision, status: 'scheduled' });
    this.timers.set(
      pageId,
      setTimeout(() => void this.run(pageId), options.immediate ? 0 : this.opts.debounceMs),
    );
  }

  /** Manual "Retry recognition": bypasses the cache. */
  retry(pageId: string) {
    this.retryCounts.delete(pageId);
    if (!this.availability?.available) void this.refreshAvailability();
    this.schedule(pageId, { immediate: true, force: true });
  }

  cancel(pageId: string) {
    this.clearTimer(this.timers, pageId);
    this.clearTimer(this.retryTimers, pageId);
    this.inFlight.get(pageId)?.controller.abort();
    this.inFlight.delete(pageId);
    this.waiting.delete(pageId);
    this.offlineQueue.delete(pageId);
    this.unavailableQueue.delete(pageId);
    this.cache.delete(pageId);
  }

  dispose() {
    this.disposed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    for (const t of this.retryTimers.values()) clearTimeout(t);
    for (const f of this.inFlight.values()) f.controller.abort();
    this.timers.clear();
    this.retryTimers.clear();
    this.inFlight.clear();
    this.opts.provider.dispose?.();
  }

  private clearTimer(map: Map<string, ReturnType<typeof setTimeout>>, pageId: string) {
    const t = map.get(pageId);
    if (t !== undefined) clearTimeout(t);
    map.delete(pageId);
  }

  private emptyResult(snap: PageInkSnapshot): RecognitionResult {
    return {
      pageId: snap.pageId,
      revision: snap.revision,
      signature: 'empty',
      lines: [],
      rawText: '',
      provider: this.opts.provider.id,
      recognizedAt: Date.now(),
    };
  }

  private emitResult(snap: PageInkSnapshot, result: RecognitionResult) {
    this.opts.onUpdate({
      pageId: snap.pageId,
      revision: snap.revision,
      status: 'recognized',
      error: null,
      result: { ...result, revision: snap.revision },
    });
  }

  private putCache(pageId: string, signature: string, result: RecognitionResult) {
    let m = this.cache.get(pageId);
    if (!m) this.cache.set(pageId, (m = new Map()));
    m.delete(signature);
    m.set(signature, { ...result, signature });
    while (m.size > CACHE_PER_PAGE) m.delete(m.keys().next().value as string);
  }

  private async run(pageId: string) {
    this.timers.delete(pageId);
    await this.ready;
    if (this.disposed) return;
    const snap = this.opts.getPage(pageId);
    if (!snap) return;
    if (snap.strokes.length === 0) {
      this.emitResult(snap, this.emptyResult(snap));
      return;
    }
    const signature = strokeSignature(snap.strokes.map((s) => s.id));
    const force = this.forced.has(pageId);
    if (!force) {
      const cached = this.cache.get(pageId)?.get(signature);
      if (cached) {
        this.emitResult(snap, cached);
        return;
      }
    }

    if (this.opts.provider.capabilities.requiresNetwork && !this.online) {
      this.offlineQueue.add(pageId);
      this.opts.onUpdate({ pageId, revision: snap.revision, status: 'pending-offline' });
      return;
    }
    if (this.availability && !this.availability.available) {
      this.unavailableQueue.add(pageId);
      this.opts.onUpdate({
        pageId,
        revision: snap.revision,
        status: 'unavailable',
        error: this.availability.reason ?? 'Recognition is unavailable.',
      });
      return;
    }
    if (this.inFlight.has(pageId) || this.inFlight.size >= this.opts.maxConcurrent) {
      this.waiting.add(pageId);
      return;
    }

    this.forced.delete(pageId);
    const controller = new AbortController();
    this.inFlight.set(pageId, { revision: snap.revision, controller });
    this.opts.onUpdate({ pageId, revision: snap.revision, status: 'recognizing' });

    try {
      const req = {
        pageId,
        revision: snap.revision,
        strokes: snap.strokes,
        width: snap.width,
        height: snap.height,
        language: 'en_US' as const,
        signal: controller.signal,
      };
      let result: RecognitionResult;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await this.opts.provider.recognizePage(req);
          break;
        } catch (e) {
          if (!isTransient(e) || attempt >= QUICK_RETRY_DELAYS.length || !this.online) throw e;
          await sleep(QUICK_RETRY_DELAYS[attempt], controller.signal);
          if (this.disposed || controller.signal.aborted) return;
          const cur = this.opts.getPage(pageId);
          if (!cur || cur.revision !== snap.revision) return; // newer ink has its own schedule
        }
      }
      if (this.disposed) return;
      this.putCache(pageId, signature, result);
      this.retryCounts.delete(pageId);
      const current = this.opts.getPage(pageId);
      if (current && current.revision === snap.revision) {
        this.emitResult(current, { ...result, signature });
      }
      // Otherwise a newer revision exists and has its own schedule; drop this result.
    } catch (e) {
      if (this.disposed || controller.signal.aborted) return;
      const err =
        e instanceof RecognitionError ? e : new RecognitionError('unknown', (e as Error)?.message ?? String(e));
      const current = this.opts.getPage(pageId);
      if (!current || current.revision !== snap.revision) return;
      if (err.kind === 'aborted') return;
      if (err.kind === 'network') {
        this.offlineQueue.add(pageId);
        this.opts.onUpdate({ pageId, revision: snap.revision, status: 'pending-offline', error: err.message });
        this.scheduleAutoRetry(pageId);
      } else if (err.kind === 'not-configured') {
        this.availability = { available: false, requiresNetwork: true, reason: err.message };
        this.opts.onAvailabilityChange?.(this.availability);
        this.unavailableQueue.add(pageId);
        this.opts.onUpdate({ pageId, revision: snap.revision, status: 'unavailable', error: err.message });
      } else {
        this.opts.onUpdate({ pageId, revision: snap.revision, status: 'error', error: err.message });
        if (err.retryable) this.scheduleAutoRetry(pageId);
      }
    } finally {
      const f = this.inFlight.get(pageId);
      if (f && f.controller === controller) this.inFlight.delete(pageId);
      this.pump();
    }
  }

  private scheduleAutoRetry(pageId: string) {
    const n = this.retryCounts.get(pageId) ?? 0;
    if (n >= RETRY_DELAYS.length) return;
    this.retryCounts.set(pageId, n + 1);
    this.clearTimer(this.retryTimers, pageId);
    this.retryTimers.set(
      pageId,
      setTimeout(() => {
        this.retryTimers.delete(pageId);
        this.offlineQueue.delete(pageId);
        this.schedule(pageId, { immediate: true });
      }, RETRY_DELAYS[n]),
    );
  }

  private pump() {
    for (const pageId of [...this.waiting]) {
      if (this.inFlight.size >= this.opts.maxConcurrent) break;
      if (this.inFlight.has(pageId)) continue;
      this.waiting.delete(pageId);
      void this.run(pageId);
    }
  }
}
