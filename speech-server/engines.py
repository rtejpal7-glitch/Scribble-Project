"""Speech recognition engines behind the server.

The server talks to an engine through `Engine`, so another backend (an
IndicConformer/NeMo model, a different Whisper runtime) can be added without
touching the HTTP layer or the frontend.
"""

from __future__ import annotations

import threading
import time
from typing import Protocol

import numpy as np

from config import MODES, Settings
from textproc import build_prompt, join_segments, keep_segment


class EngineBusy(Exception):
    """Raised for interim requests when the model is already working."""


class EngineError(Exception):
    pass


class Engine(Protocol):
    name: str

    def describe(self) -> dict: ...

    def preload(self) -> None: ...

    def transcribe(self, audio: np.ndarray, mode: str, interim: bool, vocabulary: str) -> dict:
        """audio: float32 mono at 16 kHz. Returns {text, segments, model, language}."""
        ...


class FasterWhisperEngine:
    """Whisper via faster-whisper (CTranslate2). Runs on CPU or NVIDIA GPU."""

    name = "faster-whisper"

    def __init__(self, settings: Settings):
        self.settings = settings
        self._models: dict[str, object] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._state: dict[str, dict] = {}
        self._guard = threading.Lock()

    # -- model management -------------------------------------------------
    def _load(self, model_name: str):
        with self._guard:
            if model_name in self._models:
                return self._models[model_name]
            self._state[model_name] = {"loading": True, "error": None}
        try:
            from faster_whisper import WhisperModel  # imported lazily: heavy

            s = self.settings
            model = WhisperModel(
                model_name,
                device=s.device,
                compute_type=s.compute_type,
                cpu_threads=s.cpu_threads,
                download_root=s.model_dir or None,
            )
        except Exception as e:  # noqa: BLE001 - surface any load failure to /health
            with self._guard:
                self._state[model_name] = {"loading": False, "error": f"{type(e).__name__}: {e}"}
            raise EngineError(f"Could not load model '{model_name}': {e}") from e
        with self._guard:
            self._models[model_name] = model
            self._locks.setdefault(model_name, threading.Lock())
            self._state[model_name] = {"loading": False, "error": None}
        return model

    def preload(self) -> None:
        for name in dict.fromkeys(m.model for m in self.settings.modes.values()):
            try:
                self._load(name)
            except EngineError:
                pass  # reported via describe()

    def describe(self) -> dict:
        modes = {}
        for mode in MODES:
            cfg = self.settings.modes[mode]
            st = self._state.get(cfg.model, {})
            modes[mode] = {
                "model": cfg.model,
                "language": cfg.language,
                "loaded": cfg.model in self._models,
                "loading": bool(st.get("loading")),
                "error": st.get("error"),
            }
        return {"engine": self.name, "device": self.settings.device, "modes": modes}

    # -- recognition -------------------------------------------------------
    def transcribe(self, audio: np.ndarray, mode: str, interim: bool, vocabulary: str) -> dict:
        cfg = self.settings.modes[mode]
        model = self._models.get(cfg.model) or self._load(cfg.model)
        lock = self._locks[cfg.model]
        if interim:
            if not lock.acquire(blocking=False):
                raise EngineBusy()
        else:
            lock.acquire()
        try:
            started = time.perf_counter()
            segments_iter, info = model.transcribe(  # type: ignore[attr-defined]
                audio,
                language=cfg.language,
                task="transcribe",  # never translate: keep the language as spoken
                beam_size=1 if interim else self.settings.beam_size,
                temperature=0.0 if interim else (0.0, 0.2, 0.4),
                initial_prompt=build_prompt(cfg.prompt, vocabulary),
                condition_on_previous_text=False,
                vad_filter=not interim,
                vad_parameters={"min_silence_duration_ms": 500},
            )
            segments = [
                {
                    "start": round(float(s.start), 2),
                    "end": round(float(s.end), 2),
                    "text": s.text.strip(),
                    "no_speech_prob": float(s.no_speech_prob),
                    "avg_logprob": float(s.avg_logprob),
                    "compression_ratio": float(s.compression_ratio),
                }
                for s in segments_iter
            ]
            kept = [s for s in segments if keep_segment(s)]
            return {
                "text": join_segments(kept),
                "segments": [{k: s[k] for k in ("start", "end", "text")} for s in kept],
                "model": cfg.model,
                "language": cfg.language,
                "inference_ms": int((time.perf_counter() - started) * 1000),
            }
        finally:
            lock.release()


def load_engine(spec: str, settings: Settings) -> Engine:
    """`spec` is 'faster-whisper' or 'module:Class' (used by tests)."""
    if spec in ("", "faster-whisper"):
        return FasterWhisperEngine(settings)
    module_name, _, cls_name = spec.partition(":")
    module = __import__(module_name, fromlist=[cls_name])
    return getattr(module, cls_name)(settings)
