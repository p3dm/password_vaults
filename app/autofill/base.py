from __future__ import annotations
from typing import Protocol, runtime_checkable
from app.autofill_matcher import AutofillContext

@runtime_checkable
class AutofillAdapter(Protocol):
    def get_context(self) -> AutofillContext:
        ...
    def fill(self, username: str, password: str) -> None:
        ...