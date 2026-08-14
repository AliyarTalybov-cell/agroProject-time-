#!/usr/bin/env python3
import json
import re
import sys


def extract_text(payload):
    try:
        return json.dumps(payload, ensure_ascii=False)
    except Exception:
        return ""


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"permission": "allow"}))
        return

    try:
        payload = json.loads(raw)
    except Exception:
        print(json.dumps({"permission": "allow"}))
        return

    text = extract_text(payload).lower()
    ui_hint = bool(
        re.search(
            r"(frontend|ui|верстк|layout|modal|button|icon|widget|menu|page|screen|tsx|css|scss)",
            text,
        )
    )

    if ui_hint:
        message = (
            "Preflight before UI work: read .cursor/rules/architecture-and-compatibility.mdc "
            "and .cursor/rules/pr-safety-checklist.mdc, then reuse existing project patterns."
        )
        print(json.dumps({"permission": "allow", "agent_message": message}, ensure_ascii=False))
    else:
        print(json.dumps({"permission": "allow"}))


if __name__ == "__main__":
    main()
