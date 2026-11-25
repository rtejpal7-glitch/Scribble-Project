"""Test-only sentence checker: fixed corrections, no model. Never used by default."""

FIXES = {
    "Hi why am Rahul.": ("Hi I am Rahul.", "misheard 'I'"),
    "Patient ko do hafte se itching ho rahi hai.": ("Patient ko do hafte se itching ho rahi hai.", "unchanged"),
}


class StubSuggester:
    name = "stub"

    def describe(self):
        return {"backend": "stub", "model": "stub", "enabled": True}

    def suggest(self, language, sentences, context, medicines):
        out = []
        for s in sentences:
            if s["text"] in FIXES:
                out.append({"id": s["id"], "text": FIXES[s["text"]][0], "reason": FIXES[s["text"]][1]})
            if s["text"].startswith("Rewrite"):
                out.append({"id": s["id"], "text": "Something completely different and much longer than before", "reason": "x"})
        return out
