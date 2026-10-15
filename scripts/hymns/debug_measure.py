#!/usr/bin/env python3
"""Ontwikkelhulp: schrijft de noten van één maat uit het extractieresultaat en rendert de bijbehorende PDF-uitsnede.
Gebruik: debug_measure.py <lofzangnummer> <maat> [png-uit]"""
import json
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent.parent
CACHE = ROOT / ".cache/hymns/nld"
n, m = int(sys.argv[1]), int(sys.argv[2])
h = next(h for h in json.loads((CACHE / "index.json").read_text())["hymns"] if h["number"] == n)
d = json.loads((CACHE / "score" / f"{h['slug']}.score.json").read_text())
print(h["slug"], d["timeSignature"], "pickup", d.get("pickup"), "start", d["measureStarts"][str(m - 1)], "len", d["measureLengths"][str(m - 1)])
cols = [c for c in d["columns"] if c["measure"] == m - 1]
for c in cols:
    ns = [(x["staff"][0], x["midi"], x["dur"], x["dbg"]) for x in d["notes"] if x["measure"] == m - 1 and abs(x["t"] - c["t"]) < 1e-3]
    print(f"  t={c['t'] - d['measureStarts'][str(m - 1)]:.3f} sys={c['system']} xc={c['xc']} {ns}")
if len(sys.argv) > 3:
    sys.path.insert(0, str(ROOT / "scripts/hymns"))
    import extract_score as E

    pg = pymupdf.open(CACHE / "pdf" / f"{h['slug']}.pdf")[0]
    staves = E.find_staves(pg.get_drawings())
    sysi = cols[0]["system"]
    sb = d["systems"][sysi]
    k = m - 1 - sb["measureStart"]
    k = min(max(k, 0), len(sb["bounds"]) - 2)
    lo, hi = sb["bounds"][k], sb["bounds"][k + 1]
    top, bot = staves[2 * sysi]["top"] - 12, staves[2 * sysi + 1]["bottom"] + 30
    pg.get_pixmap(dpi=170, clip=pymupdf.Rect(max(lo - 25, 0), top, min(hi + 25, pg.rect.width), bot)).save(sys.argv[3])
