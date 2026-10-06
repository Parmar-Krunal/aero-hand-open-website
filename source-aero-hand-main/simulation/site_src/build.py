#!/usr/bin/env python3
"""
Aero Hand Open -- Website Compiler & Bundler
=============================================
Compiles modular HTML sections, CSS tokens, and JavaScript modules from `site_src/`
into the unified, high-performance production webpage:
  - simulation/aero_hand_website.html (Standalone website)
  - simulation/index.html (Website entry point)

Usage:
  python build.py            # Compile once
  python build.py --watch    # Watch for changes and recompile automatically
"""
from __future__ import annotations
import argparse
import re
import sys
import time
from pathlib import Path

# Safe stdout on Windows
if sys.platform == "win32":
    import io
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SITE_SRC = Path(__file__).resolve().parent
SIM_DIR = SITE_SRC.parent
TEMPLATE_PATH = SITE_SRC / "template.html"
STYLES_DIR = SITE_SRC / "styles"
SECTIONS_DIR = SITE_SRC / "sections"
SCRIPTS_DIR = SITE_SRC / "scripts"

OUT_FLAGSHIP = SIM_DIR / "aero_hand_website.html"
OUT_INDEX = SIM_DIR / "index.html"


def compile_site() -> str:
    print("[Compiler] Reading template.html...")
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Template not found: {TEMPLATE_PATH}")

    html = TEMPLATE_PATH.read_text(encoding="utf-8")

    # 1. Bundle Stylesheets
    css_chunks = []
    style_order = ["theme.css", "components.css", "twin_dashboard.css"]
    for fname in style_order:
        fpath = STYLES_DIR / fname
        if fpath.exists():
            print(f"  + Bundling CSS: styles/{fname}")
            css_chunks.append(f"/* === {fname} === */\n" + fpath.read_text(encoding="utf-8"))
        else:
            print(f"  ! Warning: CSS not found: {fpath}")

    # Also catch any other CSS files in styles/
    for extra_f in sorted(STYLES_DIR.glob("*.css")):
        if extra_f.name not in style_order:
            print(f"  + Bundling extra CSS: styles/{extra_f.name}")
            css_chunks.append(f"/* === {extra_f.name} === */\n" + extra_f.read_text(encoding="utf-8"))

    combined_css = "\n\n".join(css_chunks)
    style_tag = f"<style>\n{combined_css}\n</style>"
    html = html.replace("<!-- INJECT:STYLES -->", style_tag)

    # 2. Inject Sections
    section_files = sorted(SECTIONS_DIR.glob("*.html"))
    for sec_path in section_files:
        sec_name = sec_path.stem  # e.g., "02_overview"
        slot = f"<!-- INJECT:SECTION:{sec_name} -->"
        if slot in html:
            print(f"  + Injecting Section: {sec_name}")
            sec_content = sec_path.read_text(encoding="utf-8")
            html = html.replace(slot, sec_content)
        else:
            print(f"  ! Note: Slot {slot} not explicitly found, appending to main content")
            html = html.replace("</main>", f"  {sec_path.read_text(encoding='utf-8')}\n</main>")

    # 3. Bundle Scripts
    js_chunks = []
    script_order = ["core.js", "digital_twin.js", "cad_viewer.js"]
    for sname in script_order:
        spath = SCRIPTS_DIR / sname
        if spath.exists():
            print(f"  + Bundling Script: scripts/{sname}")
            js_chunks.append(f"// === {sname} ===\n" + spath.read_text(encoding="utf-8"))
        else:
            print(f"  ! Warning: Script not found: {spath}")

    for extra_js in sorted(SCRIPTS_DIR.glob("*.js")):
        if extra_js.name not in script_order:
            print(f"  + Bundling extra Script: scripts/{extra_js.name}")
            js_chunks.append(f"// === {extra_js.name} ===\n" + extra_js.read_text(encoding="utf-8"))

    combined_js = "\n\n".join(js_chunks)
    script_tag = f"<script>\n{combined_js}\n</script>"
    html = html.replace("<!-- INJECT:SCRIPTS -->", script_tag)

    # Clean un-injected slots if any remain
    html = re.sub(r'<!--\s*INJECT:[^>]+-->', '', html)

    # Write Outputs
    OUT_FLAGSHIP.write_text(html, encoding="utf-8")
    print(f"[Compiler] Wrote: {OUT_FLAGSHIP} ({OUT_FLAGSHIP.stat().st_size:,} bytes)")

    OUT_INDEX.write_text(html, encoding="utf-8")
    print(f"[Compiler] Wrote: {OUT_INDEX} ({OUT_INDEX.stat().st_size:,} bytes)")

    return html


def watch_mode():
    print(f"[Compiler] Watching {SITE_SRC} for file modifications...")
    compile_site()

    last_mtimes = {}
    for p in SITE_SRC.rglob("*"):
        if p.is_file():
            last_mtimes[p] = p.stat().st_mtime

    try:
        while True:
            time.sleep(1.0)
            changed = False
            for p in list(SITE_SRC.rglob("*")):
                if p.is_file():
                    mtime = p.stat().st_mtime
                    if p not in last_mtimes or mtime > last_mtimes[p]:
                        last_mtimes[p] = mtime
                        changed = True
                        print(f"[Compiler] Detected change in: {p.relative_to(SITE_SRC)}")

            if changed:
                print("[Compiler] Recompiling website...")
                compile_site()
    except KeyboardInterrupt:
        print("\n[Compiler] Watch stopped.")


def main():
    parser = argparse.ArgumentParser(description="Aero Hand Open Website Compiler")
    parser.add_argument("--watch", action="store_true", help="Watch for changes and auto-compile")
    args = parser.parse_args()

    if args.watch:
        watch_mode()
    else:
        compile_site()
        print("\n[Compiler] Build successful!")


if __name__ == "__main__":
    main()
