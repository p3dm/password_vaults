from __future__ import annotations

from dataclasses import dataclass

from app.controller.autofill_rule import find_candidates as fc


@dataclass(frozen=True)
class AutofillContext:
    source: str
    domain: str | None = None
    url: str | None = None
    process_name: str | None = None
    window_title: str | None = None


def build_match_request(context: AutofillContext) -> list[tuple[str, str]]:
    if context.source == "browser":
        requests = []
        if context.url:
            requests.append(("exact_url", context.url))
        if context.domain:
            requests.append(("domain", context.domain))
        return requests
    elif context.source == "desktop":
        requests = []
        if context.process_name:
            requests.append(("process_name", context.process_name))
        if context.window_title:
            requests.append(("window_title_regex", context.window_title))
        return requests

    return []

def find_candidates(context: AutofillContext) -> list[dict]:
    match_request = build_match_request(context)
    seen_ids = set()
    candidates = []
    for match_type, match_value in match_request:
        result = fc(match_type, match_value)
        for credential in result:
            if credential.credential_id not in seen_ids:
                seen_ids.add(credential.credential_id)
                candidates.append(credential)
    return candidates
