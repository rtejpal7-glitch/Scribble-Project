"""Prompt building and post-filtering of Whisper output."""

from __future__ import annotations

import re
import unicodedata

# Phrases Whisper is known to hallucinate on silence/noise (from its training
# subtitles). They are only removed when the decoder was also unsure.
HALLUCINATIONS = {
    "thank you",
    "thank you for watching",
    "thanks for watching",
    "please subscribe",
    "subtitles by the amaraorg community",
    "you",
    "bye",
    "धन्यवाद",
    "शुक्रिया",
    "सब्सक्राइब करें",
}

MAX_VOCAB_CHARS = 600


def normalize_for_match(text: str) -> str:
    t = unicodedata.normalize("NFC", text).lower()
    t = re.sub(r"[^\w\s]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def build_prompt(base: str, vocabulary: str) -> str | None:
    """Whisper's initial prompt nudges spelling and style (e.g. drug names)."""
    terms = [t.strip() for t in re.split(r"[,\n;]+", vocabulary) if t.strip()]
    vocab = ", ".join(dict.fromkeys(terms))[:MAX_VOCAB_CHARS].strip(" ,")
    parts = [p for p in (base.strip(), f"Terms: {vocab}." if vocab else "") if p]
    return " ".join(parts) or None


def keep_segment(seg: dict) -> bool:
    text = seg.get("text", "").strip()
    if not text:
        return False
    no_speech = float(seg.get("no_speech_prob", 0.0))
    logprob = float(seg.get("avg_logprob", 0.0))
    compression = float(seg.get("compression_ratio", 1.0))
    if no_speech > 0.6 and logprob < -0.8:
        return False  # mostly silence
    if compression > 2.6:
        return False  # repetition loop ("the the the ...")
    if normalize_for_match(text) in HALLUCINATIONS and (no_speech > 0.3 or logprob < -0.6):
        return False
    return True


def join_segments(segments: list[dict]) -> str:
    return re.sub(r"\s+", " ", " ".join(s["text"].strip() for s in segments)).strip()
