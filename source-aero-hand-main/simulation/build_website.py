#!/usr/bin/env python3
"""Convenience runner for simulation/site_src/build.py"""
import sys
from pathlib import Path

SRC_BUILD = Path(__file__).resolve().parent / "site_src" / "build.py"
if __name__ == "__main__":
    import runpy
    sys.argv[0] = str(SRC_BUILD)
    runpy.run_path(str(SRC_BUILD), run_name="__main__")
