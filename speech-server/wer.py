"""Word / character error rate with normalisation suitable for English, Hindi and Hinglish.

Must stay consistent with src/recognition/speech/evaluation.ts in the frontend.
"""

from __future__ import annotations

import re
import unicodedata

# Latin punctuation plus the Devanagari danda / double danda.
_PUNCT = re.compile(r"[।॥.,!?;:\"'“”‘’()\[\]{}<>/\\|@#$%^&*_+=~`-]+")


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFC", text).lower()
    t = _PUNCT.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def _edit_distance(ref: list[str], hyp: list[str]) -> int:
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1]


def wer(reference: str, hypothesis: str) -> float:
    ref, hyp = normalize(reference).split(), normalize(hypothesis).split()
    if not ref:
        return 0.0 if not hyp else 1.0
    return _edit_distance(ref, hyp) / len(ref)


def cer(reference: str, hypothesis: str) -> float:
    ref = list(normalize(reference).replace(" ", ""))
    hyp = list(normalize(hypothesis).replace(" ", ""))
    if not ref:
        return 0.0 if not hyp else 1.0
    return _edit_distance(ref, hyp) / len(ref)
