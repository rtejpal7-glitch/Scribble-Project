# InkFlow speech server

Self-hosted speech-to-text for the **Voice to Text** workspace. It runs Whisper models locally with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), so audio stays on your machine.

Full setup, iPad HTTPS options and hardware notes: see the main README, **§10**.

```powershell
py -3.12 -m venv .venv ; .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # set SPEECH_SERVER_TOKEN
python server.py
```

| Endpoint | |
|---|---|
| `GET /v1/health` | Engine, device, and model per mode (loaded / loading / error). Requires the token. |
| `POST /v1/suggest` | JSON `{language, sentences:[{id,text}], context?, medicines?}` → `{suggestions:[{id,text,reason}]}` from the local language model (`SUGGEST_BACKEND`). |
| `POST /v1/transcribe?mode=en\|hi\|hinglish[&interim=1]` | Body: WAV (16 kHz mono preferred). Header `Authorization: Bearer <token>`, optional `X-Vocabulary: base64(utf-8 terms)`. Returns `{text, segments, model, processing_ms, …}` |

- **Privacy:** audio is decoded in memory and never written to disk. Request bodies and transcripts are never logged.
- **Accuracy on your recordings:** `python evaluate.py samples/ --csv results.csv` (see the docstring).
- **Tests** (no models needed): `python -m unittest discover -s tests -t .`

`tests/stub_engine.py` is a deterministic stand-in used **only** by automated tests (`--engine tests.stub_engine:StubEngine`). It does not recognise speech.

## NVIDIA GPU on Windows

1. `pip install -r requirements-gpu.txt` (inside the activated `.venv`). This installs cuBLAS and cuDNN into the virtual environment; the server adds them to the DLL search path automatically.
2. In `.env`: `WHISPER_DEVICE=cuda` and `WHISPER_COMPUTE_TYPE=int8_float16` (lower memory, good for 4–6 GB cards) or `float16`.
3. Start the server. It prints `Loaded <model> on CUDA (...)` for each model. If the libraries still cannot be found it prints a warning and falls back to the CPU.

## Consultation reports

`POST /v1/report` with `{"language": "hinglish", "transcript": "...", "medicines": [...]}` returns a structured clinical note drafted by the local model (`REPORT_MODEL`, default `qwen2.5:7b-instruct`, same backend as the sentence check). Every medicine and diagnosis is checked against the transcript and returned with `flags` (`name-not-in-transcript`, `source-not-found`, `number-not-in-transcript`). Transcript text is never logged.
