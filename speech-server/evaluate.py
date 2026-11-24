#!/usr/bin/env python3
"""Measure recognition accuracy on your own recordings.

Put pairs of files in a folder:

    samples/
      001_hinglish.wav   001_hinglish.txt   (reference transcript, UTF-8)
      002_hi.m4a         002_hi.txt
      003_en.wav         003_en.txt

The language mode is taken from the file name suffix (_en, _hi, _hinglish), or
from --mode. Any format ffmpeg/PyAV can read works (wav, m4a, mp3, ogg...).

    python evaluate.py samples/ --csv results.csv

Prints WER/CER per file and per mode, plus real-time factor. Nothing is sent
anywhere: the models run locally, exactly as the server runs them.
Compare transcripts in the same script (Roman vs Devanagari counts as wrong).
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
from collections import defaultdict
from pathlib import Path

from config import MODES, load_settings
from engines import FasterWhisperEngine
from wer import cer, wer

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".ogg", ".opus", ".flac", ".webm", ".aac"}


def mode_from_name(path: Path, default: str | None) -> str | None:
    stem = path.stem.lower()
    for mode in sorted(MODES, key=len, reverse=True):
        if stem.endswith("_" + mode) or stem.endswith("-" + mode):
            return mode
    return default


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", type=Path)
    ap.add_argument("--mode", choices=MODES, help="mode for files without a _mode suffix")
    ap.add_argument("--vocabulary", default="", help="comma-separated terms, same as the app setting")
    ap.add_argument("--csv", type=Path, help="write per-file results to this CSV")
    args = ap.parse_args()

    from faster_whisper.audio import decode_audio  # requires faster-whisper

    engine = FasterWhisperEngine(load_settings())
    rows = []
    for audio_path in sorted(p for p in args.folder.iterdir() if p.suffix.lower() in AUDIO_EXT):
        ref_path = audio_path.with_suffix(".txt")
        mode = mode_from_name(audio_path, args.mode)
        if not ref_path.exists() or mode is None:
            print(f"skip {audio_path.name}: {'no .txt reference' if not ref_path.exists() else 'unknown mode'}")
            continue
        audio = decode_audio(str(audio_path), sampling_rate=16000)
        duration = len(audio) / 16000
        t0 = time.perf_counter()
        out = engine.transcribe(audio, mode, interim=False, vocabulary=args.vocabulary)
        secs = time.perf_counter() - t0
        reference = ref_path.read_text(encoding="utf-8").strip()
        row = {
            "file": audio_path.name,
            "mode": mode,
            "model": out["model"],
            "duration_s": round(duration, 2),
            "rtf": round(secs / max(duration, 1e-6), 3),
            "wer": round(wer(reference, out["text"]), 4),
            "cer": round(cer(reference, out["text"]), 4),
            "reference": reference,
            "hypothesis": out["text"],
        }
        rows.append(row)
        print(f"{row['file']:<32} {mode:<9} WER {row['wer']:.1%}  CER {row['cer']:.1%}  RTF {row['rtf']}")
        print(f"   ref: {reference}\n   hyp: {out['text']}")

    if not rows:
        print("No samples found.")
        return 1
    by_mode = defaultdict(list)
    for r in rows:
        by_mode[r["mode"]].append(r)
    print("\nSummary (averaged per file)")
    for mode, rs in by_mode.items():
        avg = lambda k: sum(r[k] for r in rs) / len(rs)  # noqa: E731
        print(f"  {mode:<9} files={len(rs):<3} WER {avg('wer'):.1%}  CER {avg('cer'):.1%}  RTF {avg('rtf'):.2f}")
    if args.csv:
        with args.csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"Wrote {args.csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
