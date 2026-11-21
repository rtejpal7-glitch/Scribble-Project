import type { HandwritingRecognitionProvider } from './HandwritingRecognitionProvider';
import {
  RecognitionError,
  type ProviderAvailability,
  type ProviderCapabilities,
  type RecognitionRequest,
  type RecognitionResult,
} from '../types/recognition';
import { parseJiixText, type JiixDocument } from './jiix';
import { strokeSignature } from '../utils/signature';
import { simplifyIndices } from '../utils/strokeUtils';

/** Simplification tolerance in page units (~0.13 mm): invisible, but removes most redundant points. */
const SIMPLIFY_TOLERANCE = 0.5;

export interface MyScriptProviderOptions {
  /** Same-origin proxy that holds the MyScript keys. Default `/api/recognize`. */
  endpoint?: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
}

/** Wire format sent to our proxy (the proxy builds the MyScript request). */
export interface ProxyRecognizeBody {
  width: number;
  height: number;
  lang: string;
  strokes: Array<{ x: number[]; y: number[]; t: number[]; p?: number[] }>;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * MyScript Cloud (iink REST "batch" API, contentType Text).
 *
 * The browser never sees the MyScript application key or HMAC key: requests go to
 * a same-origin serverless function (`api/recognize.ts`) that signs them with
 * HMAC-SHA512 and forwards them to cloud.myscript.com. The REST API is stateless,
 * so every call recognises the full page, which also makes re-recognition after
 * erasing exact.
 */
export class MyScriptProvider implements HandwritingRecognitionProvider {
  readonly id = 'myscript';
  readonly displayName = 'MyScript Cloud';
  readonly capabilities: ProviderCapabilities = {
    incremental: false,
    requiresNetwork: true,
    wordStrokeMapping: true,
    languages: ['en_US'],
  };

  private endpoint: string;
  private timeoutMs: number;

  constructor(options: MyScriptProviderOptions = {}) {
    this.endpoint = options.endpoint ?? '/api/recognize';
    this.timeoutMs = options.timeoutMs ?? 12000;
  }

  private lastContact = 0;

  /**
   * Wakes the serverless function (and the TLS connection) while the user is
   * still writing, so the real request after the writing pause doesn't pay
   * for a cold start. Cheap GET, at most once every 45 s.
   */
  warmUp(): void {
    const now = Date.now();
    if (now - this.lastContact < 45_000) return;
    this.lastContact = now;
    fetch(this.endpoint, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' }).catch(() => undefined);
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    this.lastContact = Date.now();
    try {
      const res = await fetch(this.endpoint, { method: 'GET', headers: { Accept: 'application/json' } });
      if (res.status === 404) {
        return {
          available: false,
          requiresNetwork: true,
          reason: 'Recognition API not found. Use "npm run dev" or a Vercel deployment.',
        };
      }
      const data = (await res.json().catch(() => null)) as { configured?: boolean; reason?: string } | null;
      if (!res.ok || !data) {
        return { available: false, requiresNetwork: true, reason: `Recognition API error (HTTP ${res.status}).` };
      }
      if (!data.configured) {
        return {
          available: false,
          requiresNetwork: true,
          reason: data.reason ?? 'MyScript keys are not configured on the server. See README → Recognition setup.',
        };
      }
      return { available: true, requiresNetwork: true };
    } catch {
      // Network failure: we cannot tell whether it is configured; treat as offline.
      throw new RecognitionError('network', 'Cannot reach the recognition service.', true);
    }
  }

  async recognizePage(request: RecognitionRequest): Promise<RecognitionResult> {
    const signature = strokeSignature(request.strokes.map((s) => s.id));
    if (request.strokes.length === 0) {
      return {
        pageId: request.pageId,
        revision: request.revision,
        signature,
        lines: [],
        rawText: '',
        provider: this.id,
        recognizedAt: Date.now(),
      };
    }

    let t0 = Infinity;
    for (const s of request.strokes) if (s.t.length && s.t[0] < t0) t0 = s.t[0];
    if (!Number.isFinite(t0)) t0 = 0;

    const body: ProxyRecognizeBody = {
      width: Math.round(request.width),
      height: Math.round(request.height),
      lang: request.language,
      // Pressure is not used by MyScript text recognition, so it is not sent.
      strokes: request.strokes.map((s) => {
        const keep = simplifyIndices(s.x, s.y, SIMPLIFY_TOLERANCE);
        return {
          x: keep.map((i) => round2(s.x[i])),
          y: keep.map((i) => round2(s.y[i])),
          t: keep.map((i) => Math.max(0, Math.round(s.t[i] - t0))),
        };
      }),
    };

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    this.lastContact = Date.now();
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (request.signal?.aborted) throw new RecognitionError('aborted', 'Request cancelled.');
      if (controller.signal.aborted) throw new RecognitionError('network', 'Recognition timed out.', true);
      throw new RecognitionError('network', 'Cannot reach the recognition service.', true);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }

    const payload = (await res.json().catch(() => null)) as
      | { jiix?: JiixDocument; error?: { code?: string; message?: string } }
      | null;

    if (!res.ok || !payload?.jiix) {
      const message = payload?.error?.message ?? `Recognition failed (HTTP ${res.status}).`;
      const code = payload?.error?.code;
      if (code === 'not_configured') throw new RecognitionError('not-configured', message);
      if (res.status === 401) throw new RecognitionError('auth', message);
      if (res.status === 403) throw new RecognitionError('quota', message);
      if (res.status === 413) throw new RecognitionError('too-large', message);
      if (res.status === 400 || res.status === 422) throw new RecognitionError('invalid-input', message);
      if (res.status === 429) throw new RecognitionError('server', message, true);
      if (res.status >= 500) throw new RecognitionError('server', message, true);
      throw new RecognitionError('unknown', message);
    }

    const { lines, rawText } = parseJiixText(payload.jiix, request.strokes);
    return {
      pageId: request.pageId,
      revision: request.revision,
      signature,
      lines,
      rawText,
      provider: this.id,
      recognizedAt: Date.now(),
    };
  }
}
