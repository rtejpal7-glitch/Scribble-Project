"""Sentence check: proposes corrections for transcribed sentences that don't make sense.

Example: speech "Hi I am Rahul" recognised as "Hi why am Rahul" -> suggests "Hi I am Rahul".

Runs a *local* language model (Ollama, or any OpenAI-compatible local server such
as llama.cpp / LM Studio / vLLM), so transcript text stays on your machine.
Results are suggestions only: the app shows them and the user decides.
Guards: suggestions that rewrite too much, change script/language, or are
identical are dropped here; numbers/medicine changes are flagged in the app.
"""

from __future__ import annotations

import difflib
import json
import re
import time
import urllib.error
import urllib.request
from typing import Protocol

LANGUAGE_DESCRIPTIONS = {
    "en-IN": "Indian English",
    "hi-IN": "Hindi written in Devanagari script",
    "hinglish": "Hinglish: Hindi and English mixed in one sentence, written in Roman (Latin) script",
}

SYSTEM_PROMPT = """You review sentences produced by automatic speech recognition of a doctor's dictation.
Language of the sentences: {language}.
Find sentences where the recogniser probably misheard a word, so the sentence does not make sense or is ungrammatical in context, and give the most likely intended sentence.
Rules:
- Change as few words as possible. Prefer words that sound like the recognised ones (e.g. "why am" -> "I am").
- Keep the same language and script. Never translate. Keep Hinglish as Hinglish in Roman script.
- Do not change numbers, doses, units, durations or medicine names unless they are clearly misheard, and never add new information or medical advice.
- If a sentence already makes sense, leave it out.
Return only JSON: {{"suggestions": [{{"id": "<id>", "text": "<corrected sentence>", "reason": "<few words>"}}]}}"""


class SuggestError(Exception):
    pass


class Suggester(Protocol):
    name: str

    def describe(self) -> dict: ...

    def suggest(self, language: str, sentences: list[dict], context: list[str], medicines: list[str]) -> list[dict]: ...


def _latin_ratio(s: str) -> float:
    lat = len(re.findall(r"[A-Za-z]", s))
    dev = len(re.findall(r"[ऀ-ॿ]", s))
    return lat / max(1, lat + dev)


def _norm(s: str) -> str:
    return re.sub(r"[^\w\s]", "", s.lower()).split().__str__()


def validate(sentences: list[dict], raw: list[dict]) -> list[dict]:
    """Keep only small, same-script corrections for sentences that were asked about."""
    by_id = {s["id"]: s["text"] for s in sentences}
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        sid, text = item.get("id"), item.get("text")
        if sid not in by_id or not isinstance(text, str):
            continue
        original, text = by_id[sid], text.strip()
        if not text or _norm(text) == _norm(original):
            continue
        if abs(_latin_ratio(text) - _latin_ratio(original)) > 0.4:
            continue  # changed script / translated
        ratio = difflib.SequenceMatcher(None, original.lower(), text.lower()).ratio()
        if ratio < 0.55 or len(text) > len(original) * 1.6 + 12:
            continue  # rewrote the sentence rather than fixing a word
        reason = item.get("reason")
        out.append({"id": sid, "text": text, "reason": reason.strip()[:120] if isinstance(reason, str) else ""})
    return out


def _messages(language: str, sentences: list[dict], context: list[str], medicines: list[str]) -> list[dict]:
    user = {"sentences": sentences}
    if context:
        user["previous_sentences_for_context"] = context[-4:]
    if medicines:
        user["known_medicine_names"] = medicines[:200]
    return [
        {"role": "system", "content": SYSTEM_PROMPT.format(language=LANGUAGE_DESCRIPTIONS.get(language, language))},
        {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
    ]


def _post_json(url: str, payload: dict, timeout: float, headers: dict | None = None) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        model = payload.get("model", "")
        if e.code == 404 and model:
            raise SuggestError(
                f"The language model '{model}' is not installed. Run: ollama pull {model} "
                f"(or set SUGGEST_MODEL in speech-server/.env to a model you have; 'ollama list' shows them)."
            ) from e
        raise SuggestError(f"Language model server returned HTTP {e.code}.") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        reason = getattr(e, "reason", e)
        if "timed out" in str(reason).lower():
            raise SuggestError(
                "The language model took too long to answer. It may still be loading; try again in a minute."
            ) from e
        raise SuggestError(f"Cannot reach the language model at {url}: {reason}") from e
    except json.JSONDecodeError as e:
        raise SuggestError("Language model server returned invalid JSON.") from e


def _parse_suggestions(content: str) -> list[dict]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", content, re.S)
        if not m:
            raise SuggestError("Model reply was not JSON.")
        data = json.loads(m.group(0))
    items = data.get("suggestions", []) if isinstance(data, dict) else data
    return items if isinstance(items, list) else []


class OllamaSuggester:
    """Ollama (https://ollama.com): `ollama pull qwen2.5:7b-instruct`."""

    name = "ollama"

    # The first request also loads the model into memory, which can take a
    # minute on a laptop; later requests are fast while the model stays loaded.
    def __init__(self, url: str, model: str, timeout: float = 120.0):
        self.url, self.model, self.timeout = url.rstrip("/"), model, timeout

    def describe(self) -> dict:
        return {"backend": self.name, "model": self.model, "enabled": True}

    def warm_up(self) -> None:
        """Load the model now (an empty prompt only loads it), so the first check is quick."""
        try:
            _post_json(f"{self.url}/api/generate", {"model": self.model, "keep_alive": "30m"}, self.timeout)
            print(f"Sentence check model {self.model} is loaded.", flush=True)
        except SuggestError as e:
            print(f"Sentence check model not ready yet: {e}", flush=True)

    def suggest(self, language, sentences, context, medicines):
        out = _post_json(
            f"{self.url}/api/chat",
            {
                "model": self.model,
                "messages": _messages(language, sentences, context, medicines),
                "stream": False,
                "format": "json",
                "keep_alive": "30m",
                "options": {"temperature": 0},
            },
            self.timeout,
        )
        return _parse_suggestions(out.get("message", {}).get("content", ""))


class OpenAICompatibleSuggester:
    """Any local OpenAI-compatible server (llama.cpp server, LM Studio, vLLM)."""

    name = "openai-compatible"

    def __init__(self, url: str, model: str, api_key: str = "", timeout: float = 30.0):
        self.url, self.model, self.api_key, self.timeout = url.rstrip("/"), model, api_key, timeout

    def describe(self) -> dict:
        return {"backend": self.name, "model": self.model, "enabled": True}

    def suggest(self, language, sentences, context, medicines):
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else None
        out = _post_json(
            f"{self.url}/v1/chat/completions",
            {
                "model": self.model,
                "messages": _messages(language, sentences, context, medicines),
                "temperature": 0,
                "response_format": {"type": "json_object"},
            },
            self.timeout,
            headers,
        )
        try:
            content = out["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise SuggestError("Unexpected reply from the language model server.") from e
        return _parse_suggestions(content)


def load_suggester(backend: str, url: str, model: str, api_key: str = "") -> Suggester | None:
    spec = (backend or "").strip()
    backend = spec.lower()
    if backend in ("", "off", "none"):
        return None
    if backend == "ollama":
        return OllamaSuggester(url or "http://127.0.0.1:11434", model or "qwen2.5:7b-instruct")
    if backend in ("openai", "openai-compatible"):
        return OpenAICompatibleSuggester(url or "http://127.0.0.1:8080", model or "local-model", api_key)
    if ":" in spec:  # module:Class (tests)
        module_name, _, cls_name = spec.partition(":")
        module = __import__(module_name, fromlist=[cls_name])
        return getattr(module, cls_name)()
    raise ValueError(f"Unknown SUGGEST_BACKEND '{backend}'")


def run_suggest(suggester: Suggester, body: dict) -> dict:
    """Validates a request body, calls the model, validates the reply."""
    language = body.get("language")
    if language not in LANGUAGE_DESCRIPTIONS:
        raise ValueError("language must be en-IN, hi-IN or hinglish")
    sentences = body.get("sentences")
    if not isinstance(sentences, list) or not sentences or len(sentences) > 20:
        raise ValueError("sentences must be a list of 1-20 items")
    clean = []
    for s in sentences:
        if not isinstance(s, dict) or not isinstance(s.get("id"), str) or not isinstance(s.get("text"), str):
            raise ValueError("each sentence needs string id and text")
        if s["text"].strip():
            clean.append({"id": s["id"][:64], "text": s["text"].strip()[:500]})
    context = [c[:500] for c in body.get("context", []) if isinstance(c, str)][:4]
    medicines = [m[:60] for m in body.get("medicines", []) if isinstance(m, str)][:200]
    started = time.perf_counter()
    raw = suggester.suggest(language, clean, context, medicines) if clean else []
    return {"suggestions": validate(clean, raw), "model": suggester.describe().get("model"), "llm_ms": int((time.perf_counter() - started) * 1000)}
