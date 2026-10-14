# Lofzangen: bronnenaudit

Onderzoek naar welke officiële gegevens er zijn voor de Nederlandstalige lofzangen, wat daarvan
bruikbaar is voor live meezingen, en wat zelf gegenereerd moet worden. Onderzocht op 14 oktober 2026.

Termen (in alle documenten in `docs/hymns/`):

- **BEWEZEN**: daadwerkelijk geïmplementeerd of gemeten, met een script of test die dat herhaalt.
- **AANNEMELIJK**: technisch onderbouwd, nog niet getest.
- **ONBEKEND**: niet onderzocht of niet te bevestigen.

## 1. Samenvatting

| Vraag | Antwoord |
|---|---|
| Staan de Nederlandse lofzangen (nummer, titel, tekst, coupletten, refrein) online? | **BEWEZEN** ja: 205 genummerde lofzangen in de Gospel Library, met gestructureerde HTML. |
| Is er bladmuziek? | **BEWEZEN** ja: per lofzang een Nederlandse PDF, een vectorbestand (geen scan). |
| Is er MIDI? | **BEWEZEN** niet officieel te downloaden. De kerk biedt alleen PDF en MP3 (zie 3.3). |
| Is er MusicXML? | **BEWEZEN** niet gevonden bij de kerk. |
| Is er audio? | **BEWEZEN** één begeleidingsopname per lofzang, maar de Engelse; geen Nederlandse opname. |
| Is er een koppeling tussen tekst en noten? | Niet als gegeven. **BEWEZEN** wel af te leiden uit de PDF (lettergrepen staan op de plek van hun noot). |
| Kunnen we de noten uit de bronnen halen? | **BEWEZEN** voor de drie proeflofzangen: uitlezen van de PDF-tekenopdrachten, met validatie. Niet generiek (zie 5). |
| Mag dit worden hergebruikt? | De eigenaar van Versado verklaart rechten te hebben. **ONBEKEND** of dat voor elk bronbestand en elk gebruik is vastgelegd; zie 6. |

## 2. Onderzochte bronnen

| Bron | URL | Inhoud |
|---|---|---|
| Lofzangen in de Gospel Library | `https://www.churchofjesuschrist.org/study/manual/hymns?lang=nld` | Lijst van 205 lofzangen (nummer, titel) en per lofzang een pagina. |
| Sacred Music | `https://www.churchofjesuschrist.org/media/music?lang=nld` en `/media/music/songs/<slug>?lang=nld` | Muziekspeler, PDF's, audio, melodienaam. |
| Tech Forum | `https://techa.churchofjesuschrist.org/forum/viewtopic.php?p=264546` | Gebruikersdiscussie over MIDI-bestanden. Geen officiële bron. |
| Gebruiksvoorwaarden | `https://www.churchofjesuschrist.org/learn/legal/terms-of-use/go?lang=eng` | Wat mag met materiaal van de site. |

Methode: alleen gewone, openbare verzoeken zoals een browser die doet. Geen toegangsbeperkingen
omzeild, geen inlog gebruikt, geen verborgen of ongedocumenteerde eindpunten aangeroepen. Het
ophalen staat in `scripts/hymns/fetch_sources.py` en is herhaalbaar (de uitvoer is byte voor byte
gelijk aan de gecommitte bibliotheek).

## 3. Wat er daadwerkelijk beschikbaar is

### 3.1 Lofzangpagina (Gospel Library)

De pagina `/study/manual/hymns/<slug>?lang=nld` bevat in de pagina-status:

- nummer en titel, bijvoorbeeld `24` en `Ere de man`;
- de tempoaanduiding (`Energiek`, `Krachtig`, `Nederig`);
- de volledige tekst in HTML: `div.stanza` met `p.line` per regel en `span.verse-number`, een
  `div.chorus` voor het refrein, en `div.verses-below-the-music` voor coupletten die onder de
  muziek niet meer passen (lofzang 82: couplet 5 en 6);
- bronvermeldingen (`Tekst:`, `Muziek:`) en schriftverwijzingen;
- `meta.sheetMusicPdf.source`: de Nederlandse bladmuziek-PDF;
- `meta.pdf.source`: een afdrukversie van de pagina (niet de bladmuziek);
- `meta.audio[]` met variant `AUDIO_ACCOMPANIMENT`: een mp3.

De slug in de URL is de **Engelse** slug (`praise-to-the-man` voor "Ere de man"). Die is
taalonafhankelijk en daarom bruikbaar als stabiele sleutel voor de compositie
(`comp:praise-to-the-man`).

### 3.2 Sacred Music-pagina

`/media/music/songs/<slug>?lang=nld` toont dezelfde bestanden en daarnaast de melodienaam:

| Lofzang | Slug | Melodie (`tunes`) |
|---|---|---|
| 24 Ere de man | `praise-to-the-man` | Martyr (ook: "Scotland the Brave") |
| 36 Kom, o Gij Vredevorst | `come-o-thou-king-of-kings` | Sanford |
| 82 Kom, volg Mij na | `come-follow-me` | Invitation |

De pagina kent ook de teksten "Bladmuziek om mee te zingen" (interactieve bladmuziek), "PDF-
bladmuziek", "MP3", "Registers" en "Downloads". Of er achter de interactieve bladmuziek een
machineleesbaar muziekformaat zit, is **ONBEKEND**: dat is niet onderzocht, omdat het alleen via
ongedocumenteerde aanroepen zou kunnen en we geen toegangsbeperkingen omzeilen.

### 3.3 MIDI en MusicXML

- De kerk biedt in de pagina-gegevens geen MIDI- of MusicXML-bestand aan. **BEWEZEN** voor alle
  drie de proeflofzangen.
- Het forum (bericht 12 en 15 van het onderwerp "Interactive Music Site") zegt: "All LDS music
  downloads are PDFs and MP3s", de oude interactieve site met MIDI bestaat niet meer, een lid heeft
  oude MIDI-bestanden (293 lofzangen en 108 kinderliederen) van de verdwenen site hersteld, en voor
  de nieuwe lofzangen zou MIDI "één voor één" te verkrijgen zijn via instructies in een ander
  bericht. Dat is een uitspraak van forumgebruikers, geen officiële bron. We hebben die
  instructies niet gevolgd en de herstelde bestanden niet gebruikt: de herkomst en de rechten zijn
  niet vastgelegd.
- Gevolg: oudere MIDI-collecties bestaan volgens het forum, maar zijn **niet officieel
  beschikbaar** en dus niet bruikbaar als bron voor dit project.

### 3.4 Bladmuziek-PDF

De Nederlandse bladmuziek (`*_nld.pdf`) is een **vectorbestand**: Ghostscript 9.27 uit TeX, met het
muzieklettertype `Interlude` en het tekstlettertype Palatino. Dat is beslissend:

- noten zijn tekens (`œ` zwarte kop, `˙` halve kop, `.` punt, `#`/`n`/`b` voortekens, `Œ`
  kwartrust, `U`/`u` fermate, `&`/`?` sleutels) op een exacte positie;
- stokjes, balken en maatstrepen zijn lijnen en gevulde vlakken;
- de lettergrepen van de tekst staan als tekst op de x-positie van hun noot.

Daardoor is het uitlezen **geen beeldherkenning (OMR)** maar het lezen van tekenopdrachten, wat
deterministisch en controleerbaar is (zie 5). De Engelse PDF's (`*_eng.pdf`) gebruiken een ander
lettertype (Maestro) en zijn niet uitgelezen.

### 3.5 Audio

Alleen een **begeleidingsopname** (`*_accompaniment_eng.mp3`, 3:35 voor lofzang 24, stereo 44,1 kHz).
Dit is de opname van de **Engelse** lofzang; er hangt geen Nederlandse opname aan de Nederlandse
pagina. De opnamen bevatten alle coupletten en een voorspel dat niet in de partituur staat
(bijvoorbeeld lofzang 36: het voorspel begint op beat 34 van de cyclus). Ze zijn bruikbaar als
echte testopname voor het volgen, met de beperking uit 4.

## 4. Nederlandse versus Engelse lofzangen

Niet uitgaan van gelijke nummers, en ook niet van gelijke muziek. Wat is vastgesteld:

| | Nederlands | Engels |
|---|---|---|
| Ere de man / Praise to the Man | 24 | 27 |
| Kom, o Gij Vredevorst / Come, O Thou King of Kings | 36 | 59 |
| Kom, volg Mij na / Come, Follow Me | 82 | 116 |

- **BEWEZEN**: de nummers verschillen en de titels zijn vertalingen of herdichtingen.
- **BEWEZEN**: maatsoort (2/4, 4/4, 3/4), tempoaanduiding in kwartnoten per minuut (76 tot 96, 84
  tot 100, 69 tot 76) en het aantal notenbalken (12, 8, 6) zijn Nederlands en Engels gelijk.
- **BEWEZEN**: de Nederlandse tekst past de ritmiek aan de taal aan en de Nederlandse bladmuziek is
  dus een eigen bron. Voorbeeld: de officiële pagina van lofzang 82 heeft "volg Mijn na" waar de
  bladmuziek en de titel "Mij" hebben; het script meldt zulke verschillen en past ze niet stil aan.
- **BEWEZEN (indirect)**: bij het uitlijnen van de Engelse opname met de Nederlandse partituur
  klopt het couplet-deel, maar bij lofzang 24 wijkt het refrein af (zie 05-TEST-RESULTS.md, 3).
- **ONBEKEND**: de noten van de Engelse uitgave zijn niet uitgelezen, dus een noot-voor-noot
  vergelijking ontbreekt. **AANNEMELIJK**: de melodie is gelijk (zelfde melodienaam, maatsoort en
  tempo), de ritmiek van het refrein niet altijd.
- Hergebruikte melodieën tussen lofzangen: de drie proeflofzangen delen geen melodie (de
  herkenner geeft geen kruisbewijs, zie 04-RECOGNITION-POC.md). Voor het hele zangboek is dat
  **ONBEKEND**; de melodienaam (`tunes`) is daarvoor de officiële sleutel en
  `complete_hymns_nld.pdf` (één bestand met alle lofzangen) de bron voor een melodievergelijking.

## 5. Wat officieel is en wat zelf is gegenereerd

| Gegeven | Herkomst |
|---|---|
| Nummer, titel, tempoaanduiding | Officieel (pagina). |
| Tekst, coupletten, refrein, bronvermeldingen | Officieel (pagina-HTML). |
| Bladmuziek | Officieel (PDF). |
| Begeleidingsopname (Engels) | Officieel (mp3), alleen voor tests. |
| Melodienaam | Officieel (Sacred Music). |
| Symbolische partituur (noten, duur, maten, fermate, sleutel) | **Zelf gegenereerd** uit de PDF met `scripts/hymns/extract_score.py`. |
| Tekst-naar-nootkoppeling (woord, regel) | **Zelf gegenereerd** uit de PDF-lettergrepen met `scripts/hymns/build_library.py`. |
| Referentiekenmerken voor herkenning | **Zelf afgeleid** uit de noten (`src/lib/hymns/score/reference.ts`), niet opgeslagen. |
| Testopnamen met bekende tijdlijn | **Zelf gegenereerd** (`src/lib/hymns/eval/synth.ts`). |

### Hoe betrouwbaar is het uitlezen van de noten?

Het uitlezen wordt gevalideerd in plaats van vertrouwd:

- elke maat moet optellen tot de maatsoort (opmaat en slotmaat uitgezonderd);
- tijden van kolommen moeten stijgen, elke noot moet binnen zijn maat eindigen, en in elke balk mag
  geen gat vallen;
- de bibliotheektest (`tests/hymns-library.test.ts`) controleert de afgeleide gegevens opnieuw.

Resultaat: de drie proeflofzangen slagen zonder problemen (344, 177 en 128 noten; 32, 16 en 16
maten). De globale toonklassenverdeling van de partituur komt voor lofzang 24 met die van de echte
opname overeen (cosinus 0,97), wat een grove controle op de toonhoogtes is.

**Beperking (BEWEZEN)**: de extractor is geen algemene oplossing. Op 12 extra, willekeurig gekozen
lofzangen slaagden er 4 zonder meldingen (10, 12, 26, 100); 8 gaven meldingen, onder meer door
rusten, herhalingstekens en andere tekens. Voor het volledige zangboek is dus nodig: uitbreiding
van de extractor en een handmatige controle van elke gemelde lofzang. Dat is bewust niet gebouwd.

De tekst-naar-nootkoppeling: in alle coupletten die onder de muziek staan (24: 1-4, 36: 1-4,
82: 1-4) is elk woord gekoppeld (118 van 118, 109 van 109, en voor 82 98 van 145 woorden omdat
couplet 5 en 6 geen eigen notenbalk hebben). Coupletten zonder balk krijgen alleen een
regelkoppeling, gelijk aan de frasering van couplet 1. Bekende uitzonderingen staan in de uitvoer
van het script:

- lofzang 36 heeft onder de muziek twee extra tekstrijen (herhalingstekst van de slotfrase) die niet
  gemodelleerd zijn;
- lofzang 82: "mede erfgenaam" is in de bladmuziek één woord;
- lofzang 36: "heelal" staat in de bladmuziek over twee systemen verdeeld.

## 6. Rechten en voorwaarden per bron

De eigenaar van Versado heeft aangegeven rechten te hebben op de beoogde content. Hieronder wat er
per bron relevant is. Dit is een technische aantekening en geen juridisch advies.

| Bron | Relevante voorwaarden of feiten | Stand |
|---|---|---|
| Teksten, bladmuziek en opnamen op de Gospel Library | De gebruiksvoorwaarden zeggen dat materiaal van de site eigendom is of in licentie wordt gebruikt door de kerk. Standaard mag je het bekijken, downloaden en afdrukken voor eigen, niet-commercieel gebruik (ook voor je kerkelijke roeping). Plaatsen op een andere website of netwerk is toegestaan voor de Gospel Media-onderdelen voor eigen niet-commercieel gebruik; voor ander materiaal is voorafgaande schriftelijke toestemming nodig. | Het opnemen in een app die aan gebruikers wordt aangeboden valt **niet** onder die standaardvoorwaarden. Dit steunt volledig op de verklaring van de eigenaar. **ONBEKEND**: of een schriftelijke toestemming of licentie is vastgelegd. |
| Muziek (melodie, arrangement) | Op de pagina's staan `Tekst:` en `Muziek:` met namen en jaartallen. Voor sommige liederen is de muziek van een bekende componist (82: Samuel McBurney, geb. 1847), voor andere traditioneel of anoniem (24: Schotse volksmelodie; 36: anoniem, ca. 1889). Het arrangement in de bladmuziek is een eigen uitgave. | **ONBEKEND**: de status van het arrangement per lofzang. |
| Engelse begeleidingsopnamen | Opnamen van de kerk. | Alleen lokaal gebruikt voor metingen, niet in git, niet in de app. |
| Forum-MIDI-bestanden | Herkomst en rechten onbekend. | Niet gebruikt. |
| `nld-poc.json` | Afgeleid van tekst en PDF's. | In de repository met een rechtenopmerking in het bestand; niet als losstaand bestand delen. |

Afspraken in de code:

- de bronbestanden (PDF, mp3, wav) staan in `.cache/hymns/` en zijn uitgesloten via `.gitignore`;
- `tests/fixtures/hymns/unknown-melodies.json` bevat alleen noten (geen tekst) van drie andere
  lofzangen, uitsluitend als "onbekende melodie" in tests;
- voor productie: schriftelijke licentie vastleggen en per uitgave de `sourceName`, `sourceUrl`,
  `licenseName` en `licenseUrl` van `ContentCollection` vullen (zie CLAUDE.md, "Bronmetadata").

## 7. Herhalen

```bash
python3 -m venv .venv-hymns && .venv-hymns/bin/pip install pymupdf
.venv-hymns/bin/python scripts/hymns/fetch_sources.py .cache/hymns
```

Dit haalt de pagina's, PDF's en mp3's op, leest de partituren en bouwt
`src/lib/hymns/library/nld-poc.json` (bevestigd: de uitvoer is identiek aan de gecommitte versie).
