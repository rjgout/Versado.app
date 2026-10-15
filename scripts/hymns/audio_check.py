#!/usr/bin/env python3
"""Onafhankelijke controle van de uit de PDF gelezen noten tegen de officiële begeleidingsopname.

Per lofzang: chroma van de opname (12 toonklassen per ~93 ms) tegen de chroma die de gelezen noten zouden geven, met
subsequence-DTW (begin en einde in de opname vrij, de partituur wordt één keer volledig doorlopen). De kosten (1 - cosinus)
langs het pad zeggen hoe goed noten en opname overeenkomen; ter vergelijking dezelfde opname tegen andere lofzangen.
Dit zegt iets over de noten (toonhoogtes en volgorde), niet over de tekstkoppeling. Resultaat: .cache/hymns/nld/audio-check.json.
De opnamen komen alleen uit de officiële begeleiding; ze gaan niet in git.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
CACHE = ROOT / ".cache/hymns/nld"
DATA = ROOT / "src/lib/hymns/library/data"
SR = 11025
NFFT = 4096
HOP = 1024


def decode(mp3):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp3), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32)


_FREQS = np.fft.rfftfreq(NFFT, 1 / SR)
_BIN_PC = np.zeros(len(_FREQS), dtype=int)
_BIN_OK = (_FREQS > 60) & (_FREQS < 2000)
_BIN_PC[_BIN_OK] = (np.round(12 * np.log2(_FREQS[_BIN_OK] / 440.0)).astype(int) + 9) % 12
_BIN_W = np.where(_BIN_OK, 1.0, 0.0) / np.maximum(_FREQS, 60) ** 0.3


def audio_chroma(mp3):
    cache = CACHE / "audio-chroma" / (Path(mp3).stem + ".npy")
    if cache.exists():
        return np.load(cache)
    x = decode(mp3)
    win = np.hanning(NFFT).astype(np.float32)
    n = 1 + max(0, (len(x) - NFFT) // HOP)
    out = np.zeros((n, 12), dtype=np.float32)
    for i in range(n):
        seg = x[i * HOP : i * HOP + NFFT] * win
        mag = np.abs(np.fft.rfft(seg)) ** 0.5 * _BIN_W
        np.add.at(out[i], _BIN_PC, mag)
    norm = np.linalg.norm(out, axis=1, keepdims=True)
    out = out / np.maximum(norm, 1e-9)
    cache.parent.mkdir(exist_ok=True)
    np.save(cache, out)
    return out


def ref_chroma(notes, total, step=0.25, partials=6):
    steps = int(round(total / step))
    ref = np.zeros((steps, 12))
    for t, dur, midi, _ in notes:
        a, b = int(t / step), max(int(t / step) + 1, int(round((t + dur) / step)))
        for h in range(1, partials + 1):
            pc = (midi + int(round(12 * np.log2(h)))) % 12
            ref[a:b, pc] += 1 / h
    k = np.array([0.25, 0.5, 0.25])
    ref = np.stack([np.convolve(np.pad(ref[:, c], 1, mode="edge"), k, mode="valid") for c in range(12)], axis=1)
    return ref / np.maximum(np.linalg.norm(ref, axis=1, keepdims=True), 1e-9)


def center(x):
    """Trekt het gemiddelde toonklasseprofiel af: zonder dat lijken alle lofzangen in dezelfde toonsoort op elkaar."""
    y = x - x.mean(axis=0, keepdims=True)
    return y / np.maximum(np.linalg.norm(y, axis=1, keepdims=True), 1e-9)


def dtw_cost(ref, aud):
    ref, aud = center(ref), center(aud)
    """Open-begin/open-end subsequence DTW over de opname. Geeft (gemiddelde kosten, begin, einde) in opnameframes."""
    cost = 1 - ref @ aud.T  # N x M
    N, M = cost.shape
    INF = 1e9
    D = np.full((N, M), INF)
    D[0] = cost[0]
    for i in range(1, N):
        prev = D[i - 1]
        best = np.full(M, INF)
        best[1:] = prev[:-1]
        best[2:] = np.minimum(best[2:], prev[:-2] + 0.05)
        if i >= 2:
            b2 = np.full(M, INF)
            b2[1:] = D[i - 2][:-1] + 0.05
            best = np.minimum(best, b2)
        D[i] = cost[i] + best
    j = int(np.argmin(D[-1]))
    return D[-1, j] / N, j


def main():
    only = {int(a) for a in sys.argv[1:] if a.isdigit()}
    force = "--force" in sys.argv
    done = json.loads((CACHE / "audio-check.json").read_text()) if (CACHE / "audio-check.json").exists() else {}
    index = {h["number"]: h for h in json.loads((CACHE / "index.json").read_text())["hymns"]}
    music = {}
    for f in (DATA / "music").glob("*.json"):
        c = json.loads(f.read_text())
        music[c["id"]] = c
    links = {int(f.stem): json.loads(f.read_text())["compositionId"] for f in (DATA / "link").glob("*.json")}
    refs = {cid: ref_chroma(c["notes"], c["totalBeats"]) for cid, c in music.items()}
    out = {}
    nums = sorted(n for n in links if (CACHE / "audio" / f"{index[n]['slug']}.mp3").exists() and (not only or n in only) and (force or str(n) not in done or done[str(n)].get("compositionId") != links[n]))
    cids = sorted(refs)
    for n in nums:
        aud = audio_chroma(CACHE / "audio" / f"{index[n]['slug']}.mp3")
        res = sorted((dtw_cost(r, aud)[0], cid) for cid, r in refs.items())
        own = links[n]
        rank = [c for _, c in res].index(own) + 1
        own_cost = next(x for x, c in res if c == own)
        runner = next(x for x, c in res if c != own)
        out[str(n)] = {"compositionId": own, "rank": rank, "of": len(res), "cost": round(float(own_cost), 4), "bestOther": round(float(runner), 4), "bestOtherId": next(c for x, c in res if c != own), "frames": int(len(aud))}
        print(n, out[str(n)], flush=True)
    path = CACHE / "audio-check.json"
    prev = json.loads(path.read_text()) if path.exists() else {}
    prev.update(out)
    path.write_text(json.dumps(prev, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
