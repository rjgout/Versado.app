#!/usr/bin/env python3
"""Haalt de officiële bronnen voor de Lofzangen-proef op en bouwt de lokale proefbibliotheek.

Wat dit doet (alleen voor de drie proeflofzangen, GEEN import van het hele zangboek):
  1. leest per lofzang de officiële pagina (https://www.churchofjesuschrist.org/study/manual/hymns/<slug>?lang=nld)
     en bewaart de tekststructuur (coupletten, refrein, bronvermeldingen);
  2. downloadt de officiële Nederlandse bladmuziek-PDF (sheetMusicPdf) en de begeleidingsopname (mp3) waarnaar
     die pagina zelf verwijst;
  3. leest met extract_score.py de noten uit de vector-PDF;
  4. bouwt met build_library.py src/lib/hymns/library/nld-poc.json.

Alles gaat via gewone, openbare verzoeken zonder toegangsbeperkingen te omzeilen. De cachemap bevat auteursrechtelijk
beschermd materiaal en hoort NIET in git (staat in .gitignore). Rechten: zie docs/hymns/01-SOURCE-AUDIT.md.

Gebruik (met pymupdf in een eigen venv):
  python3 -m venv .venv-hymns && .venv-hymns/bin/pip install pymupdf
  .venv-hymns/bin/python scripts/hymns/fetch_sources.py .cache/hymns
Vereist ffmpeg voor het decoderen van de mp3 naar wav (alleen nodig voor scripts/hymns/eval-real.ts).
"""
import base64
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

HYMNS = [("praise-to-the-man", 24), ("come-o-thou-king-of-kings", 36), ("come-follow-me", 82)]
BASE = "https://www.churchofjesuschrist.org"


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Versado hymns PoC; contact: owner)"})
    return urllib.request.urlopen(req, timeout=60).read()


def page_state(slug: str) -> dict:
    html = get(f"{BASE}/study/manual/hymns/{slug}?lang=nld").decode("utf8", "ignore")
    m = re.search(r"window\.__INITIAL_STATE__\s*=\s*(.*?)</script>", html, re.S)
    payload = json.loads(m.group(1).strip().rstrip(";"))  # JSON-string met base64 erin
    state = json.loads(base64.b64decode(payload))
    store = state["reader"]["contentStore"]
    return store[next(iter(store))]


def main(cache: str) -> None:
    out = Path(cache)
    out.mkdir(parents=True, exist_ok=True)
    here = Path(__file__).parent
    py = sys.executable
    for slug, number in HYMNS:
        entry = page_state(slug)
        meta = entry["meta"]
        (out / f"{slug}.page.json").write_text(json.dumps({"body": entry["content"]["body"], "meta": meta}, ensure_ascii=False))
        pdf = meta["sheetMusicPdf"]["source"]
        (out / f"{slug}.nld.pdf").write_bytes(get(pdf))
        audio = [a["mediaUrl"] for a in meta.get("audio", []) if a.get("variant") == "AUDIO_ACCOMPANIMENT"]
        if audio:
            mp3 = out / f"{slug}.acc.mp3"
            mp3.write_bytes(get(audio[0]))
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(mp3), "-ac", "1", "-ar", "22050", str(mp3.with_suffix(".wav"))], check=True)
        subprocess.run([py, str(here / "extract_score.py"), str(out / f"{slug}.nld.pdf"), str(out / f"{slug}.score.json")], check=True)
        print(f"{number} {slug}: pdf={pdf.split('/')[-1]} audio={audio[0].split('/')[-1] if audio else '-'}")
    subprocess.run([py, str(here / "build_library.py"), str(out), str(here.parent.parent / "src/lib/hymns/library/nld-poc.json")], check=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".cache/hymns")
