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


_dll_dirs_added = False


def _add_nvidia_dll_dirs() -> None:
    """Windows: make CUDA libraries installed with pip (nvidia-cublas-cu12,
    nvidia-cudnn-cu12) findable. Their DLLs live in site-packages/nvidia/*/bin,
    which is not on the DLL search path by default."""
    global _dll_dirs_added
    import os
    import sys

    if _dll_dirs_added or sys.platform != "win32":
        return
    _dll_dirs_added = True
    import site

    roots = list(site.getsitepackages()) + [site.getusersitepackages()]
    found = []
    for root in roots:
        base = os.path.join(root, "nvidia")
        if not os.path.isdir(base):
            continue
        for pkg in sorted(os.listdir(base)):
            bin_dir = os.path.join(base, pkg, "bin")
            if os.path.isdir(bin_dir):
                found.append(bin_dir)
    for d in found:
        try:
            os.add_dll_directory(d)
        except OSError:
            pass
    if found:
        os.environ["PATH"] = os.pathsep.join(found + [os.environ.get("PATH", "")])
        print(f"Using NVIDIA libraries from: {', '.join(found)}", flush=True)


def _import_whisper_model():
    """Import faster_whisper.WhisperModel, tolerating a blocked PyAV.

    faster-whisper imports PyAV (``av``) at start-up, but only uses it to
    decode audio *files*. This server always hands it decoded 16 kHz samples,
    so PyAV is never needed. On Windows, Smart App Control / App Control
    policies can block PyAV's unsigned DLLs ("DLL load failed ... An
    Application Control policy has blocked this file"); in that case we put a
    placeholder module in its place so the rest of faster-whisper can load.
    """
    import sys
    import types

    _add_nvidia_dll_dirs()
    try:
        import av  # noqa: F401
    except ImportError as exc:
        reason = str(exc)
        for name in [n for n in sys.modules if n == "av" or n.startswith("av.")]:
            del sys.modules[name]
        placeholder = types.ModuleType("av")
        placeholder.__inkflow_placeholder__ = True  # type: ignore[attr-defined]

        def _unavailable(*_a, **_k):
            raise RuntimeError(f"PyAV is unavailable on this machine ({reason}); file decoding is disabled")

        placeholder.open = _unavailable  # type: ignore[attr-defined]
        placeholder.__getattr__ = lambda _name: _unavailable  # type: ignore[attr-defined]
        sys.modules["av"] = placeholder
        print("Note: PyAV could not be loaded; continuing without it (not needed by this server).", flush=True)

    from faster_whisper import WhisperModel  # imported lazily: heavy

    return WhisperModel


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
            WhisperModel = _import_whisper_model()
            s = self.settings
            model = WhisperModel(
                model_name,
                device=s.device,
                compute_type=s.compute_type,
                cpu_threads=s.cpu_threads,
                download_root=s.model_dir or None,
            )
            device = getattr(getattr(model, "model", None), "device", s.device)
            print(f"Loaded {model_name} on {str(device).upper()} ({s.compute_type})", flush=True)
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

    # -- GPU -> CPU fallback ------------------------------------------------
    def _switch_to_cpu(self, reason: Exception) -> None:
        """NVIDIA driver present but CUDA libraries (cuBLAS/cuDNN) missing: use the CPU."""
        with self._guard:
            if self.settings.device == "cpu":
                return
            print(
                "GPU libraries are missing (" + str(reason).strip().splitlines()[0] + ").\n"
                "Switching to the CPU. To skip this, set WHISPER_DEVICE=cpu and WHISPER_COMPUTE_TYPE=int8 in .env.",
                flush=True,
            )
            self.settings.device = "cpu"
            if self.settings.compute_type in ("default", "auto", "float16", "int8_float16"):
                self.settings.compute_type = "int8"
            self._models.clear()
            self._state.clear()

    # -- recognition -------------------------------------------------------
    def transcribe(self, audio: np.ndarray, mode: str, interim: bool, vocabulary: str) -> dict:
        try:
            return self._transcribe(audio, mode, interim, vocabulary)
        except (RuntimeError, OSError, EngineError) as e:
            if self.settings.device == "cpu" or not _is_cuda_library_error(e):
                raise
            self._switch_to_cpu(e)
            return self._transcribe(audio, mode, interim, vocabulary)

    def _transcribe(self, audio: np.ndarray, mode: str, interim: bool, vocabulary: str) -> dict:
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


def _is_cuda_library_error(e: BaseException) -> bool:
    text = f"{e} {e.__cause__ or ''}".lower()
    return any(k in text for k in ("cublas", "cudnn", "cudart", "cuda driver", "cuda failed", "no cuda", "libcuda", "nvcuda"))


def load_engine(spec: str, settings: Settings) -> Engine:
    """`spec` is 'faster-whisper' or 'module:Class' (used by tests)."""
    if spec in ("", "faster-whisper"):
        return FasterWhisperEngine(settings)
    module_name, _, cls_name = spec.partition(":")
    module = __import__(module_name, fromlist=[cls_name])
    return getattr(module, cls_name)(settings)
