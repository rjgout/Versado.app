"""Controleer officiële schriftpagina's en de echte MP3's; schrijft nooit content of een database.

Gebruik --download voor volledige, lokaal gedecodeerde bestanden. Een cache bewaart
het oorspronkelijke controlemoment: een hervatting doet zich niet voor als een nieuwe broncontrole.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import html
import json
import pathlib
import re
import subprocess
import threading
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
LANGUAGES = {"nl": "nld", "en": "eng", "de": "deu", "fr": "fra", "es": "spa"}
WORKS = {
    "bom": ("bofm", ["1-ne", "2-ne", "jacob", "enos", "jarom", "omni", "w-of-m", "mosiah", "alma", "hel", "3-ne", "4-ne", "morm", "ether", "moro"]),
    "dc": ("dc-testament", ["dc"]),
    "pgp": ("pgp", ["moses", "abr", "js-m", "js-h", "a-of-f"]),
}
AUDIO_HOSTS = {"assets.churchofjesuschrist.org", "media2.ldscdn.org"}
MAX_BYTES = 256 * 1024 * 1024
VERSE = r'<p[^>]*class="verse(?: [^"]*)?"[^>]*>(.*?)</p>'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def clean(value):
    value = re.sub(r'<span class="line">', " ", value)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value))).strip()


def page_verses(page):
    return [re.sub(r"^\d+\s*", "", clean(v)) for v in re.findall(VERSE, page["content"]["body"], re.S)]


def validate_page_identity(page, language, book_key, chapter_number):
    attrs = page.get("meta", {}).get("pageAttributes", {})
    expected = f"/scriptures/{book_key}/{chapter_number}"
    if attrs.get("data-bcp47-lang") != language or attrs.get("data-uri") != expected:
        raise ValueError("SOURCE_PAGE_IDENTITY_MISMATCH")


def safe_url(url, audio=False):
    parsed = urllib.parse.urlparse(url)
    hosts = AUDIO_HOSTS if audio else {"www.churchofjesuschrist.org"}
    if parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username or parsed.password or parsed.port or parsed.fragment:
        raise ValueError("UNSAFE_SOURCE_URL")
    if audio and not parsed.path.lower().endswith(".mp3"):
        raise ValueError("NOT_MP3_SOURCE")
    return url


def fetch(url, target, audio=False, probe=False):
    safe_url(url, audio)
    for hop in range(4):
        headers = target.with_suffix(target.suffix + ".headers")
        command = ["curl", "--silent", "--show-error", "--compressed", "--proto", "=https", "--connect-timeout", "10", "--max-time", "120", "--retry", "2", "--retry-delay", "1", "--max-filesize", str(MAX_BYTES if audio else 2 * 1024 * 1024), "-A", "Mozilla/5.0", "-D", str(headers), "-o", str(target), "-w", "%{http_code}"]
        if probe:
            command += ["--range", "0-65535"]
        result = subprocess.run(command + [url], capture_output=True, text=True, timeout=390)
        status = int(result.stdout[-3:]) if result.stdout[-3:].isdigit() else 0
        if status in (301, 302, 303, 307, 308):
            locations = re.findall(r"^location:\s*(.*?)\s*$", headers.read_text(errors="replace"), re.I | re.M)
            if not locations:
                raise ValueError("REDIRECT_WITHOUT_LOCATION")
            url = safe_url(urllib.parse.urljoin(url, locations[-1]), audio)
            continue
        if result.returncode or status not in (200, 206):
            raise ValueError(f"HTTP_{status}_CURL_{result.returncode}")
        return {"httpStatus": status, "checkedAt": now(), "finalUrl": url}
    raise ValueError("TOO_MANY_REDIRECTS")


def recording(url, voice, root, download):
    value = {"url": url, "voice": voice}
    try:
        safe_url(url, True)
        key = hashlib.sha256(url.encode()).hexdigest()
        folder = root / "audio"; folder.mkdir(exist_ok=True)
        file = folder / (key + ".mp3")
        receipt = folder / (key + ".json")
        if not (download and file.exists() and receipt.exists()):
            temp = folder / (key + ".part")
            observation = fetch(url, temp, True, not download)
            with temp.open("rb") as stream:
                signature = stream.read(16)
            if not (signature.startswith(b"ID3") or (len(signature) >= 2 and signature[0] == 255 and signature[1] & 224 == 224)):
                raise ValueError("NOT_MPEG_AUDIO")
            if download:
                info = subprocess.run(["ffprobe", "-v", "error", "-f", "mp3", "-show_entries", "format=duration,format_name:stream=codec_name,codec_type", "-of", "json", str(temp)], capture_output=True, text=True, timeout=30)
                data = json.loads(info.stdout)
                if info.returncode or float(data["format"]["duration"]) <= 0 or not any(s.get("codec_name") == "mp3" for s in data.get("streams", [])):
                    raise ValueError("AUDIO_PROBE_FAILED")
                # Volledig decoderen: HTTP 200 en een MP3-header bewijzen geen intact bestand.
                decoded = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-f", "mp3", "-i", str(temp), "-f", "null", "-"], capture_output=True, timeout=120)
                if decoded.returncode:
                    raise ValueError("AUDIO_DECODE_FAILED")
                observation.update({"duration": float(data["format"]["duration"]), "bytes": temp.stat().st_size, "sha256": hashlib.file_digest(temp.open("rb"), "sha256").hexdigest()})
                temp.replace(file)
                receipt.write_text(json.dumps(observation, sort_keys=True))
            else:
                observation["bytesChecked"] = temp.stat().st_size
                temp.unlink(missing_ok=True)
        else:
            observation = json.loads(receipt.read_text())
            if file.stat().st_size != observation["bytes"] or hashlib.file_digest(file.open("rb"), "sha256").hexdigest() != observation["sha256"]:
                raise ValueError("LOCAL_CHECKSUM_MISMATCH")
        return {**value, **observation, "status": "DOWNLOADED_VALIDATED" if download else "RANGE_VERIFIED", "localFile": str(file.relative_to(root)) if download else None}
    except (ValueError, OSError, subprocess.SubprocessError, KeyError, json.JSONDecodeError) as error:
        return {**value, "status": "UNREACHABLE_OR_INVALID", "error": str(error)[:180], "checkedAt": now()}


def tasks(languages):
    for language in languages:
        for prefix, (work, keys) in WORKS.items():
            suffix = "" if language == "nl" else "." + language
            text_file = ROOT / f"prisma/{prefix}Content{suffix}.json"
            available = text_file.exists()
            books = json.loads((text_file if available else ROOT / f"prisma/{prefix}Content.json").read_text())
            legacy_path = ROOT / f"prisma/bomAudio{suffix}.json"
            legacy = json.loads(legacy_path.read_text()) if prefix == "bom" else []
            headings = {(slug, number): heading for slug, number, heading in json.loads((ROOT / "prisma/bomChapterHeadings.json").read_text())} if prefix == "bom" and language == "nl" else {}
            for book, key in zip(books, keys, strict=True):
                book_key = work + "/" + key
                for original in book["chapters"]:
                    chapter = {**original, "heading": headings.get((book["slug"], original["number"]), original.get("heading"))}
                    entries = [entry for entry in legacy if entry["book"] in (book_key, book["slug"]) and entry["chapter"] == chapter["number"]]
                    yield {"textSeedAvailable": available, "work": work, "prefix": prefix, "language": language, "collectionId": "content_" + prefix + ("" if language == "nl" else "_" + language), "editionKey": work, "bookKey": book_key, "chapterNumber": chapter["number"], "chapter": chapter, "legacyEntries": entries}


def inspect(task, options):
    row = {key: value for key, value in task.items() if key not in ("chapter", "legacyEntries")}
    chapter = task["chapter"]
    row.update({"expectedVerseCount": len(chapter["verses"]), "sourceHash": canonical_hash({"heading": chapter.get("heading"), "verses": [{"number": i + 1, "text": text} for i, text in enumerate(chapter["verses"])]}), "legacySeedListed": bool(task["legacyEntries"]), "productionRegistration": "NOT_INSPECTED", "nasPresence": "NOT_INSPECTED"})
    identifier = f"{task['language']}-{task['bookKey'].replace('/', '_')}-{task['chapterNumber']}"
    page_file = options.root / "pages" / (identifier + ".json")
    receipt = page_file.with_suffix(".checked.json")
    url = f"https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang={LANGUAGES[task['language']]}&uri=/scriptures/{task['bookKey']}/{task['chapterNumber']}"
    row["pageUrl"] = url
    if not task["textSeedAvailable"]:
        row["collectionId"] = None
        row["sourceHash"] = None
    try:
        if not (page_file.exists() and receipt.exists()):
            temp = page_file.with_suffix(".part")
            observation = fetch(url, temp)
            page = json.loads(temp.read_text()); page_verses(page)
            temp.replace(page_file); receipt.write_text(json.dumps(observation))
        page = json.loads(page_file.read_text()); row["pageCheckedAt"] = json.loads(receipt.read_text())["checkedAt"]
        validate_page_identity(page, task["language"], task["bookKey"], task["chapterNumber"])
        row["pageIdentityStatus"] = "EXACT_LANGUAGE_AND_CHAPTER"
        verses = page_verses(page)
        row["actualVerseCount"] = len(verses)
        heading = re.findall(r'class="study-summary"[^>]*>(.*?)</p>', page["content"]["body"], re.S)
        row["sourcePageHash"] = canonical_hash({"heading": clean(heading[0]) if heading else None, "verses": [{"number": i + 1, "text": text} for i, text in enumerate(verses)]})
        row["textStatus"] = ("EXACT_TEXT_MATCH" if verses == chapter["verses"] else "EDITION_MISMATCH") if task["textSeedAvailable"] else "EDITION_NOT_REGISTERED_IN_REPOSITORY"
        row["differentVerses"] = [i + 1 for i, (a, b) in enumerate(zip(verses, chapter["verses"])) if a != b]
        sources = page.get("meta", {}).get("audio") or []
        row["officialStatus"] = "PRESENT" if sources else "NO_OFFICIAL_AUDIO"
        row["recordings"] = [recording(item["mediaUrl"], item.get("variant", "unknown"), options.root, options.download) for item in sources]
        for item in row["recordings"]:
            item["legacySeedListed"] = any(e["url"] == item["url"] for e in task["legacyEntries"])
        row["legacyEntries"] = task["legacyEntries"]
        row["pageFile"] = str(page_file.relative_to(options.root))
    except (ValueError, OSError, subprocess.SubprocessError, KeyError, json.JSONDecodeError) as error:
        row.update({"officialStatus": "NOT_REACHABLE", "error": str(error)[:180], "checkedAt": now(), "recordings": []})
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=pathlib.Path, default=ROOT / ".audio-v2-work")
    parser.add_argument("--languages", nargs="+", choices=LANGUAGES, default=list(LANGUAGES))
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--limit", type=int)
    options = parser.parse_args(); options.root = options.root.resolve()
    if not 1 <= options.workers <= 8:
        parser.error("Gebruik 1–8 workers")
    (options.root / "pages").mkdir(parents=True, exist_ok=True)
    items = list(tasks(options.languages))
    if options.limit:
        items = items[:options.limit]
    rows = []
    with (options.root / "inventory.jsonl").open("w") as output, concurrent.futures.ThreadPoolExecutor(max_workers=options.workers) as pool:
        futures = {pool.submit(inspect, item, options): item for item in items}
        for future in concurrent.futures.as_completed(futures):
            row = future.result(); rows.append(row); output.write(json.dumps(row, ensure_ascii=False) + "\n"); output.flush()
            if len(rows) % 25 == 0 or len(rows) == len(items):
                print(f"Audio-inventaris {len(rows)}/{len(items)}: {row['work']} {row['language']} {row['bookKey']} {row['chapterNumber']} {row['officialStatus']}", flush=True)
    rows.sort(key=lambda row: (row["language"], row["work"], row["bookKey"], row["chapterNumber"]))
    (options.root / "inventory.json").write_text(json.dumps({"schemaVersion": 1, "createdAt": now(), "scope": list(WORKS), "productionInspected": False, "chapters": rows}, ensure_ascii=False, indent=2) + "\n")
    print("Inventaris volledig; geen database, content of NAS gewijzigd.")


if __name__ == "__main__":
    main()
