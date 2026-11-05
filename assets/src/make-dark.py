#!/usr/bin/env python3
"""Write assets/architecture-dark.svg from assets/architecture-light.svg.

Only the first <style> block (the THEME block) differs between the two files, so edit the light
SVG and rerun:  python3 assets/src/make-dark.py
"""
import pathlib
import re

ASSETS = pathlib.Path(__file__).resolve().parent.parent

DARK_THEME = """<style>
    .bg     { fill: #0d1117; }
    .box    { fill: #161b22; stroke: #8b949e; }
    .sub    { fill: #0d1117; stroke: #6e7681; }
    .lane   { fill: none; stroke: #6e7681; }
    .line   { fill: none; stroke: #8b949e; }
    .dash   { fill: none; stroke: #6e7681; }
    .edge   { fill: none; stroke: #6e7681; }
    .node   { fill: #0d1117; stroke: #8b949e; }
    .accent { fill: none; stroke: #ff7b72; }
    .head   { fill: #8b949e; }
    .head-a { fill: #ff7b72; }
    text, .ink        { fill: #e6edf3; }
    .muted, .muted text { fill: #9198a1; }
    .red              { fill: #ff7b72; }
  </style>"""

light = (ASSETS / "architecture-light.svg").read_text()
dark, n = re.subn(r"<style>.*?</style>", DARK_THEME, light, count=1, flags=re.S)
assert n == 1, "THEME <style> block not found"
(ASSETS / "architecture-dark.svg").write_text(dark)
print("wrote", ASSETS / "architecture-dark.svg")
