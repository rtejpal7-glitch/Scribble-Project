"""Test-only report generator: returns a fixed report, including items that are
NOT in the transcript so the grounding checks can be tested. Never used by default."""


class StubReporter:
    name = "stub"

    def describe(self):
        return {"backend": "stub", "model": "stub-report", "enabled": True}

    def generate(self, language, transcript, medicines):
        return {
            "patient": {"name": "Rahul", "age": 32, "sex": "male"},
            "chief_complaints": [{"complaint": "Itching", "duration": "2 weeks"}, "Rash on arms"],
            "history": "Itching for two weeks, worse at night.",
            "examination": "Red papules on both forearms.",
            "diagnosis": [
                {"text": "Allergic dermatitis", "source": "allergic dermatitis lag raha hai"},
                {"text": "Psoriasis", "source": "plaque psoriasis"},
            ],
            "medicines": [
                {"name": "Cetirizine", "strength": "10 mg", "dose": "1 tablet", "frequency": "at night",
                 "timing": "after food", "duration": "5 days", "route": "oral", "instructions": "",
                 "source": "cetirizine 10 mg raat ko khane ke baad paanch din"},
                {"name": "Mometasone cream", "strength": "", "dose": "thin layer", "frequency": "twice daily",
                 "timing": "", "duration": "2 weeks", "route": "topical", "instructions": "",
                 "source": "mometasone cream din mein do baar do hafte"},
                {"name": "Prednisolone", "strength": "40 mg", "dose": "", "frequency": "once daily",
                 "timing": "", "duration": "10 days", "route": "oral", "instructions": "", "source": ""},
            ],
            "investigations": ["CBC", ""],
            "advice": ["Avoid hot water baths"],
            "follow_up": "After 2 weeks",
            "unclear": ["'jalan wala' - unclear which area"],
        }
