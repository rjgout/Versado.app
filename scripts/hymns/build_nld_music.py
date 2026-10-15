#!/usr/bin/env python3
"""Koppelt per lofzang de gelezen partituur aan de officiële tekst en schrijft de muziekgegevens.

Uitvoer (in src/lib/hymns/library/data/):
  music/<compositieId>.json   de compositie (noten, maten, vorm); één bestand per unieke melodie
  link/NNN.json               per tekst: welke beat bij welke regel/woord/lettergreep hoort

Strikt: een partituur wordt alleen gebruikt als hij zonder extractieproblemen is gelezen (extract_score), de
bladmuziektekst onder de noten overeenkomt met de officiële tekst, en de koppelingen oplopend zijn. Wat daar niet aan
voldoet, wordt NIET opgeslagen en komt met de reden in het kwaliteitsrapport. Er wordt nooit een gok als zeker bewaard.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import unicodedata  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
CACHE = ROOT / ".cache/hymns/nld"
DATA = ROOT / "src/lib/hymns/library/data"
def norm(w):
    w = unicodedata.normalize("NFKD", w.lower())
    w = "".join(c for c in w if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", w)


def group_rows(syls, system):
    """Groepeert de lettergrepen van één systeem in tekstrijen (per couplet één rij), van boven naar onder."""
    rows = []
    for s in sorted([s for s in syls if s["system"] == system], key=lambda s: (s["y"], s["x0"])):
        if rows and abs(rows[-1][0]["y"] - s["y"]) < 3:
            rows[-1].append(s)
        else:
            rows.append([s])
    return [sorted(r, key=lambda s: s["x0"]) for r in rows]


LABELS = {"koren", "allen", "solo", "mannen", "vrouwen", "refrein", "eenstemmig", "tutti"}
HARD = ("geen overeenkomst", "te weinig woorden", "woorden in de balk over")


def hard_count(diffs):
    return sum(1 for d in diffs if d.startswith("HARD"))


def system_measure(score, sys_i, x):
    s = score["systems"][sys_i]
    bounds = s["bounds"]
    for k in range(len(bounds) - 1):
        if bounds[k] < x <= bounds[k + 1]:
            return s["measureStart"] + k
    return s["measureStart"] + s["measureCount"]  # staartfragment hoort bij de maat die in het volgende systeem afsluit


def row_syllables(row, cols):
    """Lettergrepen van één tekstrij met de beat van de dichtstbijzijnde notenkolom; nummers en uitvoeringsaanwijzingen vervallen."""
    out = []
    for s in row:
        t = s["t"]
        if re.fullmatch(r"\d+\.", t) or norm(t) in LABELS or not norm(t):
            continue
        center = (s["x0"] + s["x1"]) / 2
        col = min(cols, key=lambda c: abs(c["xc"] - center))
        out.append({"s": t, "t": col["t"], "dx": abs(col["xc"] - center)})
    return out


def align_words(lines, syls, label):
    """Legt de lettergrepen onder de noten langs de officiële tekst via een tekenvergelijking.

    Waarom tekens en niet woorden: de bladmuziek splitst woorden over regels, plakt woorden aan elkaar of schrijft
    een samenstelling anders; een tekenvergelijking is daar tegen bestand en laat toch elk verschil zien. Geeft (regels, afwijkingen)."""
    import difflib

    sheet = "".join(norm(x["s"]) for x in syls)
    owner_s = [i for i, x in enumerate(syls) for _ in norm(x["s"])]
    words = []  # (lijn, woord)
    for li, line in enumerate(lines):
        for w in line.split():
            words.append((li, w))
    text = "".join(norm(w) for _, w in words)
    owner_t = [j for j, (_, w) in enumerate(words) for _ in norm(w)]
    diffs = []
    if not text or not sheet:
        return None, [f"HARD {label}: lege tekst of lege tekstrij"]
    sm = difflib.SequenceMatcher(None, sheet, text, autojunk=False)
    pos_t2s = {}
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            pos_t2s[blk.b + k] = blk.a + k
    matched = len(pos_t2s)
    missing = len(text) - matched
    extra = len(sheet) - matched
    # Weinig overeenkomst = de tekstrij onder de noten hoort niet bij deze tekst (HARD: onbruikbaar). Een klein verschil (andere
    # spelling, een extra herhaling) laat de regels bruikbaar maar zonder woordkoppeling voor de afwijkende woorden (SOFT).
    if missing / len(text) > 0.15 or matched < 0.7 * min(len(text), len(sheet)):
        diffs.append(f"HARD {label}: {missing} van {len(text)} tekens uit de officiële tekst niet in de bladmuziek teruggevonden")
    elif missing / len(text) > 0.03:
        diffs.append(f"{label}: {missing} van {len(text)} tekens uit de officiële tekst niet in de bladmuziek teruggevonden")
    if extra / len(sheet) > 0.15 and matched < 0.85 * len(sheet):
        diffs.append(f"HARD {label}: {extra} van {len(sheet)} tekens onder de noten niet in de officiële tekst")
    elif extra / len(sheet) > 0.05:
        diffs.append(f"{label}: {extra} van {len(sheet)} tekens onder de noten niet in de officiële tekst")
    out = [{"text": line, "words": []} for line in lines]
    prev_b = None
    word_first_char = {}
    for ti, j in enumerate(owner_t):
        word_first_char.setdefault(j, []).append(ti)
    for j, (li, w) in enumerate(words):
        chars = word_first_char.get(j, [])
        hit = [c for c in chars if c in pos_t2s]
        if not chars:
            # een los leesteken (bv. een gedachtestreepje) heeft geen eigen klank; het deelt de beat van het vorige woord
            out[li]["words"].append({"w": w, "b": prev_b if prev_b is not None else 0.0})
            continue
        if len(hit) < max(1, 0.6 * len(chars)):
            diffs.append(f"{label}: woord '{w}' niet aan de bladmuziek te koppelen")
            out[li]["words"].append({"w": w, "b": None})
            continue
        owners = sorted({owner_s[pos_t2s[c]] for c in hit})
        sy = [[syls[o]["s"], syls[o]["t"]] for o in owners]
        b = syls[owners[0]]["t"]
        if prev_b is not None and b < prev_b - 1e-6:
            diffs.append(f"{label}: woord '{w}' staat voor het vorige woord (beat {b} < {prev_b})")
        prev_b = b
        out[li]["words"].append({"w": w, "b": b, "syl": sy})
        if any(syls[o]["dx"] > 14 for o in owners):
            diffs.append(f"{label}: woord '{w}' staat ver van zijn noot")
    for li, ln in enumerate(out):
        if ln["words"] and all(w["b"] is None for w in ln["words"]):
            diffs.append(f"HARD {label}: regel {li + 1} heeft geen enkel gekoppeld woord")
    return out, diffs


def try_boundary(text, score, boundary):
    """boundary = beat waar het refrein begint (None = geen refrein in de muziek). Een refrein kan midden in een maat
    beginnen (opmaat die in het volgende systeem wordt afgemaakt), dus de grens is een beat en geen maatnummer."""
    stanzas = text["stanzas"]
    row_stanzas = [s for s in stanzas if not s.get("belowMusic")]
    cols_by_system = {}
    for c in score["columns"]:
        cols_by_system.setdefault(c["system"], []).append(c)
    verse_rows, chorus_rows, diffs = {}, {}, []
    extra = 0
    for si in range(len(score["systems"])):
        syl = [s for s in score["syllables"] if s["system"] == si]
        cols = cols_by_system.get(si, [])

        def meas(sy):  # de maat van de dichtstbijzijnde notenkolom (de lettergreep staat links uitgelijnd onder zijn noot)
            return min(cols, key=lambda c: abs(c["xc"] - (sy["x0"] + sy["x1"]) / 2))["t"] if cols else 0

        vs = [s for s in syl if boundary is None or meas(s) < boundary]
        cs = [s for s in syl if boundary is not None and s not in vs]
        for ri, row in enumerate(group_rows(vs, si)):
            if ri < len(row_stanzas):
                verse_rows.setdefault(ri, []).extend(row_syllables(row, cols))
            else:
                extra += 1
        for ri, row in enumerate(group_rows(cs, si)):
            chorus_rows.setdefault(ri, []).extend(row_syllables(row, cols))
    linked = {}
    for ri, st in enumerate(row_stanzas):
        if ri not in verse_rows:
            diffs.append(f"HARD couplet {st['n']}: geen tekstrij onder de noten")
            continue
        lines, d = align_words(st["lines"], verse_rows[ri], f"couplet {st['n']}")
        diffs += d
        if lines:
            linked[st["n"]] = lines
    chorus_lines = None
    if text["choruses"]:
        if chorus_rows:
            # staan er onder het refrein meerdere tekstrijen (bv. afwijkende woorden per couplet), dan telt de rij die het best past
            best = None
            for ri, syl in sorted(chorus_rows.items()):
                lines, d = align_words(text["choruses"][0], syl, "refrein")
                key = (hard_count(d), len(d))
                if lines is not None and (best is None or key < best[0]):
                    best = (key, lines, d)
            if best:
                chorus_lines, d = best[1], best[2]
                diffs += d
            else:
                diffs.append("HARD refrein: geen woorden onder de noten gevonden")
        else:
            diffs.append("HARD refrein: geen woorden onder de noten gevonden")
    if extra:
        diffs.append(f"{extra} extra tekstrij(en) onder de muziek niet gemodelleerd")
    return linked, chorus_lines, diffs


def build_link(text, score):
    """Geeft (link, composition-info, diffs, boundary) of gooit ValueError met een reden."""
    cands = [None]
    if text["choruses"]:
        starts_m = [score["measureStarts"][str(i)] for i in range(len(score["measureStarts"]))]
        sys_first = {}
        for c in score["columns"]:
            if c["system"] not in sys_first or c["t"] < sys_first[c["system"]]:
                sys_first[c["system"]] = c["t"]
        after_end = [starts_m[m + 1] for m in score["sectionEndMeasures"] if m + 1 < len(starts_m)]
        cands = sorted({t for t in list(sys_first.values()) + after_end if t > 0})
        if not cands:
            raise ValueError("refrein in tekst maar geen sectiegrens in de muziek")
    best = None
    for b in cands:
        linked, chorus_lines, diffs = try_boundary(text, score, b)
        key = (hard_count(diffs), len(diffs))
        if best is None or key < best[0]:
            best = (key, b, linked, chorus_lines, diffs)
    return best[1:]


def beats_of(line):
    return [w["b"] for w in line["words"] if w["b"] is not None]


def finalize_stanzas(text, linked, ref_n):
    """Maakt per couplet het koppelingsrecord. Een couplet met harde afwijkingen valt terug op regelniveau."""
    out = []
    ref = linked.get(ref_n)
    for st in text["stanzas"]:
        n = st["n"]
        lines = linked.get(n)
        if lines is not None:
            rec_lines = []
            ok = True
            for ln in lines:
                bs = [w["b"] for w in ln["words"]]
                first = next((b for b in bs if b is not None), None)
                if first is None or any(b is None for b in bs):
                    ok = False
                rec_lines.append({"start": first, "words": bs, "syl": [w.get("syl") for w in ln["words"]]})
            # woorden moeten oplopen binnen het couplet
            flat = [b for ln in rec_lines for b in ln["words"] if b is not None]
            if any(b2 < b1 - 1e-6 for b1, b2 in zip(flat, flat[1:])):
                ok = False
            out.append({"n": n, "linking": "word" if ok else "line", "lines": rec_lines})
        else:
            # zonder eigen notenbalk: frasering van couplet 1, alleen regelstart
            rl = []
            for j, _ in enumerate(st["lines"]):
                src = ref[min(j, len(ref) - 1)] if ref else None
                first = next((w["b"] for w in src["words"] if w["b"] is not None), None) if src else None
                rl.append({"start": first, "words": [None] * len(st["lines"][j].split()), "syl": [None] * len(st["lines"][j].split())})
            out.append({"n": n, "linking": "line", "lines": rl})
    return out


def comp_from_score(score):
    n_meas = len(score["measureStarts"])
    starts = [score["measureStarts"][str(i)] for i in range(n_meas)]
    total = starts[-1] + score["measureLengths"][str(n_meas - 1)]
    return starts, total


def process(n, text, score, summary):
    """Geeft (status, reasons, link, comp) voor één lofzang."""
    reasons = []
    if score is None:
        return "geen-muziek", ["geen bladmuziek-PDF"], None, None
    if summary.get("status") == "fout":
        return "onzeker", [f"extractiefout: {summary.get('error')}"], None, None
    if score["problems"]:
        return "onzeker", [f"{len(score['problems'])} extractieproblemen, o.a. {score['problems'][0]}"], None, None
    if score["repeats"]:
        return "onzeker", ["herhalingstekens in de partituur (gespeelde volgorde niet gemodelleerd)"], None, None
    try:
        boundary, linked, chorus_lines, diffs = build_link(text, score)
    except ValueError as e:
        return "onzeker", [str(e)], None, None
    starts, total = comp_from_score(score)
    row_n = [s["n"] for s in text["stanzas"] if not s.get("belowMusic")]
    if not row_n or row_n[0] not in linked:
        return "onzeker", ["geen tekst onder de noten gekoppeld"] + diffs[:3], None, None
    hard = hard_count(diffs)
    stanzas = finalize_stanzas(text, linked, row_n[0])
    chorus = None
    if text["choruses"]:
        if chorus_lines is None or boundary is None:
            return "onzeker", ["refrein niet aan de muziek te koppelen"] + diffs[:3], None, None
        crl = []
        for ln in chorus_lines:
            bs = [w["b"] for w in ln["words"]]
            crl.append({"start": next((b for b in bs if b is not None), None), "words": bs, "syl": [w.get("syl") for w in ln["words"]]})
        ok = all(all(b is not None for b in r["words"]) for r in crl)
        chorus = {"linking": "word" if ok else "line", "lines": crl}
    word_ok = all(s["linking"] == "word" for s in stanzas if s["n"] in linked) and (chorus is None or chorus["linking"] == "word")
    # regelstarten moeten overal bestaan en oplopen binnen couplet 1
    first = stanzas[0]["lines"]
    starts_ok = all(l["start"] is not None for l in first) and all(b["start"] >= a["start"] - 1e-6 for a, b in zip(first, first[1:]))
    if not starts_ok:
        return "onzeker", ["regelstarten van couplet 1 niet oplopend of onvolledig"] + diffs[:3], None, None
    sections = [{"id": "verse", "startBeat": 0.0, "endBeat": total}]
    if boundary is not None:
        sections = [{"id": "verse", "startBeat": 0.0, "endBeat": boundary}, {"id": "chorus", "startBeat": boundary, "endBeat": total}]
    comp = {
        "timeSignature": score["timeSignature"],
        "beatsPerBar": score["beatsPerBar"],
        "tempoQuarterBpm": score["tempoQuarterBpm"],
        "keySignature": score["keyLetters"],
        "measureStarts": starts,
        "totalBeats": total,
        "sections": sections,
        "fermatas": score["fermatas"],
        "notes": [[nt["t"], nt["dur"], nt["midi"], 0 if nt["staff"] == "treble" else 1] for nt in score["notes"]],
    }
    link = {"stanzas": stanzas, "chorus": chorus, "boundary": boundary, "diffs": diffs}
    status = "gevalideerd" if hard == 0 else "onzeker"
    if hard:
        reasons.append(f"{hard} harde tekstafwijkingen tussen bladmuziek en officiële tekst, o.a. {[d for d in diffs if d.startswith("HARD")][0]}")
    return status, reasons, link, {"comp": comp, "wordLinking": word_ok}


def comp_hash(comp):
    raw = json.dumps([comp["measureStarts"], comp["notes"], comp["sections"]], separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def build_all(index, flog):
    """Schrijft music/ en link/ en geeft per lofzang het muziekrecord voor het manifest."""
    for sub in ("music", "link"):
        d = DATA / sub
        d.mkdir(parents=True, exist_ok=True)
        for f in d.glob("*.json"):
            f.unlink()
    summary = json.loads((CACHE / "score" / "_summary.json").read_text())
    by_hash = {}
    records = {}
    for h in sorted(index, key=lambda h: h["number"]):
        n = h["number"]
        tf = DATA / "text" / f"{n:03d}.json"
        rec = {"musicStatus": "geen-tekst" if not tf.exists() else None, "musicReasons": [], "compositionId": None, "wordLinking": False}
        if not tf.exists():
            rec["musicReasons"] = ["tekst niet gepubliceerd door de kerk (licentiebeperking)"]
            records[n] = rec
            continue
        text = json.loads(tf.read_text())
        sf = CACHE / "score" / f"{h['slug']}.score.json"
        score = json.loads(sf.read_text()) if sf.exists() else None
        status, reasons, link, extra = process(n, text, score, summary.get(str(n), {}))
        rec["musicStatus"], rec["musicReasons"] = status, reasons
        if status == "gevalideerd":
            comp = extra["comp"]
            hsh = comp_hash(comp)
            if hsh not in by_hash:
                by_hash[hsh] = f"comp:{h['slug']}"
                comp = {"id": by_hash[hsh], "officialSlug": h["slug"], **comp, "source": {"pdfSha": flog[str(n)].get("pdfSha"), "extractor": score.get("variant")}}
                (DATA / "music" / f"{h['slug']}.json").write_text(json.dumps(comp, ensure_ascii=False, separators=(",", ":")) + "\n")
            rec["compositionId"] = by_hash[hsh]
            link["compositionId"] = rec["compositionId"]
            rec["wordLinking"] = extra["wordLinking"]
            (DATA / "link" / f"{n:03d}.json").write_text(json.dumps(link, ensure_ascii=False, separators=(",", ":")) + "\n")
        records[n] = rec
    return records


if __name__ == "__main__":
    index = json.loads((CACHE / "index.json").read_text())["hymns"]
    flog = json.loads((CACHE / "fetch-log.json").read_text())
    r = build_all(index, flog)
    from collections import Counter
    print(Counter(v["musicStatus"] for v in r.values()), "woordkoppeling:", sum(v["wordLinking"] for v in r.values()))
    for n, v in sorted(r.items()):
        if v["musicStatus"] == "onzeker":
            print(n, v["musicReasons"][:1])
