#!/usr/bin/env python3
"""Assemble the hosted demo into one self-contained HTML file.

    python3 tools/export_demo.py > demo/data.b64
    node demo/verify.mjs
    python3 demo/build.py

Published pages cannot fetch anything, so the season payload and the app
script are inlined. `demo/index.html` is generated -- edit `template.html`
and `app.js`.
"""

from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> None:
    template = (HERE / "template.html").read_text()
    app_js = (HERE / "app.js").read_text()
    payload = (HERE / "data.b64").read_text().strip()

    for name, blob in (("app.js", app_js), ("data.b64", payload)):
        if "</script" in blob.lower():
            raise SystemExit(f"{name} contains a closing script tag and cannot be inlined")

    html = template.replace("{{PAYLOAD}}", payload).replace("{{APP_JS}}", app_js)
    out = HERE / "index.html"
    out.write_text(html)
    print(f"wrote {out}  ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
