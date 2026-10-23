"""Gedeelde stukken voor het berekenen van de versbegintijden in de audio.

Zie README.md in deze map. Werkmap (pagina's, herkende woorden, tijden):
$BOM_AUDIO_WORK, standaard .bom-audio-work/ in de repo-root (in .gitignore).
"""
import html
import json
import os
import re
import unicodedata

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK_ROOT = os.environ.get("BOM_AUDIO_WORK", os.path.join(ROOT, ".bom-audio-work"))

LANGUAGES = {
    "nl": {
        "church": "nld",
        "content": "bomContent.json",
        "output": "bomAudio.json",
        "model": "vosk-model-small-nl-0.22",
    },
    "en": {
        "church": "eng",
        "content": "bomContent.en.json",
        "output": "bomAudio.en.json",
        "model": "vosk-model-small-en-us-0.15",
    },
    "de": {
        "church": "deu",
        "content": "bomContent.de.json",
        "output": "bomAudio.de.json",
        "model": "vosk-model-small-de-0.15",
    },
    "fr": {
        "church": "fra",
        "content": "bomContent.fr.json",
        "output": "bomAudio.fr.json",
        "model": "vosk-model-small-fr-0.22",
    },
    "es": {
        "church": "spa",
        "content": "bomContent.es.json",
        "output": "bomAudio.es.json",
        "model": "vosk-model-small-es-0.42",
    },
}

# Afkortingen in de URL's van de kerkwebsite, in de volgorde van prisma/bomContent.json.
ABBR = ["1-ne", "2-ne", "jacob", "enos", "jarom", "omni", "w-of-m", "mosiah", "alma", "hel", "3-ne", "4-ne", "morm", "ether", "moro"]


def language_config(language):
    if language not in LANGUAGES:
        raise SystemExit("Gebruik taal: " + "|".join(LANGUAGES))
    config = LANGUAGES[language]
    # Houd de bestaande Nederlandse werkmap intact; andere talen krijgen hun
    # eigen map, zodat pagina's, woorden en timings nooit vermengd raken.
    return {**config, "work": WORK_ROOT if language == "nl" else os.path.join(WORK_ROOT, language)}


def work(language, *parts):
    path = os.path.join(language_config(language)["work"], *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def clean(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def norm(w):
    w = unicodedata.normalize("NFKD", w.lower())
    return "".join(c for c in w if c.isalnum())


def units_for(page):
    """De stukken die de audio achter elkaar voorleest: eventueel de boekinleiding
    ("pre"), "Hoofdstuk N" ("num"), de hoofdstukkop ("head") en de verzen."""
    body = page["content"]["body"]
    before = body.split('class="verse"')[0]
    pre = [clean(t) for _, t in re.findall(r'<(?:p|h1|h2|div)[^>]*class="(subtitle|intro|study-intro|title)"[^>]*>(.*?)</(?:p|h1|h2|div)>', before, re.S)]
    nums = re.findall(r'class="title-number"[^>]*>(.*?)<', before, re.S)
    num = clean(nums[0]) if nums else ""
    heads = re.findall(r'class="study-summary"[^>]*>(.*?)</p>', body, re.S)
    head = clean(heads[0]) if heads else ""
    verses = [re.sub(r"^\d+\s*", "", clean(v)) for v in re.findall(r'<p[^>]*class="verse"[^>]*>(.*?)</p>', body, re.S)]
    units = []
    if pre:
        units.append(("pre", " ".join(pre)))
    units += [(key, value) for key, value in [("num", num), ("head", head)] if value]
    units += [(f"v{i + 1}", v) for i, v in enumerate(verses)]
    return units


def load_audio(path, sr=16000):
    import av

    c = av.open(path)
    rs = av.AudioResampler(format="s16", layout="mono", rate=sr)
    out = []
    for fr in c.decode(c.streams.audio[0]):
        for r in rs.resample(fr):
            out.append(r.to_ndarray().reshape(-1))
    for r in rs.resample(None):
        out.append(r.to_ndarray().reshape(-1))
    return np.concatenate(out).astype(np.float32) / 32768, sr


def find_pauses(x, sr, hop=0.01, min_len=0.18):
    """Stille stukken (begin, eind) in seconden, relatief aan het spraakniveau."""
    n = int(sr * hop)
    frames = len(x) // n
    e = np.sqrt((x[: frames * n].reshape(frames, n) ** 2).mean(1) + 1e-12)
    db = 20 * np.log10(e)
    thr = max(np.percentile(db, 50) - 18, np.percentile(db, 5) + 3)
    sil = db < thr
    res, i = [], 0
    while i < frames:
        if sil[i]:
            j = i
            while j < frames and sil[j]:
                j += 1
            if (j - i) * hop >= min_len:
                res.append((i * hop, j * hop))
            i = j
        else:
            i += 1
    return res, frames * hop


def recognize(x, sr, model, page):
    """Woorden met begintijd, via Vosk met alleen de woorden van dit hoofdstuk
    als grammatica: sneller en nauwkeuriger dan vrije herkenning."""
    from vosk import KaldiRecognizer

    vocab = sorted({w.lower() for _, t in units_for(page) for w in re.findall(r"[a-zA-ZÀ-ÿ]+", t)})
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()
    rec = KaldiRecognizer(model, sr, json.dumps(vocab + ["[unk]"], ensure_ascii=False))
    rec.SetWords(True)
    out, step = [], sr * 2 * 4
    for i in range(0, len(pcm), step):
        if rec.AcceptWaveform(pcm[i : i + step]):
            out += json.loads(rec.Result()).get("result", [])
    out += json.loads(rec.FinalResult()).get("result", [])
    return [(w["start"], w["word"]) for w in out if w["word"] != "[unk]"]
