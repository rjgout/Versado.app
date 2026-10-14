#!/usr/bin/env python3
"""Importeert het volledige huidige Nederlandse zangboek (Lofzangen van De Kerk van Jezus Christus van de Heiligen
der Laatste Dagen) van de officiële website. Idempotent en hervatbaar.

Fases (elk apart aan te roepen, standaard alles):
  index    haalt de officiële inhoudsopgave op en schrijft het manifest (nummer, slug, titel, afdeling, bron-URL's)
  fetch    haalt per lofzang de pagina en de bladmuziek-PDF op; bewaart sha256 van elk bronbestand
  audio    haalt de officiële begeleidingsopname op (alleen voor onafhankelijke controle en tests)
  
Bronbestanden komen in .cache/hymns/nld/ en horen NIET in git. Alleen gewijzigde of ontbrekende bestanden worden
opnieuw opgehaald. Verzoeken zijn beperkt tot ~2 per seconde met een duidelijke User-Agent; bij een fout volgt een
herhaling met uitstel, daarna wordt de lofzang als mislukt gemeld zonder de rest te blokkeren.

Gebruik: python3 scripts/hymns/import_nld.py [index|fetch|all] [--cache .cache/hymns/nld] [--only 24,36]
"""
import argparse
import base64
import hashlib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://www.churchofjesuschrist.org"
INDEX_URL = f"{BASE}/study/manual/hymns?lang=nld"
UA = {"User-Agent": "Mozilla/5.0 (Versado hymns import; contact: owner)"}
ROOT = Path(__file__).resolve().parent.parent.parent
MANIFEST = ROOT / "src/lib/hymns/library/data/manifest.json"
_last = [0.0]


def get(url: str, retries: int = 4) -> bytes:
    for attempt in range(retries):
        wait = 0.5 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError("onbereikbaar")


def initial_state(html: str) -> dict:
    m = re.search(r"window\.__INITIAL_STATE__\s*=\s*(.*?)</script>", html, re.S)
    payload = json.loads(m.group(1).strip().rstrip(";"))
    return json.loads(base64.b64decode(payload))


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def stage_index(cache: Path) -> list:
    html = get(INDEX_URL).decode("utf8", "ignore")
    state = initial_state(html)
    book = state["reader"]["bookStore"]["/nld/manual/hymns"]
    out = []
    for entry in book["entries"]:
        sec = entry.get("section")
        if not sec:
            continue
        for e in sec.get("entries", []):
            c = e["content"]
            if "songNumber" not in c:
                continue
            out.append({"number": int(c["songNumber"]), "slug": c["uri"].rsplit("/", 1)[-1], "title": c["title"], "section": sec["title"]})
    out.sort(key=lambda h: h["number"])
    # nummering controleren: aaneengesloten, geen dubbele nummers of slugs
    nums = [h["number"] for h in out]
    assert len(nums) == len(set(nums)), "dubbele nummers in de index"
    assert len({h["slug"] for h in out}) == len(out), "dubbele slugs in de index"
    gaps = [n for n in range(1, max(nums) + 1) if n not in nums]
    (cache / "index.json").write_text(json.dumps({"hymns": out, "gaps": gaps}, ensure_ascii=False, indent=1))
    print(f"index: {len(out)} lofzangen, hoogste nummer {max(nums)}, ontbrekende nummers: {gaps or 'geen'}")
    return out


def stage_fetch(cache: Path, hymns: list, only: set | None) -> dict:
    (cache / "pages").mkdir(exist_ok=True)
    (cache / "pdf").mkdir(exist_ok=True)
    log = json.loads((cache / "fetch-log.json").read_text()) if (cache / "fetch-log.json").exists() else {}
    for h in hymns:
        n = h["number"]
        if only and n not in only:
            continue
        rec = log.get(str(n), {})
        try:
            page_file = cache / "pages" / f"{h['slug']}.json"
            if not page_file.exists():
                html = get(f"{BASE}/study/manual/hymns/{h['slug']}?lang=nld").decode("utf8", "ignore")
                state = initial_state(html)
                store = state["reader"]["contentStore"]
                entry = store[next(iter(store))]
                page_file.write_text(json.dumps({"body": entry["content"]["body"], "meta": entry["meta"]}, ensure_ascii=False, sort_keys=True))
            page = json.loads(page_file.read_text())
            rec["pageSha"] = sha(page_file.read_bytes())
            sm = page["meta"].get("sheetMusicPdf")
            rec["pdfUrl"] = sm["source"] if sm else None
            if sm:
                pdf_file = cache / "pdf" / f"{h['slug']}.pdf"
                if not pdf_file.exists():
                    pdf_file.write_bytes(get(sm["source"]))
                rec["pdfSha"] = sha(pdf_file.read_bytes())
            rec["error"] = None
        except Exception as e:  # noqa: BLE001
            rec["error"] = f"{type(e).__name__}: {e}"
            print(f"{n}: FOUT {rec['error']}")
        log[str(n)] = rec
        (cache / "fetch-log.json").write_text(json.dumps(log, ensure_ascii=False, indent=1, sort_keys=True))
    ok = sum(1 for r in log.values() if not r.get("error"))
    print(f"fetch: {ok}/{len(log)} zonder fout")
    return log


def stage_audio(cache: Path, hymns: list, only: set | None) -> None:
    """Haalt de officiële begeleidingsopname (piano/orgel, AUDIO_ACCOMPANIMENT) op. Die dient uitsluitend als
    onafhankelijke controle van de uit de PDF gelezen noten en als testmateriaal; hij gaat niet in git en niet naar gebruikers."""
    (cache / "audio").mkdir(exist_ok=True)
    log_file = cache / "fetch-log.json"
    log = json.loads(log_file.read_text())
    for h in hymns:
        n = h["number"]
        if only and n not in only:
            continue
        page = json.loads((cache / "pages" / f"{h['slug']}.json").read_text())
        acc = next((a for a in page["meta"].get("audio") or [] if a.get("variant") == "AUDIO_ACCOMPANIMENT"), None)
        rec = log.setdefault(str(n), {})
        if not acc:
            rec["audioUrl"] = None
            continue
        f = cache / "audio" / f"{h['slug']}.mp3"
        try:
            if not f.exists():
                f.write_bytes(get(acc["mediaUrl"]))
            rec["audioUrl"] = acc["mediaUrl"]
            rec["audioSha"] = sha(f.read_bytes())
            rec.pop("audioError", None)
        except Exception as e:  # noqa: BLE001
            rec["audioError"] = f"{type(e).__name__}: {e}"
            print(f"{n}: audio FOUT {rec['audioError']}")
        log_file.write_text(json.dumps(log, ensure_ascii=False, indent=1, sort_keys=True))
    print(f"audio: {sum(1 for r in log.values() if r.get('audioSha'))} bestanden")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", nargs="?", default="all")
    ap.add_argument("--cache", default=str(ROOT / ".cache/hymns/nld"))
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)
    only = {int(x) for x in a.only.split(",") if x} or None
    hymns = stage_index(cache) if a.stage in ("index", "all") or not (cache / "index.json").exists() else json.loads((cache / "index.json").read_text())["hymns"]
    if a.stage in ("fetch", "all"):
        stage_fetch(cache, hymns, only)
    if a.stage in ("audio", "all"):
        stage_audio(cache, hymns, only)


if __name__ == "__main__":
    main()
