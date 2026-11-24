# Speech engine evaluation (English · Hindi · Hinglish, clinical use)

Status: **desk evaluation** (November 2026), based on published model cards, vendor documentation and the architecture of each option. It has **not** yet been measured on real clinic recordings. Use the in-app *Test accuracy* panel and `speech-server/evaluate.py` to do that before choosing for production (see README §10.9).

## Requirements that drive the choice

1. **Hinglish code-switching** inside one sentence, written as spoken (not translated, not forced into one script).
2. Indian English and native Hindi accents, medical terms, numbers and dosages.
3. **Patient privacy:** a preference for local or self-hosted processing.
4. Near-live feedback while the doctor speaks.
5. Works in a React web app on iPad Safari.

## Options compared

| | Browser Web Speech API (Safari / Chrome) | Whisper large-v3 / turbo (faster-whisper) | **Oriserve Whisper-Hindi2Hinglish (Prime / Apex)** | AI4Bharat IndicConformer | Vosk | Sarvam Saaras (cloud API) |
|---|---|---|---|---|---|---|
| Hindi | Yes (`hi-IN`) | Good | Good (trained for Hindi/Hinglish) | Strong, Hindi-specific | Small model, weaker | Strong (India-focused) |
| Indian English | Yes (`en-IN`) | Good | Apex claims Indian-accented English | No (Indian languages) | Weak | Yes |
| **Hinglish code-switching** | **No.** One language per session | Weak: tends to pick one language or script, and may translate | **Yes, the stated purpose.** Romanized output | No (monolingual, Devanagari) | No | Yes (code-mix mode) |
| Medical terms | No custom vocabulary | Prompt biasing | Prompt biasing | Needs fine-tuning | Custom LM possible | Not evaluated |
| Live latency | Word-by-word (native streaming) | Per-utterance; GPU recommended | Per-utterance; large-v3-sized, GPU recommended | Fast on GPU | Real-time on CPU | Streaming available |
| Offline | No | Yes | Yes | Yes | Yes | No |
| Hardware | None | GPU recommended | GPU recommended (~1.5 GB CT2 fp16) | GPU / CPU, NeMo stack | CPU, small | None |
| Licence / cost | Free; vendor terms | MIT | Apache-2.0 | MIT | Apache-2.0 | Paid per minute |
| Where audio goes | **Apple / Google servers** | Your server | Your server | Your server | Your server | Sarvam servers in India |
| Runs on iPad web | Yes (Safari 14.5+) | Via your server | Via your server | Via your server | Via your server | Via a backend proxy |

## Notes per option

**Browser Web Speech API.**
- Safari asks permission to send the audio to Apple, and Chrome streams it to Google. Neither offers code-switching.
- Speech recognition in Home Screen web apps on iOS has a history of problems.
- Included in the app as an **opt-in** fallback (explicit consent; Hinglish labelled *approximate*) because it needs no setup and gives true streaming for quick trials. Not for patient data.

**Whisper (stock).**
- A good multilingual baseline and the runtime used here (faster-whisper / CTranslate2, MIT).
- For mixed speech it is unreliable: it often commits to one language or script, and can translate when given the wrong language token.
- Used for the English and Hindi modes by default (`large-v3-turbo`). Try `large-v3` for better Hindi if your GPU allows.

**Oriserve Whisper-Hindi2Hinglish.**
- Whisper fine-tuned on conversational Indian audio to output romanized Hinglish.
- The Prime model card (base `openai/whisper-large-v3`, Apache-2.0) reports WER against stock large-v3:

  | Test set | Stock large-v3 | Prime |
  |---|---|---|
  | Common Voice | 61.9 | 32.4 |
  | FLEURS | 50.8 | 28.7 |
  | Indic-Voices | 82.6 | 60.8 |

  Measured on Hinglish-romanized references.
- **Apex** is the newer release (~800M parameters, trained on 1,000+ hours, also targets Indian-accented English).
- Selected for the Hinglish mode. Caveats: the Hinglish spelling convention is the model's own; it was not trained specifically on medical speech; the default CT2 conversion is a community build (convert yourself, as in the README).
- Other open Hinglish fine-tunes exist (for example Shunya Labs zero-stt-hinglish, based on Whisper Medium and mixing scripts; Trelis whisper-hinglish-preview). Any CTranslate2-convertible Whisper model can be tried via `MODEL_HINGLISH` and compared with `evaluate.py`.

**AI4Bharat IndicConformer.**
- MIT-licensed Conformer models for 22 Indian languages, including a 120M-parameter Hindi model (16 kHz, hybrid CTC-RNNT, NeMo).
- Excellent candidate for **pure Hindi**, but monolingual Devanagari output means no Hinglish, and it needs the AI4Bharat NeMo fork.
- It could be added as a second engine for the Hindi mode behind the server's `Engine` interface if Hindi accuracy from Whisper proves insufficient.

**Vosk.** Lightweight and offline (the small Hindi model is ~45 MB, CPU real-time), but accuracy is clearly below the transformer models and there is no code-switching. Not selected.

**Sarvam (cloud).**
- India-focused STT with native code-mixing, streaming, and processing in India. It advertises DPDP compliance and offers VPC and on-premise deployment.
- Priced per minute, around ₹1.25–1.5/min on their site at the time of writing.
- A strong option if self-hosting a GPU is impractical, but audio leaves your infrastructure, so it needs a data-processing agreement. It is **not integrated**. It would sit behind `speech-server` (server-side key) as another engine.

**On-device iPad recognition** (Apple SpeechAnalyzer, WhisperKit Core ML builds of the Hinglish model) is only available to **native** iOS apps, not to a Safari web page. It is the path to fully on-device recognition if ClinicFlow later ships a native or Capacitor iPad app; the same `SpeechRecognitionProvider` interface would wrap it.

## Decision

| Mode | Engine (default) | Why |
|---|---|---|
| Hinglish | Whisper-Hindi2Hinglish (self-hosted) | Only open option built for code-switching; private |
| Hindi | Whisper large-v3-turbo (self-hosted) | Good accuracy, same runtime; IndicConformer is the fallback candidate |
| English (India) | Whisper large-v3-turbo (self-hosted) | Robust to accents; consider Apex if it tests better |
| Fallback | Browser Web Speech (opt-in) | Zero setup for demos; not private, no Hinglish |

**Revisit this decision after measuring:** run 20–30 real samples per mode through `evaluate.py` for each candidate `MODEL_*` and keep the CSVs.

## Sources

- Oriserve Whisper-Hindi2Hinglish-Prime model card: https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Prime
- Oriserve Apex announcement: https://wordpress-dev.oriserve.com/?p=626
- CT2 conversion used by default: https://huggingface.co/Hub84/faster-whisper-hinglish-prime
- Shunya Labs Hinglish model: https://huggingface.co/shunyalabs/zero-stt-hinglish
- Trelis Whisper Hinglish: https://huggingface.co/Trelis/whisper-hinglish-preview
- AI4Bharat IndicConformer: https://github.com/AI4Bharat/IndicConformerASR · https://huggingface.co/ai4bharat/indicconformer_stt_hi_hybrid_ctc_rnnt_large
- Vosk Hindi model: https://huggingface.co/rhasspy/vosk-models/tree/main/hi
- Web Speech API on Safari (permission to send audio to Apple): https://blog.addpipe.com/a-deep-dive-into-the-web-speech-api/
- Web Speech API privacy (server-based by default): https://developer.mozilla.org/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API
- Safari Home Screen app issue: https://bugs.webkit.org/show_bug.cgi?id=225298
- Sarvam STT: https://www.sarvam.ai/speech-to-text · https://www.sarvam.ai/try/speech-to-text-api
- faster-whisper: https://github.com/SYSTRAN/faster-whisper
