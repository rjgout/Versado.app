#!/usr/bin/env python3
"""Draait de partituurextractie over alle gecachte PDF's (alleen gewijzigde, tenzij --force) en schrijft
.cache/hymns/nld/score/<slug>.score.json plus score/_summary.json met per lofzang de status."""
import hashlib
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_score as E  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
CACHE = ROOT / ".cache/hymns/nld"


def main():
    force = "--force" in sys.argv
    only = {int(a) for a in sys.argv[1:] if a.isdigit()}
    code_sha = hashlib.sha256(Path(E.__file__).read_bytes()).hexdigest()[:12]
    (CACHE / "score").mkdir(exist_ok=True)
    summary_file = CACHE / "score" / "_summary.json"
    summary = json.loads(summary_file.read_text()) if summary_file.exists() else {}
    for h in json.loads((CACHE / "index.json").read_text())["hymns"]:
        n = h["number"]
        if only and n not in only:
            continue
        pdf = CACHE / "pdf" / f"{h['slug']}.pdf"
        if not pdf.exists():
            summary[str(n)] = {"status": "geen-pdf"}
            continue
        pdf_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        prev = summary.get(str(n))
        if not force and prev and prev.get("pdfSha") == pdf_sha and prev.get("codeSha") == code_sha:
            continue
        out = CACHE / "score" / f"{h['slug']}.score.json"
        rec = {"pdfSha": pdf_sha, "codeSha": code_sha}
        try:
            r = E.extract_best(str(pdf))
            out.write_text(json.dumps(r, ensure_ascii=False))
            rec.update(status="ok" if not r["problems"] else "problemen", problems=r["problems"][:12], nProblems=len(r["problems"]))
        except Exception as e:  # noqa: BLE001
            rec.update(status="fout", error=f"{type(e).__name__}: {e}", trace=traceback.format_exc().splitlines()[-3:])
        summary[str(n)] = rec
    summary_file.write_text(json.dumps(summary, ensure_ascii=False, indent=1, sort_keys=True))
    from collections import Counter
    print(Counter(v["status"] for v in summary.values()))


if __name__ == "__main__":
    main()
