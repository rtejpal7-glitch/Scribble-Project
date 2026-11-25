import { SpeechError, type SpeechLanguage } from '../../types/speech';

export interface ServerHealth {
  ok: boolean;
  engine: string;
  device: string;
  modes: Record<string, { model: string; language: string; loaded: boolean; loading: boolean; error: string | null }>;
  suggest?: { enabled: boolean; backend: string; model?: string };
}

export interface SentenceSuggestion {
  id: string;
  text: string;
  reason: string;
}

export interface ServerTranscription {
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  model: string;
  processing_ms: number;
}

export const LANGUAGE_TO_MODE: Record<SpeechLanguage, 'en' | 'hi' | 'hinglish'> = {
  'en-IN': 'en',
  'hi-IN': 'hi',
  hinglish: 'hinglish',
};

function b64utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/** HTTP client for speech-server/server.py. The token is entered by the user and stays in this browser. */
export class SpeechServerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 30000,
  ) {}

  private url(path: string) {
    return this.baseUrl.replace(/\/+$/, '') + path;
  }

  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      return await fetch(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
      });
    } catch {
      if (signal?.aborted) throw new SpeechError('aborted', 'Cancelled.');
      if (location.protocol === 'https:' && this.baseUrl.startsWith('http:'))
        throw new SpeechError('network', 'This page is https, so the browser blocks an http speech server. Use an https server URL (see README).');
      throw new SpeechError('network', `Cannot reach the speech server at ${this.baseUrl}.`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async fail(res: Response): Promise<never> {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const msg = body?.error?.message ?? `Speech server error (HTTP ${res.status}).`;
    if (res.status === 401) throw new SpeechError('auth', 'The speech server rejected the access token. Check it in Voice settings.');
    if (res.status === 429) throw new SpeechError('server', 'busy');
    throw new SpeechError(res.status >= 500 ? 'server' : 'unknown', msg);
  }

  async health(): Promise<ServerHealth> {
    const res = await this.request('/v1/health', { method: 'GET' });
    if (!res.ok) await this.fail(res);
    return (await res.json()) as ServerHealth;
  }

  /** Sentence check on the server's local language model. */
  async suggest(
    language: SpeechLanguage,
    sentences: Array<{ id: string; text: string }>,
    options: { context?: string[]; medicines?: string[]; signal?: AbortSignal } = {},
  ): Promise<SentenceSuggestion[]> {
    const res = await this.request(
      '/v1/suggest',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, sentences, context: options.context ?? [], medicines: options.medicines ?? [] }),
      },
      options.signal,
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (res.status === 401) throw new SpeechError('auth', 'The speech server rejected the access token.');
      const code = body?.error?.code;
      throw new SpeechError(
        code === 'suggest_disabled' || code === 'suggest_unavailable' ? 'not-configured' : 'server',
        body?.error?.message ?? `Sentence check failed (HTTP ${res.status}).`,
      );
    }
    return ((await res.json()) as { suggestions: SentenceSuggestion[] }).suggestions;
  }

  async transcribe(
    wav: Blob,
    language: SpeechLanguage,
    options: { interim?: boolean; vocabulary?: string; signal?: AbortSignal } = {},
  ): Promise<ServerTranscription> {
    const params = new URLSearchParams({ mode: LANGUAGE_TO_MODE[language], interim: options.interim ? '1' : '0' });
    const headers: Record<string, string> = { 'Content-Type': 'audio/wav' };
    if (options.vocabulary?.trim()) headers['X-Vocabulary'] = b64utf8(options.vocabulary.trim());
    const res = await this.request(`/v1/transcribe?${params}`, { method: 'POST', body: wav, headers }, options.signal);
    if (!res.ok) await this.fail(res);
    return (await res.json()) as ServerTranscription;
  }
}
