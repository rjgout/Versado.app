#!/usr/bin/env python3
"""Bouwt de lokale proefbibliotheek (src/lib/hymns/library/nld-poc.json) uit:
  - de officiële lofzangpagina (HTML-tekst met coupletten/refrein), en
  - de met extract_score.py uit de officiële PDF gelezen partituur.

Aanroep: build_library.py <cachemap> <uitvoerbestand>
De cachemap bevat per lofzang <slug>.page.json (de teksten van de pagina) en <slug>.score.json.
Zie docs/hymns/01-SOURCE-AUDIT.md voor de herkomst en de rechtenaantekening.
"""
import json
import re
import sys
import unicodedata

HYMNS = [
    {"number": 24, "slug": "praise-to-the-man"},
    {"number": 36, "slug": "come-o-thou-king-of-kings"},
    {"number": 82, "slug": "come-follow-me"},
]


def norm(w):
    w = unicodedata.normalize("NFKD", w.lower())
    w = "".join(c for c in w if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", w)


def edit_distance(a, b):
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def parse_page(body):
    """Haalt coupletten, refrein en bronvermeldingen uit de officiële pagina-HTML."""
    body = re.sub(r' data-aid="\d+"| id="[^"]*"', "", body)
    title = re.search(r"<h1>(.*?)</h1>", body).group(1)
    number = int(re.search(r'class="song-number">(\d+)<', body).group(1))
    tempo = re.search(r'<p class="label">([^<\[]+)</p>', body)
    stanzas = []
    for m in re.finditer(r'<div class="stanza">(.*?)</div>', body, re.S):
        lines = re.findall(r'<p class="line">(.*?)</p>', m.group(1), re.S)
        num = int(re.search(r'verse-number">(\d+)\.', lines[0]).group(1))
        lines = [re.sub(r"<[^>]+>", "", l).strip() for l in lines]
        lines[0] = re.sub(r"^\d+\.\s*", "", lines[0])
        stanzas.append({"n": num, "lines": lines, "belowMusic": False})
    # coupletten "onder de muziek" hebben geen eigen balk met lettergrepen
    below = re.search(r'verses-below-the-music">(.*)</div>\s*</div>', body, re.S)
    if below:
        for st in stanzas:
            if any(f"{st['n']}. " in re.sub(r"<[^>]+>", "", x) for x in re.findall(r'verse-number">(\d+\. )', below.group(1))):
                pass
        nums_below = {int(x) for x in re.findall(r'verse-number">(\d+)\.', below.group(1))}
        for st in stanzas:
            st["belowMusic"] = st["n"] in nums_below
    chorus = None
    cm = re.search(r'<div class="chorus">(.*?)</div>', body, re.S)
    if cm:
        chorus = [re.sub(r"<[^>]+>", "", l).strip() for l in re.findall(r'<p class="line">(.*?)</p>', cm.group(1), re.S)]
    text_credit = re.search(r"<em>Tekst:</em>\s*(.*?)</p>", body)
    music_credit = re.search(r"<em>Muziek:</em>\s*(.*?)</p>", body)
    scripture = re.findall(r'scripture-ref"[^>]*>(.*?)</(?:a|span)>', body)
    return {
        "number": number,
        "title": title,
        "tempoLabel": tempo.group(1).strip() if tempo else None,
        "stanzas": stanzas,
        "chorus": chorus,
        "textCredit": text_credit.group(1) if text_credit else None,
        "musicCredit": music_credit.group(1) if music_credit else None,
        "scriptureRefs": scripture,
    }


def group_rows(syls, system):
    rows = []
    for s in sorted([s for s in syls if s["system"] == system], key=lambda s: (s["y"], s["x0"])):
        if rows and abs(rows[-1][0]["y"] - s["y"]) < 3:
            rows[-1].append(s)
        else:
            rows.append([s])
    return [sorted(r, key=lambda s: s["x0"]) for r in rows]


def append_row(words, row, columns_of_system):
    """Voegt lettergrepen toe aan `words`; een woord dat op een afbreekstreepje eindigt loopt door
    in de volgende balk (regelafbreking van de bladmuziek)."""
    cur = words[-1] if words and words[-1]["open"] else None
    for s in row:
        if re.fullmatch(r"\d+\.", s["t"]):
            continue
        center = (s["x0"] + s["x1"]) / 2
        col = min(columns_of_system, key=lambda c: abs(c["xc"] - center))
        syl = {"s": s["t"], "t": col["t"], "dx": round(abs(col["xc"] - center), 1)}
        if cur is None:
            cur = {"syls": [], "open": False}
            words.append(cur)
        cur["syls"].append(syl)
        cur["open"] = bool(s["hyphen"])
        if not s["hyphen"]:
            cur = None


def link_lines(lines, words, label):
    """Legt de woorden van een lyrics-rij langs de officiële regels. Geeft (regels, afwijkingen).

    Drie gevallen komen in de bladmuziek voor en worden bewust ondersteund: een woord dat door de
    regelafbreking in twee balkwoorden is gesplitst ("heel" + "al,"), een samenstelling die in de
    tekst uit twee woorden bestaat ("mede erfgenaam"), en kleine tekstverschillen (afwijkingen
    worden gemeld, niet stilzwijgend verbeterd)."""
    out = []
    diffs = []
    wi = 0
    for line in lines:
        toks = line.split()
        lw = []
        ti = 0
        while ti < len(toks):
            tok = toks[ti]
            if wi >= len(words):
                diffs.append(f"{label}: te weinig woorden in de balk bij '{tok}'")
                lw.append({"w": tok, "b": None})
                ti += 1
                continue
            pw = words[wi]
            ptext = "".join(x["s"] for x in pw["syls"])
            if norm(ptext) == norm(tok) or edit_distance(norm(ptext), norm(tok)) <= 1:
                if norm(ptext) != norm(tok):
                    diffs.append(f"{label}: tekst '{tok}' versus bladmuziek '{ptext}'")
                lw.append({"w": tok, "b": pw["syls"][0]["t"], "syl": [[x["s"], x["t"]] for x in pw["syls"]]})
                wi += 1
                ti += 1
                continue
            # bladmuziekwoord is samengesteld uit meerdere tekstwoorden
            joined, k = tok, 1
            while ti + k < len(toks) and len(norm(joined)) < len(norm(ptext)):
                joined += toks[ti + k]
                k += 1
            if k > 1 and norm(joined) == norm(ptext):
                for j in range(k):
                    lw.append({"w": toks[ti + j], "b": pw["syls"][0]["t"] if j == 0 else None})
                lw[-k]["syl"] = [[x["s"], x["t"]] for x in pw["syls"]]
                diffs.append(f"{label}: '{' '.join(toks[ti:ti + k])}' is in de bladmuziek één woord ('{ptext}')")
                wi += 1
                ti += k
                continue
            # tekstwoord is door regelafbreking in de bladmuziek in meerdere stukken gesplitst
            j, merged = 1, ptext
            while wi + j < len(words) and len(norm(merged)) < len(norm(tok)):
                merged += "".join(x["s"] for x in words[wi + j]["syls"])
                j += 1
            if j > 1 and norm(merged) == norm(tok):
                syls = [x for q in range(j) for x in words[wi + q]["syls"]]
                lw.append({"w": tok, "b": syls[0]["t"], "syl": [[x["s"], x["t"]] for x in syls]})
                diffs.append(f"{label}: '{tok}' staat in de bladmuziek over {j} stukken (regelafbreking)")
                wi += j
                ti += 1
                continue
            diffs.append(f"{label}: geen overeenkomst '{tok}' versus '{ptext}'")
            lw.append({"w": tok, "b": None})
            ti += 1
        out.append({"text": line, "words": lw})
    if wi != len(words):
        diffs.append(f"{label}: {len(words) - wi} woorden in de balk over")
    return out, diffs


def main(cache, out_path):
    compositions = []
    texts = []
    entries = []
    audit = {}
    for h in HYMNS:
        slug = h["slug"]
        page = json.load(open(f"{cache}/{slug}.page.json"))
        score = json.load(open(f"{cache}/{slug}.score.json"))
        info = parse_page(page["body"])
        assert info["number"] == h["number"], (info["number"], h["number"])
        assert not score["problems"], score["problems"]

        measure_starts = [score["measureStarts"][str(i)] for i in range(len(score["measureStarts"]))]
        n_meas = len(measure_starts)
        total = measure_starts[-1] + score["measureLengths"][str(n_meas - 1)]
        sect_ends = score["sectionEndMeasures"]
        sections = []
        if sect_ends:
            sections.append({"id": "verse", "startBeat": 0.0, "endBeat": measure_starts[sect_ends[0] + 1]})
            sections.append({"id": "chorus", "startBeat": measure_starts[sect_ends[0] + 1], "endBeat": total})
        else:
            sections.append({"id": "verse", "startBeat": 0.0, "endBeat": total})
        if bool(info["chorus"]) != bool(sect_ends):
            raise SystemExit(f"{slug}: refrein in tekst en dubbele maatstreep in muziek komen niet overeen")

        # kolommen per systeem
        cols_by_system = {}
        for c in score["columns"]:
            cols_by_system.setdefault(c["system"], []).append(c)
        # alleen kolommen met een treble-noot zijn voor tekst relevant; de kolommen zijn gedeeld
        sys_measure0 = {i: s["measureStart"] for i, s in enumerate(score["systems"])}

        def section_of_system(i):
            m = sys_measure0[i]
            if sect_ends and m > sect_ends[0]:
                return "chorus"
            return "verse"

        # rijen per sectie: lijst van (stanza-volgorde) -> woorden
        n_row_stanzas = len([st for st in info["stanzas"] if not st["belowMusic"]])
        verse_rows = {}   # rijindex -> woorden
        chorus_words = []
        first_verse_rows = None
        for si in range(len(score["systems"])):
            rows = group_rows(score["syllables"], si)
            cols = cols_by_system.get(si, [])
            sec = section_of_system(si)
            if sec == "verse":
                if first_verse_rows is None:
                    first_verse_rows = len(rows)
                for ri, row in enumerate(rows[:n_row_stanzas]):
                    append_row(verse_rows.setdefault(ri, []), row, cols)
            else:
                for row in rows:
                    append_row(chorus_words, row, cols)

        # coupletten: rijen 0.. -> coupletnummers 1.. voor stanzas die onder de muziek staan
        row_stanzas = [st for st in info["stanzas"] if not st["belowMusic"]]
        diffs = []
        extra_rows = sum(max(0, len(group_rows(score["syllables"], si)) - n_row_stanzas) for si in range(len(score["systems"])) if section_of_system(si) == "verse")
        if extra_rows:
            diffs.append(f"{slug}: {extra_rows} extra tekstrij(en) onder de muziek (herhalingstekst) niet gemodelleerd")
        if len(verse_rows) != len(row_stanzas):
            diffs.append(f"{slug}: {len(verse_rows)} tekstbalken versus {len(row_stanzas)} coupletten onder de muziek")
        stanza_out = []
        linked = {}
        for idx, st in enumerate(info["stanzas"]):
            if not st["belowMusic"] and idx in verse_rows:
                lines, d = link_lines(st["lines"], verse_rows[idx], f"{slug} couplet {st['n']}")
                diffs += d
                linked[st["n"]] = lines
                stanza_out.append({"n": st["n"], "linking": "word", "lines": lines})
        # coupletten zonder balk: zelfde frasering als couplet 1 (alleen regelstart)
        ref = stanza_out[0]
        for st in info["stanzas"]:
            if st["belowMusic"]:
                if len(st["lines"]) != len(ref["lines"]):
                    diffs.append(f"{slug} couplet {st['n']}: {len(st['lines'])} regels versus {len(ref['lines'])} in couplet 1")
                lines = []
                for j, line in enumerate(st["lines"]):
                    first = next((w["b"] for w in ref["lines"][min(j, len(ref["lines"]) - 1)]["words"] if w["b"] is not None), None)
                    lines.append({"text": line, "words": [{"w": t, "b": None} for t in line.split()], "startBeat": first})
                stanza_out.append({"n": st["n"], "linking": "line", "lines": lines})
        stanza_out.sort(key=lambda s: s["n"])
        for st in stanza_out:
            for ln in st["lines"]:
                if "startBeat" not in ln:
                    ln["startBeat"] = next((w["b"] for w in ln["words"] if w["b"] is not None), None)
        chorus_out = None
        if info["chorus"]:
            lines, d = link_lines(info["chorus"], chorus_words, f"{slug} refrein")
            diffs += d
            for ln in lines:
                ln["startBeat"] = next((w["b"] for w in ln["words"] if w["b"] is not None), None)
            chorus_out = {"linking": "word", "lines": lines}

        comp_id = f"comp:{slug}"
        text_id = f"nld:{slug}"
        compositions.append(
            {
                "id": comp_id,
                "officialSlug": slug,
                "timeSignature": score["timeSignature"],
                "beatsPerBar": score["beatsPerBar"],
                "tempoQuarterBpm": score["tempoQuarterBpm"],
                "keySignature": score["keyLetters"],
                "measureStarts": measure_starts,
                "totalBeats": total,
                "sections": sections,
                "fermatas": score["fermatas"],
                # [startBeat, duurInBeats, midiNoot, balk(0=treble,1=bass)]
                "notes": [[n["t"], n["dur"], n["midi"], 0 if n["staff"] == "treble" else 1] for n in score["notes"]],
                "musicCredit": info["musicCredit"],
            }
        )
        texts.append(
            {
                "id": text_id,
                "compositionId": comp_id,
                "language": "nld",
                "title": info["title"],
                "tempoLabel": info["tempoLabel"],
                "textCredit": info["textCredit"],
                "scriptureRefs": info["scriptureRefs"],
                "stanzas": stanza_out,
                "chorus": chorus_out,
            }
        )
        entries.append({"number": info["number"], "textId": text_id, "compositionId": comp_id})
        audit[slug] = diffs

    out = {
        "schemaVersion": 1,
        "rights": "Afgeleid van de officiële Nederlandse lofzangen (Gospel Library) met toestemming van de eigenaar van Versado. Niet als losstaand bestand delen met een instantie die die toestemming niet apart heeft.",
        "edition": {
            "id": "nld-lofzangen",
            "language": "nld",
            "title": "Lofzangen (huidige Nederlandstalige zangboek)",
            "sourceUrl": "https://www.churchofjesuschrist.org/study/manual/hymns?lang=nld",
            "entries": entries,
        },
        "compositions": compositions,
        "texts": texts,
    }
    json.dump(out, open(out_path, "w"), ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(audit, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
