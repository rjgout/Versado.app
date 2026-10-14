# Lofzangen: de volledige Nederlandse bibliotheek

Fase 4. Hier staat hoe de volledige huidige Nederlandstalige bibliotheek (205 lofzangen) wordt geïmporteerd,
opgeslagen en aan de app aangeboden. De exacte aantallen staan in `15-KWALITEITSRAPPORT.md` (gegenereerd uit het manifest);
dit document beschrijft de werkwijze. Begrippen zoals in `01-SOURCE-AUDIT.md`: **BEWEZEN** (gemeten of door een test
herhaald), **AANNEMELIJK**, **ONBEKEND**.

## 1. Bron en omvang

| Vraag | Antwoord |
|---|---|
| Hoeveel lofzangen telt het huidige Nederlandse zangboek? | **BEWEZEN 205**, genummerd 1 t/m 205 zonder gaten (de officiële inhoudsopgave `https://www.churchofjesuschrist.org/study/manual/hymns?lang=nld`). `tests/hymns-library-full.test.ts` bewaakt de nummering. |
| Hebben alle lofzangen een bladmuziek-PDF? | **BEWEZEN nee**: 202 van 205. Lofzang 54, 86 en 151 hebben er geen. |
| Is van elke lofzang de tekst beschikbaar? | **BEWEZEN nee**: 203 van 205. Lofzang 54 en 151 publiceert de kerk niet (zie 5). |
| Welke extra bron is er voor muziek? | De muziekpagina's (`/media/music?lang=nld`) verwijzen per lofzang naar dezelfde PDF en naar één begeleidingsopname (MP3). De 181 beschikbare opnamen zijn gebruikt als onafhankelijke controle (zie `10-MUZIEKEXTRACTIE.md`). |

De index staat in de pagina zelf (`window.__INITIAL_STATE__`, base64-JSON); de importer leest die gestructureerde gegevens,
geen losse HTML-scheuren. Er wordt niets vertaald, aangevuld of "verbeterd".

## 2. Importproces (herhaalbaar)

```
python3 scripts/hymns/import_nld.py all          # index, pagina's, PDF's, begeleidingsopnamen -> .cache/hymns/nld (niet in git)
.venv-hymns/bin/python scripts/hymns/extract_all.py   # partituren lezen -> .cache/hymns/nld/score
python3 scripts/hymns/build_nld_library.py       # manifest, tekst, muziek, koppeling -> src/lib/hymns/library/data
.venv-hymns/bin/python scripts/hymns/audio_check.py   # onafhankelijke controle tegen de opnamen
python3 scripts/hymns/report.py                  # docs/hymns/15-KWALITEITSRAPPORT.md
```

- **Idempotent en hervatbaar**: een bestaand bronbestand wordt niet opnieuw opgehaald; `fetch-log.json` bewaart per lofzang de
  sha256 van pagina, PDF en opname plus eventuele fouten. De extractie slaat een PDF over waarvan hash en extractorcode niet
  veranderd zijn (`extract_all.py`, `--force` om te forceren).
- **Beleefd**: maximaal ~2 verzoeken per seconde, duidelijke User-Agent, herhaling met uitstel; een mislukte lofzang blokkeert de
  rest niet en komt met zijn fout in het logboek.
- **Deterministisch**: dezelfde bron geeft byte voor byte dezelfde uitvoer (tweemaal draaien levert een identiek manifest).
  `manifest.json` bevat een `dataVersion` (hash van de inhoud) waarmee de app zijn lokale kopie ongeldig maakt.
- **Geen databasemigratie**: de afgeleide gegevens zijn statische, in git versioneerde bestanden (zoals `bomContent.json`) en
  worden per lofzang geladen. Bronbestanden (PDF, opname, pagina) staan nooit in git.

## 3. Bestanden en lagen

`src/lib/hymns/library/data/`:

| Bestand | Inhoud | Laag |
|---|---|---|
| `manifest.json` | bron, tellingen, per lofzang: titel, tekststatus, muziekstatus + reden, capaciteiten, bronhashes | uitgave + kwaliteit |
| `search.json` | compacte zoekindex (nummer, titel, eerste regel) | uitgave |
| `text/NNN.json` | tekst: coupletten, refrein(en), credits, rechten, schriftverwijzingen, bron-URL's en hashes | tekst |
| `music/<compositie>.json` | noten, maten, secties, fermates, tempo; één bestand per unieke melodie | compositie |
| `link/NNN.json` | tekst-naar-nootkoppeling: begin van regels, woorden en lettergrepen in beats | tekst ↔ compositie |
| `evidence-calibration.json` | z-normalisatie van tracker-bewijs per compositie (zie `12-HERKENNING-SCHAALBAAR.md`) | herkenning |

De vijf lagen uit `02-ARCHITECTURE.md` blijven gescheiden: nummer, tekst, compositie, koppeling en herkenningsgegevens staan in
eigen bestanden. Twee lofzangen met **precies dezelfde noten** delen één compositiebestand en één herkenningskandidaat, elk
met hun eigen tekst en nummer (BEWEZEN: `tests/hymns-library-full.test.ts`, gedeelde melodieën). Een tekst die niet bij
een gevalideerde compositie hoort, heeft geen `link/` en geen `music/`: de lofzang is dan alleen leesbaar.

## 4. Teksten

`scripts/hymns/hymn_text.py` leest alleen wat de pagina zelf geeft:

- **Coupletten** met hun nummer; vier lofzangen (44, 143, 197, 199) hebben één couplet zonder nummer in de bron: dat is couplet 1.
- **Refrein per couplet**: een refrein hoort bij het couplet dat het volgt (patroon S-C-S-C). Lofzang 154 heeft in couplet 4 een
  afwijkend refrein; elke afwijkende variant staat apart (`choruses`), gevolgd wordt de eerste (`extraChorusVariants`).
- **Coupletten onder de muziek**: de bron markeert welke coupletten geen eigen tekstrij onder de noten hebben.
- **Bronvermelding**: tekst- en muziekcredits, auteursrechtregels (`rights`), schriftverwijzingen, de officiële pagina-URL, de PDF-URL
  en hun sha256.
- Haakjes in de officiële tekst (`[tot Hij komt,]` bij lofzang 51) blijven staan zoals de kerk ze drukt.

BEWEZEN: 203 teksten zonder lege regels, met aaneensluitende coupletnummers, bronvermelding en zonder dubbele coupletreeksen
(`tests/hymns-library-full.test.ts`). Lofzang 100 heeft acht coupletten en 23 zeven; 25+ lofzangen hebben een refrein na elk couplet.

## 5. Licentie-uitzonderingen en rechten

- **Lofzang 54 en 151**: de kerk publiceert de tekst en de muziek zelf niet ("vanwege beperkingen in het kader van de licentie").
  Dit zijn officiële uitzonderingen, geen importfouten. Het nummer en de titel blijven in de bibliotheek; de app toont een nette
  melding. Er wordt niets via alternatieve bronnen opgehaald of aangevuld.
- **Lofzang 86** heeft wel een tekst maar geen bladmuziek: volledig leesbaar, zonder meezingmodus.
- **Rechten per bestand**: `text/NNN.json` bewaart de rechtenregels van de pagina (auteursrechtvermelding, "kopiëren zonder
  schriftelijke toestemming verboden", "incidenteel niet-commercieel kopiëren toegestaan"). **ONBEKEND** blijft of de eigenaar van
  Versado voor elk afzonderlijk bestand de rechten heeft die nodig zijn om het aan gewone gebruikers te tonen. Daarom blijft de
  hele bibliotheek **uitsluitend voor beheerders** (zie 7); open haar niet voor gewone gebruikers vóór een schriftelijke
  bevestiging per bestand (`01-SOURCE-AUDIT.md`, 6).

## 6. Hoe de app de bibliotheek gebruikt

- Admin-only API (404 voor anderen, ook zonder sessie): `/api/hymns/index` (~63 KB), `/api/hymns/<nummer>` (~15 KB),
  `/api/hymns/recognition` (herkenningsbundel), `/api/hymns/report` (kwaliteitsoverzicht, alleen beheerders). Toegang via dezelfde
  regel als de pagina (`hymnsPocAccess`, `src/lib/hymns/apiAccess.ts`).
- Server: `src/lib/hymns/library/server.ts` leest de bestanden en voegt tekst, koppeling en compositie per lofzang samen tot de
  bestaande `ResolvedHymn`; de engine en de meezingweergave hebben dus niets nieuws nodig.
- Client: `src/lib/hymnLibraryClient.ts` (bewust buiten `src/lib/hymns`, want daar verbiedt de privacytest netwerk en opslag) haalt
  gegevens op en bewaart ze in IndexedDB; zie `13-PRESTATIES-EN-OFFLINE.md`.
- Zoeken (`src/lib/hymns/search.ts`) gebeurt lokaal op nummer, volledige titel, deel van de titel en beginwoorden, zonder verzoek
  per toetsaanslag.

## 7. Toegang

Ongewijzigd: de contentkiezer toont "Lofzangen" alleen aan beheerders; `/dev/lofzangen` en alle `/api/hymns/*` geven anderen 404;
`HYMNS_POC=0` blijft de noodstop. BEWEZEN in een echte browser (`scripts/hymns/e2e-library-access.mjs`).

## 8. Een andere uitgave of taal toevoegen

`import_nld.py` neemt uitgave, taal en URL's als constanten; een nieuwe uitgave (bijvoorbeeld het wereldwijde zangboek) krijgt
een eigen index en eigen `text/`-bestanden. Melodieën die hetzelfde zijn, hergebruiken de bestaande `music/`-bestanden doordat het
compositie-id uit de noten volgt. **AANNEMELIJK** (niet gebouwd): een tweede taal vraagt een eigen `link/`, want de
koppeling hangt van de tekst af.
