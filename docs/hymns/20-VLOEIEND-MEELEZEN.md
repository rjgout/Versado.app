# 20 · Vloeiend meelezen en vooruitkijken

Doel: tijdens een echte dienst rustig en zonder afleiding kunnen meezingen. **Rustig meelezen gaat voor perfecte synchronisatie**: een korte storing in de
muziekherkenning mag geen hinderlijke onderbreking geven en de gebruiker moet altijd kunnen zien wat eraan komt.

Alles hieronder is gemeten met Node en Chromium (nep-microfoon met een echt audiobestand), **niet** op een echte iPhone of in een kerk.

## 1. Tijdelijk syncverlies: doorlopen op het laatst betrouwbare tempo (`follow/coast.ts`)

Voorheen bevroor de woordmarkering direct zodra de volger "onzeker" werd, terwijl de gemeente gewoon doorzong. Nu loopt de markering een beperkte tijd voorspelbaar door.
Dit is **geen nieuw herkenningsalgoritme**: er wordt niets uit audio afgeleid. `PositionCoaster` rekent met wat de volger al betrouwbaar mat (laatste betrouwbare positie
en tempo) en de bestaande beat-naar-woordkoppeling (`display.ts`).

| Regel | Waarde / gedrag |
|---|---|
| Alleen tijdens de zang | geen schatting in voorspel, tussenspel of vóór een betrouwbare meting |
| Eerst betrouwbaar gemeten | minstens 3 s (`minReliableSeconds`), anders is het tempo onbekend |
| Veilige duur | hooguit 7 s achtereen (`maxCoastSeconds`); daarna bevriest de markering (langdurig verlies: lees zelf verder) |
| Tempo | rustig bijgesteld uit de betrouwbare metingen (tijdconstante ~4 s), begrensd op 0,5–1,8× het nominale tempo; onbetrouwbare metingen tellen niet |
| Stilte | telt niet mee: de muziek staat stil, dus de schatting ook; het schatbudget loopt niet |
| Fermate | houdt de schatting vast (hoe lang gehouden wordt is niet te voorspellen) |
| Einde van de ronde | nooit voorbij het einde van de cyclus: de **volgende ronde (couplet) begint alleen op een door de fase-laag gemeten rondegrens**, nooit op een gok |
| Rondegrens tijdens schatten | de fase-laag meldt hem (`lap`), de weergave springt mee naar het begin van de nieuwe ronde (`noteLap`) |
| Herstel | zonder sprong: achterlopen wordt met beperkte snelheid ingehaald (2,5× tempo, max. 8 beats; groter = echte sprong), vooruitlopen wacht tot de meting aansluit (max. 3 s), nooit terug |

Gemeten tegenover geschat: `DisplayCursor.estimated`, `FollowSnapshot.positionSource` (`measured` / `estimated` / `frozen` / `none`), `displayPosition` en `estimatedSeconds`.
In de weergave is een geschat woord subtieler (accentkleur met stippellijn, `data-estimated`), een geschatte maat een gestippelde omlijning; de status zegt "Tekst loopt door" (neutraal,
geen alarm) in plaats van "Even onzeker". Na de veilige duur staat er weer "Even onzeker / Lees gewoon mee" of "Synchronisatie verloren".

Wat de coast-laag expliciet **niet** doet: een volgend couplet voorspellen (wisselen gebeurt alleen op `lap`-gebeurtenissen van `phase.ts`), woorden markeren tijdens voorspel, stilte of tussenspel,
doorlopen na de veilige duur, of iets met audio doen.

## 2. Vooruitkijken

- **Volledig couplet**: het volgende couplet (volgens de gekozen volgorde, `nextStanzaInPlan`, dezelfde regel als `StanzaPlan.onNewLap`) staat gedimd onder het huidige in dezelfde leesruimte.
  De actieve regel blijft in de bovenste helft (band 52%, doel 30%, `scrollDelta`), zodat ~70% van het scherm voor wat eraan komt is.
- **Karaoke**: de actieve regel staat hoger (28% i.p.v. 40%), de komende regels staan eronder en na het refrein de eerste 3 regels van het volgende couplet ("Volgend couplet N").
- **Bladmuziek**: twee graveerplekken. Het getoonde couplet staat in de zichtbare plek; het volgende couplet wordt in een rustig moment (`requestIdleCallback`) in de verborgen plek gegraveerd
  (één graveerbeurt tegelijk). De coupletwissel is een zichtbaarheidswissel: geen graveerpauze, geen leeg blad (`data-hymns-sheet-ready`, gemeten). Bij een andere breedte of zoom worden beide plekken opnieuw gegraveerd.
- **Geen scrollsprong bij het doorschakelen**: het volgende couplet stond al klaar en wordt het huidige. `useStanzaAnchor` meet de blokken in inhoudscoördinaten en compenseert de scrollpositie;
  wat niet te compenseren is (alles past op het scherm) glijdt in 0,45 s (Web Animations, direct bij verminderde beweging). Gemeten frame voor frame: de nieuwe positie begint waar het voorbeeld stond.
- De maatmarkering in de bladmuziek gaat binnen een couplet niet terug (`holdMeasure`, 1,5 s): jitter rond een maatgrens en de korte tijd tussen "de positie begint opnieuw" en "het couplet is doorgeschakeld" geven geen heen-en-weer.

## 3. Coupletvolgorde en refreinen

Het voorbeeld volgt de gekozen volgorde (aangepast 1 → 4 toont 4, niet 2) en verdwijnt na het laatste couplet (er wordt nooit teruggelopen). Het voorbeeld wisselt **nooit** het getoonde couplet; dat gebeurt alleen op een gemeten
rondegrens of door een handmatige keuze. Refreinen blijven bij het couplet (de reeks is couplet + refrein); het eerste refreinvariant is het enige dat de gegevens kennen (zoals voorheen).

## 4. Leespositie

Muzikale positie (engine) en leespositie (gebruiker) blijven gescheiden. Handmatig scrollen heeft altijd voorrang (`reading.ts` ongewijzigd); automatisch volgen hervat alleen op verzoek of als de gebruiker nog in de automatische stand zit.
Een **bewuste** wissel van couplet of lofzang (aantikken, kiezen, opnieuw starten) zet de leesplek bovenaan (`placeEpoch`); een **vanzelf** doorschakelend couplet doet dat niet. Wisselen tussen de drie weergaven start de microfoon
of muzieksessie nooit opnieuw (gemeten: één `getUserMedia` per sessie).

## 5. Tests en metingen

| Test | Wat |
|---|---|
| `tests/hymns-coast.test.ts` (14) | rekenregels van de coast-laag (tempo, veilige duur, stilte, einde van de ronde, fermate, rondegrens, herstel zonder sprong) en op sessieniveau met echte extractie: kort verlies (6 s), langdurig verlies (18 s), voorspel, stilte |
| `tests/hymns-readahead.test.ts` (10) | volgende couplet volgens de volgorde, scrollband, status, maatmarkering-hold, **refreinlofzangen** (5 uit de bibliotheek met een volgbare testopname), automatische overgang alleen op een gemeten rondegrens, aangepaste volgorde, langdurig verlies over de rondegrens, statische controles van weergave en bladmuziek |
| `tests/hymns-session.test.ts` | de bestaande test "weergave verschuift niet bij syncverlies" is **bewust herschreven**: eerst op tempo doorlopen (geschat), daarna veilig bevriezen |
| `scripts/hymns/e2e-meelezen.mjs` | browser, echt 82-bestand (en synthetische dienst voor refreinlofzang 24) met een gat in het zingen: voorbeeld klaar, geschat doorlopen, nooit terug, geen scrollsprong frame voor frame, bladmuziek vooraf gegraveerd |

Browserresultaten (Chromium, nep-microfoon, officiële begeleiding lofzang 82 met een 6 s gat via `drop72.wav`, daarnaast refreinlofzang 24):

| Weergave | Portret 390×844 | Landschap 844×390 |
|---|---|---|
| Volledig couplet | 9/9 | 9/9 |
| Karaoke | 10/10 | 9/9 |
| Bladmuziek | 8/8 | 8/8 |
| Lofzang 24 (refrein), volledig couplet | 9/9 | – |
| Zonder storing (82, volledig couplet) | nooit geschat (0 samples), 8/8 | – |

Bestaande tests opnieuw uitgevoerd: `e2e-reading.mjs` 60/60 (handmatig bladeren, hervatten, 320 px, grote tekst, landschap), `e2e-sheet.mjs`, `e2e-sheet-sync.mjs`, `e2e-live-audio.mjs` (herkennen en volgen) en de foutscenario's van `e2e-live-failures.mjs`.
(`e2e-reading.mjs` is bijgewerkt: de wisselknop doorloopt sinds de bladmuziek drie weergaven.)

## 6. Beperkingen en wat nog niet bevestigd is

- Alleen Chromium met een nep-microfoon; geen echte iPhone/Android en geen echte kerkopname met zang. De waarden (7 s, 3 s, 2,5×, 52%/30%) zijn gekozen op de officiële begeleiding en synthetische diensten, niet afgestemd op echte diensten.
- De geschatte positie wijkt hooguit ongeveer één regel af van de waarheid (gemeten); de volger zelf loopt soms ~1 beat voor, en de schatting neemt die over.
- Bij verlies over een rondegrens blijft de markering aan het einde van het couplet staan tot de volger de nieuwe ronde meet; het volgende couplet staat dan al klaar onder het huidige om op te lezen.
- De bladmuziek houdt twee gegraveerde partituren in het geheugen (SVG); op een telefoon is de graveertijd en het geheugengebruik niet gemeten.
- Afwijkende refreinvarianten (zoals lofzang 154) zijn er niet in de gegevens; alleen de eerste variant wordt getoond.
