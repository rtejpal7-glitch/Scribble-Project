/**
 * Recognition proxy: Vercel Function (Node.js runtime, Web handler), also mounted
 * by the Vite dev server (see vite.config.ts) so `npm run dev` works the same.
 *
 *   GET  /api/recognize  → { configured: boolean }
 *   POST /api/recognize  → { jiix }  (MyScript JIIX for the page's strokes)
 *
 * The MyScript application key and HMAC key are read from server-side
 * environment variables only. They are never sent to the browser. The request
 * body is signed with HMAC-SHA512 (key = applicationKey + hmacKey), as MyScript
 * Cloud requires.
 *
 * This file is deliberately self-contained (no relative imports) so it runs
 * unchanged on Vercel and inside Vite.
 */

type Env = Record<string, string | undefined>;

interface ClientStroke {
  x: number[];
  y: number[];
  t?: number[];
  p?: number[];
}
interface ClientBody {
  width: number;
  height: number;
  lang?: string;
  strokes: ClientStroke[];
}

const DEFAULT_ENDPOINT = 'https://cloud.myscript.com/api/v4.0/iink/batch';
const MAX_BODY_BYTES = 3_000_000;
const MAX_STROKES = 6000;
const MAX_POINTS = 400_000;
const RATE_LIMIT_PER_MINUTE = 90;
const SUPPORTED_LANGS = new Set(['en_US', 'en_GB']);

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}
function fail(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function credentials(env: Env) {
  const applicationKey = env.MYSCRIPT_APPLICATION_KEY?.trim();
  const hmacKey = env.MYSCRIPT_HMAC_KEY?.trim();
  return applicationKey && hmacKey ? { applicationKey, hmacKey } : null;
}

async function hmacSha512Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* Best-effort per-instance rate limiting (serverless instances do not share memory). */
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > RATE_LIMIT_PER_MINUTE;
}

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin GET / non-browser; Origin is sent on cross-site browser POSTs
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const o = new URL(origin);
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (host && o.host === host) return true;
    return allowed.includes(o.origin);
  } catch {
    return false;
  }
}

function validNumbers(a: unknown, n?: number): a is number[] {
  return Array.isArray(a) && (n === undefined || a.length === n) && a.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function validate(body: unknown): ClientBody | string {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object.';
  const b = body as Partial<ClientBody>;
  if (typeof b.width !== 'number' || typeof b.height !== 'number' || b.width <= 0 || b.height <= 0 || b.width > 20000 || b.height > 20000)
    return 'Invalid page size.';
  if (!Array.isArray(b.strokes) || b.strokes.length === 0) return 'No strokes supplied.';
  if (b.strokes.length > MAX_STROKES) return `Too many strokes (max ${MAX_STROKES}).`;
  let points = 0;
  for (const s of b.strokes) {
    if (!s || !validNumbers(s.x) || s.x.length === 0 || !validNumbers(s.y, s.x.length)) return 'Invalid stroke coordinates.';
    if (s.t !== undefined && !validNumbers(s.t, s.x.length)) return 'Invalid stroke timestamps.';
    if (s.p !== undefined && !validNumbers(s.p, s.x.length)) return 'Invalid stroke pressure.';
    points += s.x.length;
  }
  if (points > MAX_POINTS) return 'Too many points on this page.';
  return b as ClientBody;
}

function buildMyScriptRequest(b: ClientBody) {
  const lang = b.lang && SUPPORTED_LANGS.has(b.lang) ? b.lang : 'en_US';
  return {
    xDPI: 96,
    yDPI: 96,
    contentType: 'Text',
    width: Math.round(b.width),
    height: Math.round(b.height),
    configuration: {
      lang,
      text: { guides: { enable: false } },
      export: {
        jiix: {
          'bounding-box': true,
          strokes: true,
          ids: true,
          text: { words: true, chars: false, lines: true },
        },
      },
    },
    strokeGroups: [
      {
        strokes: b.strokes.map((s) => {
          const out: Record<string, unknown> = { x: s.x, y: s.y, pointerType: 'PEN' };
          if (s.t) {
            // MyScript requires chronological, non-negative timestamps.
            let last = 0;
            out.t = s.t.map((v) => (last = Math.max(last, Math.max(0, Math.round(v)))));
          }
          if (s.p) out.p = s.p.map((v) => Math.min(0.99, Math.max(0.01, v)));
          return out;
        }),
      },
    ],
  };
}

function mapUpstreamError(status: number, detail: string): Response {
  if (status === 401) return fail(401, 'auth', 'MyScript rejected the credentials. Check MYSCRIPT_APPLICATION_KEY and MYSCRIPT_HMAC_KEY.');
  if (status === 403) return fail(403, 'forbidden', `MyScript refused the request (quota exceeded or account restriction). ${detail}`.trim());
  if (status === 413) return fail(413, 'too_large', 'This page has too much ink for one recognition request.');
  if (status === 400) return fail(400, 'invalid', `MyScript could not process this ink. ${detail}`.trim());
  if (status === 429) return fail(429, 'rate_limited', 'MyScript rate limit reached. Retrying shortly.');
  return fail(502, 'upstream', `MyScript service error (HTTP ${status}). ${detail}`.trim());
}

export async function handleRecognitionRequest(request: Request, env: Env): Promise<Response> {
  const creds = credentials(env);

  if (request.method === 'GET') {
    return json(200, {
      provider: 'myscript',
      configured: !!creds,
      reason: creds ? undefined : 'MyScript keys are not set on the server (MYSCRIPT_APPLICATION_KEY, MYSCRIPT_HMAC_KEY).',
    });
  }
  if (request.method !== 'POST') return fail(405, 'method', 'Use GET or POST.');
  if (!originAllowed(request, env)) return fail(403, 'origin', 'Origin not allowed.');
  if (!creds) return fail(503, 'not_configured', 'Handwriting recognition is not configured on the server. Set the MyScript keys (see README).');

  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (rateLimited(ip)) return fail(429, 'rate_limited', 'Too many recognition requests. Slow down a little.');

  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BODY_BYTES) return fail(413, 'too_large', 'Request too large.');
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail(400, 'invalid', 'Could not read request body.');
  }
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'too_large', 'Request too large.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(400, 'invalid', 'Body is not valid JSON.');
  }
  const body = validate(parsed);
  if (typeof body === 'string') return fail(400, 'invalid', body);

  const payload = JSON.stringify(buildMyScriptRequest(body));
  const hmac = await hmacSha512Hex(creds.applicationKey + creds.hmacKey, payload);
  const endpoint = env.MYSCRIPT_API_URL?.trim() || DEFAULT_ENDPOINT;

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.myscript.jiix,application/json',
        applicationKey: creds.applicationKey,
        hmac,
        'myscript-client-name': 'inkflow',
        'myscript-client-version': '1.0.0',
      },
      body: payload,
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    return fail(504, 'upstream_unreachable', `Could not reach MyScript: ${(e as Error)?.message ?? e}`);
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    let detail = '';
    try {
      const err = JSON.parse(text) as { message?: string; code?: string };
      detail = [err.code, err.message].filter(Boolean).join(': ');
    } catch {
      detail = text.slice(0, 200);
    }
    return mapUpstreamError(upstream.status, detail);
  }
  try {
    return json(200, { jiix: JSON.parse(text) });
  } catch {
    return fail(502, 'upstream', 'MyScript returned an unexpected response.');
  }
}

/* ---------------------------- Vercel entry points ---------------------------- */
export function GET(request: Request): Promise<Response> {
  return handleRecognitionRequest(request, process.env);
}

export function POST(request: Request): Promise<Response> {
  return handleRecognitionRequest(request, process.env);
}
