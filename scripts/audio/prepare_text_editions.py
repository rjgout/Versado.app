"""Maak uitsluitend de zes expliciet goedgekeurde, verborgen tekstuitgaven uit gecontroleerde bronpagina's.

Geen database, cursussen of oefeningen. Ontbrekende/afwijkende hoofdstukken stoppen de export.
"""
import json
import pathlib
import re
from official_inventory import ROOT, WORKS, clean, page_verses, validate_page_identity

root = ROOT / '.audio-v2-work'
for language in ('de', 'fr', 'es'):
    for prefix in ('dc', 'pgp'):
        work, keys = WORKS[prefix]
        template = json.loads((ROOT / f'prisma/{prefix}Content.json').read_text())
        books = []
        for original, key in zip(template, keys, strict=True):
            chapters = []
            name = None
            for chapter in original['chapters']:
                file = root / 'pages' / f'{language}-{work}_{key}-{chapter["number"]}.json'
                page = json.loads(file.read_text())
                validate_page_identity(page, language, f"{work}/{key}", chapter["number"])
                verses = page_verses(page)
                if len(verses) != len(chapter['verses']):
                    raise ValueError(f'Verstelaantal wijkt af: {file}')
                headings = re.findall(r'class="study-summary"[^>]*>(.*?)</p>', page['content']['body'], re.S)
                name = name or re.sub(r'\s+\d+$', '', clean(page.get('meta', {}).get('title', ''))) or f'{work}/{key}'
                chapters.append({'number': chapter['number'], 'heading': clean(headings[0]) if headings else None, 'verses': verses})
            books.append({'slug': f'{language}-{work}-{key}', 'key': f'{work}/{key}', 'name': name, 'chapters': chapters})
        output = ROOT / f'prisma/{prefix}Content.{language}.json'
        output.write_text(json.dumps(books, ensure_ascii=False, indent=2) + '\n')
        print(output.name, sum(len(b['chapters']) for b in books), 'hoofdstukken; uitsluitend brontekst')
