#!/usr/bin/env python3
"""Bouwt de afgeleide gegevens van de Nederlandse lofzangenbibliotheek uit de gecachte bronbestanden
(.cache/hymns/nld/, gevuld door import_nld.py). Deterministisch en idempotent: dezelfde bron geeft byte-voor-byte
dezelfde uitvoer, zodat een wijziging in git ook een echte bronwijziging is.

Uitvoer in src/lib/hymns/library/data/:
  manifest.json   bron, tellingen en per lofzang de kwaliteitsstatus + bronhashes
  search.json     compacte zoekindex (nummer, titel, eerste regel)
  text/NNN.json   tekst per lofzang (alleen wat de officiële pagina geeft)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hymn_text as T  # noqa: E402
import build_nld_music as M  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
CACHE = ROOT / ".cache/hymns/nld"
OUT = ROOT / "src/lib/hymns/library/data"
BASE = "https://www.churchofjesuschrist.org"


def dump(path: Path, obj, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    s = json.dumps(obj, ensure_ascii=False, sort_keys=True, **({"separators": (",", ":")} if compact else {"indent": 1}))
    path.write_text(s + "\n")


def main():
    index = json.loads((CACHE / "index.json").read_text())["hymns"]
    flog = json.loads((CACHE / "fetch-log.json").read_text())
    entries, search = [], []
    for h in index:
        n = h["number"]
        page = json.loads((CACHE / "pages" / f"{h['slug']}.json").read_text())
        t = T.parse_hymn_page(page["body"])
        rec = flog[str(n)]
        assert t["number"] == n, (n, t["number"])
        meta = page["meta"]
        text = {
            "id": f"nld:{n}",
            "number": n,
            "title": t["title"],
            "subtitle": t["subtitle"],
            "tempoLabel": t["tempoLabel"],
            "stanzas": [{k: v for k, v in s.items() if not (k in ("belowMusic", "chorus") and (v is None or v is False))} for s in t["stanzas"]],
            "choruses": t["choruses"],
            "leadingChorus": t["leadingChorus"],
            "textCredit": t["textCredit"],
            "musicCredit": t["musicCredit"],
            "notices": t["notices"],
            "rights": t["rights"],
            "scriptureRefs": t["scriptureRefs"],
            "source": {
                "pageUrl": meta.get("canonicalUrl") or f"{BASE}/study/manual/hymns/{h['slug']}?lang=nld",
                "pageSha": rec["pageSha"],
                "pdfUrl": rec.get("pdfUrl"),
                "pdfSha": rec.get("pdfSha"),
            },
        }
        if t["available"]:
            dump(OUT / "text" / f"{n:03d}.json", text)
        status = "volledig" if t["available"] and not t["issues"] else ("niet-gepubliceerd" if not t["available"] else "onzeker")
        entries.append({
            "number": n, "id": f"nld:{n}", "slug": h["slug"], "title": h["title"], "section": h.get("section"),
            "textStatus": status, "textIssues": t["issues"],
            "stanzaCount": len(t["stanzas"]), "hasChorus": bool(t["choruses"]),
            "pageSha": rec["pageSha"], "pdfUrl": rec.get("pdfUrl"), "pdfSha": rec.get("pdfSha"),
        })
        if t["available"]:
            first = t["stanzas"][0]["lines"][0] if t["stanzas"] else ""
            search.append([n, h["title"], first])
        else:
            search.append([n, h["title"], ""])
    entries.sort(key=lambda e: e["number"])
    music = M.build_all(index, flog)
    audio = json.loads((CACHE / "audio-check.json").read_text()) if (CACHE / "audio-check.json").exists() else {}
    recog = json.loads((OUT / "recognition-eval.json").read_text()) if (OUT / "recognition-eval.json").exists() else {}
    summary = json.loads((CACHE / "score" / "_summary.json").read_text())
    for e in entries:
        m = music[e["number"]]
        a = audio.get(str(e["number"]))
        status = m["musicStatus"]
        reasons = list(m["musicReasons"])
        # onafhankelijke controle tegen de officiële begeleidingsopname (zie audio_check.py)
        audio_state = "niet-beschikbaar"
        if a:
            # De opname is de ENGELSE begeleiding van dezelfde melodie; een andere harmonisatie in het Nederlandse boek geeft dus
            # geen fout in de extractie. "afwijkend" blokkeert de status daarom niet, maar telt ook niet als bevestiging.
            audio_state = "bevestigd" if a["rank"] <= 3 else "afwijkend"
        e["music"] = {"status": status, "reasons": reasons, "compositionId": m["compositionId"] if status == "gevalideerd" else None,
                      "extractionProblems": summary.get(str(e["number"]), {}).get("nProblems", 0), "audioCheck": audio_state,
                      "audioRank": a["rank"] if a else None}
        valid = status == "gevalideerd"
        r = recog.get(str(e["number"]))
        e["capabilities"] = {
            "textComplete": e["textStatus"] == "volledig",
            "sheetMusicAvailable": bool(e["pdfUrl"]),
            "scoreValidated": valid,
            "lineFollowing": valid,
            "wordFollowing": valid and m["wordLinking"],
            "recognizable": valid,
            "recognitionValidated": bool(valid and r and r.get("ok")),
        }
    # alleen muziekgegevens van gevalideerde lofzangen blijven bestaan (de rest is onzeker en wordt afgeschermd)
    keep_links = {e["number"] for e in entries if e["capabilities"]["scoreValidated"]}
    for f in (OUT / "link").glob("*.json"):
        if int(f.stem) not in keep_links:
            f.unlink()
    keep_comps = {e["music"]["compositionId"] for e in entries if e["music"]["compositionId"]}
    for f in (OUT / "music").glob("*.json"):
        if json.loads(f.read_text())["id"] not in keep_comps:
            f.unlink()
    counts = {
        "official": len(entries),
        "textComplete": sum(e["textStatus"] == "volledig" for e in entries),
        "textUnavailable": [e["number"] for e in entries if e["textStatus"] == "niet-gepubliceerd"],
        "textUncertain": [e["number"] for e in entries if e["textStatus"] == "onzeker"],
        "withPdf": sum(bool(e["pdfUrl"]) for e in entries),
        "scoreValidated": sum(e["capabilities"]["scoreValidated"] for e in entries),
        "lineFollowing": sum(e["capabilities"]["lineFollowing"] for e in entries),
        "wordFollowing": sum(e["capabilities"]["wordFollowing"] for e in entries),
        "recognizable": sum(e["capabilities"]["recognizable"] for e in entries),
        "recognitionValidated": sum(e["capabilities"]["recognitionValidated"] for e in entries),
        "uniqueCompositions": len(keep_comps),
        "audioConfirmed": sum(e["music"]["audioCheck"] == "bevestigd" for e in entries),
        "audioDeviating": [e["number"] for e in entries if e["music"]["audioCheck"] == "afwijkend"],
    }
    import hashlib
    version = hashlib.sha256(json.dumps([entries, search], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
    dump(OUT / "manifest.json", {
        "schema": 1,
        "dataVersion": version,
        "source": {"name": "Lofzangen (Nederlands), De Kerk van Jezus Christus van de Heiligen der Laatste Dagen",
                   "indexUrl": f"{BASE}/study/manual/hymns?lang=nld", "language": "nld"},
        "counts": counts, "hymns": entries,
    })
    dump(OUT / "search.json", search, compact=True)
    print(json.dumps(counts, ensure_ascii=False))


if __name__ == "__main__":
    main()
