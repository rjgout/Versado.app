"""Leest de tekststructuur van een officiële Nederlandse lofzangpagina (de HTML-body uit window.__INITIAL_STATE__).

Alleen wat de pagina zelf geeft: coupletten, refrein(en), bronvermeldingen en schriftverwijzingen. Er wordt niets
aangevuld, vertaald of verbeterd; ontbreekt er tekst (bij sommige lofzangen publiceert de kerk de tekst niet vanwege
licentiebeperkingen), dan staat dat in `issues` en `available` is False.
"""
import html as htmllib
import re
import unicodedata


def strip_tags(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    s = htmllib.unescape(s).replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def clean_body(body: str) -> str:
    return re.sub(r' data-aid="\d+"| id="[^"]*"', "", body)


def _blocks(body: str):
    """Coupletten en refreinen in documentvolgorde: (soort, inner_html, onder_de_muziek)."""
    below_start = body.find("verses-below-the-music")
    out = []
    for m in re.finditer(r'<div class="(stanza|chorus)">(.*?)</div>', body, re.S):
        out.append((m.group(1), m.group(2), below_start >= 0 and m.start() > below_start))
    return out


def parse_hymn_page(body: str) -> dict:
    body = clean_body(body)
    issues = []
    num = re.search(r'class="song-number">(\d+)<', body)
    title = re.search(r"<h1>(.*?)</h1>", body, re.S)
    subtitle = re.search(r'<[a-z0-9]+ class="subtitle">(.*?)</[a-z0-9]+>', body, re.S)
    tempo = re.search(r'<p class="label">([^<]+)</p>', body)
    result = {
        "number": int(num.group(1)) if num else None,
        "title": strip_tags(title.group(1)) if title else None,
        "subtitle": strip_tags(subtitle.group(1)) if subtitle else None,
        "tempoLabel": strip_tags(tempo.group(1)) if tempo else None,
        "stanzas": [],
        "leadingChorus": None,
        "available": True,
        "issues": issues,
    }
    if "kan de kerk deze muziek niet in deze vorm publiceren" in strip_tags(body):
        result["available"] = False
        issues.append("tekst niet gepubliceerd door de kerk (licentiebeperking)")

    # Refreinen hangen aan het couplet dat ze volgt (SCSC-patroon); een refrein voor het eerste couplet is `leadingChorus`.
    # Verschilt een refrein per couplet (lofzang 154), dan staat elke variant apart in `choruses`.
    choruses = []
    for kind, inner, below in _blocks(body):
        lines = [strip_tags(l) for l in re.findall(r'<p class="line">(.*?)</p>', inner, re.S)]
        if kind == "chorus":
            if lines and re.fullmatch(r"\[.*\]", lines[0]):
                lines = lines[1:]
            if lines not in choruses:
                choruses.append(lines)
            ci = choruses.index(lines)
            if result["stanzas"]:
                result["stanzas"][-1]["chorus"] = ci
            else:
                result["leadingChorus"] = ci
            continue
        n = None
        if lines:
            vm = re.search(r'verse-number">(\d+)\.', re.findall(r'<p class="line">(.*?)</p>', inner, re.S)[0])
            if vm:
                n = int(vm.group(1))
                lines[0] = re.sub(r"^\d+\.\s*", "", lines[0])
        result["stanzas"].append({"n": n, "lines": lines, "belowMusic": below, "chorus": None})
    # een lofzang met één couplet zonder nummer
    if len(result["stanzas"]) == 1 and result["stanzas"][0]["n"] is None:
        result["stanzas"][0]["n"] = 1
    nums = [s["n"] for s in result["stanzas"]]
    if result["available"] and nums != list(range(1, len(nums) + 1)):
        issues.append(f"coupletnummers niet aaneengesloten vanaf 1: {nums}")
    for s in result["stanzas"]:
        if not s["lines"] or any(not l for l in s["lines"]):
            issues.append(f"couplet {s['n']} bevat een lege regel of is leeg")
    result["choruses"] = choruses
    if result["available"] and not result["stanzas"]:
        issues.append("geen coupletten gevonden")

    credits = [strip_tags(p) for p in re.findall(r"<p>(.*?)</p>", re.search(r'<div class="citation-info">(.*?)</div>', body, re.S).group(1) if re.search(r'<div class="citation-info">(.*?)</div>', body, re.S) else "", re.S)]
    text_credit = next((re.sub(r"^Tekst:\s*", "", c) for c in credits if c.startswith("Tekst:")), None)
    music_credit = next((re.sub(r"^Muziek:\s*", "", c) for c in credits if c.startswith("Muziek:")), None)
    notices = [c for c in credits if not c.startswith(("Tekst:", "Muziek:"))]
    joined = " ".join(credits)
    result["textCredit"] = text_credit
    result["musicCredit"] = music_credit
    result["notices"] = notices
    result["rights"] = {
        "copyrightNotice": "©" in joined or "auteursrecht" in joined.lower(),
        "copyingForbiddenWithoutPermission": "zonder schriftelijke toestemming" in joined,
        "copyingAllowedNonCommercial": "mag gekopieerd worden voor incidenteel, niet-commercieel gebruik" in joined,
        "licenseRestrictedByChurch": not result["available"],
    }
    result["scriptureRefs"] = [strip_tags(x) for x in re.findall(r'<(?:a|span) class="(?:legacy-)?scripture-ref"[^>]*>(.*?)</(?:a|span)>', body, re.S)]
    return result


def norm_word(w: str) -> str:
    w = unicodedata.normalize("NFKD", w.lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in w if not unicodedata.combining(c)))
