"""HTTP-level tests with the stub engine.  Run:  python -m unittest discover -s tests"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import Settings, load_settings  # noqa: E402
from server import build_server, decode_wav  # noqa: E402
from tests.stub_engine import StubEngine  # noqa: E402
from textproc import build_prompt, keep_segment  # noqa: E402
from wer import cer, wer  # noqa: E402


def wav_bytes(seconds: float, rate: int = 16000, channels: int = 1) -> bytes:
    t = np.arange(int(seconds * rate)) / rate
    tone = (0.3 * np.sin(2 * np.pi * 220 * t) * 32767).astype("<i2")
    if channels == 2:
        tone = np.repeat(tone, 2)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(tone.tobytes())
    return buf.getvalue()


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.pop("SPEECH_SERVER_TOKEN", None)
        cls.settings: Settings = load_settings(Path("/nonexistent"))
        cls.settings.port = 0
        cls.settings.token = "secret-token"
        cls.settings.allowed_origins = ["http://localhost:5173"]
        cls.engine = StubEngine(cls.settings)
        cls.httpd = build_server(cls.settings, cls.engine)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def req(self, method, path, body=None, headers=None):
        h = {"Authorization": "Bearer secret-token", **(headers or {})}
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=body, method=method, headers=h)
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status, dict(resp.headers), json.loads(resp.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), json.loads(e.read() or b"null")

    def test_health_requires_token(self):
        status, _, body = self.req("GET", "/v1/health", headers={"Authorization": "Bearer wrong"})
        self.assertEqual(status, 401)
        status, _, body = self.req("GET", "/v1/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertIn("hinglish", body["modes"])

    def test_transcribe_each_mode_preserves_unicode(self):
        for mode, expected in (("en", "itching"), ("hi", "खुजली"), ("hinglish", "hafte")):
            status, _, body = self.req("POST", f"/v1/transcribe?mode={mode}", wav_bytes(1.0), {"Content-Type": "audio/wav"})
            self.assertEqual(status, 200, body)
            self.assertIn(expected, body["text"])
            self.assertEqual(body["mode"], mode)

    def test_resamples_and_downmixes(self):
        status, _, body = self.req("POST", "/v1/transcribe?mode=en", wav_bytes(1.0, rate=48000, channels=2))
        self.assertEqual(status, 200)
        self.assertAlmostEqual(body["duration_s"], 1.0, places=1)

    def test_vocabulary_header(self):
        vocab = base64.b64encode("Benzoyl peroxide, क्लोबेटासोल".encode()).decode()
        status, _, body = self.req("POST", "/v1/transcribe?mode=en", wav_bytes(1.0), {"X-Vocabulary": vocab})
        self.assertEqual(status, 200)
        self.assertIn("Benzoyl peroxide", body["text"])

    def test_rejects_bad_input(self):
        self.assertEqual(self.req("POST", "/v1/transcribe?mode=fr", wav_bytes(1.0))[0], 400)
        self.assertEqual(self.req("POST", "/v1/transcribe?mode=en", b"x" * 100)[0], 400)
        self.assertEqual(self.req("POST", "/v1/transcribe?mode=en", wav_bytes(1.0), {"Authorization": ""})[0], 401)
        self.assertEqual(self.req("POST", "/v1/nope", wav_bytes(0.5))[0], 404)

    def test_too_long(self):
        old = self.settings.max_audio_seconds
        try:
            self.settings.max_audio_seconds = 1
            # handler captured max_body at creation; duration check still applies
            status, _, body = self.req("POST", "/v1/transcribe?mode=en", wav_bytes(1.8))
            self.assertEqual(status, 413)
        finally:
            self.settings.max_audio_seconds = old

    def test_cors(self):
        status, headers, _ = self.req("OPTIONS", "/v1/transcribe", headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Private-Network": "true",
        })
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "http://localhost:5173")
        self.assertEqual(headers.get("Access-Control-Allow-Private-Network"), "true")
        _, headers, _ = self.req("OPTIONS", "/v1/transcribe", headers={"Origin": "https://evil.example"})
        self.assertNotIn("Access-Control-Allow-Origin", headers)


class TextTest(unittest.TestCase):
    def test_decode_wav(self):
        audio, dur = decode_wav(wav_bytes(0.5, rate=8000))
        self.assertEqual(audio.dtype, np.float32)
        self.assertAlmostEqual(dur, 0.5, places=2)

    def test_hallucination_filter(self):
        self.assertFalse(keep_segment({"text": "Thank you for watching!", "no_speech_prob": 0.5, "avg_logprob": -0.3}))
        self.assertTrue(keep_segment({"text": "Thank you.", "no_speech_prob": 0.05, "avg_logprob": -0.2}))
        self.assertFalse(keep_segment({"text": "the the the", "compression_ratio": 3.1}))

    def test_prompt(self):
        self.assertEqual(build_prompt("", ""), None)
        self.assertEqual(build_prompt("Base.", "a,\nb"), "Base. Terms: a, b.")

    def test_wer(self):
        self.assertEqual(wer("Patient ko fever nahi hai.", "patient ko fever nahi hai"), 0.0)
        self.assertAlmostEqual(wer("mild headache hai", "mild hedache hai"), 1 / 3)
        self.assertEqual(wer("मरीज को खुजली है।", "मरीज को खुजली है"), 0.0)
        self.assertGreater(cer("खुजली", "खुजलि"), 0)


if __name__ == "__main__":
    unittest.main()
