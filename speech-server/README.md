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
