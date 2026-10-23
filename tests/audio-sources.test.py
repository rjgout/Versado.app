"""Gerichte bron-/uitlijningsregressies; geen netwerk, database of ASR-model nodig."""
import pathlib
import sys
import unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/audio'))
sys.path.insert(0, str(ROOT / 'scripts/bom-audio'))
from official_inventory import safe_url, validate_page_identity, page_verses
from common import units_for


class AudioSourcesTest(unittest.TestCase):
    def test_sources_require_exact_https_host_without_credentials(self):
        safe_url('https://assets.churchofjesuschrist.org/recording.mp3', True)
        for value in ('http://assets.churchofjesuschrist.org/a.mp3', 'https://assets.churchofjesuschrist.org.evil.invalid/a.mp3', 'https://user:password@assets.churchofjesuschrist.org/a.mp3', 'https://assets.churchofjesuschrist.org:8443/a.mp3', 'https://assets.churchofjesuschrist.org/a.html'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                safe_url(value, True)

    def test_page_language_and_chapter_must_be_exact(self):
        page = {'meta': {'pageAttributes': {'data-bcp47-lang': 'de', 'data-uri': '/scriptures/dc-testament/dc/1'}}}
        validate_page_identity(page, 'de', 'dc-testament/dc', 1)
        for language, book, number in [('fr', 'dc-testament/dc', 1), ('de', 'bofm/1-ne', 1), ('de', 'dc-testament/dc', 2)]:
            with self.assertRaises(ValueError):
                validate_page_identity(page, language, book, number)

    def test_existing_bom_units_remain_unchanged(self):
        page = {'content': {'body': '<h1 class="title">Boek</h1><p class="title-number">Hoofdstuk 1</p><p class="study-summary">De bestaande kop.</p><p class="verse"><span>1</span> Eerste tekst.</p><p class="verse"><span>2</span> Tweede tekst.</p>'}}
        self.assertEqual(units_for(page), [('pre', 'Boek'), ('num', 'Hoofdstuk 1'), ('head', 'De bestaande kop.'), ('v1', 'Eerste tekst.'), ('v2', 'Tweede tekst.')])
        self.assertEqual(page_verses(page), ['Eerste tekst.', 'Tweede tekst.'])

    def test_generic_scripture_without_heading_or_chapter_title(self):
        page = {'content': {'body': '<h1 class="title">Geloofsartikelen</h1><p class="verse"><span>1</span> Testtekst.</p>'}}
        self.assertEqual(units_for(page), [('pre', 'Geloofsartikelen'), ('v1', 'Testtekst.')])


if __name__ == '__main__':
    unittest.main()
