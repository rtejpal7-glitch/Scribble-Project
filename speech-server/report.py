"""Consultation report: turns a dictated transcript into a structured clinical note.

The doctor dictates the consultation (complaints, findings, diagnosis, medicines
with doses and durations). A *local* language model (same backend as the
sentence check) organises what was said into sections. It must not add
anything that was not dictated, and this module double-checks that:

* every medicine and diagnosis carries a "source" quote that must be found in
  the transcript (fuzzy match, because recognition is imperfect);
* every medicine name must itself be found in the transcript;
* numbers in strength / duration must appear in the transcript (as digits or
  as English / Hinglish / Hindi number words).

Items that fail a check are returned with flags so the app can highlight them
for the doctor. The report is a draft for the doctor to review and edit; it is
never used without review.
"""

from __future__ import annotations

import difflib
import json
import re
import time
from typing import Protocol

from suggest import LANGUAGE_DESCRIPTIONS, SuggestError, _post_json

MAX_TRANSCRIPT_CHARS = 30000

SYSTEM_PROMPT = """You turn a doctor's dictated consultation into a structured clinical note.
The text comes from automatic speech recognition, so it can contain misheard words and rough grammar. Language of the dictation: {language}.

Rules:
- Use ONLY what is said in the transcript. Never add a diagnosis, medicine, dose, test, advice or follow-up that was not said. If something is not mentioned, leave it empty ("" or []).
- Write the note in clear, concise clinical English. Translate Hindi / Hinglish phrases into English, but copy medicine names, strengths, doses, numbers and durations exactly as said (convert number words to digits, e.g. "do hafte" -> "2 weeks", "paanch din" -> "5 days").
- Diagnosis: only what the doctor stated as the diagnosis or impression. Add "(provisional)" only if the doctor said so.
- Medicines: one entry per medicine. frequency examples: "once daily", "twice daily", "1-0-1", "at night", "SOS". timing examples: "after food", "before food", "empty stomach". route examples: "oral", "topical", "eye drops". Leave a field empty if it was not said.
- For every diagnosis and medicine, "source" must be the exact words from the transcript it came from (copy them, do not translate).
- Patient name, age and sex only if they were said.
- Put anything you could not understand, that seems misheard, or that contradicts itself into "unclear" (quote the transcript words and say briefly what is unclear).
Return only JSON with exactly this shape:
{{"patient": {{"name": "", "age": "", "sex": ""}},
 "chief_complaints": [{{"complaint": "", "duration": ""}}],
 "history": "",
 "examination": "",
 "diagnosis": [{{"text": "", "source": ""}}],
 "medicines": [{{"name": "", "strength": "", "dose": "", "frequency": "", "timing": "", "duration": "", "route": "", "instructions": "", "source": ""}}],
 "investigations": [""],
 "advice": [""],
 "follow_up": "",
 "unclear": [""]}}"""


class Reporter(Protocol):
    name: str

    def describe(self) -> dict: ...

    def generate(self, language: str, transcript: str, medicines: list[str]) -> dict: ...


def _messages(language: str, transcript: str, medicines: list[str]) -> list[dict]:
    user = {"transcript": transcript}
    if medicines:
        user["known_medicine_names"] = medicines[:300]
    return [
        {"role": "system", "content": SYSTEM_PROMPT.format(language=LANGUAGE_DESCRIPTIONS.get(language, language))},
        {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
    ]


def _parse(content: str) -> dict:
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?|```$", "", content, flags=re.M).strip()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", content, re.S)
        if not m:
            raise SuggestError("The language model did not return a report.")
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError as e:
            raise SuggestError("The language model returned an unreadable report.") from e
    if not isinstance(data, dict):
        raise SuggestError("The language model returned an unreadable report.")
    return data


class OllamaReporter:
    name = "ollama"

    def __init__(self, url: str, model: str, timeout: float = 300.0):
        self.url, self.model, self.timeout = url.rstrip("/"), model, timeout

    def describe(self) -> dict:
        return {"backend": self.name, "model": self.model, "enabled": True}

    def generate(self, language, transcript, medicines):
        out = _post_json(
            f"{self.url}/api/chat",
            {
                "model": self.model,
                "messages": _messages(language, transcript, medicines),
                "stream": False,
                "format": "json",
                "keep_alive": "10m",
                # Long consultations need a bigger context than Ollama's default.
                "options": {"temperature": 0, "num_ctx": 8192},
            },
            self.timeout,
        )
        return _parse(out.get("message", {}).get("content", ""))


class OpenAICompatibleReporter:
    name = "openai-compatible"

    def __init__(self, url: str, model: str, api_key: str = "", timeout: float = 300.0):
        self.url, self.model, self.api_key, self.timeout = url.rstrip("/"), model, api_key, timeout

    def describe(self) -> dict:
        return {"backend": self.name, "model": self.model, "enabled": True}

    def generate(self, language, transcript, medicines):
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else None
        out = _post_json(
            f"{self.url}/v1/chat/completions",
            {
                "model": self.model,
                "messages": _messages(language, transcript, medicines),
                "temperature": 0,
                "response_format": {"type": "json_object"},
            },
            self.timeout,
            headers,
        )
        try:
            return _parse(out["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as e:
            raise SuggestError("Unexpected reply from the language model server.") from e


def load_reporter(backend: str, url: str, model: str, api_key: str = "") -> Reporter | None:
    spec = (backend or "").strip()
    backend = spec.lower()
    if backend in ("", "off", "none"):
        return None
    if backend == "ollama":
        return OllamaReporter(url or "http://127.0.0.1:11434", model or "qwen2.5:7b-instruct")
    if backend in ("openai", "openai-compatible"):
        return OpenAICompatibleReporter(url or "http://127.0.0.1:8080", model or "local-model", api_key)
    if ":" in spec:  # module:Class (tests)
        module_name, _, cls_name = spec.partition(":")
        module = __import__(module_name, fromlist=[cls_name])
        return getattr(module, cls_name)()
    raise ValueError(f"Unknown REPORT_BACKEND '{backend}'")


# --------------------------------------------------------------------------- #
# Grounding checks
# --------------------------------------------------------------------------- #

NUMBER_WORDS = {
    # English
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "hundred": 100, "half": 0.5, "once": 1, "twice": 2, "thrice": 3, "single": 1, "double": 2,
    # Hinglish (Roman)
    "ek": 1, "do": 2, "teen": 3, "tin": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "chhe": 6, "che": 6, "chheh": 6,
    "saat": 7, "sat": 7, "aath": 8, "ath": 8, "nau": 9, "das": 10, "gyarah": 11, "barah": 12, "baarah": 12, "pandrah": 15,
    "bees": 20, "tees": 30, "chalis": 40, "pachas": 50, "sau": 100, "aadha": 0.5, "adha": 0.5, "dedh": 1.5, "dhai": 2.5,
    # Hindi (Devanagari)
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
    "बारह": 12, "पंद्रह": 15, "बीस": 20, "तीस": 30, "सौ": 100, "आधा": 0.5, "डेढ़": 1.5, "ढाई": 2.5,
}
# Units implied by a word ("hafta" = 7 days etc.) let "1 week" match "ek hafta".
_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def _norm_text(s: str) -> str:
    s = s.translate(_DEVANAGARI_DIGITS).lower()
    s = re.sub(r"[^\w\s.]", " ", s)
    s = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _numbers_in(s: str) -> set[float]:
    norm = _norm_text(s)
    out: set[float] = set()
    for m in re.findall(r"\d+(?:\.\d+)?", norm):
        try:
            out.add(float(m))
        except ValueError:
            pass
    for w in norm.split():
        if w in NUMBER_WORDS:
            out.add(float(NUMBER_WORDS[w]))
    return out


def _find(needle: str, words: list[str], threshold: float) -> bool:
    """Fuzzy search: does `needle` (roughly) occur as a run of words in `words`?"""
    target = _norm_text(needle).split()
    if not target:
        return False
    n = len(target)
    joined_target = " ".join(target)
    if n == 1 and len(joined_target) < 3:
        return joined_target in words
    best = 0.0
    for size in {max(1, n - 1), n, n + 1}:
        for i in range(0, max(1, len(words) - size + 1)):
            window = " ".join(words[i : i + size])
            if abs(len(window) - len(joined_target)) > max(4, len(joined_target) * 0.5):
                continue
            r = difflib.SequenceMatcher(None, joined_target, window, autojunk=False).ratio()
            if r > best:
                best = r
                if best >= threshold:
                    return True
    return False


def _s(v, limit: int = 400) -> str:
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        v = str(v)
    if not isinstance(v, str):
        return ""
    return re.sub(r"\s+", " ", v).strip()[:limit]


def _list(v, limit: int = 30) -> list:
    return v[:limit] if isinstance(v, list) else []


def sanitise(raw: dict, transcript: str) -> dict:
    """Coerce the model's JSON into the report shape and add grounding flags."""
    words = _norm_text(transcript).split()
    transcript_numbers = _numbers_in(transcript)
    patient = raw.get("patient") if isinstance(raw.get("patient"), dict) else {}

    complaints = []
    for c in _list(raw.get("chief_complaints")):
        if isinstance(c, str):
            c = {"complaint": c}
        if isinstance(c, dict) and _s(c.get("complaint")):
            complaints.append({"complaint": _s(c.get("complaint"), 200), "duration": _s(c.get("duration"), 80)})

    diagnosis = []
    for d in _list(raw.get("diagnosis"), 10):
        if isinstance(d, str):
            d = {"text": d}
        if not isinstance(d, dict) or not _s(d.get("text")):
            continue
        source = _s(d.get("source"), 300)
        flags = [] if source and _find(source, words, 0.72) else ["source-not-found"]
        diagnosis.append({"text": _s(d.get("text"), 200), "source": source, "flags": flags})

    medicines = []
    for m in _list(raw.get("medicines"), 25):
        if not isinstance(m, dict) or not _s(m.get("name")):
            continue
        item = {k: _s(m.get(k), 160) for k in ("name", "strength", "dose", "frequency", "timing", "duration", "route", "instructions")}
        item["source"] = _s(m.get("source"), 300)
        flags = []
        if not _find(item["name"], words, 0.75):
            flags.append("name-not-in-transcript")
        if not item["source"] or not _find(item["source"], words, 0.72):
            flags.append("source-not-found")
        spoken = _numbers_in(item["strength"] + " " + item["duration"])
        # "1 week" may be said as "7 din"; accept either side of week/day conversions.
        alt = {x * 7 for x in transcript_numbers} | {x / 7 for x in transcript_numbers}
        if any(n not in transcript_numbers and n not in alt for n in spoken):
            flags.append("number-not-in-transcript")
        item["flags"] = flags
        medicines.append(item)

    def strings(key: str, limit: int = 20) -> list[str]:
        return [x for x in (_s(v, 300) for v in _list(raw.get(key), limit)) if x]

    return {
        "patient": {"name": _s(patient.get("name"), 80), "age": _s(patient.get("age"), 20), "sex": _s(patient.get("sex"), 20)},
        "chief_complaints": complaints,
        "history": _s(raw.get("history"), 2000),
        "examination": _s(raw.get("examination"), 2000),
        "diagnosis": diagnosis,
        "medicines": medicines,
        "investigations": strings("investigations"),
        "advice": strings("advice"),
        "follow_up": _s(raw.get("follow_up"), 200),
        "unclear": strings("unclear", 15),
    }


def run_report(reporter: Reporter, body: dict) -> dict:
    language = body.get("language")
    if language not in LANGUAGE_DESCRIPTIONS:
        raise ValueError("language must be en-IN, hi-IN or hinglish")
    transcript = body.get("transcript")
    if not isinstance(transcript, str) or not transcript.strip():
        raise ValueError("transcript must be non-empty text")
    transcript = transcript.strip()
    if len(transcript) > MAX_TRANSCRIPT_CHARS:
        raise ValueError(f"transcript is longer than {MAX_TRANSCRIPT_CHARS} characters")
    medicines = [m[:60] for m in body.get("medicines", []) if isinstance(m, str)][:300]
    started = time.perf_counter()
    raw = reporter.generate(language, transcript, medicines)
    return {
        "report": sanitise(raw, transcript),
        "model": reporter.describe().get("model"),
        "llm_ms": int((time.perf_counter() - started) * 1000),
    }
