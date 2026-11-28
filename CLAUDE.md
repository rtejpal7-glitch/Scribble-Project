# InkFlow (Scribble-Project): notes for Claude Code

## Who you're working with
- The owner is a doctor building this for clinic use, and **is new to coding** (first time using git, Node and Python). Explain steps in plain language, one at a time. Say what each command does before running it, and what output to expect.
- Development machine: **Windows**, VS Code, **PowerShell**. Project folder: `C:\Projects\Scribble-Project`.
  - PowerShell `copy` and `cd` print nothing on success. Say so.
  - To run a program by full path, start the line with `&`, e.g. `& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" list`.
- The PC is a laptop with an **NVIDIA GeForce RTX 3050 6 GB Laptop GPU**. Windows **Smart App Control** blocks some unsigned DLLs (it blocked PyAV; the server works around that).

## What the app is
A web app (PWA) with two independent, reusable workspaces:
- **Handwriting to Text:** Apple Pencil on iPad Safari. Recognition by MyScript through a secure Vercel function (`api/recognize.ts`). Erasing ink updates the text.
- **Voice to Text:** Indian English, Hindi and Hinglish (code-switched Hindi/English in Roman script, **never translated**). Recognised by a **self-hosted speech server** (`speech-server/`, faster-whisper) running on the doctor's PC, or optionally by the browser's speech engine.
  - Extras: sentence check (local LLM suggests fixes for misheard sentences), medicine dictionary check, and **consultation report** (local LLM turns the dictated consultation into a clinical note + prescription, with grounding checks; editable; print/PDF).
- Light/dark theme follows the system, with a toggle in the header.
- Both editors are meant to be embedded later in **ClinicFlow**, the owner's clinic management system: `<HandwritingEditor/>` in `src/handwriting-module/`, `<VoiceToTextEditor/>` in `src/voice-module/`.

Stack: React 19, TypeScript, Vite 7, Tailwind v4, IndexedDB (`src/storage/db.ts`, DB_VERSION 2), jsPDF. Python 3.12 standard-library HTTP server for speech.

## Deployment
- GitHub: `rtejpal7-glitch/Scribble-Project`. **Vercel deploys automatically from `main`**; the site is https://scribble-project.vercel.app.
- The owner wants updates pushed to `main` so Vercel redeploys. Run `npm run build` (it type-checks) before pushing. Branch `voice-to-text` mirrors `main`.
- MyScript keys exist only as Vercel environment variables (`MYSCRIPT_APPLICATION_KEY`, `MYSCRIPT_HMAC_KEY`), never in frontend code.

## Running things locally
- Frontend: `npm install` once, then `npm run dev` (http://localhost:5173). Node.js LTS may not be installed yet; check with `node -v`.
- Speech server, in its own terminal, kept running:
  ```
  cd C:\Projects\Scribble-Project\speech-server
  .venv\Scripts\activate
  python server.py
  ```
  - It listens on http://127.0.0.1:8765. Look for `Loaded … on CUDA (int8_float16)`, `Reports: ollama (qwen2.5:7b-instruct)` and `Sentence check model … is loaded.`
  - To restart it: Ctrl + C, then `python server.py`.
  - In the app: Voice → Settings → Self-hosted Whisper server, URL `http://localhost:8765` plus the token from `.env`.
- GPU libraries: `pip install -r requirements-gpu.txt` (cuBLAS 12, cuDNN 9 inside the venv; `engines.py` adds them to the DLL path). If CUDA libraries are missing, the server falls back to the CPU automatically.
- **Ollama** (local LLM) is installed. Models: `qwen2.5:3b-instruct` (sentence check, `SUGGEST_MODEL`) and `qwen2.5:7b-instruct` (reports, `REPORT_MODEL`). Use local mode only; never Ollama cloud models (patient text must stay on the PC).
- `speech-server/.env` holds the owner's settings: `SPEECH_SERVER_TOKEN`, `ALLOWED_ORIGINS` (includes the Vercel URL), `WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=int8_float16`, `SUGGEST_MODEL=qwen2.5:3b-instruct`.
  - It is gitignored. **Never commit it, print the token, or overwrite it.** Edit single lines only, and tell the owner what you changed.
  - In `.env`, a later line for the same key overrides an earlier one.
- iPad/phone access to the speech server needs **https**. The plan is Tailscale (`tailscale serve --bg 8765`); this isn't set up yet.

## Tests
- Frontend: `npm run typecheck`, `npm test` (vitest; tests in `tests/`).
- Speech server: `npm run speech:test`, or `python -m pytest speech-server/tests`.
  - Stub engines for testing without models: `python server.py --engine tests.stub_engine:StubEngine`, with `SUGGEST_BACKEND=tests.stub_suggester:StubSuggester` and `REPORT_BACKEND=tests.stub_reporter:StubReporter`.
- There is no browser-test setup in the repo. Test UI changes manually in the browser, and ask the owner to try them on the iPad or phone when relevant.

## Rules (from the owner's specs; keep them)
- No secrets in frontend code or in git. No hard-coded keys.
- No mock or fake features presented as working. Every button must do what it says.
- Don't send audio or patient text to third-party services without explicit configuration. **Never log audio, transcripts or patient information** (the server logs only sizes and timings).
- Medical safety:
  - The report and suggestions only organise or correct what the doctor said. **No automatic diagnosis or prescription generation.**
  - Medicine and dose changes are always suggestions the doctor accepts, never silent.
  - Report items not found in the transcript are flagged. Printouts say "Draft — not reviewed" until the doctor ticks reviewed.
- Hinglish stays in Roman script as spoken. Hindi mode outputs Devanagari. Never translate the transcript itself.
- Don't claim recognition is accurate because a few examples work. Accuracy hasn't been evaluated on real clinic audio; the app has a Test accuracy panel (WER/CER) and there is `speech-server/evaluate.py`.
- Keep the handwriting and voice modules independent and reusable (props and ref APIs, pluggable storage and recognition providers).

## Where things are
- `README.md` holds full documentation: §10 voice and speech server, §10.11 sentence check, §10.12 reports, §11 medicine dictionary, §12 theme. Also `docs/SPEECH_ENGINES.md` and `speech-server/README.md`.
- Voice:
  - `src/voice-module/VoiceToTextEditor.tsx` (entry point), `src/components/voice/*`, `src/components/report/*`
  - `src/hooks/useSpeechRecognition.ts`, `useSentenceCheck.ts`, `useReportGenerator.ts`
  - `src/recognition/speech/*` (providers, `SpeechServerClient`, audio capture and segmentation)
  - `src/state/voiceReducer.ts`
- Clinical: `src/clinical/` (medicine list and matcher, report helpers, clinic profile).
- Handwriting: `src/handwriting-module/`, `src/components/handwriting/*`, `src/recognition/` (MyScript), `src/sync/textSync.ts`.
- Speech server:
  - `speech-server/server.py` (routes `/v1/health`, `/v1/transcribe`, `/v1/suggest`, `/v1/report`)
  - `engines.py` (faster-whisper), `suggest.py`, `report.py`, `config.py`
