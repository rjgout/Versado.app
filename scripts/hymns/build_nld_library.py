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
    counts = {
        "official": len(entries),
        "textComplete": sum(e["textStatus"] == "volledig" for e in entries),
        "textUnavailable": [e["number"] for e in entries if e["textStatus"] == "niet-gepubliceerd"],
        "textUncertain": [e["number"] for e in entries if e["textStatus"] == "onzeker"],
        "withPdf": sum(bool(e["pdfUrl"]) for e in entries),
    }
    dump(OUT / "manifest.json", {
        "schema": 1,
        "source": {"name": "Lofzangen (Nederlands), De Kerk van Jezus Christus van de Heiligen der Laatste Dagen",
                   "indexUrl": f"{BASE}/study/manual/hymns?lang=nld", "language": "nld"},
        "counts": counts, "hymns": entries,
    })
    dump(OUT / "search.json", search, compact=True)
    print(json.dumps(counts, ensure_ascii=False))


if __name__ == "__main__":
    main()
