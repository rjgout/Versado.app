#!/usr/bin/env python3
"""Leest de officiële vector-bladmuziek-PDF van een Nederlandse lofzang en
schrijft een symbolische partituur (noten, maten, lettergrepen) als JSON.

Waarom dit werkt: de kerk levert geen MIDI/MusicXML, maar de PDF's zijn
vectorbestanden (Ghostscript/TeX, lettertype "Interlude"). Noten zijn dus
tekens op een exacte positie, stokjes en balken zijn lijnen/vlakken. Dat is
geen beeldherkenning (OMR) maar het lezen van tekenopdrachten, wat bij deze
bestanden deterministisch is. De uitvoer wordt gevalideerd: elke stem moet per
maat optellen tot de maatsoort, en alle stemmen moeten gelijk lopen.

Gebruik (met pymupdf, numpy in een eigen venv):
  python3 extract_score.py <pdf> <uit.json>
"""
import json
import re
import sys
from collections import defaultdict

import pymupdf

HEAD_BLACK = "œ"
HEAD_HALF = "˙"
REST_QUARTER = "Œ"
ACCIDENTALS = {"#": 1, "n": 0, "b": -1}
FLAGS = {"j", "J"}  # J = vlag omhoog-stokje, j = vlag omlaag-stokje (beide 1 vlag)
STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"]
STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11]


def _group_double(raw):
    """Geeft (x_van_laatste_streep, aantal_strepen_in_groep) per maatgrens."""
    groups = []
    for x in raw:
        if groups and x - groups[-1][0][-1] < 6:
            groups[-1][0].append(x)
        else:
            groups.append(([x], None))
    return [(g[0][-1], len(g[0])) for g in groups if len(g[0]) > 1]


def diatonic_to_midi(d, alter=0):
    octave, step = divmod(d, 7)
    return 12 * (octave + 1) + STEP_SEMITONES[step] + alter


def main(pdf_path, out_path):
    page = pymupdf.open(pdf_path)[0]
    drawings = page.get_drawings()

    # --- notenbalken: horizontale lijnen van 0.25 breed, gegroepeerd per vijf
    hlines = []
    for d in drawings:
        for it in d["items"]:
            if it[0] == "l" and abs(it[1].y - it[2].y) < 0.01 and abs(it[1].x - it[2].x) > 200:
                hlines.append((round(it[1].y, 2), min(it[1].x, it[2].x), max(it[1].x, it[2].x)))
    hlines.sort()
    staves = []
    i = 0
    while i + 4 < len(hlines):
        ys = [h[0] for h in hlines[i : i + 5]]
        sp = (ys[4] - ys[0]) / 4
        if all(abs((ys[k + 1] - ys[k]) - sp) < 0.2 for k in range(4)):
            staves.append({"top": ys[0], "bottom": ys[4], "sp": sp, "x0": hlines[i][1], "x1": hlines[i][2]})
            i += 5
        else:
            i += 1

    # --- tekens uit het muzieklettertype
    glyphs = []
    words = []
    for b in page.get_text("rawdict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                if "Interlude" in s["font"]:
                    for ch in s["chars"]:
                        if ch["c"].strip():
                            glyphs.append({"c": ch["c"], "x": ch["origin"][0], "y": ch["origin"][1]})
    seen = set()
    uniq = []
    for g in glyphs:
        key = (g["c"], round(g["x"], 1), round(g["y"], 1))
        if key not in seen:  # sommige PDF's tekenen elk muziekteken twee keer
            seen.add(key)
            uniq.append(g)
    glyphs = uniq
    for w in page.get_text("words"):
        words.append({"x0": w[0], "y0": w[1], "x1": w[2], "y1": w[3], "t": w[4]})

    # clef per balk bepaalt de pitch-referentie
    for st in staves:
        clef = next(
            (g for g in glyphs if g["c"] in "&?" and abs(g["y"] - (st["bottom"] if g["c"] == "&" else st["bottom"] - 2 * st["sp"])) < 3 and abs(g["x"] - 23.5) < 3 and st["top"] - 3 < g["y"] < st["bottom"] + 3),
            None,
        )
        st["clef"] = "treble" if clef and clef["c"] == "&" else "bass"
        # onderste lijn: treble = E4 (diatonisch 4*7+2=30), bass = G2 (2*7+4=18)
        st["bottomDiatonic"] = 30 if st["clef"] == "treble" else 18

    def staff_of(y):
        for si, st in enumerate(staves):
            if st["top"] - 3 * st["sp"] <= y <= st["bottom"] + 3 * st["sp"]:
                # liever de balk waar het midden het dichtst bij ligt
                pass
        best = min(range(len(staves)), key=lambda k: abs(y - (staves[k]["top"] + staves[k]["bottom"]) / 2))
        return best

    # --- verticale lijnen: maatstreep (0.5) en stokjes (0.44)
    stems = []
    barlines = defaultdict(list)
    for d in drawings:
        w = d.get("width") or 0
        for it in d["items"]:
            if it[0] == "l" and abs(it[1].x - it[2].x) < 0.01:
                y0, y1 = sorted((it[1].y, it[2].y))
                x = it[1].x
                if abs(w - 0.44) < 0.02:
                    stems.append({"x": x, "y0": y0, "y1": y1})
                elif w >= 0.45:
                    for si, st in enumerate(staves):
                        if abs(y0 - st["top"]) < 0.6 and abs(y1 - st["bottom"]) < 0.6:
                            barlines[si].append(x)
    # balken (gevulde vlakken): rechthoek of schuin parallellogram met ~2 pt dikte
    beams = []
    for d in drawings:
        if d["type"] != "f":
            continue
        its = d["items"]
        if len(its) == 1 and its[0][0] == "re":
            r = its[0][1]
            if r.height < 3 and r.width > 3:
                beams.append({"x0": r.x0, "x1": r.x1, "yl": (r.y0 + r.y1) / 2, "yr": (r.y0 + r.y1) / 2})
        elif len(its) >= 4 and all(i[0] == "l" for i in its):
            pts = [(i[1].x, i[1].y) for i in its]
            xs = [p[0] for p in pts]
            x0, x1 = min(xs), max(xs)
            left = [p[1] for p in pts if abs(p[0] - x0) < 0.05]
            right = [p[1] for p in pts if abs(p[0] - x1) < 0.05]
            if x1 - x0 > 3 and left and right and 1.2 < max(left) - min(left) < 3.2 and 1.2 < max(right) - min(right) < 3.2:
                beams.append({"x0": x0, "x1": x1, "yl": sum(left) / len(left), "yr": sum(right) / len(right)})

    # --- koppen per balk
    notes_by_staff = defaultdict(list)
    for g in glyphs:
        if g["c"] in (HEAD_BLACK, HEAD_HALF):
            si = staff_of(g["y"])
            st = staves[si]
            step = round((st["bottom"] - g["y"]) / (st["sp"] / 2))
            notes_by_staff[si].append(
                {"x": g["x"], "y": g["y"], "head": g["c"], "diatonic": st["bottomDiatonic"] + step, "staff": si, "alter": None, "dots": 0}
            )

    other = [g for g in glyphs if g["c"] in ("." , "#", "n", "b", "U", "u", "J", "j", REST_QUARTER)]

    # sleutelvoorteken: tekens #/b links van de eerste noot op elke balk, rechts van de sleutel.
    key_sig = {}
    for si, st in enumerate(staves):
        sigs = [g for g in other if g["c"] in "#b" and abs(g["x"] - 23.5) > 0 and st["top"] - 6 < g["y"] < st["bottom"] + 6 and g["x"] < 60 and staff_of(g["y"]) == si]
        # alleen de tekens vóór de maatsoort/eerste noot
        first_note_x = min((n["x"] for n in notes_by_staff[si]), default=999)
        sigs = [g for g in sigs if g["x"] < first_note_x - 4 and g["x"] > 30]
        # sleutelvoorteken geldt voor de eerste balk van elk systeem
        key_sig[si] = sigs
    ks_per_staff = {}
    for si, sigs in key_sig.items():
        st = staves[si]
        letters = {}
        kind = 0
        for g in sigs:
            step = round((st["bottom"] - g["y"]) / (st["sp"] / 2))
            d = st["bottomDiatonic"] + step
            # de glyph-origin van # ligt 0,5 stap anders; normaliseer op letternaam
            letters[d % 7] = 1 if g["c"] == "#" else -1
        ks_per_staff[si] = letters
    # een echt sleutelvoorteken staat vooraan op (bijna) elke balk; een enkel voorteken bij de eerste
    # noot van één systeem is dat niet.
    votes = defaultdict(int)
    for letters in ks_per_staff.values():
        for k, v in letters.items():
            votes[(k, v)] += 1
    key_letters = {k: v for (k, v), c in votes.items() if c > len(staves) / 2}

    # maatsoort
    digits = [g for g in glyphs if g["c"].isdigit()]
    num = den = None
    if digits:
        top = min(digits, key=lambda g: g["y"])
        bot = max(digits, key=lambda g: g["y"])
        num, den = int(top["c"]), int(bot["c"])
        # 2-cijferige tellers zijn hier niet aanwezig
    beats_per_bar = num * (4 / den)

    # --- punten, voortekens, stokjes, balken, vlaggen aan koppen koppelen
    for si, lst in notes_by_staff.items():
        st = staves[si]
        for n in lst:
            head_w = 5.1
            # stok: rechter rand (stok omhoog) of linker rand (stok omlaag) van de kop
            cand = None
            for s in stems:
                if s["y0"] - 1.6 <= n["y"] <= s["y1"] + 1.6:
                    if abs(s["x"] - (n["x"] + head_w)) < 0.6:
                        cand = ("up", s)
                    elif abs(s["x"] - n["x"]) < 0.6:
                        cand = ("down", s)
            n["stem"] = cand[1] if cand else None
            n["dir"] = cand[0] if cand else None
            # punt: rechts van de kop, 2 tot 9 pt, dicht bij dezelfde hoogte (+ half spatie hoger)
            for g in other:
                if g["c"] == "." and 0 < g["x"] - (n["x"] + head_w) < 6 and abs(g["y"] - n["y"]) < st["sp"] * 0.8 + 1 and g["y"] - n["y"] <= 0.5:
                    n["dots"] = 1
            # nette puntherkenning: punt hoort bij de kop met dezelfde ruimte of lijn-ruimte
            for g in other:
                if g["c"] in "#nb" and 0 < n["x"] - g["x"] < 11 and abs(g["y"] - n["y"]) < st["sp"] * 0.9:
                    if n["alter"] is None and g["x"] > 0:
                        n["alter"] = ACCIDENTALS[g["c"]]

    # punten: een punt kan door twee koppen worden geclaimd (kop op lijn: punt in de ruimer erboven).
    # Wijs elke punt aan precies één kop toe: de dichtstbijzijnde (x, y).
    for si, lst in notes_by_staff.items():
        for n in lst:
            n["dots"] = 0
    for g in other:
        if g["c"] != ".":
            continue
        si = staff_of(g["y"])
        best = None
        for n in notes_by_staff[si]:
            dx = g["x"] - (n["x"] + 5.1)
            if 0 < dx < 7:
                # punt staat in een ruimte: op of hoger dan de kop
                dy = n["y"] - g["y"]
                if -0.3 <= dy <= staves[si]["sp"] * 0.6:
                    score = dx + abs(dy)
                    if best is None or score < best[0]:
                        best = (score, n)
        if best:
            best[1]["dots"] += 1

    def beam_count(n):
        s = n["stem"]
        if not s:
            return 0
        far_y = s["y0"] if n["dir"] == "up" else s["y1"]
        cnt = 0
        for b in beams:
            if b["x0"] - 0.4 <= s["x"] <= b["x1"] + 0.4:
                frac = (s["x"] - b["x0"]) / max(b["x1"] - b["x0"], 1e-6)
                yb = b["yl"] + (b["yr"] - b["yl"]) * min(max(frac, 0), 1)
                if abs(yb - far_y) < 4.5:
                    cnt += 1
        # vlaggen: teken J/j vlak bij het stokeinde
        for g in other:
            if g["c"] in FLAGS and abs(g["x"] - s["x"]) < 2.5 and (abs(g["y"] - far_y) < 6):
                cnt += 1
        return cnt

    for si, lst in notes_by_staff.items():
        for n in lst:
            if n["head"] == HEAD_HALF:
                base = 2.0
            elif n["stem"] is None:
                base = 4.0
            else:
                b = beam_count(n)
                base = {0: 1.0, 1: 0.5, 2: 0.25, 3: 0.125}.get(b, 0.25)
            n["dur"] = base * (1.5 if n["dots"] else 1.0)

    # --- maten per balk bepalen
    for si in notes_by_staff:
        raw_bl = sorted(set(round(x, 1) for x in barlines[si]))
        bl = []
        for x in raw_bl:
            # dubbele maatstreep (sectie-einde, eindstreep): telt als één grens
            if bl and x - bl[-1] < 6:
                bl[-1] = x
            else:
                bl.append(x)
        staves[si]["bars"] = bl
        staves[si]["doubleBars"] = [b for b, raw_group in _group_double(raw_bl)]

    systems = []
    for si, st in enumerate(staves):
        if st["clef"] == "treble":
            systems.append({"treble": si, "bass": si + 1 if si + 1 < len(staves) and staves[si + 1]["clef"] == "bass" else None})

    problems = []
    rests = [g for g in other if g["c"] == REST_QUARTER]
    measure_records = []  # per maat: {system, columns:[{t, x, items}], length}
    system_infos = []
    gm = 0
    for sy_i, sy in enumerate(systems):
        ts = sy["treble"]
        bars_x = staves[ts]["bars"]
        bounds = [staves[ts]["x0"]] + bars_x
        system_infos.append({"measureStart": gm, "measureCount": len(bars_x), "bounds": [round(b, 1) for b in bounds]})
        for m in range(len(bars_x)):
            lo, hi = bounds[m], bounds[m + 1]
            items = []
            for si in [ts, sy["bass"]]:
                if si is None:
                    continue
                for n in notes_by_staff[si]:
                    if lo < n["x"] + 2.5 <= hi:
                        items.append({"x": n["x"], "dur": n["dur"], "note": n, "staff": si})
                for g in rests:
                    if staff_of(g["y"]) == si and lo < g["x"] + 2.5 <= hi:
                        items.append({"x": g["x"], "dur": 1.0, "note": None, "staff": si})
            items.sort(key=lambda it: it["x"])
            # kolommen: koppen binnen 6,5 pt horen bij hetzelfde tijdstip (verplaatste koppen bij secunden)
            cols = []
            for it in items:
                if cols and it["x"] - cols[-1]["x"] < 6.5:
                    cols[-1]["items"].append(it)
                else:
                    cols.append({"x": it["x"], "items": [it]})
            # tijd: volgende kolom begint zodra de eerst eindigende klinkende gebeurtenis eindigt
            t = 0.0
            active = []
            ok = True
            for ci, col in enumerate(cols):
                col["t"] = t
                for it in col["items"]:
                    it["end"] = t + it["dur"]
                    active.append(it)
                future = [it["end"] for it in active if it["end"] > t + 1e-9]
                nxt = min(future) if future else t
                if ci + 1 < len(cols):
                    if nxt >= max(it["end"] for it in active) - 1e-9 and nxt >= max(it["end"] for it in active):
                        pass
                    t = nxt
            length = max((it["end"] for it in items), default=0.0)
            rec = {"system": sy_i, "index": gm + m, "cols": cols, "length": length, "x0": lo, "x1": hi}
            measure_records.append(rec)
        gm += len(bars_x)

    n_meas = len(measure_records)
    full = beats_per_bar
    starts = {}
    acc = 0.0
    for rec in measure_records:
        starts[rec["index"]] = acc
        acc += rec["length"]

    # validatie per maat
    for rec in measure_records:
        m = rec["index"]
        if abs(rec["length"] - full) > 1e-6 and m not in (0, n_meas - 1):
            problems.append(f"maat {m + 1}: lengte {rec['length']} != {full}")
        # elke kolom moet binnen de maat vallen en per balk moeten alle klinkende stemmen de maat vullen
        for ci, col in enumerate(rec["cols"]):
            for it in col["items"]:
                if it["end"] > rec["length"] + 1e-6:
                    problems.append(f"maat {m + 1}: noot eindigt na de maat (x={it['x']:.1f})")
        # kolom-tijden moeten strikt stijgen
        ts_ = [c["t"] for c in rec["cols"]]
        if any(b <= a for a, b in zip(ts_, ts_[1:])):
            problems.append(f"maat {m + 1}: kolomtijden niet stijgend {ts_}")
        # elk tijdstip van de maat moet in elke balk door minstens één noot gedekt zijn (geen gaten)
        for si_role in ("treble", "bass"):
            cover = []
            for col in rec["cols"]:
                for it in col["items"]:
                    if staves[it["staff"]]["clef"] == si_role:
                        cover.append((col["t"], it["end"]))
            if cover:
                pts = sorted({c[0] for c in cover} | {c[1] for c in cover})
                for a_, b_ in zip(pts, pts[1:]):
                    if b_ > rec["length"] + 1e-6:
                        continue
                    if not any(c0 <= a_ + 1e-9 and c1 >= b_ - 1e-9 for c0, c1 in cover):
                        problems.append(f"maat {m + 1}: gat in {si_role} tussen {a_} en {b_}")
                        break

    # voortekens per balk/maat in x-volgorde
    for rec in measure_records:
        carried = {}
        for col in rec["cols"]:
            for it in sorted(col["items"], key=lambda it: it["x"]):
                n = it["note"]
                if n is None:
                    continue
                key = (it["staff"], n["diatonic"])
                letter = n["diatonic"] % 7
                if n["alter"] is not None:
                    carried[key] = n["alter"]
                    alter = n["alter"]
                elif key in carried:
                    alter = carried[key]
                else:
                    alter = key_letters.get(letter, 0)
                n["midi"] = diatonic_to_midi(n["diatonic"], alter)

    result_notes = []
    for rec in measure_records:
        base = starts[rec["index"]]
        for col in rec["cols"]:
            for it in col["items"]:
                n = it["note"]
                if n is None:
                    continue
                result_notes.append(
                    {
                        "t": round(base + col["t"], 4),
                        "dur": it["dur"],
                        "midi": n["midi"],
                        "staff": staves[it["staff"]]["clef"],
                        "measure": rec["index"],
                        "system": rec["system"],
                        "x": round(it["x"], 1),
                    }
                )
    result_notes.sort(key=lambda n: (n["t"], n["midi"]))
    events = []
    for rec in measure_records:
        for col in rec["cols"]:
            for it in col["items"]:
                events.append({"staff": it["staff"], "x": it["x"], "t": starts[rec["index"]] + col["t"], "rest": it["note"] is None})
    meas_len = {rec["index"]: rec["length"] for rec in measure_records}
    n_total_meas = n_meas

    # fermata (U/u) -> tijdpunt van de dichtstbijzijnde kop in x
    fermatas = []
    for g in other:
        if g["c"] in "Uu":
            si = staff_of(g["y"])
            cand = [e for e in events if e["staff"] == si and not e.get("rest")]
            if cand:
                e = min(cand, key=lambda e: abs(e["x"] + 2.5 - g["x"]))
                fermatas.append(round(e["t"], 4))

    # lettergrepen uit afzonderlijke tekens: een afbreekstreepje (en spatie) sluit een lettergreep af,
    # zodat samengestelde woorden als "ter-schap" of "mart’-laar" eigen posities krijgen.
    syllables = []
    for b_ in page.get_text("rawdict")["blocks"]:
        for l in b_.get("lines", []):
            for sp_ in l["spans"]:
                if "Palatino" not in sp_["font"] or "Italic" in sp_["font"]:
                    continue
                y = (l["bbox"][1] + l["bbox"][3]) / 2
                for sy_i, sy in enumerate(systems):
                    st = staves[sy["treble"]]
                    nxt_top = staves[sy["bass"]]["top"] if sy["bass"] is not None else st["bottom"] + 80
                    if st["bottom"] + 4 < y < nxt_top - 2:
                        cur = ""
                        x0 = x1 = None
                        for ch in sp_["chars"] + [{"c": " ", "bbox": [0, 0, 0, 0], "origin": [0, 0]}]:
                            c = ch["c"]
                            if c in (" ", "-", "\u2010", "\u2011", "\u2013"):
                                if cur:
                                    syllables.append({"system": sy_i, "x0": round(x0, 1), "x1": round(x1, 1), "y": round(y, 1), "t": cur, "hyphen": c != " "})
                                cur, x0, x1 = "", None, None
                                if c != " " and syllables:
                                    syllables[-1]["hyphen"] = True
                            else:
                                if x0 is None:
                                    x0 = ch["bbox"][0]
                                x1 = ch["bbox"][2]
                                cur += c
                        break

    # metadata uit tekst
    txt = page.get_text("text")
    tempo = re.search(r"=\s*(\d+)\s*-\s*(\d+)", txt)
    result = {
        "source": pdf_path.split("/")[-1],
        "timeSignature": [num, den],
        "beatsPerBar": beats_per_bar,
        "keyLetters": {STEP_NAMES[k]: v for k, v in key_letters.items()},
        "tempoQuarterBpm": [int(tempo.group(1)), int(tempo.group(2))] if tempo else None,
        "measureStarts": {str(k): v for k, v in starts.items()},
        "measureLengths": {str(k): v for k, v in meas_len.items()},
        "fermatas": sorted(set(fermatas)),
        "sectionEndMeasures": sorted({rec["index"] for rec in measure_records if any(abs(rec["x1"] - db) < 1.5 for si_ in (systems[rec["system"]]["treble"],) for db in staves[si_].get("doubleBars", []))} - {n_total_meas - 1}),
        "columns": [
            {"system": rec["system"], "measure": rec["index"], "t": round(starts[rec["index"]] + col["t"], 4), "xc": round(min(it["x"] for it in col["items"]) + 2.55, 1)}
            for rec in measure_records
            for col in rec["cols"]
        ],
        "notes": result_notes,
        "syllables": syllables,
        "systems": system_infos,
        "problems": problems,
    }
    json.dump(result, open(out_path, "w"), ensure_ascii=False, indent=1)
    print(f"{pdf_path}: {len(result_notes)} noten, {n_total_meas} maten, {len(problems)} problemen")
    for p in problems[:30]:
        print("  !", p)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
