# InkFlow: handwriting-to-text notebook

Write with an Apple Pencil (or a mouse or stylus) on a notebook-style canvas, and see your handwriting turned into editable text in a live side panel. The handwriting engine is a self-contained module (`<HandwritingEditor />`) designed to be embedded later in **ClinicFlow**.

- **Digital-ink recognition.** Real stroke data (x, y, timestamps, pressure) is sent to MyScript. No screenshots or OCR.
- **Ink and text stay in sync.** Erase a word, a line or a page and the matching text disappears. Undo or redo brings back both the ink and its text.
- **Manual corrections are preserved.** They are bound to the strokes they belong to, so unrelated writing never overwrites them. If the handwriting under an edited line changes, the line is flagged and you choose which version to keep.
- **Local-first.** Documents live in IndexedDB. Writing works offline, and recognition is queued until you reconnect.
- **PWA.** Installable on the iPad Home Screen, with an offline app shell.

---

## 1. Prerequisites

| Tool | Version |
|---|---|
| Node.js | **20.19+ or 22 LTS** (https://nodejs.org) |
| npm | 10+ (bundled with Node) |
| MyScript developer account | Free tier: 2,000 recognition requests per month (see §4) |
| Vercel account | Only for deployment |

Windows and VS Code work out of the box. Use PowerShell or the VS Code terminal.

## 2. Install and run

```bash
npm install
copy .env.example .env.local      # PowerShell / cmd   (macOS/Linux: cp .env.example .env.local)
# edit .env.local and paste your MyScript keys
npm run dev
```

`npm run dev` opens http://localhost:5173. The Vite dev server also serves the recognition API (`/api/recognize`) using the keys in `.env.local`, so recognition behaves the same locally as on Vercel.

**Without MyScript keys the app still runs** as a handwriting notebook. Ink is saved and exported normally, and the text panel says *"Recognition not configured"*. No fake text is ever produced.

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (with recognition API) |
| `npm run dev:host` | Dev server reachable from other devices on your LAN |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run preview` | Serve the production build locally (also with the API) |
| `npm test` | Unit tests (sync logic, JIIX parsing, recognition manager) |
| `npm run typecheck` | TypeScript only |

## 3. Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `MYSCRIPT_APPLICATION_KEY` | **server only** | MyScript application key |
| `MYSCRIPT_HMAC_KEY` | **server only** | MyScript HMAC key (secret) |
| `MYSCRIPT_API_URL` | server, optional | Override endpoint (default `https://cloud.myscript.com/api/v4.0/iink/batch`) |
| `ALLOWED_ORIGINS` | server, optional | Extra origins allowed to call `/api/recognize` (e.g. ClinicFlow's domain) |
| `VITE_RECOGNITION_PROVIDER` | client | `myscript` (default) or `none` |
| `VITE_RECOGNITION_DEBOUNCE_MS` | client | Writing pause before recognition (default `500`) |

> ⚠️ Never prefix the MyScript keys with `VITE_`. Vite embeds every `VITE_*` variable into the public JavaScript bundle.

## 4. Recognition API configuration (MyScript)

**What was checked:** MyScript's Web SDK (iink-ts) is designed to connect from the browser using the application key and HMAC key, which would expose the HMAC secret in frontend code. MyScript also offers a REST API, where each request is signed with **HMAC-SHA512 (key = applicationKey + hmacKey)**. This project uses that REST API (`/api/v4.0/iink/batch`, contentType `Text`, JIIX output) **through a serverless proxy**, so the secret stays on the server:

```
Browser ──strokes──▶ /api/recognize (Vercel Function: validates, signs) ──▶ MyScript Cloud
        ◀──JIIX─────                                                    ◀──
```

Set-up:

1. Create an account at https://developer.myscript.com and open the cloud dashboard (https://cloud.myscript.com).
2. Create an application. Copy its **Application key** and **HMAC key**.
3. Put them in `.env.local` for local use, and in Vercel → Project → Settings → Environment Variables for deployment.
4. Restart `npm run dev`. The status bar should read **"MyScript Cloud: connected"**.

**Pricing (verify current terms on https://developer.myscript.com/pricing):** at the time of writing, 2,000 free requests per month, then $10 per 1,000 requests. One request is sent per page after each writing pause (default 500 ms). Undo/redo reuses cached results and makes no new request. To use fewer requests, raise `VITE_RECOGNITION_DEBOUNCE_MS`. For production volume or clinical data-residency requirements, check MyScript's licensing (MyScript Server can be self-hosted; point `MYSCRIPT_API_URL` at it).

> **Patient data note for ClinicFlow:** recognition sends handwriting strokes to MyScript's cloud. Before using this with real patient notes, review MyScript's data-processing terms against your regulatory obligations, or plan for an on-device or self-hosted engine (see §9).

## 5. Deploy to Vercel

1. Push the project to GitHub (`.env.local` is git-ignored).
2. In Vercel, choose **Add New → Project** and import the repo. The framework is detected as **Vite** (`vercel.json` is included).
3. Add `MYSCRIPT_APPLICATION_KEY` and `MYSCRIPT_HMAC_KEY` under **Environment Variables** (Production and Preview).
4. Deploy. `api/recognize.ts` is deployed automatically as a Node.js Vercel Function.

CLI alternative: `npm i -g vercel`, then `vercel`, then `vercel env add MYSCRIPT_APPLICATION_KEY` (and the HMAC key), then `vercel --prod`.

**Protect the endpoint.** `/api/recognize` rejects cross-site browser calls and is rate-limited per instance. Anyone who knows the URL can still call it from a script and use your quota. Before sharing the URL widely, enable **Vercel Deployment Protection** or add authentication. ClinicFlow will put this behind its own login.

## 6. Testing on iPad (Safari + Apple Pencil)

**Recommended:** open the Vercel URL (HTTPS) in Safari. Service workers, clipboard and installation need HTTPS.

**On your LAN (quick checks):** run `npm run dev:host`, then open `http://<your-PC-IP>:5173` on the iPad. Writing and recognition work. Offline mode, install and clipboard copy may not, because the connection isn't HTTPS. Allow Node through the Windows Firewall if prompted.

What to try:

1. Write with Apple Pencil. Scroll with one finger. Fingers never draw unless the ✋ toggle is on.
2. Pause and watch the text appear. Erase a word with *Whole stroke* or *Precise* and check that it disappears from the text.
3. Undo/redo (toolbar, or ⌘Z / ⇧⌘Z on a keyboard).
4. Edit a line in the text panel, then erase part of that handwriting to see the conflict prompt.
5. Rotate the iPad. Landscape shows side-by-side panels with a draggable divider. Portrait stacks them, and the divider still resizes.
6. Share → **Add to Home Screen**. The installed app opens full-screen and works offline (handwriting only). Recognition resumes when you're back online.
7. Pinch with two fingers to zoom the notebook.

## 7. Project structure

```
api/recognize.ts                 Vercel Function: validates input, signs with HMAC, calls MyScript
src/
  handwriting-module/            ← public API for ClinicFlow (HandwritingEditor + exports)
  types/                         handwriting.ts, recognition.ts, document.ts
  handwriting/                   inkRenderer (pressure-aware drawing), inkOperations (undo/redo)
  recognition/                   HandwritingRecognitionProvider (interface), MyScriptProvider,
                                 UnavailableProvider, RecognitionManager, jiix parser, factory
  sync/textSync.ts               ink ↔ text mapping, corrections, conflicts
  state/                         editorReducer, documentModel, snapshot
  storage/                       StorageAdapter interface, IndexedDBStorage, MemoryStorage
  hooks/                         useHandwriting, useRecognition, useAutosave, useOnlineStatus
  components/
    handwriting/                 HandwritingCanvas, InkPage, HandwritingToolbar, PenSettings, EraserTool
    editor/                      TextOutputPanel, TextBlockEditor, RecognitionStatus
    layout/                      MainLayout, SplitView
    documents/                   DocumentManager, PageNavigator
    common/                      icons, dialogs, menu
  utils/                         strokeUtils, exportUtils, signature, id
  pwa/registerServiceWorker.ts
public/                          sw.js, manifest.webmanifest, icons
tests/                           unit tests (vitest)
```

### How the synchronisation works

- **Ink** (`Stroke`: id, pageId, x[], y[], p[]?, t[], colour, width) is the source of truth. Erasing really removes strokes. Partial erasing replaces a stroke with new pieces. Undo restores the exact strokes, with the same IDs.
- Each ink change increments the page's **revision**. `RecognitionManager` waits for a writing pause, then recognises the **whole page**. Re-recognising a page after an erase is therefore always exact. Results for an older revision are discarded, and in-flight requests are cancelled with `AbortController`.
- MyScript's JIIX returns words with stroke geometry, which is mapped back to our stroke IDs. Each **text line** is keyed by a signature of its stroke set.
- **Corrections** are stored under that signature. They survive unrelated changes and come back on undo. When a corrected line's strokes change, the new recognition is shown with a *Restore my edit / Use new text* prompt. Edited lines have an amber marker.
- Results are cached by stroke-set signature, so undo/redo restores the text instantly without a network call.

## 8. Embedding in ClinicFlow

```tsx
import { HandwritingEditor, type HandwritingEditorHandle } from '@/handwriting-module';

const ref = useRef<HandwritingEditorHandle>(null);

<HandwritingEditor
  ref={ref}
  documentId={`consultation-${consultationId}`}
  storage={clinicFlowStorageAdapter}        // optional; default is IndexedDB
  onTextChange={(s) => setDraftNotes(s.text)}
  onInkChange={(s) => markDirty()}
  onSave={(s) => api.saveHandwriting(consultationId, s)}
/>

// later
const snap = ref.current?.getSnapshot();
// snap.pages[i].strokes          → original strokes
// snap.pages[i].recognizedText   → raw recognition
// snap.pages[i].text             → corrected text (+ typed notes)
// snap.pages[i].hasManualEdits, recognitionStatus, lastRecognizedAt
// snap.text                      → whole document, in page order
```

Implement `StorageAdapter` (`listDocuments`, `loadDocument`, `saveDocument`, `deleteDocument`) to save to ClinicFlow's backend. Implement `HandwritingRecognitionProvider` to swap engines. The module has no dependency on patients, appointments, doctors, prescriptions or billing.

### Speed and accuracy notes

- **Where the time goes:** the writing pause (500 ms), the round trip to MyScript Cloud (its servers are in the US, so add about 0.3–0.6 s from South Asia), and MyScript's processing time. The Vercel function is pinned to `iad1` (US East) to sit next to MyScript. Requests carry simplified stroke points without pressure, and responses don't echo stroke points back, which keeps both small.
- **Cold starts:** the app wakes the recognition function as soon as the pencil touches the page, so the real request after the pause doesn't wait for a cold start.
- **Transient failures:** network or 5xx errors are retried quietly twice (after 0.35 s and 1.2 s) before any warning appears.
- **Accuracy:** pencil points are stored exactly as the device reports them, with no smoothing. Each line has a ✨ button that shows MyScript's alternative readings for each word, so you can fix a misread word with two taps and no keyboard.
- **True as-you-write recognition** would need either MyScript's WebSocket (interactive) API through a persistent server, since Vercel functions can't hold WebSockets, or an on-device engine. Both are possible later behind `HandwritingRecognitionProvider`.

## 9. Known limitations

- **Recognition needs the internet.** MyScript Cloud is online-only. Offline, ink is saved and the text is marked *pending*, then recognised automatically when you reconnect. A genuine on-device engine can be added as another `HandwritingRecognitionProvider` (`'local'`/`'mlkit'` slots in `providerFactory.ts`). Google ML Kit digital-ink recognition is a native Android/iOS SDK, not a web library, so using it would need a native wrapper.
- **Palm rejection in Safari is limited.** WebKit doesn't expose iPadOS's native palm rejection. While the Pencil is down, other touches are ignored and can't scroll. Before the Pencil touches, a resting palm can scroll the page. Keep *Finger drawing* off (the default) when using a Pencil.
- **Pressure** is captured for Apple Pencil (`pointerType: "pen"`). Mouse and finger strokes have constant width.
- **No hover cursor for the eraser on iPad** unless the iPad and Pencil support hover. The eraser circle shows while erasing.
- **Safari storage eviction:** Safari may delete website data after about 7 days without use. The app requests persistent storage, and **adding it to the Home Screen** avoids eviction. Export important notes.
- **One request per page per pause.** Very long pages (thousands of strokes) are sent in full on each update. The proxy limits a request to 6,000 strokes / 400k points.
- **Text PDF export** uses PDF standard fonts, so characters outside Latin-1 are replaced with `?`. English text is unaffected.
- **Paragraph detection** is a heuristic: a skipped ruled line, or a large vertical gap, starts a new paragraph.
- The serverless rate limiter is per instance (best effort). Use Deployment Protection or authentication for real access control.
- The service worker is active only in production builds (`npm run build && npm run preview`, or Vercel).
