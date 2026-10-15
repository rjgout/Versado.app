#!/usr/bin/env python3
"""Schrijft per gevalideerde compositie de notatielaag (voor het graveren van bladmuziek) naast de analysegegevens.

Uitvoer: src/lib/hymns/library/data/notation/<officialSlug>.json

De notatielaag is een AFZONDERLIJK gegeven naast `music/<slug>.json` (analyse voor herkennen en volgen):
  - de analysegegevens blijven ongewijzigd en worden hier alleen gecontroleerd;
  - de notatielaag bewaart wat nodig is om de partituur te tekenen: spelling (diatonische stap + wijziging), stokrichting
    (stem), balkgroepen, puntjes, rusten, bogen (overbinding/legato), fermates, maatindeling en maatsoort per maat.
Alles komt uit dezelfde PDF-extractie (extract_score.py) als de analysegegevens; er wordt niets gegokt. Een kop waarvan de
analysegegevens en de notatielaag niet overeenkomen, laat de bouw falen.
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CACHE = ROOT / ".cache/hymns/nld"
DATA = ROOT / "src/lib/hymns/library/data"
NOTATION_VERSION = 1
STAFF = {"treble": 0, "bass": 1}
DIR = {"up": 0, "down": 1, None: 2}


def fifths_of(key):
    """Aantal kruisen (+) of mollen (-) uit de sleutelvoortekens."""
    return sum(key.values()) if key else 0


def build(slug, comp, score):
    notes = [n for n in score["notes"]]
    # de analysegegevens (music/) en de notatielaag moeten dezelfde koppen beschrijven
    a = sorted((round(n[0], 3), round(n[1], 3), n[2], n[3]) for n in comp["notes"])
    b = sorted((round(n["t"], 3), round(n["dur"], 3), n["midi"], STAFF[n["staff"]]) for n in notes)
    if a != b:
        raise SystemExit(f"{slug}: notatielaag en analysegegevens beschrijven niet dezelfde noten")
    lengths = {int(k): v for k, v in score["measureLengths"].items()}
    starts = comp["measureStarts"]
    changes = [tuple(c) for c in score.get("timeSignatureChanges", [])]
    base_sig = tuple(comp["timeSignature"])
    measures = []
    for i, st in enumerate(starts):
        ln = lengths.get(i, comp["beatsPerBar"])
        sig = base_sig
        if changes:
            fits = [c for c in changes if abs(c[0] * 4 / c[1] - ln) < 1e-6]
            sig = fits[0] if fits else base_sig
            if len(fits) > 1:
                sig = max(fits, key=lambda c: c[1] == base_sig[1])
        measures.append([st, ln, sig[0], sig[1]])
    curves = [c for c in score.get("curves", [])]
    ties, slurs, unresolved = [], [], 0
    by_head = {(n["midi"], round(n["x"], 1), None): n for n in notes}
    head_at = {}
    for n in notes:
        head_at[(n["midi"], round(n["x"], 1))] = n
    for c in curves:
        if c["kind"] == "unresolved":
            unresolved += 1
            continue
        h1 = head_at.get((c["from"][0], c["from"][1]))
        h2 = head_at.get((c["to"][0], c["to"][1]))
        if not h1 or not h2:
            unresolved += 1
            continue
        item = [round(h1["t"], 4), h1["midi"], STAFF[h1["staff"]], round(h2["t"], 4), h2["midi"]]
        (ties if c["kind"] == "tie" else slurs).append(item)
    out_notes = []
    for n in sorted(notes, key=lambda n: (n["t"], STAFF[n["staff"]], n["midi"])):
        out_notes.append([round(n["t"], 4), round(n["dur"], 4), n["midi"], STAFF[n["staff"]], n["dia"], n["alt"], DIR[n["dir"]], n["acc"], n["bm"], n["dots"], n["base"]])
    rests = [[round(r["t"], 4), round(r["dur"], 4), STAFF[r["staff"]]] for r in score.get("rests", [])]
    return {
        "v": NOTATION_VERSION,
        "compositionId": comp["id"],
        "pdfSha": comp["source"]["pdfSha"],
        "extractor": comp["source"]["extractor"],
        "fifths": fifths_of(comp["keySignature"]),
        "pickup": score.get("pickup"),
        "measures": measures,
        "fermatas": comp["fermatas"],
        "fermataMarks": [[m["t"], STAFF[m["staff"]], 1 if m["inverted"] else 0] for m in score.get("fermataMarks", [])],
        "notes": out_notes,
        "rests": rests,
        "ties": ties,
        "slurs": slurs,
        "unresolvedCurves": unresolved,
    }


def main():
    out_dir = DATA / "notation"
    out_dir.mkdir(exist_ok=True)
    for f in out_dir.glob("*.json"):
        f.unlink()
    stats = Counter()
    for f in sorted((DATA / "music").glob("*.json")):
        comp = json.loads(f.read_text())
        slug = comp["officialSlug"]
        sf = CACHE / "score" / f"{slug}.score.json"
        score = json.loads(sf.read_text())
        notation = build(slug, comp, score)
        (out_dir / f"{slug}.json").write_text(json.dumps(notation, ensure_ascii=False, separators=(",", ":")) + "\n")
        stats["composities"] += 1
        stats["ties"] += len(notation["ties"])
        stats["slurs"] += len(notation["slurs"])
        stats["onopgeloste bogen"] += notation["unresolvedCurves"]
        stats["rusten"] += len(notation["rests"])
    print(dict(stats))


if __name__ == "__main__":
    main()
