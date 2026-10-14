#!/usr/bin/env python3
"""Leest de officiële vector-bladmuziek-PDF van een Nederlandse lofzang en
schrijft een symbolische partituur (noten, maten, lettergrepen) als JSON.

Waarom dit werkt: de kerk levert geen MIDI/MusicXML, maar de PDF's zijn
vectorbestanden (lettertype "Interlude"). Noten zijn tekens op een exacte positie,
stokjes en balken zijn lijnen/vlakken. Dat is geen beeldherkenning (OMR) maar het
lezen van tekenopdrachten, wat bij deze bestanden deterministisch is.

Een PDF die zonder fout verwerkt wordt, is niet automatisch correct. De uitvoer bevat
daarom `problems`: elke logische maat moet optellen tot de maatsoort (met uitzondering van
een opmaat die door de laatste maat wordt aangevuld), elke stem moet de maat vullen en
alle stemmen moeten gelijk lopen. Alleen een partituur zonder problemen mag later als
"gevalideerd" gelden; de rest blijft onzeker en wordt niet voor herkenning gebruikt.

Structurele aanpak:
  * een maat die over een systeemwisseling loopt (staartfragment + kopfragment) wordt samengevoegd;
  * maatsoort per maat (wissels midden in het stuk, "c" = 4/4);
  * noten (kwart/half/heel + punten), rusten (kwart, half, hele maat, achtste, zestiende), triolen;
  * maatstreepsoorten (enkel, dubbel, eind, herhaling) met herhalingstekens.

Gebruik (met pymupdf in een eigen venv):
  python3 extract_score.py <pdf> <uit.json>
"""
import json
import re
import sys
from collections import defaultdict

import pymupdf

HEAD_BLACK = "œ"
HEAD_HALF = "˙"
HEAD_WHOLE = "w"
# rust -> duur in kwartnoten; None = hele maat
RESTS = {"Œ": 1.0, "Ó": 2.0, "∑": None, "‰": 0.5, "K": 0.25}
TUPLET3 = "£"
REPEAT_DOTS = "{"
ACCIDENTALS = {"#": 1, "n": 0, "b": -1}
FLAGS = {"j", "J"}  # J = vlag omhoog-stokje, j = vlag omlaag-stokje (beide 1 vlag)
STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"]
STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11]
TREBLE_CLEFS = {"&", "ß"}
BASS_CLEFS = {"?", "Í"}
HEAD_W = 5.1


def diatonic_to_midi(d, alter=0):
    octave, step = divmod(d, 7)
    return 12 * (octave + 1) + STEP_SEMITONES[step] + alter


def find_staves(drawings):
    hlines = []
    for d in drawings:
        for it in d["items"]:
            if it[0] == "l" and abs(it[1].y - it[2].y) < 0.01 and abs(it[1].x - it[2].x) > 100:
                hlines.append((round(it[1].y, 2), min(it[1].x, it[2].x), max(it[1].x, it[2].x)))
    hlines.sort()
    staves = []
    i = 0
    while i + 4 < len(hlines):
        ys = [h[0] for h in hlines[i : i + 5]]
        sp = (ys[4] - ys[0]) / 4
        if sp > 1 and all(abs((ys[k + 1] - ys[k]) - sp) < 0.2 for k in range(4)):
            staves.append({"top": ys[0], "bottom": ys[4], "sp": sp, "x0": hlines[i][1], "x1": hlines[i][2]})
            i += 5
        else:
            i += 1
    return staves


def cluster_bars(items):
    """items: [(x, soort)] met soort 'thin'|'thick'. Geeft per maatstreepgroep {x0, x1, kind}."""
    items = sorted(items)
    groups = []
    for x, k in items:
        if groups and x - groups[-1][-1][0] < 7:
            groups[-1].append((x, k))
        else:
            groups.append([(x, k)])
    out = []
    for g in groups:
        kinds = [k for _, k in g]
        if "thick" in kinds:
            ti = kinds.index("thick")
            kind = "thickbefore" if ti < len(kinds) - 1 and "thin" in kinds[ti + 1 :] else "thickafter"
        elif len(g) > 1:
            kind = "double"
        else:
            kind = "thin"
        out.append({"x0": g[0][0], "x1": g[-1][0], "kind": kind})
    return out


def extract(pdf_path, opts=None):
    opts = opts or {}
    page = pymupdf.open(pdf_path)[0]
    drawings = page.get_drawings()
    staves = find_staves(drawings)
    problems = []
    warnings = []

    glyphs = []
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

    if not staves or len(staves) % 2:
        raise ValueError(f"onverwacht aantal notenbalken: {len(staves)}")

    # clef per balk: het meest linkse teken in de balk bepaalt de sleutel
    for si, st in enumerate(staves):
        cand = [g for g in glyphs if g["c"] in TREBLE_CLEFS | BASS_CLEFS and st["top"] - 8 < g["y"] < st["bottom"] + 8 and st["x0"] - 1 < g["x"] < st["x0"] + 20]
        if cand:
            g = min(cand, key=lambda g: g["x"])
            st["clef"] = "treble" if g["c"] in TREBLE_CLEFS else "bass"
        else:
            st["clef"] = "treble" if si % 2 == 0 else "bass"
            warnings.append(f"balk {si}: sleutel niet gevonden, positie aangenomen")
        st["bottomDiatonic"] = 30 if st["clef"] == "treble" else 18
    systems = []
    for si in range(0, len(staves), 2):
        if staves[si]["clef"] != "treble" or staves[si + 1]["clef"] != "bass":
            raise ValueError(f"systeem {si // 2}: verwacht G- en F-sleutel, kreeg {staves[si]['clef']}/{staves[si + 1]['clef']}")
        systems.append({"treble": si, "bass": si + 1})

    def systems_of_staff(si):
        return si // 2

    def staff_of(y):
        return min(range(len(staves)), key=lambda k: abs(y - (staves[k]["top"] + staves[k]["bottom"]) / 2))

    # --- verticale lijnen: maatstreep, stokjes
    # de breedte van een maatstreep is die van de beginstreep over beide balken van het eerste systeem
    bar_w = 0.5
    for d in drawings:
        for it in d["items"]:
            if it[0] == "l" and abs(it[1].x - it[2].x) < 0.01 and abs(it[1].x - staves[0]["x0"]) < 1:
                y0, y1 = sorted((it[1].y, it[2].y))
                if abs(y0 - staves[0]["top"]) < 0.6 and abs(y1 - staves[1]["bottom"]) < 0.6:
                    bar_w = d.get("width") or 0.5
    stems = []
    bar_items = defaultdict(list)
    for d in drawings:
        w = d.get("width") or 0
        for it in d["items"]:
            # sommige stokken zijn ~1 pt scheef getekend (afronding in de bron); dat blijft een stok
            if it[0] == "l" and abs(it[1].x - it[2].x) < 1.2:
                y0, y1 = sorted((it[1].y, it[2].y))
                x = (it[1].x + it[2].x) / 2
                is_bar = False
                for si, st in enumerate(staves):
                    if st["clef"] != "treble":
                        continue
                    full = abs(y0 - st["top"]) < 0.6 and abs(y1 - st["bottom"]) < 0.6
                    thick = w >= 1.5 and abs(y0 - st["top"]) < 1.6 and abs(y1 - st["bottom"]) < 1.6
                    if thick:
                        bar_items[si].append((x, "thick"))
                        is_bar = True
                    elif full and abs(w - bar_w) < 0.02:
                        bar_items[si].append((x, "thin"))
                        is_bar = True
                if not is_bar and 0.3 < w < 0.47:
                    stems.append({"x": x, "y0": y0, "y1": y1})
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

    # --- koppen en rusten per balk
    notes_by_staff = defaultdict(list)
    rests_by_staff = defaultdict(list)
    for g in glyphs:
        if g["c"] in (HEAD_BLACK, HEAD_HALF, HEAD_WHOLE):
            si = staff_of(g["y"])
            st = staves[si]
            step = round((st["bottom"] - g["y"]) / (st["sp"] / 2))
            notes_by_staff[si].append({"x": g["x"], "y": g["y"], "head": g["c"], "diatonic": st["bottomDiatonic"] + step, "staff": si, "alter": None, "dots": 0, "tuplet": 1.0})
        elif g["c"] in RESTS:
            si = staff_of(g["y"])
            rests_by_staff[si].append({"x": g["x"], "y": g["y"], "kind": g["c"], "dots": 0, "staff": si, "tuplet": 1.0})
    other = [g for g in glyphs if g["c"] in (".", "#", "n", "b", "U", "u", "J", "j", TUPLET3, REPEAT_DOTS)]

    # --- sleutelvoorteken: tekens #/b links van de eerste noot, per balk; meerderheid van de balken telt
    key_sig = {}
    for si, st in enumerate(staves):
        first_note_x = min((n["x"] for n in notes_by_staff[si]), default=999)
        sigs = [g for g in other if g["c"] in "#b" and st["top"] - 6 < g["y"] < st["bottom"] + 6 and st["x0"] + 8 < g["x"] < first_note_x - 4 and g["x"] < st["x0"] + 70 and staff_of(g["y"]) == si]
        letters = {}
        for g in sigs:
            step = round((st["bottom"] - g["y"]) / (st["sp"] / 2))
            letters[(st["bottomDiatonic"] + step) % 7] = 1 if g["c"] == "#" else -1
        key_sig[si] = letters
    votes = defaultdict(int)
    for letters in key_sig.values():
        for k, v in letters.items():
            votes[(k, v)] += 1
    key_letters = {k: v for (k, v), c in votes.items() if c > len(staves) / 2}

    # --- maatsoort(en): cijfers (hoofdletter-cijfers in Interlude), "c" = 4/4
    sigs = []  # (systeem, x, teller, noemer)
    digit_glyphs = [g for g in glyphs if g["c"].isdigit()]
    for sy_i, sy in enumerate(systems):
        st = staves[sy["treble"]]
        mid = (st["top"] + st["bottom"]) / 2
        ds = [g for g in digit_glyphs if st["top"] - 2 < g["y"] < st["bottom"] + 2]
        top_row = sorted([g for g in ds if g["y"] < mid + st["sp"] * 0.3 and g["y"] <= mid + 0.1], key=lambda g: g["x"])
        bot_row = sorted([g for g in ds if g["y"] > mid + 0.1], key=lambda g: g["x"])

        def group(row):
            out = []
            for g in row:
                if out and g["x"] - out[-1][-1]["x"] < 9:
                    out[-1].append(g)
                else:
                    out.append([g])
            return out

        tops, bots = group(top_row), group(bot_row)
        for tg in tops:
            bg = min(bots, key=lambda b: abs(b[0]["x"] - tg[0]["x"]), default=None)
            if bg and abs(bg[0]["x"] - tg[0]["x"]) < 6:
                sigs.append((sy_i, tg[0]["x"], int("".join(g["c"] for g in tg)), int("".join(g["c"] for g in bg))))
        for g in glyphs:
            if g["c"] == "c" and st["top"] - 2 < g["y"] < st["bottom"] + 2 and st["x0"] < g["x"] < st["x0"] + 60:
                sigs.append((sy_i, g["x"], 4, 4))
    sigs.sort()
    if not sigs:
        problems.append("maatsoort niet gevonden")
        sigs = [(0, 0, 4, 4)]

    def sig_at(sys_i, hi):
        cur = sigs[0]
        for s in sigs:
            if (s[0], s[1]) < (sys_i, hi):
                cur = s
        return cur

    # --- punten: globale koppeling van punten aan koppen/rusten (laagste kosten eerst), zodat in een tweestemmige
    # dyade elk punt bij zijn eigen kop komt; een tweede punt vlak achter een toegewezen punt maakt de duur dubbelgepunteerd
    dot_glyphs = [g for g in other if g["c"] == "."]
    if opts.get("dots") == "above":
        # eenvoudiger regel: elk punt hoort bij één kop, op of boven de kop; dichtstbijzijnde wint
        for g in dot_glyphs:
            si = staff_of(g["y"])
            best = None
            for n in notes_by_staff[si]:
                dx = g["x"] - (n["x"] + HEAD_W)
                if 0 < dx < 7:
                    dy = n["y"] - g["y"]
                    if -0.3 <= dy <= staves[si]["sp"] * 0.6:
                        sc = dx + abs(dy)
                        if best is None or sc < best[0]:
                            best = (sc, n)
            for r in rests_by_staff[si]:
                dx = g["x"] - (r["x"] + 4.5)
                if 0 < dx < 7 and abs(g["y"] - r["y"]) < staves[si]["sp"] * 1.6:
                    sc = dx + abs(g["y"] - r["y"]) * 0.3 - 0.5
                    if best is None or sc < best[0]:
                        best = (sc, r)
            if best:
                best[1]["dots"] += 1
        pairs = []
    pairs = []
    for gi, g in enumerate(dot_glyphs if opts.get("dots") != "above" else []):
        si = staff_of(g["y"])
        sp = staves[si]["sp"]
        for n in notes_by_staff[si]:
            dx = g["x"] - (n["x"] + HEAD_W)
            dy = abs(n["y"] - g["y"])
            if -1 < dx < 8.5 and dy <= sp * 0.58:
                pairs.append((abs(dx - 3) + 3 * dy, gi, n))
        for r in rests_by_staff[si]:
            dx = g["x"] - (r["x"] + 4.5)
            dy = abs(g["y"] - r["y"])
            if 0 < dx < 8 and dy < sp * 1.6:
                pairs.append((abs(dx - 3) + opts.get("restDy", 0.6) * dy + opts.get("restBonus", -1.0), gi, r))  # rustpunt wint (standaard) van een nabije kop
    pairs.sort(key=lambda p_: p_[0])
    if opts.get("dots") == "above":
        pairs = []
    used_dots = set()
    for cost, gi, target in pairs:
        if gi in used_dots or target["dots"]:
            continue
        target["dots"] = 1
        target["dotX"] = dot_glyphs[gi]["x"]
        used_dots.add(gi)
    for gi, g in enumerate(dot_glyphs):
        if gi in used_dots:
            continue
        for cost, gj, target in pairs:
            if gj in used_dots and target.get("dotX") is not None and 1.5 < g["x"] - target["dotX"] < 6 and abs(dot_glyphs[gj]["y"] - g["y"]) < 0.4 and target["dots"] == 1:
                target["dots"] = 2
                used_dots.add(gi)
                break

    # --- stokjes, voortekens
    def beam_count_of(stem, direction):
        far_y = stem["y0"] if direction == "up" else stem["y1"]
        cnt = 0
        for b in beams:
            if b["x0"] - 0.4 <= stem["x"] <= b["x1"] + 0.4:
                frac = (stem["x"] - b["x0"]) / max(b["x1"] - b["x0"], 1e-6)
                yb = b["yl"] + (b["yr"] - b["yl"]) * min(max(frac, 0), 1)
                if abs(yb - far_y) < 4.5:
                    cnt += 1
        for g in other:
            if g["c"] in FLAGS and abs(g["x"] - stem["x"]) < 2.5 and abs(g["y"] - far_y) < 6:
                cnt += 1
        return cnt

    for si, lst in notes_by_staff.items():
        for n in lst:
            cands = []
            for s in stems:
                if s["y0"] - 1.6 <= n["y"] <= s["y1"] + 1.6:
                    if abs(s["x"] - (n["x"] + HEAD_W)) < 0.9:
                        cands.append(("up", s))
                    elif abs(s["x"] - n["x"]) < 0.9:
                        cands.append(("down", s))
            # twee stokken aan één kop (twee stemmen op dezelfde toon): de gebalkte stok bepaalt de duur
            best = max(cands, key=lambda c: beam_count_of(c[1], c[0]), default=None)
            n["stem"] = best[1] if best else None
            n["dir"] = best[0] if best else None
            n["twoStems"] = len(cands) > 1
            for g in other:
                if g["c"] in "#nb" and 0 < n["x"] - g["x"] < 11 and abs(g["y"] - n["y"]) < staves[si]["sp"] * 0.9:
                    if n["alter"] is None and g["x"] > 0:
                        n["alter"] = ACCIDENTALS[g["c"]]

    def beam_count(n):
        return beam_count_of(n["stem"], n["dir"]) if n["stem"] else 0

    # één punt achter een akkoord geldt voor alle koppen aan dezelfde stok
    for si, lst in notes_by_staff.items():
        by_stem = defaultdict(list)
        for n in lst:
            if n["stem"] is not None:
                by_stem[id(n["stem"])].append(n)
        for group in by_stem.values():
            if len(group) > 1:
                dots = max(n["dots"] for n in group)
                for n in group:
                    n["dots"] = dots

    for si, lst in notes_by_staff.items():
        for n in lst:
            if n["head"] == HEAD_WHOLE:
                base = 4.0
            elif n["head"] == HEAD_HALF:
                base = 2.0
            elif n["stem"] is None:
                base = 4.0
            else:
                base = {0: 1.0, 1: 0.5, 2: 0.25, 3: 0.125}.get(beam_count(n), 0.25)
            n["base"] = base

    # --- triolen: het cijfer 3 ("£") staat in het midden van de groep. Standaard geldt het voor de drie kolommen rond het cijfer;
    # een triool kan ook uit twee noten bestaan (kwart + achtste). Welke van de twee klopt, volgt uit de maatsom (extract_best).
    tuplet_list = []
    tmode = opts.get("tupletMode", {})
    for ti_, g in enumerate([g for g in other if g["c"] == TUPLET3]):
        si = staff_of(g["y"])
        cols = {}
        for n in notes_by_staff[si]:
            if abs(n["x"] + 2.5 - g["x"]) < 40:
                cols.setdefault(round(n["x"], 0), []).append(n)
        xs = sorted(cols)
        best = None
        for i in range(len(xs) - 2):
            trio = xs[i : i + 3]
            centre = (trio[0] + trio[-1]) / 2 + 2.5
            sc = abs(centre - g["x"]) + (0 if all(cols[x][0]["base"] <= 1.0 for x in trio) else 5)
            if best is None or sc < best[0]:
                best = (sc, trio)
        tuplet_list.append({"i": ti_, "x": g["x"], "y": g["y"], "staff": si})
        if best and best[0] < 14:
            members = {"L2": best[1][:2], "R2": best[1][1:]}.get(tmode.get(ti_, "3"), best[1])
            for x in members:
                for n in cols[x]:
                    n["tuplet"] = 2 / 3
        else:
            problems.append(f"triool bij x={g['x']:.0f} niet te koppelen")

    # --- maatstrepen per treble-balk
    for si in range(len(staves)):
        if staves[si]["clef"] == "treble":
            staves[si]["bars"] = cluster_bars(bar_items[si])
            staves[si]["bars"] = [b for b in staves[si]["bars"] if b["x1"] > staves[si]["x0"] + 30]
    repeat_dots = [g for g in other if g["c"] == REPEAT_DOTS]

    def seg_items(sy, lo, hi):
        """Alle noten en rusten van beide balken met midden in (lo, hi]."""
        items = []
        for si in (sy["treble"], sy["bass"]):
            for n in notes_by_staff[si]:
                if lo < n["x"] + 2.5 <= hi:
                    items.append({"x": n["x"], "dur": n["base"] * (1.0 + 0.5 * n["dots"] if n["dots"] < 2 else 1.75) * n["tuplet"], "note": n, "staff": si})
            for r in rests_by_staff[si]:
                if lo < r["x"] + 2.2 <= hi:
                    base = RESTS[r["kind"]]
                    items.append({"x": r["x"], "dur": None if base is None else base * (1.0 + 0.5 * r["dots"] if r["dots"] < 2 else 1.75) * r["tuplet"], "note": None, "staff": si, "full": base is None})
        items.sort(key=lambda it: it["x"])
        return items

    opts_col_tol = opts.get("colTol", 6.5)

    def _is_second(a, b):
        """Verplaatste kop: een kop in b staat een secunde (1 stap) naast een kop in a op dezelfde balk."""
        for x in a["items"]:
            for y in b["items"]:
                if x["note"] is not None and y["note"] is not None and x["staff"] == y["staff"] and abs(x["note"]["diatonic"] - y["note"]["diatonic"]) <= 1 and 3.5 < abs(y["x"] - x["x"]) < 6.5:
                    return True
        return False

    def timeline(items, full_len):
        """Kolommen en eindtijden; geeft (cols, lengte). Hele-maat-rusten krijgen de maatlengte."""
        # een hele-maat-rust staat gecentreerd in de maat en begint dus op tijd 0, niet op zijn x-positie
        fulls = [it for it in items if it["dur"] is None]
        items = [it for it in items if it["dur"] is not None]
        # kolommen: koppen op bijna dezelfde x horen bij hetzelfde tijdstip. Een verplaatste kop (secunde, ~5 pt ernaast) hoort
        # er ook bij, maar twee stemmen met verschillend ritme staan op verschillende x en mogen niet worden samengevoegd.
        tol = opts_col_tol
        cols = []
        for it in items:
            if cols and it["x"] - cols[-1]["x"] < tol:
                cols[-1]["items"].append(it)
            else:
                cols.append({"x": it["x"], "items": [it]})
        merged = []
        for c in cols:
            if merged and c["x"] - merged[-1]["x"] < 6.5 and _is_second(merged[-1], c):
                merged[-1]["items"].extend(c["items"])
            else:
                merged.append(c)
        cols = merged
        t = 0.0
        active = []
        for ci, col in enumerate(cols):
            col["t"] = t
            for it in col["items"]:
                it["end"] = t + it["dur"]
                active.append(it)
            future = [it["end"] for it in active if it["end"] > t + 1e-9]
            t = min(future) if future else t
        length = max((it["end"] for it in items), default=full_len if fulls else 0.0)
        for it in fulls:
            it["dur"] = it["end"] = length
        return cols, length, fulls

    # --- logische maten: segmenten tussen maatstrepen; staart + kop over een systeemwisseling worden één maat
    measures = []  # {segments:[{system, lo, hi, items}], endKind, endRepeat}
    system_infos = []
    carry = None
    for sy_i, sy in enumerate(systems):
        st = staves[sy["treble"]]
        bars = st["bars"]
        bounds = [st["x0"]] + [b["x1"] for b in bars]
        system_infos.append({"measureStart": len(measures), "measureCount": len(bars), "bounds": [round(b, 1) for b in bounds]})
        for i, b in enumerate(bars):
            lo, hi = bounds[i], b["x1"]
            seg = {"system": sy_i, "lo": lo, "hi": hi, "items": seg_items(sy, lo, hi)}
            end_rep = any(b["x0"] - 14 < g["x"] < b["x0"] + 1 and st["top"] - 2 < g["y"] < st["bottom"] + 2 for g in repeat_dots)
            start_rep = any(b["x1"] - 1 < g["x"] < b["x1"] + 12 and st["top"] - 2 < g["y"] < st["bottom"] + 2 for g in repeat_dots)
            m = {"segments": [seg], "endKind": b["kind"], "endRepeat": end_rep, "startRepeatAfter": start_rep}
            if i == 0 and carry is not None:
                m["segments"] = carry["segments"] + m["segments"]
                carry = None
            elif i == 0 and not seg["items"] and bars and False:
                pass
            if i == 0 and not m["segments"][-1]["items"] and len(m["segments"]) == 1:
                # lege kop (alleen sleutel/voortekens voor de eerste streep): geen maat
                problems.append(f"systeem {sy_i + 1}: lege eerste maat")
            measures.append(m)
        tail_lo = bounds[-1]
        if tail_lo < st["x1"] - 3:
            tail_items = seg_items(sy, tail_lo, st["x1"] + 3)
            if tail_items:
                carry = {"segments": [{"system": sy_i, "lo": tail_lo, "hi": st["x1"] + 3, "items": tail_items}]}
            elif sy_i == len(systems) - 1:
                carry = None
        if carry is not None and sy_i == len(systems) - 1:
            measures.append({"segments": carry["segments"], "endKind": "none", "endRepeat": False, "startRepeatAfter": False})
            carry = None

    # staart die niet door een kop wordt afgesloten (systeem eindigt zonder streep en het volgende begint met een eigen maat):
    # al verwerkt via carry; een carry die overblijft is hierboven toegevoegd.

    # --- tijdlijn per logische maat
    results = []
    gm = 0
    for idx, m in enumerate(measures):
        first = m["segments"][0]
        sg = sig_at(first["system"], first["hi"])
        full = sg[2] * (4 / sg[3])
        cols_all = []
        fulls_all = []
        offset = 0.0
        for seg in m["segments"]:
            cols, length, fulls = timeline(seg["items"], full)
            for f in fulls:
                f["end"] += offset
                f["t0"] = offset
            fulls_all.extend(fulls)
            for c in cols:
                c["t"] += offset
                c["system"] = seg["system"]
                for it in c["items"]:
                    it["end"] += offset
            cols_all.extend(cols)
            offset += length
        results.append({"index": idx, "cols": cols_all, "fulls": fulls_all, "length": offset, "full": full, "sig": sg, "m": m})

    starts = {}
    acc = 0.0
    for r in results:
        starts[r["index"]] = acc
        acc += r["length"]
    n_meas = len(results)

    # --- validatie
    pickup = None
    for r in results:
        m_i = r["index"]
        full = r["full"]
        ok_len = abs(r["length"] - full) < 1e-6
        if not ok_len:
            if m_i == 0 and r["length"] < full:
                pickup = r["length"]
            elif m_i == n_meas - 1 and pickup is not None and abs(r["length"] + pickup - full) < 1e-6:
                pass
            elif m_i == n_meas - 1 and r["length"] < full and r["m"]["endKind"] in ("thickafter", "none") and False:
                pass
            else:
                problems.append(f"maat {m_i + 1}: lengte {r['length']:.4g} != {full:.4g}")
        for col in r["cols"]:
            for it in col["items"]:
                if it["end"] > r["length"] + 1e-6:
                    problems.append(f"maat {m_i + 1}: noot eindigt na de maat (x={it['x']:.1f})")
        ts_ = [c["t"] for c in r["cols"]]
        if any(b <= a for a, b in zip(ts_, ts_[1:])):
            problems.append(f"maat {m_i + 1}: kolomtijden niet stijgend")
        for role in ("treble", "bass"):
            cover = [(c["t"], it["end"]) for c in r["cols"] for it in c["items"] if staves[it["staff"]]["clef"] == role]
            cover += [(f["t0"], f["end"]) for f in r["fulls"] if staves[f["staff"]]["clef"] == role]
            if cover:
                pts = sorted({c[0] for c in cover} | {c[1] for c in cover})
                for a_, b_ in zip(pts, pts[1:]):
                    if b_ > r["length"] + 1e-6:
                        continue
                    if not any(c0 <= a_ + 1e-9 and c1 >= b_ - 1e-9 for c0, c1 in cover):
                        problems.append(f"maat {m_i + 1}: gat in {role} tussen {a_:.4g} en {b_:.4g}")
                        break
            elif r["length"] > 0:
                problems.append(f"maat {m_i + 1}: geen {role}-noten")
        if r["length"] == 0:
            problems.append(f"maat {m_i + 1}: lege maat")

    # --- voortekens per maat in x-volgorde
    for r in results:
        carried = {}
        for col in r["cols"]:
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
    events = []
    for r in results:
        base = starts[r["index"]]
        for col in r["cols"]:
            for it in col["items"]:
                events.append({"staff": it["staff"], "x": it["x"], "t": base + col["t"], "rest": it["note"] is None})
                n = it["note"]
                if n is None:
                    continue
                result_notes.append({"t": round(base + col["t"], 4), "dur": round(it["dur"], 4), "midi": n["midi"], "staff": staves[it["staff"]]["clef"], "measure": r["index"], "system": col["system"], "x": round(it["x"], 1), "dbg": {"dots": n["dots"], "base": n["base"], "stemX": round(n["stem"]["x"], 1) if n["stem"] else None, "dir": n["dir"], "two": n["twoStems"], "y": round(n["y"], 1)}})
    result_notes.sort(key=lambda n: (n["t"], n["midi"]))

    fermatas = []
    for g in other:
        if g["c"] in "Uu":
            si = staff_of(g["y"])
            cand = [e for e in events if e["staff"] == si and not e["rest"]]
            if cand:
                e = min(cand, key=lambda e: abs(e["x"] + 2.5 - g["x"]))
                fermatas.append(round(e["t"], 4))

    # --- lettergrepen uit afzonderlijke tekens
    syllables = []
    for b_ in page.get_text("rawdict")["blocks"]:
        for l in b_.get("lines", []):
            for sp_ in l["spans"]:
                if "Palatino" not in sp_["font"] or "Italic" in sp_["font"]:
                    continue
                y = (l["bbox"][1] + l["bbox"][3]) / 2
                for sy_i, sy in enumerate(systems):
                    st = staves[sy["treble"]]
                    nxt_top = staves[sy["bass"]]["top"]
                    if st["bottom"] + 4 < y < nxt_top - 2:
                        cur = ""
                        x0 = x1 = None
                        for ch in sp_["chars"] + [{"c": " ", "bbox": [0, 0, 0, 0], "origin": [0, 0]}]:
                            c = ch["c"]
                            if c in (" ", "-", "‐", "‑", "–"):
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

    txt = page.get_text("text")
    tempo = re.search(r"=\s*(\d+)\s*-\s*(\d+)", txt)
    first_sig = results[0]["sig"] if results else sigs[0]
    sig_changes = sorted({(r["sig"][2], r["sig"][3]) for r in results})
    repeats = [{"measure": r["index"], "endRepeat": r["m"]["endRepeat"], "startRepeatAfter": r["m"]["startRepeatAfter"]} for r in results if r["m"]["endRepeat"] or r["m"]["startRepeatAfter"]]
    # welke maat bij welke triool hoort (voor de maatsom-gestuurde keuze in extract_best)
    tuplet_measures = []
    for t_ in tuplet_list:
        for r in results:
            if any(seg["system"] == systems_of_staff(t_["staff"]) and seg["lo"] < t_["x"] <= seg["hi"] for seg in r["m"]["segments"]):
                tuplet_measures.append({"i": t_["i"], "measure": r["index"]})
                break
    result = {
        "tuplets": tuplet_measures,
        "source": pdf_path.split("/")[-1],
        "timeSignature": [first_sig[2], first_sig[3]],
        "timeSignatureChanges": [list(s) for s in sig_changes] if len(sig_changes) > 1 else [],
        "beatsPerBar": first_sig[2] * (4 / first_sig[3]),
        "pickup": pickup,
        "keyLetters": {STEP_NAMES[k]: v for k, v in key_letters.items()},
        "tempoQuarterBpm": [int(tempo.group(1)), int(tempo.group(2))] if tempo else None,
        "measureStarts": {str(k): v for k, v in starts.items()},
        "measureLengths": {str(r["index"]): r["length"] for r in results},
        "fermatas": sorted(set(fermatas)),
        "repeats": repeats,
        "sectionEndMeasures": sorted(r["index"] for r in results if r["m"]["endKind"] in ("double", "thickafter", "thickbefore") and r["index"] != n_meas - 1),
        "columns": [{"system": c["system"], "measure": r["index"], "t": round(starts[r["index"]] + c["t"], 4), "xc": round(min(it["x"] for it in c["items"]) + 2.55, 1)} for r in results for c in r["cols"]],
        "notes": result_notes,
        "syllables": syllables,
        "systems": system_infos,
        "warnings": warnings,
        "problems": problems,
    }
    return result


VARIANTS = [
    {"dots": "match", "colTol": 6.5},
    {"dots": "above", "colTol": 6.5},
    {"dots": "match", "colTol": 2.0},
    {"dots": "above", "colTol": 2.0},
    {"dots": "match", "colTol": 2.0, "restBonus": 0.0, "restDy": 3.0},
    {"dots": "match", "colTol": 6.5, "restBonus": 0.0, "restDy": 3.0},
]


def _failing_measures(problems):
    out = set()
    for p in problems:
        m = re.match(r"maat (\d+):", p)
        if m:
            out.add(int(m.group(1)) - 1)
    return out


def extract_best(pdf_path):
    """Probeert de extractievarianten en houdt die met de minste problemen; bij gelijke stand de eerste.
    Bij een triool in een mislukte maat wordt per triool ook een tweenoten-triool geprobeerd (links of rechts); alleen wat de
    maatsom herstelt, blijft staan. Een variant zonder problemen is alleen intern consistent, geen bewijs van juistheid
    (zie de tekstkoppeling en de opnamecontrole in build_nld_music.py en audio_check.py)."""
    best = None
    err = None
    for v in VARIANTS:
        try:
            r = extract(pdf_path, v)
        except Exception as e:  # noqa: BLE001
            err = e
            continue
        r["variant"] = f"{v['dots']}/{v['colTol']}/{v.get('restBonus', '-')}"
        # tweenoten-triolen: greedy per triool in een mislukte maat
        mode = {}
        for _ in range(4):
            if not r["problems"] or not r["tuplets"]:
                break
            failing = _failing_measures(r["problems"])
            improved = False
            for t in r["tuplets"]:
                if t["measure"] not in failing and t["measure"] + 1 not in failing and t["measure"] - 1 not in failing:
                    continue
                for alt in ("L2", "R2"):
                    trial = dict(mode)
                    trial[t["i"]] = alt
                    try:
                        r2 = extract(pdf_path, {**v, "tupletMode": trial})
                    except Exception:  # noqa: BLE001
                        continue
                    if len(r2["problems"]) < len(r["problems"]):
                        r2["variant"] = f"{r['variant']}+triool"
                        r, mode, improved = r2, trial, True
                        break
                if improved:
                    break
            if not improved:
                break
        if best is None or len(r["problems"]) < len(best["problems"]):
            best = r
        if not best["problems"]:
            break
    if best is None:
        raise err
    return best


def main(pdf_path, out_path):
    result = extract_best(pdf_path)
    json.dump(result, open(out_path, "w"), ensure_ascii=False, indent=1)
    print(f"{pdf_path}: {len(result['notes'])} noten, {len(result['measureStarts'])} maten, {len(result['problems'])} problemen")
    for p in result["problems"][:30]:
        print("  !", p)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
