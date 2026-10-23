# Werkelijk bron- en testbewijs — Audio V2

Broncontrole: 2026-10-23T16:52:37.888989+00:00. Cachehervattingen bewaren het originele controlemoment per pagina/bestand.

## Volledige broninventaris

Alle **1.965** hoofdstuk-taalcombinaties en **1.974** aangeboden opnamen zijn daadwerkelijk gecontroleerd.
De 1.974 bestanden hebben 1.973 unieke audiochecksums: Frans Alma 30 heeft twee officiële URL’s met dezelfde bytes.
Iedere download is volledig gedecodeerd; alle pagina’s hebben exact de gevraagde taal en hoofdstukidentiteit.
Geen onbereikbare aangeboden MP3, geen afwijkende tekst-/hoofdstukidentiteit in deze controle.

**Dit is geen inventarisatie van productie of de NAS.** Die zijn niet geïnspecteerd. De kolom legacy betreft alleen bestaande metadata in de repository.

| Taal | Werk | Hoofdstukken | Officiële audiohoofdstukken | Opnamen gedownload | Zonder aangeboden audio | Legacy-hoofdstukken in repo |
|---|---|---:|---:|---:|---:|---:|
| nl | Boek van Mormon | 239 | 239 | 239 | 0 | 205 |
| nl | Leer en Verbonden | 138 | 0 | 0 | 138 | 0 |
| nl | Parel van Grote Waarde | 16 | 0 | 0 | 16 | 0 |
| en | Boek van Mormon | 239 | 239 | 478 | 0 | 239 |
| en | Leer en Verbonden | 138 | 138 | 276 | 0 | 0 |
| en | Parel van Grote Waarde | 16 | 16 | 32 | 0 | 0 |
| de | Boek van Mormon | 239 | 239 | 239 | 0 | 214 |
| de | Leer en Verbonden | 138 | 0 | 0 | 138 | 0 |
| de | Parel van Grote Waarde | 16 | 16 | 16 | 0 | 0 |
| fr | Boek van Mormon | 239 | 239 | 241 | 0 | 239 |
| fr | Leer en Verbonden | 138 | 44 | 44 | 94 | 0 |
| fr | Parel van Grote Waarde | 16 | 16 | 16 | 0 | 0 |
| es | Boek van Mormon | 239 | 239 | 239 | 0 | 239 |
| es | Leer en Verbonden | 138 | 138 | 138 | 0 | 0 |
| es | Parel van Grote Waarde | 16 | 16 | 16 | 0 | 0 |

De exacte hoofdstukken, URL’s, checksums, duur, bronhashes, taal-/tekstcontrole en controlemomenten staan in
[official-inventory.json](../../data/audio/official-inventory.json). Een ontbrekende meta.audio-lijst heet
`NO_OFFICIAL_AUDIO`; dat betekent geen aangeboden opname op deze gecontroleerde officiële pagina, niet een geraden URL.

## Versuitlijning en kwaliteit

Herbruikte bestaande tijdcodes vereisen dezelfde bron en tekst, volledig verse-aantal en geldige grenzen.
Ontbrekende tijdcodes zijn berekend met het bestaande Vosk-/pauzeproces; geen bestaande NL-seed is overschreven.
Software: vosk 0.3.45, av 19.0.2, numpy 2.3.5.
De kleine taalmodellen staan gepind in `scripts/bom-audio/common.py`; er zijn geen modellen/audio in git gezet.

Berekende metadata: **1955** opnamen met technisch gevalideerde grenzen, **12** met onzekere maar begrensde uitlijning, **7** zonder veilige volledige versgrenzen.
Alle onzekere/onvolledige opnamen blijven uitsluitend reviewkandidaten, niet publiceerbaar.
`VALIDATED` is technisch bewijs; beheer doet alsnog de bewuste luister-/publicatiebeoordeling.

Zonder veilige grenzen (de volledige opname blijft als reviewkandidaat beschikbaar):

- de — bofm/morm 1 — audio: `SEGMENT_BOUNDARIES_INVALID`.
- en — dc-testament/dc 84 — female: `SEGMENT_BOUNDARIES_INVALID`.
- en — dc-testament/dc 84 — male: `SEGMENT_BOUNDARIES_INVALID`.
- es — dc-testament/dc 84 — audio: `SEGMENT_BOUNDARIES_INVALID`.
- fr — bofm/1-ne 18 — audio: `SEGMENT_BOUNDARIES_INVALID`.
- fr — pgp/moses 3 — audio: `SEGMENT_BOUNDARIES_INVALID`.
- nl — bofm/1-ne 1 — audio: `SEGMENT_BOUNDARIES_INVALID`.

De bestaande NL 1 Nephi 1- en Duitse Mormon 1-seeds bevatten samenvallende versstarts.
Die bestaande metadata is behouden; ook een nieuwe ASR-poging leverde daarvoor geen veilige complete grenzen op.
Er zijn geen gefingeerde tijdcodes ingevuld om publicatie mogelijk te maken.

Alle uitlijningsuitkomsten en overige reviewpunten staan in [official-alignments.json](../../data/audio/official-alignments.json).

## Technische controles

- 7 audiounit-tests geslaagd (bronhash, segmenten, URL-schema, NL-seed, bestandstypes, Range/HEAD).
- 25 geïsoleerde audio-integratietests geslaagd, inclusief twee Node-processen, rollback, sessierace, albumafbeeldingen en zes verborgen tekstuitgaven.
- 4 Python-bron-/uitlijningsregressies geslaagd (host/taal/hoofdstukbinding, bestaande BOM-units, ontbrekende kop).
- 43 bestaande native unit-tests geslaagd.
- Productiedependencyaudit: 0 bekende kwetsbaarheden.
- Kompas-opdracht: 60 geslaagd, 9 databaseafhankelijke tests overgeslagen in die opdracht; geen volledige Kompas-integratieclaim.
- Prisma-validatie en additieve migratieproef op een eigen lege database met vooraf bestaande tekst/audio/hintvoorraad uitgevoerd.

De afsluitende volledige proef (`scripts/audio/test-isolated.mjs --official --browser`) is geslaagd:

- **1.974 officiële opnamen geregistreerd**, exact aan alle aanwezige hoofdstuk-/uitgavehashes gebonden.
- **0 mislukte officiële imports**, **0 uitgavemismatches**, **0 officiële publicaties**.
- **205 bestaande Nederlandse BOM-audiohoofdstukken**, inclusief alle URL’s, kop- en verstijdcodes, ongewijzigd na de volledige import.
- **22 browsercontroles geslaagd**, inclusief beheerbevestiging/publicatie van uitsluitend synthetische audio, gewone gebruiker versus beheerpreview, GET/HEAD/Range, sessie-intrekking, verbergen, taalkeuze, minispeler, TTS, 320px, 200% tekst en lange Duitse vertaling.
- De 25 integratietests zijn in dezelfde proef opnieuw geslaagd; geen skips.

De volledige registratieproef gebruikte uitsluitend eigen wegwerp-PostgreSQL/Redis en een tijdelijk audiovolume.
De bronbestanden zijn opnieuw door de ontvangende validator gehaald; het is geen SQL-backfill of nagebootste successtatus.
Samenvatting per werk/taal (alleen de geïsoleerde testdatabase):

| Taal | Werk | Geregistreerde opnamen | Hoofdstukken | Technisch gevalideerd | Review vereist |
|---|---|---:|---:|---:|---:|
| nl | bofm | 239 | 239 | 238 | 1 |
| nl | dc-testament | 0 | 0 | 0 | 0 |
| nl | pgp | 0 | 0 | 0 | 0 |
| en | bofm | 478 | 239 | 478 | 0 |
| en | dc-testament | 276 | 138 | 273 | 3 |
| en | pgp | 32 | 16 | 30 | 2 |
| de | bofm | 239 | 239 | 238 | 1 |
| de | dc-testament | 0 | 0 | 0 | 0 |
| de | pgp | 16 | 16 | 15 | 1 |
| fr | bofm | 241 | 239 | 240 | 1 |
| fr | dc-testament | 44 | 44 | 39 | 5 |
| fr | pgp | 16 | 16 | 13 | 3 |
| es | bofm | 239 | 239 | 239 | 0 |
| es | dc-testament | 138 | 138 | 137 | 1 |
| es | pgp | 16 | 16 | 15 | 1 |

De synchronisatie met main #193 wijzigde geen audio-servercode, Prisma-schema of audio-importscripts;
het volledige bronbewijs blijft op identieke code van toepassing. De native inventaris is opnieuw gegenereerd.

## Afbakening

Geen productie/NAS-handeling, merge, deploy of officiële audiopublicatie uitgevoerd. Alleen synthetische testpublicaties in de wegwerpdatabase.
De zes nieuwe officiële tekstuitgaven blijven verborgen/DRAFT/uitgeschakeld, zonder cursussen of oefeningen.
Lokale native-audiopariteit ontbreekt al op de basisbranch en wordt hiermee niet als voltooid geclaimd.
Eigenaaracceptatie op echte toestellen/NAS, inclusief achtergrondweergave, hoofdtelefoonbediening en lifecycle-herstel, blijft nodig.
Fase 3 vraagt eigen Bijbelbron-/uitgavecontrole en import; geen Bijbelaudio is aangeraakt. CFM/FSY-audio blijft fase 4.
