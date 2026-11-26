#!/usr/bin/env python3
"""InkFlow speech server: self-hosted speech-to-text for the Voice workspace.

    GET  /v1/health                       -> engine + model status (auth required)
    POST /v1/transcribe?mode=hinglish     -> {text, segments, ...}
    POST /v1/suggest                      -> sentence-check suggestions (local LLM)
         body: audio/wav (16 kHz mono PCM16 preferred; other rates are resampled)
         headers: Authorization: Bearer <SPEECH_SERVER_TOKEN>
                  X-Vocabulary: base64(UTF-8 comma-separated terms)   (optional)
         query:   interim=1 for fast, lower-accuracy previews

Privacy: audio is processed in memory and never written to disk. Request bodies
and transcripts are never logged; access logs contain only method, path,
status and timing.

Run:  python server.py            (configuration via environment or .env)
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hmac
import io
import json
import logging
import ssl
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

from config import MODES, Settings, load_settings
from engines import Engine, EngineBusy, EngineError, load_engine
from suggest import SuggestError, Suggester, load_suggester, run_suggest

log = logging.getLogger("inkflow.speech")
TARGET_RATE = 16000


class BadAudio(ValueError):
    pass


def decode_wav(data: bytes) -> tuple[np.ndarray, float]:
    """WAV bytes -> float32 mono 16 kHz samples, duration (s)."""
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            channels, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(frames)
    except (wave.Error, EOFError) as e:
        raise BadAudio(f"Expected a WAV file: {e}") from e
    if width == 2:
        audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        audio = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    elif width == 1:
        audio = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise BadAudio(f"Unsupported sample width: {width * 8} bit")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != TARGET_RATE and audio.size:
        n = int(round(audio.size * TARGET_RATE / rate))
        audio = np.interp(np.linspace(0, audio.size - 1, n), np.arange(audio.size), audio).astype(np.float32)
    return audio, audio.size / TARGET_RATE


def make_handler(settings: Settings, engine: Engine, suggester: Suggester | None = None):
    max_body = settings.max_audio_seconds * TARGET_RATE * 2 * 2 + 4096  # generous (allows 32-bit / stereo)

    class Handler(BaseHTTPRequestHandler):
        server_version = "InkFlowSpeech/1.0"
        protocol_version = "HTTP/1.1"

        # Never log request content; only a short access line.
        def log_message(self, format: str, *args) -> None:  # noqa: A002
            return

        def _access_log(self, status: int, started: float) -> None:
            path = urlparse(self.path).path
            log.info("%s %s %d %dms", self.command, path, status, (time.perf_counter() - started) * 1000)

        # -- helpers -------------------------------------------------------
        def _cors_headers(self) -> None:
            origin = (self.headers.get("Origin") or "").rstrip("/")
            if origin and ("*" in settings.allowed_origins or origin in settings.allowed_origins):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Vocabulary")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Max-Age", "600")
                if self.headers.get("Access-Control-Request-Private-Network") == "true":
                    self.send_header("Access-Control-Allow-Private-Network", "true")

        def _send_json(self, status: int, payload: dict, started: float) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if self.close_connection:
                self.send_header("Connection", "close")
            self._cors_headers()
            self.end_headers()
            self.wfile.write(body)
            self._access_log(status, started)

        def _error(self, status: int, code: str, message: str, started: float) -> None:
            self._send_json(status, {"error": {"code": code, "message": message}}, started)

        def _authorized(self) -> bool:
            if not settings.token:
                return settings.allow_no_token
            header = self.headers.get("Authorization", "")
            supplied = header[7:].strip() if header.lower().startswith("bearer ") else ""
            return hmac.compare_digest(supplied.encode(), settings.token.encode())

        def _drain(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            if 0 < length <= max_body:
                self.rfile.read(length)

        # -- routes --------------------------------------------------------
        def do_OPTIONS(self) -> None:  # noqa: N802
            started = time.perf_counter()
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self._cors_headers()
            self.end_headers()
            self._access_log(204, started)

        def do_GET(self) -> None:  # noqa: N802
            started = time.perf_counter()
            path = urlparse(self.path).path
            if path == "/":
                return self._send_json(200, {"service": "inkflow-speech", "health": "/v1/health"}, started)
            if path != "/v1/health":
                return self._error(404, "not_found", "Unknown endpoint.", started)
            if not self._authorized():
                return self._error(401, "unauthorized", "Missing or wrong access token.", started)
            suggest = suggester.describe() if suggester else {"enabled": False, "backend": "off"}
            return self._send_json(200, {"ok": True, **engine.describe(), "suggest": suggest}, started)

        def _suggest(self, started: float) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 65536:
                self.close_connection = True
                return self._error(413 if length else 400, "bad_body", "Send a JSON body up to 64 KB.", started)
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return self._error(400, "bad_json", "Body must be JSON.", started)
            if suggester is None:
                return self._error(503, "suggest_disabled", "Sentence check is turned off on the server (SUGGEST_BACKEND=off).", started)
            try:
                result = run_suggest(suggester, body if isinstance(body, dict) else {})
            except ValueError as e:
                return self._error(400, "bad_request", str(e), started)
            except SuggestError as e:
                return self._error(503, "suggest_unavailable", str(e), started)
            except Exception as e:  # noqa: BLE001
                log.exception("suggest failed (%s)", type(e).__name__)
                return self._error(500, "suggest_error", f"Sentence check failed: {type(e).__name__}", started)
            return self._send_json(200, result, started)

        def do_POST(self) -> None:  # noqa: N802
            started = time.perf_counter()
            url = urlparse(self.path)
            if url.path == "/v1/suggest":
                if not self._authorized():
                    self._drain()
                    return self._error(401, "unauthorized", "Missing or wrong access token.", started)
                return self._suggest(started)
            if url.path != "/v1/transcribe":
                self._drain()
                return self._error(404, "not_found", "Unknown endpoint.", started)
            if not self._authorized():
                self._drain()
                return self._error(401, "unauthorized", "Missing or wrong access token.", started)
            query = parse_qs(url.query)
            mode = (query.get("mode") or ["en"])[0]
            if mode not in MODES:
                self._drain()
                return self._error(400, "bad_mode", f"mode must be one of {', '.join(MODES)}.", started)
            interim = (query.get("interim") or ["0"])[0] in ("1", "true")
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 44:
                self._drain()
                return self._error(400, "no_audio", "Request body must be a WAV file.", started)
            if length > max_body:
                self.close_connection = True  # body left unread
                return self._error(413, "too_large", f"Audio longer than {settings.max_audio_seconds}s.", started)
            data = self.rfile.read(length)
            vocabulary = ""
            if self.headers.get("X-Vocabulary"):
                try:
                    vocabulary = base64.b64decode(self.headers["X-Vocabulary"]).decode("utf-8")
                except (binascii.Error, UnicodeDecodeError):
                    return self._error(400, "bad_vocabulary", "X-Vocabulary must be base64 UTF-8.", started)
            try:
                audio, duration = decode_wav(data)
            except BadAudio as e:
                return self._error(400, "bad_audio", str(e), started)
            if duration > settings.max_audio_seconds + 0.5:
                return self._error(413, "too_large", f"Audio longer than {settings.max_audio_seconds}s.", started)
            try:
                result = engine.transcribe(audio, mode, interim, vocabulary)
            except EngineBusy:
                return self._error(429, "busy", "Busy with another request; interim skipped.", started)
            except EngineError as e:
                return self._error(503, "engine_unavailable", str(e), started)
            except Exception as e:  # noqa: BLE001
                log.exception("transcription failed (%s)", type(e).__name__)
                return self._error(500, "engine_error", f"Transcription failed: {type(e).__name__}", started)
            result.update(
                {
                    "mode": mode,
                    "interim": interim,
                    "duration_s": round(duration, 2),
                    "processing_ms": int((time.perf_counter() - started) * 1000),
                }
            )
            return self._send_json(200, result, started)

    return Handler


def build_server(settings: Settings, engine: Engine, suggester: Suggester | None = None) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer((settings.host, settings.port), make_handler(settings, engine, suggester))
    httpd.daemon_threads = True
    if settings.ssl_certfile and settings.ssl_keyfile:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(settings.ssl_certfile, settings.ssl_keyfile)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    return httpd


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="InkFlow self-hosted speech server")
    parser.add_argument("--engine", default="faster-whisper", help="'faster-whisper' or module:Class (tests)")
    parser.add_argument("--port", type=int, help="override SPEECH_PORT")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()
    if args.port:
        settings.port = args.port
    if not settings.token and not settings.allow_no_token:
        log.error("Set SPEECH_SERVER_TOKEN (or SPEECH_ALLOW_NO_TOKEN=1 for local-only testing).")
        return 2
    if not settings.token and settings.host not in ("127.0.0.1", "localhost"):
        log.error("Refusing to listen on %s without a token.", settings.host)
        return 2

    engine = load_engine(args.engine, settings)
    if settings.preload:
        threading.Thread(target=engine.preload, name="preload", daemon=True).start()

    suggester = load_suggester(settings.suggest_backend, settings.suggest_url, settings.suggest_model, settings.suggest_api_key)
    if suggester is not None and settings.preload and hasattr(suggester, "warm_up"):
        threading.Thread(target=suggester.warm_up, name="suggest-warmup", daemon=True).start()
    httpd = build_server(settings, engine, suggester)
    scheme = "https" if settings.ssl_certfile else "http"
    log.info("InkFlow speech server on %s://%s:%d (engine: %s)", scheme, settings.host, settings.port, engine.name)
    for mode, cfg in settings.modes.items():
        log.info("  mode %-8s model=%s language=%s", mode, cfg.model, cfg.language)
    log.info("Allowed origins: %s", ", ".join(settings.allowed_origins) or "(none)")
    log.info("Sentence check: %s", f"{suggester.name} ({suggester.describe().get('model')})" if suggester else "off")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
