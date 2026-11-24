"""Test-only engine: returns deterministic text without any model.

Used by the automated tests (`python server.py --engine tests.stub_engine:StubEngine`)
to exercise the HTTP layer and the browser pipeline. It is never used by default
and does not recognise speech.
"""

from __future__ import annotations

import threading

import numpy as np

from config import MODES, Settings
from engines import EngineBusy

TEXT = {
    "en": "The patient has been experiencing itching for two weeks",
    "hi": "मरीज को पिछले दो हफ्तों से खुजली हो रही है",
    "hinglish": "Patient ko do hafte se itching ho rahi hai",
}


class StubEngine:
    name = "stub"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.calls = 0
        self._lock = threading.Lock()

    def describe(self) -> dict:
        return {
            "engine": self.name,
            "device": "none",
            "modes": {m: {"model": "stub", "language": m, "loaded": True, "loading": False, "error": None} for m in MODES},
        }

    def preload(self) -> None:
        return None

    def transcribe(self, audio: np.ndarray, mode: str, interim: bool, vocabulary: str) -> dict:
        if interim and not self._lock.acquire(blocking=False):
            raise EngineBusy()
        if not interim:
            self._lock.acquire()
        try:
            self.calls += 1
            seconds = audio.size / 16000
            text = TEXT[mode] if seconds >= 0.3 else ""
            if interim:
                words = text.split()
                text = " ".join(words[: max(1, len(words) // 2)])
            if vocabulary:
                text = f"{text} ({vocabulary.split(',')[0].strip()})"
            return {"text": text, "segments": [{"start": 0.0, "end": round(seconds, 2), "text": text}], "model": "stub", "language": mode}
        finally:
            self._lock.release()
