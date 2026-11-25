"""Configuration for the InkFlow speech server (environment variables / .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

MODES = ("en", "hi", "hinglish")


def load_dotenv(path: Path) -> None:
    """Minimal .env loader (KEY=VALUE lines). Existing environment variables win."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass
class ModeConfig:
    """How one language mode is transcribed."""

    model: str
    language: str  # Whisper language token passed to the decoder
    prompt: str  # initial prompt (style / vocabulary hint), may be empty


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    token: str = ""
    allow_no_token: bool = False
    allowed_origins: list[str] = field(default_factory=list)
    ssl_certfile: str = ""
    ssl_keyfile: str = ""
    device: str = "auto"
    compute_type: str = "default"
    cpu_threads: int = 0
    model_dir: str = ""
    beam_size: int = 5
    preload: bool = True
    max_audio_seconds: int = 60
    modes: dict[str, ModeConfig] = field(default_factory=dict)
    # Sentence check (local language model)
    suggest_backend: str = "ollama"
    suggest_url: str = ""
    suggest_model: str = ""
    suggest_api_key: str = ""


DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"


def load_settings(env_file: Path | None = None) -> Settings:
    load_dotenv(env_file or Path(__file__).with_name(".env"))
    origins = os.environ.get("ALLOWED_ORIGINS", DEFAULT_ORIGINS)
    s = Settings(
        host=os.environ.get("SPEECH_HOST", "127.0.0.1"),
        port=_int("SPEECH_PORT", 8765),
        token=os.environ.get("SPEECH_SERVER_TOKEN", ""),
        allow_no_token=_bool("SPEECH_ALLOW_NO_TOKEN", False),
        allowed_origins=[o.strip().rstrip("/") for o in origins.split(",") if o.strip()],
        ssl_certfile=os.environ.get("SSL_CERTFILE", ""),
        ssl_keyfile=os.environ.get("SSL_KEYFILE", ""),
        device=os.environ.get("WHISPER_DEVICE", "auto"),
        compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "default"),
        cpu_threads=_int("WHISPER_CPU_THREADS", 0),
        model_dir=os.environ.get("MODEL_DIR", ""),
        beam_size=_int("BEAM_SIZE", 5),
        preload=_bool("PRELOAD", True),
        max_audio_seconds=_int("MAX_AUDIO_SECONDS", 60),
        suggest_backend=os.environ.get("SUGGEST_BACKEND", "ollama"),
        suggest_url=os.environ.get("SUGGEST_URL", ""),
        suggest_model=os.environ.get("SUGGEST_MODEL", ""),
        suggest_api_key=os.environ.get("SUGGEST_API_KEY", ""),
    )
    s.modes = {
        # Indian English: multilingual Whisper, English decoding.
        "en": ModeConfig(
            model=os.environ.get("MODEL_EN", "large-v3-turbo"),
            language="en",
            prompt=os.environ.get("PROMPT_EN", "Clinical notes dictated by an Indian doctor."),
        ),
        # Hindi: Devanagari output.
        "hi": ModeConfig(
            model=os.environ.get("MODEL_HI", "large-v3-turbo"),
            language="hi",
            prompt=os.environ.get("PROMPT_HI", "डॉक्टर द्वारा बोले गए क्लिनिकल नोट्स।"),
        ),
        # Hinglish: a Whisper model fine-tuned on code-switched Indian speech that
        # emits romanized Hinglish under the English language token.
        "hinglish": ModeConfig(
            model=os.environ.get("MODEL_HINGLISH", "Hub84/faster-whisper-hinglish-prime"),
            language=os.environ.get("HINGLISH_LANGUAGE", "en"),
            prompt=os.environ.get("PROMPT_HINGLISH", ""),
        ),
    }
    return s
