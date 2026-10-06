#!/usr/bin/env python3
"""Validate HTML IDs and literal JavaScript DOM lookups across the website."""
from __future__ import annotations

from collections import defaultdict
from html.parser import HTMLParser
import re
from pathlib import Path

SITE_SRC = Path(__file__).resolve().parent
DOM_LOOKUP_RE = re.compile(
    r"""document\.getElementById\(\s*(['"])([^'"]+)\1\s*\)"""
)

# These controls belong to an optional CAD/webcam layout not included in the
# current page. Their lookups are guarded, so their absence is intentional.
OPTIONAL_DOM_IDS = {
    "cadFingerPreset",
    "cadFingerPosition",
    "cadThumbPosition",
    "cadFingerPositionValue",
    "cadThumbPositionValue",
    "btnResetCadPose",
    "btnApplyCadPose",
    "btnOpenWebcamCalibration",
    "cadEditStatus",
    "btnCadStepMode",
    "btnCadUrdfMode",
    "cadManualControls",
    "cadWebcamControls",
    "cadWorkspaceNote",
    "cadWebcamStatusDot",
    "cadWebcamStatusText",
    "cadWebcamPlaceholder",
    "cadWebcamVideo",
    "cadWebcamLandmarkCanvas",
}


class HtmlIdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[tuple[str, int]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name == "id" and value:
                self.ids.append((value, self.getpos()[0]))

    handle_startendtag = handle_starttag


def validate(site_src: Path = SITE_SRC) -> bool:
    html_ids: dict[str, list[tuple[Path, int]]] = defaultdict(list)
    for html_file in sorted(site_src.rglob("*.html")):
        parser = HtmlIdParser()
        parser.feed(html_file.read_text(encoding="utf-8"))
        for elem_id, line in parser.ids:
            html_ids[elem_id].append((html_file, line))
    print(f"[Validator] Found {len(html_ids)} unique HTML IDs.")

    js_lookups: dict[str, list[tuple[Path, int]]] = defaultdict(list)
    for js_file in sorted((site_src / "scripts").glob("*.js")):
        content = js_file.read_text(encoding="utf-8")
        for match in DOM_LOOKUP_RE.finditer(content):
            elem_id = match.group(2)
            line = content.count("\n", 0, match.start()) + 1
            js_lookups[elem_id].append((js_file, line))
    print(f"[Validator] Found {sum(map(len, js_lookups.values()))} literal JavaScript DOM lookups.")

    missing = sorted(elem_id for elem_id in js_lookups if elem_id not in html_ids and elem_id not in OPTIONAL_DOM_IDS)
    duplicates = {
        elem_id: locations
        for elem_id, locations in html_ids.items()
        if len(locations) > 1
    }
    optional_missing = sorted(elem_id for elem_id in js_lookups if elem_id not in html_ids and elem_id in OPTIONAL_DOM_IDS)

    if optional_missing:
        print("[Validator] [WARN] Optional CAD/webcam controls are not present in this page:")
        for elem_id in optional_missing:
            print(f"  - #{elem_id}")

    if duplicates:
        print("[Validator] [FAIL] Duplicate HTML IDs:")
        for elem_id, locations in sorted(duplicates.items()):
            formatted = ", ".join(f"{path.relative_to(site_src)}:{line}" for path, line in locations)
            print(f"  - #{elem_id} ({formatted})")

    if missing:
        print("[Validator] [FAIL] JavaScript lookups have no matching HTML ID:")
        for elem_id in missing:
            locations = ", ".join(
                f"{path.relative_to(site_src)}:{line}"
                for path, line in js_lookups[elem_id]
            )
            print(f"  - #{elem_id} (looked up in {locations})")

    if duplicates or missing:
        return False

    print("[Validator] [PASS] No missing required DOM IDs or duplicate HTML IDs.")
    return True


def main() -> int:
    return 0 if validate() else 1


if __name__ == "__main__":
    raise SystemExit(main())
