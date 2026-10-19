#!/usr/bin/env python3
"""Vergelijkt beslisregels voor de melodieroute achteraf op de trajecten van lv3-melody-rules.ts.

  python3 scripts/hymns/lv3-melody-rules.py docs/hymns/v3/melody-rules-traj.json

Een regel vuurt op het eerste moment waarop (a) dezelfde kop `streak` seconden achter elkaar eerste staat, (b) de marge tot de tweede
kandidaat, (c) de kosten, (d) de z-score ten opzichte van alle kandidaten, (e) het aantal gestemde stappen en het aandeel gestemde
stappen voldoen. Per regel: herkenning (juist/fout) bij zang MET de lofzang, en valse herkenning bij zang/instrument ZONDER de lofzang.
"""
import json, sys, itertools, collections

def fire(sw, rule):
    streak, last = 0, None
    for s in sw:
        top, second = s["top"][0], s["top"][1]
        margin = second[1] - top[1]
        z = (s["med"] - top[1]) / (1.4826 * s["mad"] + 1e-6)
        if s["vs"] < rule["vs"] or s["steps"] < rule["steps"]:
            streak, last = 0, None
            continue
        streak = streak + 1 if last == top[0] else 1
        last = top[0]
        if streak >= rule["streak"] and margin >= rule["margin"] and top[1] <= rule["cost"] and z >= rule["z"] and s["t"] >= rule["t"]:
            return top[0], s["t"]
    return None

def evaluate(trajs, rule):
    out = collections.defaultdict(lambda: collections.Counter())
    for tr in trajs:
        r = fire(tr["sweeps"], rule)
        key = (tr["source"] if tr["source"] == "officieel" else tr["scenario"], tr["mode"])
        out[key]["n"] += 1
        if r is None: continue
        out[key]["right" if r[0] == tr["hymn"] else "wrong"] += 1
    return out

def summary(trajs, rule):
    o = evaluate(trajs, rule)
    sing_in = [k for k in o if k[1] == "in" and k[0] != "officieel"]
    n_in = sum(o[k]["n"] for k in sing_in); right = sum(o[k]["right"] for k in sing_in); wrong_in = sum(o[k]["wrong"] for k in sing_in)
    sing_out = [k for k in o if k[1] == "uit" and k[0] != "officieel"]
    n_out = sum(o[k]["n"] for k in sing_out); fp_out = sum(o[k]["right"] + o[k]["wrong"] for k in sing_out)
    off_out = o[("officieel", "uit")]; off_in = o[("officieel", "in")]
    return dict(recall=right / n_in, wrongIn=wrong_in / n_in, falseOutSing=fp_out / n_out,
                falseOutOfficial=(off_out["right"] + off_out["wrong"]) / max(1, off_out["n"]),
                wrongInOfficial=off_in["wrong"] / max(1, off_in["n"]), per=o)

if __name__ == "__main__":
    trajs = json.load(open(sys.argv[1]))
    base = dict(vs=0.45, steps=36, streak=4, margin=0.03, cost=0.3, z=-99, t=0)
    grid = [("huidige regel", base)]
    for streak, margin, z, t in itertools.product((4, 8), (0.03, 0.05), (-99, 4, 6, 8), (0, 20)):
        grid.append((f"streak={streak} marge={margin} z>={z} t>={t}", dict(base, streak=streak, margin=margin, z=z, t=t)))
    print(f"{'regel':44} {'herkend':>8} {'fout':>6} {'vals zang':>10} {'vals instr.':>12} {'fout instr.in':>14}")
    for name, rule in grid:
        s = summary(trajs, rule)
        print(f"{name:44} {s['recall']:8.2f} {s['wrongIn']:6.2f} {s['falseOutSing']:10.2f} {s['falseOutOfficial']:12.2f} {s['wrongInOfficial']:14.2f}")
