#!/usr/bin/env python3
"""Assemble the published demo into one self-contained HTML file.

    python3 tools/export_demo.py > demo/data.b64
    node demo/verify.mjs
    python3 demo/build.py

The demo is the same interface the app serves, from the same files in `ui/`.
Only two things change: a published page cannot fetch anything, so the
stylesheet, the script and the season payload are inlined; and the live data
source is swapped for the static one. Nothing here is a second front end --
edit `ui/`.
"""

from __future__ import annotations

import base64
from pathlib import Path

HERE = Path(__file__).resolve().parent
UI = HERE.parent / "ui"


def inlineable(name: str, blob: str) -> str:
    if "</script" in blob.lower():
        raise SystemExit(f"{name} contains a closing script tag and cannot be inlined")
    return blob


def main() -> None:
    html = (UI / "index.html").read_text()
    styles = (UI / "styles.css").read_text()
    app_js = inlineable("app.js", (UI / "app.js").read_text())
    source_js = inlineable("source-static.js", (UI / "source-static.js").read_text())
    payload = inlineable("data.b64", (HERE / "data.b64").read_text().strip())

    # A published page cannot fetch anything, so the icon becomes a data URI.
    icon = base64.b64encode((UI / "favicon.svg").read_bytes()).decode()
    html = html.replace(
        '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
        f'<link rel="icon" href="data:image/svg+xml;base64,{icon}">',
    )
    html = html.replace(
        '<link rel="stylesheet" href="/styles.css">',
        f"<style>\n{styles}\n</style>",
    )
    html = html.replace(
        '<script src="/app.js"></script>\n<script src="/source-live.js"></script>',
        f'<script id="payload" type="text/plain">{payload}</script>\n'
        f"<script>{app_js}</script>\n"
        f"<script>{source_js}</script>",
    )
    if "{{" in html or "/app.js" in html:
        raise SystemExit("build did not fully inline the page")

    out = HERE / "index.html"
    out.write_text(html)
    print(f"wrote {out}  ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
