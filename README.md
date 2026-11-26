# InkFlow: voice and handwriting to text

An input workspace with two independent tools, built to be embedded later in **ClinicFlow**:

| Tab | What it does | Reusable module |
|---|---|---|
| **Voice to Text** | Dictate in Indian English, Hindi or **Hinglish** and see live, editable text | `<VoiceToTextEditor />` (`src/voice-module`) |
| **Handwriting to Text** | Write with Apple Pencil; handwriting becomes editable text, kept in sync with the ink | `<HandwritingEditor />` (`src/handwriting-module`) |

Switching tabs never loses content (both stay loaded). Only one input runs at a time: leaving the Voice tab pauses a recording.

Voice highlights (details in [§10](#10-voice-to-text)):

- **Hinglish as spoken.** A Whisper model fine-tuned on Hindi–English code-switched speech writes "Patient ko do hafte se itching ho rahi hai" as it was said. No translation.
- **Private by default.** Speech recognition runs on a **speech server you host** (your PC or a clinic machine). Audio never goes to a third party unless you explicitly switch to the browser engine.
- **Live text.** Grey provisional words while you speak, confirmed text when you pause. Pause and resume, a timer, a four-stage status, edit, undo/redo, TXT/PDF export that keeps Hindi intact, optional audio retention.
- **Measure accuracy yourself.** A *Test accuracy* panel (WER/CER) and a batch script for your own recordings.

Handwriting highlights:

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
| Python **3.11 or 3.12** | Only for the voice speech server (§10) |
| NVIDIA GPU (≥ 6 GB VRAM) | Recommended for live voice recognition; a CPU works but is slower (§10.6) |

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
| `npm test` | Unit tests (handwriting sync, JIIX parsing, recognition manager, speech segmentation/scoring/transcript) |
| `npm run typecheck` | TypeScript only |
| `npm run speech:server` | Start the self-hosted speech server (after its one-time setup, §10.3) |
| `npm run speech:test` | Speech server tests (no models needed) |

The Handwriting tab works with just `npm install` + `npm run dev`. The Voice tab additionally needs the speech server (§10.3), or the browser engine with explicit consent (§10.2).

## 3. Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `MYSCRIPT_APPLICATION_KEY` | **server only** | MyScript application key |
| `MYSCRIPT_HMAC_KEY` | **server only** | MyScript HMAC key (secret) |
| `MYSCRIPT_API_URL` | server, optional | Override endpoint (default `https://cloud.myscript.com/api/v4.0/iink/batch`) |
| `ALLOWED_ORIGINS` | server, optional | Extra origins allowed to call `/api/recognize` (e.g. ClinicFlow's domain) |
| `VITE_RECOGNITION_PROVIDER` | client | `myscript` (default) or `none` |
| `VITE_RECOGNITION_DEBOUNCE_MS` | client | Writing pause before recognition (default `500`) |
| `VITE_SPEECH_SERVER_URL` | client, optional | Default speech server URL shown in Voice settings (default `http://localhost:8765`). Not secret. |

The speech server has its own settings in `speech-server/.env` (§10.3). The speech server token is **never** put in a `VITE_` variable: each user types it into Voice settings, and it stays in that browser.

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
api/recognize.ts                 Vercel Function: MyScript proxy for handwriting (signs with HMAC)
speech-server/                   Self-hosted speech recognition (Python, separate from the frontend)
  server.py                      HTTP API: /v1/health, /v1/transcribe (token auth, CORS, no content logging)
  engines.py, config.py          faster-whisper engine, one model per language mode
  evaluate.py, wer.py            batch accuracy test on your own recordings
  suggest.py                     sentence check via a local language model (Ollama / OpenAI-compatible)
  tests/                         server tests (stub engine, no models needed)
docs/SPEECH_ENGINES.md           engine evaluation (why this engine, alternatives)
src/
  App.tsx                        tabs + the two workspaces (both kept mounted)
  handwriting-module/            ← public API: HandwritingEditor
  voice-module/                  ← public API: VoiceToTextEditor
  types/                         handwriting.ts, recognition.ts, document.ts, speech.ts
  handwriting/                   inkRenderer (pressure-aware drawing), inkOperations (undo/redo)
  recognition/                   handwriting: provider interface, MyScriptProvider, RecognitionManager, jiix
    speech/                      SpeechRecognitionProvider (interface), WhisperServerProvider,
                                 BrowserSpeechProvider, SpeechServerClient, postprocess, evaluation, settings
      audio/                     AudioCapture (mic → 16 kHz), UtteranceSegmenter (VAD), wav
  sync/textSync.ts               ink ↔ text mapping, corrections, conflicts
  state/                         editorReducer, documentModel, snapshot, voiceReducer, voiceText
  storage/                       db (shared IndexedDB v2), IndexedDBStorage (ink), VoiceStorage (voice + audio)
  hooks/                         useHandwriting, useRecognition, useSpeechRecognition, useVoiceDocument,
                                 useAutosave (shared), useOnlineStatus
  clinical/                      medicines (built-in list), medicineMatcher, medicineStore, suggestionSafety
  theme/theme.ts                 system / light / dark theme
  components/
    navigation/                  WorkspaceTabs, ThemeToggle
    clinical/                    MedicineSuggestions, MedicineDictionaryDialog
    voice/                       VoiceWorkspace, MicrophoneControls, LanguageSelector, TranscriptionPanel,
                                 RecordingStatus, VoiceSettingsDialog, EvaluationPanel
    handwriting/                 HandwritingWorkspace, HandwritingCanvas, InkPage, HandwritingToolbar, …
    editor/                      TextOutputPanel, TextBlockEditor, RecognitionStatus
    layout/                      WorkspaceHeader, SplitView
    documents/                   DocumentManager (shared by both tabs), PageNavigator
    common/                      icons, dialogs, menu
  utils/                         strokeUtils, exportUtils, voiceExport, signature, id
public/                          sw.js, manifest.webmanifest, icons
tests/                           unit tests (vitest)
```

Voice and handwriting use **separate data models and IndexedDB stores** (`documents` for notebooks; `voiceDocuments` and `voiceAudio` for dictations). Upgrading from the handwriting-only version keeps existing notebooks.

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

Implement `StorageAdapter` (`listDocuments`, `loadDocument`, `saveDocument`, `deleteDocument`) to save to ClinicFlow's backend.

Voice works the same way:

```tsx
import { VoiceToTextEditor, type VoiceToTextEditorHandle } from '@/voice-module';

<VoiceToTextEditor
  ref={voiceRef}
  documentId={`consultation-${consultationId}-dictation`}
  language="hinglish"                         // 'en-IN' | 'hi-IN' | 'hinglish' (for new documents)
  active={consultationTab === 'dictation'}    // pauses recording when hidden
  storage={clinicFlowVoiceStorage}            // optional VoiceStorageAdapter
  provider={new WhisperServerProvider({ url: clinicSpeechUrl, token })}  // optional; default = user settings
  onTranscriptChange={(s) => setDraft(s.text)}
  onSave={(s) => api.saveDictation(consultationId, s)}
/>
// voiceRef.current?.getSnapshot() → { text, recognizedText, hasManualEdits, segments (with timestamps), recordings, language }
// voiceRef.current?.stopAndSave()   → stop recording, finish transcription, persist (call before navigating away)
``` Implement `HandwritingRecognitionProvider` to swap engines. The module has no dependency on patients, appointments, doctors, prescriptions or billing.

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

---

## 10. Voice to Text

### 10.1 Which recognition engine, and why

**Default: self-hosted Whisper (faster-whisper), with a Hinglish-specialised model.** The engines evaluated are compared in [`docs/SPEECH_ENGINES.md`](docs/SPEECH_ENGINES.md). In short:

- **Hinglish is the hard requirement.** Standard speech models treat Hindi and English as separate languages. Whisper models fine-tuned on code-switched Indian speech write Hinglish the way it is spoken (Roman script). Oriserve publishes one of these, Whisper-Hindi2Hinglish (Apache-2.0), with large error-rate reductions over stock Whisper large-v3 on Hindi/Hinglish test sets.
- **Privacy.** It runs on hardware you control, so no patient audio goes to a third party. This matches the preference to avoid third-party servers.
- **One runtime for all three modes.** English and Hindi use stock Whisper (`large-v3-turbo` by default). Hinglish uses the fine-tuned model. Every model can be swapped in `speech-server/.env` without code changes.
- Hindi-only engines (AI4Bharat IndicConformer, Vosk) don't do Hinglish, and browser speech recognition sends audio to Apple or Google and can't code-switch. Details are in the evaluation document.

> **Important:** this choice is based on published benchmarks and on architecture fit. It has **not yet been validated on your doctors' voices, accents, clinic noise or vocabulary.** Use the accuracy tools (§10.9) on real samples before relying on it, and compare models by changing `MODEL_*` in the server's `.env`.

### 10.2 How English, Hindi and Hinglish are handled

| Language mode | Self-hosted server (default) | Output | Browser engine (opt-in) |
|---|---|---|---|
| English (India) | `MODEL_EN` (Whisper large-v3-turbo), English decoding | Latin script | `en-IN` recogniser |
| Hindi (India) | `MODEL_HI` (Whisper large-v3-turbo), Hindi decoding | Devanagari, "।" sentence ends | `hi-IN` recogniser |
| Hinglish | `MODEL_HINGLISH` (Whisper-Hindi2Hinglish), English token as its authors document | **Roman Hinglish as spoken**, English words stay English | ⚠️ *approximate*: runs `hi-IN`, cannot code-switch (the app says so) |

- Recognition always uses `task=transcribe`, **never translate**.
- Post-processing only capitalises and adds a full stop (or "।" after Devanagari). It never transliterates or translates.
- **Medical vocabulary** (Voice → Settings) is passed to Whisper as a prompt to improve spelling of drug and condition names.
- Hindi Unicode is preserved in editing, storage, TXT export (UTF-8) and PDF export. The PDF is typeset by the browser, because jsPDF fonts cannot render Devanagari.

### 10.3 Setting up the speech server (Windows)

The server is a separate Python program in `speech-server/` and is not part of the Vite/React app.

```powershell
cd speech-server
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# Create a token and paste it into .env as SPEECH_SERVER_TOKEN:
python -c "import secrets; print(secrets.token_urlsafe(32))"
python server.py          # or, from the project root: npm run speech:server
```

- **First start downloads the models** from Hugging Face (several GB). This needs internet once; after that everything runs offline. `GET /v1/health` shows the loading status.
- **In the app:** open **Voice → Settings**, choose **Self-hosted Whisper server**, and enter the URL (`http://localhost:8765`) and the token. Use **Test connection** to check.
- **NVIDIA GPU on Windows:** CTranslate2 needs the CUDA 12 cuBLAS and cuDNN 9 libraries. Follow the GPU section of the faster-whisper README. Without them, set `WHISPER_DEVICE=cpu`.
- **Default Hinglish model:** a community CTranslate2 conversion (`Hub84/faster-whisper-hinglish-prime`) of Oriserve's model. To build it yourself from the original weights, or to try the newer **Apex** version:

  ```powershell
  pip install ctranslate2 "transformers[torch]"
  ct2-transformers-converter --model Oriserve/Whisper-Hindi2Hinglish-Apex --output_dir models/hinglish-apex --copy_files tokenizer.json preprocessor_config.json --quantization float16
  # then in .env:  MODEL_HINGLISH=models/hinglish-apex
  ```

### 10.4 Using the voice workspace from the iPad

Safari only allows the microphone on **https** pages, and an https page (Vercel) may only call an **https** speech server. Pick one:

| Option | Privacy | Effort |
|---|---|---|
| **Local certificate:** create a cert for your PC's LAN IP with `mkcert`, set `SSL_CERTFILE`/`SSL_KEYFILE`, `SPEECH_HOST=0.0.0.0`, and install the mkcert root certificate on the iPad (Settings → General → About → Certificate Trust Settings) | Audio stays on your network | Medium |
| **Tailscale:** install it on the PC and iPad, then `tailscale serve --https=443 http://localhost:8765` | Encrypted, private network only | Low |
| **Cloudflare quick tunnel:** `cloudflared tunnel --url http://localhost:8765` | Traffic passes through Cloudflare. **Test audio only, not patient data.** | Lowest |

Then add the iPad-facing origin (for example `https://scribble-project.vercel.app`) to `ALLOWED_ORIGINS` in `speech-server/.env`, and enter the https server URL in Voice → Settings on the iPad.

### 10.5 Where audio goes, internet and cost

| | Self-hosted server | Browser engine |
|---|---|---|
| Where audio is processed | Your PC or clinic server | Apple (Safari) or Google (Chrome) |
| Leaves your infrastructure? | No | **Yes**, so explicit consent is required in Settings |
| Internet needed? | Only to download models once. Works offline on a local network. | Always |
| Cost | Free (open-source models). You provide the hardware. | Free to use. No contract or data agreement. |
| API keys | One token you create yourself | None |

There are no cloud speech API keys in this project. A paid, India-hosted alternative (Sarvam) is described in the evaluation document if self-hosting is impractical. It is not wired in.

### 10.6 Hardware and speed

- **NVIDIA GPU (≥ 6 GB VRAM):** each sentence is final shortly after you pause, and interim text updates about every second. This is the recommended setup for clinic use.
- **CPU only:** works, but large models take several seconds per sentence and the interim preview lags. For CPU testing, try `MODEL_EN=small`/`MODEL_HI=small` (less accurate). The Hinglish model is large-v3-sized, so it is slow on CPU.
- **Memory:** two model sizes are loaded by default (turbo for English/Hindi, and the Hinglish model). Set the same model for several modes to save memory.

### 10.7 How live transcription works

- **Capture:** microphone → 16 kHz mono in the browser. A voice-activity detector splits speech into **utterances at natural pauses** (~0.75 s), adapting to steady background noise.
- **Interim text:** while you speak, a fast pass roughly every second shows **grey provisional text**.
- **Final text:** when you pause, the whole utterance is transcribed once at full accuracy (beam search, VAD, hallucination filter) and appended as **black, editable text**. This is the final correction step for each sentence.
- **No duplicates:** utterances never overlap, so finished text is never re-sent or rewritten. For the browser engine, repeated or accumulated results (a known Safari behaviour) are removed.
- **Sentences and paragraphs:** each utterance becomes a sentence. A longer silence (default 4 s, adjustable) or the ¶ button starts a new paragraph, and ¶ on a line toggles its break.
- **Status:** four stages are shown separately: *capturing audio → processing audio → recognising text → final transcription available*.
- **Pause:** stops capturing (the microphone track is disabled) and the timer stops. **Stop** finishes pending sentences and releases the microphone. Switching tabs or sending the app to the background pauses recording. Nothing records in the background.
- **Failed sentences** (network or server error) are kept as a red "Couldn't transcribe" line with **Retry transcription**. Text is never silently dropped.
- **Editing:** every line is editable, with undo/redo (toolbar or Ctrl/⌘+Z). Undo only reverts your own actions, never newly recognised speech. Edited lines are marked in amber, and ＋ adds typed text.

### 10.8 Audio retention and privacy

- **Off by default:** audio is discarded after transcription, and only text is saved (IndexedDB, this device).
- **When enabled** (Settings → *Keep audio recordings*, self-hosted engine): each recording is stored locally as WAV. You can then play a sentence, replay or download the recording, re-transcribe failed parts, or **Delete audio** (the transcript is kept).
- **Deleting a dictation** deletes its recordings.
- **The server** processes audio in memory, never writes it to disk, and logs only method/path/status/time. It never logs audio or text. Access needs the token. CORS limits which web origins may call it.
- The voice feature is for **testing transcription quality**. It makes no diagnoses and generates no prescriptions.

### 10.9 Testing accuracy on real samples

- **In the app:** open **Test accuracy** in the Voice workspace. Dictate, type what was actually said, and see **WER/CER** with a word-by-word diff. Save results with a note (for example "OPD noise, fast speech") and **Export CSV** to compare engines, models and languages.
- **Batch, on the server machine:** put `001_hinglish.wav` + `001_hinglish.txt` pairs (any audio format) in a folder and run `python evaluate.py samples/ --csv results.csv`. It reports WER/CER and speed per file and per mode.
- **Suggested protocol:** 20–30 recordings per mode from several doctors, covering:
  - Indian English accents, native Hindi, and natural Hinglish
  - drug names, numbers and dosages ("500 mg twice a day after food")
  - slow and fast speech, recordings over 5 minutes, and real OPD background noise

  Compare `MODEL_*` options on the same set before choosing. The test sentences in the requirements are a smoke test, not proof of accuracy.

### 10.10 Voice limitations (including iPad Safari)

- The self-hosted engine gives **near-live** text (provisional, then final per sentence), not word-by-word streaming. Truly streaming open models for Hinglish are not mature yet.
- Hinglish spelling is not standardised ("nahi" or "nahin"), so expect WER to overstate real errors. Compare CER too.
- **iPad Safari:**
  - microphone and speech need **https** (see §10.4)
  - recording stops when the iPad locks or Safari goes to the background (the app pauses on this)
  - Safari's built-in speech recognition may not work in a Home Screen web app, so use Safari itself for the browser engine
  - the browser engine cannot keep audio or show a level meter
- Long recordings with audio retention use memory (about 2 MB per minute), and retention is capped at 45 minutes per recording.
- Number formatting ("two" vs "2", "500 mg") depends on the model. Check dosages in your accuracy tests.
- **Deploying to Vercel** is unchanged: only the frontend is deployed. The speech server runs on your own machine. Optionally set `VITE_SPEECH_SERVER_URL` in Vercel to pre-fill the server URL.

### 10.11 Sentence check ("Hi why am Rahul" → "Hi I am Rahul")

After sentences are recognised, the app sends the newest unedited sentences, plus a little preceding context, to the speech server's **local language model**. Sentences that probably contain a misheard word get a blue **"Possibly misheard — did you mean …"** card with the changed words highlighted. Nothing changes until you tap **Use suggestion**, and undo works. Use **Check sentences** in the transcript toolbar to run it manually.

- **Private:** the model runs on your machine. The transcript text never goes to a cloud AI service.
- **Safety:**
  - The server drops "suggestions" that rewrite the whole sentence or switch script or language (no translation).
  - The app shows **⚠ changes a number or dose / changes a medicine name** whenever a suggestion touches those, so check carefully.
  - Only recognised, unedited sentences are checked. Your own writing is left alone.

Setup on the speech server machine (Windows):

1. Install **Ollama** from https://ollama.com and run `ollama pull qwen2.5:7b-instruct` (≈5 GB; a GPU is recommended).
2. In `speech-server/.env`, set `SUGGEST_BACKEND=ollama` (the default). `SUGGEST_MODEL` can point at another model. On a CPU, a smaller one like `qwen2.5:3b-instruct` is faster but weaker.
3. Restart `python server.py`. **Voice → Settings → Test connection** shows "sentence check: ollama (…)".
4. Alternatives: `SUGGEST_BACKEND=openai-compatible` with `SUGGEST_URL` for llama.cpp server, LM Studio or vLLM. `SUGGEST_BACKEND=off` disables it.

It needs the speech server (URL + token in Voice settings) even when recognition uses the browser engine.

**Limitation:** the suggestion quality depends on the local model and **has not been evaluated** on Hindi or Hinglish clinical dictation. Treat it as a helper and judge it with your own samples. Running the model and Whisper on the same GPU slows both, so the app waits until pending transcription is done before checking.

### 10.12 Consultation report (clinical note + prescription)

Dictate the whole consultation (complaints, history, findings, diagnosis, medicines with dose, frequency and duration, tests, advice, follow-up) in rough Hinglish, Hindi or English. Then tap **Create report** in the transcript toolbar. The speech server's local language model organises it into an editable **clinical note with a prescription table**:

- Patient (name, age and sex are pre-filled if said, otherwise typed), date
- Chief complaints, history, examination, diagnosis
- Medicines (name, strength, dose, how often, when, how long, route, instructions)
- Investigations, advice, follow-up

**Safety by design:**
- The model is told to use only what was dictated and never add a diagnosis, medicine or dose. The server then **checks every medicine and diagnosis against the transcript**:
  - **"Name not found in the dictation"**: the medicine name isn't in the transcript.
  - **"Couldn't find where this was said"**: the quoted source words aren't in the transcript.
  - **"Number not found in the dictation"**: a strength or duration number wasn't said (number words such as *do / paanch / teen* are understood).
- Each item shows **Heard: "…"** with the words it came from. Medicine names are also checked against the **medicine dictionary**, with tap-to-fix suggestions.
- Things the model couldn't understand are listed under **Please check**.
- Until **"I have reviewed and corrected this report"** is ticked, printouts say **DRAFT — NOT REVIEWED BY THE DOCTOR**.
- If the transcript changes after the report was made, a banner offers **Create again**. Patient details you typed are kept.

**Print / PDF** uses the browser's print dialog (A4): print on paper, or choose *Save as PDF*. The clinic name, address, phone, doctor's name, qualification and registration number are entered once under **Clinic & doctor details**, saved on this device. **Copy** gives a plain-text version. The report is saved with the dictation, and ClinicFlow receives it in `VoiceSnapshot.report`.

Setup (speech server machine):

```
ollama pull qwen2.5:7b-instruct
```

`.env`: `REPORT_MODEL=qwen2.5:7b-instruct` (the default). Restart `python server.py`; its log shows `Reports: ollama (qwen2.5:7b-instruct)`. On a 6 GB GPU that also runs Whisper, a report takes roughly 20–60 s; the first one after starting takes longer while the model loads. `REPORT_BACKEND=off` disables reports.

**Limitations:**
- Report quality depends on the local model and **has not been evaluated** on real clinic dictations.
- The model can still put something in the wrong section or misread a dose that *was* said. The checks catch invented items, not every misreading.
- The doctor must review every report. This feature organises dictation; it does not diagnose or prescribe.

## 11. Medicine dictionary (voice and handwriting)

The **Medicines** button in the top bar opens a shared dictionary.

- **Built-in list:** ~370 generic names commonly prescribed in India. It is not a drug database and holds no doses.
- **Your own names:** add brands and your formulary by typing, pasting, or importing a `.txt`/`.csv` file.

After any recognition (voice, either engine, or handwriting), words that look like a misspelled medicine get a green **"Medicine name? 'clobetasole' → clobetasol"** row. A fuzzy, sound-alike match catches misreadings like cetrizine → cetirizine and benzoil peroxide → benzoyl peroxide.

- **One tap applies a suggestion; nothing is changed automatically**, because many drug names sound alike (hydroxyzine / hydralazine).
- **Not a medicine** stops a word from being flagged again.
- ClinicFlow can supply its formulary in code: `setCustomMedicines([...])` from `src/clinical/medicineStore`.
- This complements **Voice settings → Medical vocabulary**. The vocabulary (about 50 names) helps Whisper *hear* names correctly; the dictionary catches what still comes out wrong, with no size limit.

## 12. Light / dark theme

The app follows the device's light or dark setting automatically. The toggle at the top right cycles **automatic → light → dark** and remembers the choice. In dark mode the handwriting **paper stays white**, so black ink remains readable, and exports are unchanged.
