# 05 — Teststrategie en risicoanalyse

Dit document scheidt de **uitgevoerde fase-0-controles** van de nog te bouwen
en uit te voeren V2-acceptatietests. Een ontwerp is geen gevalideerde
implementatie. Bron van de audit: main `b5aafbf`, 11 oktober 2026.

## 1. Werkelijk uitgevoerd in fase 0

| Controle | Resultaat | Wat dit bewijst |
|---|---|---|
| `npx tsx --test tests/content-edition.test.ts tests/content-switch.test.ts tests/content-source-icons.test.ts tests/learning-rules.test.ts tests/streak-central.test.ts tests/otb.test.ts tests/study-scoring.test.ts tests/study-reading-phase.test.ts` | 53 geslaagd, 0 mislukt, 0 skipped | Bestaande pure regels, broncontracten en lokale OTB-parser/validatiefixtures |
| `npm run test:focus` | 23 geslaagd, 0 skipped | Bestaande focus- en shell-sourcecontracten |
| `npm run test:live-data` | 51 geslaagd, 0 skipped | Bestaande verversing/key/invalidatiecontracten |
| `npx tsc --noEmit` | Exit 0 | Huidige applicatie compileert; geen appwijzigingen in deze audit |
| `npx tsx scripts/i18n/check.ts` | Exit 0; en/de/fr/es elk 3261/3684 vertaald | Bestaande achterstand van 423 sleutels per taal; geen nieuwe UI-teksten toegevoegd |
| `DATABASE_URL=postgresql://audit:audit@127.0.0.1:1/content_v2_audit npx prisma validate` | Exit 0; schema geldig | Statische validatie met onbruikbare dummy-URL; geen verbinding/migratie |
| `npm run lint` | Exit 0; 0 fouten, 132 bestaande waarschuwingen | Bestaande codekwaliteit; Markdown is geen nieuwe applicatiecode |

De 127 uitgevoerde tests gebruiken geen echte database. OTB-tests lezen/
schrijven tijdelijke lokale fixtures en mocken de DB-client om afwijzing vóór
writes te bewijzen; geen upstreamdownload of contentimport uitgevoerd.
TypeScript/Prisma/schema zijn ongewijzigd. De aangehaalde logs zijn lokale
werkomgevingsartefacten, geen repositorycontent met gebruikersdata.

ESLint is uitgevoerd zonder automatische fixes. De 132 waarschuwingen betreffen
bestaande applicatie- en testcode; deze documentatieopdracht verandert die niet.

De documentatie is afzonderlijk gecontroleerd: alle zeven gevraagde bestanden
zijn aanwezig, de elf lokale Markdown-links wijzen naar bestaande documenten
en de codeblokken zijn gesloten. Er zijn drie Mermaid-diagrammen opgenomen;
de diagrammen zijn op structuur nagelezen, niet in een browser gerenderd.

Bij de aanvullende vastlegging van besluiten D1–D4 zijn de documentconsistentie,
lokale links, codeblokken, diff en documentatie-only scope opnieuw gecontroleerd.
De applicatiechecks hierboven horen bij de oorspronkelijke audit en zijn voor
deze aanvullende documentatiewijziging niet opnieuw uitgevoerd. Er zijn geen
productiegegevens benaderd en geen technische bronvalidaties vervroegd uitgevoerd.

### Niet uitgevoerd en niet geclaimd

- Productie-inventaris/DB-readback, migratie, seed, scraper of adminpublicatie.
- `content-switch.integration`, `learning-progress.integration` of andere
  echte DB-suites. Sommige scripts skippen deze bij ontbrekende
  LEARNING_TEST_DATABASE_URL; ze worden hier niet als geslaagde integratie
  gepresenteerd. Fase 0 verbiedt migratie/import; er is dus geen nieuwe
  wegwerpdatabase ingericht.
- Een volledige OTB-upstreamscan of officiële CFM/FSY-broncontrole.
- Browserreproductie/screenshots van deze auditbranch. De recente header-
  fix is in actuele code en contracttests bevestigd, niet opnieuw live gemeten.
- Nieuwe productiebuild of deployment voor deze documentatie-only opdracht.
- Fysieke iOS/Android-, Safari/WebKit- of Capacitor-tests.

Deze beperkingen blokkeren het **ontwerp** niet. Echte data-inventaris,
fixturebroncontrole en herstelproef zijn verplichte gates vóór implementatie-
uitrol; browser-/DB-bewijs is per fase verplicht.

Bij de hervatting van fase 1A heeft de eigenaar de aanvullende geïsoleerde
backupherstelproef expliciet overgeslagen. Deze specifieke risicoacceptatie
vervangt die herstelgate voor de voorbereiding van de 1A-PR; de daadwerkelijke
productie-inventarisatie en geïsoleerde migratie-/databehoudtests blijven nodig.
Dagelijkse Hyper Backup is door de eigenaar bevestigd, maar bewijst geen
geslaagde restore, backupconsistentie of gecontroleerde mediadekking.
Document 07 houdt de werkelijk gecontroleerde status bij. Geen nieuwe backup
of herstelactie uitvoeren en geen productie-uitrol afleiden uit deze uitzondering.

## 2. Testlagen voor de implementatiefasen

### A. Pure regels en schema's

Bronsoorten, editie-families, routeclassificatie, fallbackafwijzing,
publicatiebeschikbaarheid, programma-, periode- en lesidentiteit, kalenderlookup,
rich-schema, tekstnormalisatie, selectors, verwijzingsdoelen en spelondersteuning.
Geen tests die uitsluitend CSS-klassennamen van de eigen implementatie
herhalen; broncontracttests blijven aanvullend op echt gedrag.

### B. Repository-/service-integratie

Eigen PostgreSQL-wegwerpdatabase, alle vereiste migraties, expliciet fixture-
manifest. Vooraf database-id/host allowlisten; scripts mogen nooit de normale
DATABASE_URL als testfallback nemen. Iedere suite start met eigen tijdelijke
gebruiker/bron/lesdata, controleert invarianten en ruimt alleen zijn fixtures op.
Gebruik de bestaande isolated-runnerpatronen uit scripts/puzzle/layout-audit/
word-game zonder productieaccounts of algemene live runSeed.

Bewijs atomiciteit met echte concurrente verzoeken, constraintfouten,
afgebroken publicatie en doelbewuste fout vóór/na commit. Niet uitsluitend
mocken dat `$transaction` wordt aangeroepen. Restoretest met backup van
fixturedata incl. verwijzingen/privéannotaties en immutable media.

### C. API en autorisatie

Niet ingelogd, vreemde eigenaar, verborgen/disabled/draft, staleVersion,
fout program/edition/period/lesson, vervalste URL/selector, unknown action,
double submit en verloren response/retry. GET-preview is read-only. Publieke
DTO's bevatten geen answers, private notes of ongepubliceerde bodies.
De content-only API krijgt geen persoonlijke voortgang/annotations.

### D. Werkelijke browser en platform

UI-test tegen dezelfde productiebuild en fixture-API, met echte login en
daadwerkelijk gerenderde tekst, hit-testing, computed layers, focus en scroll.
Afmetingen, safe areas en keyboard niet afleiden uit Tailwindklassen.

| Variatie | Minimum |
|---|---|
| Mobiel portrait | 320, 375, 390 en 430 px |
| Tablet/desktop | 768 en 1280 px, plus geschikte grotere layout |
| Landscape | Telefoon en tablet; notch links/rechts |
| Tekst | 100% en 200%, brede systeemfontfallback, lange vertaling |
| Thema/beweging | Light/dark; reduced motion |
| Invoer | Touch drag/scroll/longpress, mouse, keyboard, screenreader-steekproef |
| Navigatie | Back/forward/deeplink/reload/app-resume, virtueel toetsenbord |
| Platforms | Chromium CI; daarnaast Safari/iOS en Android WebView op echt toestel of geschikte simulator vóór productieacceptatie |

De huidige Capacitor-profielen zijn remote-preview, geen voltooide native
releasearchitectuur. UI-compatibiliteit mag niet als App Store-releasevalidatie
worden beschreven. Offlinelezen is momenteel geen productfeature; test
netwerkverlies/herstel zonder te beloven dat de service worker content bewaart.
Onopgeslagen positie krijgt een herstelbare status, nooit schijnbaar 'bewaard'.

## 3. Scenario's en verplichte bewijzen

### Fase 1 — Aanbod en context

1. Gewone gebruiker/admin zien de juiste catalogus; hidden/disabled/draft
   blijven onbereikbaar via directe text-, read-, preview- en start-API's.
2. Geen toegankelijke collectie: nette status, geen synthetische BOM-fallback.
3. Bron wisselen vanaf Vandaag, cursussen, hoofdstuk, leesstap, FSY en spel;
   juiste route-equivalenten of gekozen-bronhub, geen bevestigingsdialoog.
4. Taalwissel blijft in expliciete familie; geen beschikbare taaleditie leidt
   niet naar een andere bron. uiLanguage blijft onafhankelijk.
5. Context A/B gescheiden; oudere les blijft na kalenderwissel actief;
   nieuw account zonder lesinstelling werkt; double taps/twee apparaten veilig.
6. Geen datavervuiling met late fetchresponses. Cardmenus/sleepkaart onder
   header en contentkiezer niet afgekapt; terug en bottomnav blijven werken.
7. Podcasts als herkenbare aparte rij onder Studieprogramma’s, type OTHER;
   geen wekelijkse leslogica, bestaande podcastfuncties/voortgang behouden.
   Verwijzingsmapping is geen voorwaarde voor fase 1A.

### Fase 2 — Lezen, verwijzingen en publicatie

1. Import herhalen geeft geen dubbele logical ids/revisions met dezelfde
   inhoud; parse-/media-/linkfout geeft zichtbaar conceptprobleem, oude
   publicatie blijft intact. Alle betekenisvolle blokken overleven conversie.
2. Concurrent publish vs publish/rollback heeft versionconflict, geen vreemde
   revisionpointer of gemengde media. DB-fout rolt pointer/registratie terug.
3. Lezen bewaart anker, hervat op andere viewport/font en na late afbeelding;
   herladen/weer inloggen/ander apparaat gebruiken de juiste editiepositie.
4. Nieuwe les/save-response-race kan alleen het eigen target wijzigen.
5. 100% scroll ≠ READ; reopen ≠ nieuwe activiteit; expliciet READ atomair;
   dubbele mark/retry/revisie-/taalwissel ≠ extra reeks/XP.
6. Drie onafhankelijke statussen: positie halverwege + READ mogelijk;
   positie 100% + UNREAD mogelijk; oefeningen afgerond + UNREAD mogelijk.
7. Preview opent/sluit met focusherstel, zonder context-/leesmutatie.
   Meer lezen wijzigt bron bewust; Terug naar les herstelt anker/selectie;
   zelfstandige vervolgroute activeert geen automatische terugwisseling.
8. Onbekende/missing/verborgen reference geeft officiële fallback als bekend,
   anders unavailable en admindiagnose. Nieuwe import maakt logische link
   oplosbaar zonder bestaande lesbody's te herschrijven.
9. Vóór fase 2D en latere publicatie: canonieke én editie-equivalentie van
   interne previews bewijzen met bronfixtures. Onzekere mapping geeft externe
   officiële fallback of melding; nooit stille vertalingssubstitutie.
10. Imports, updates en rollback behouden bestaande publicaties, relevante
    revisies, snapshots, gerefereerde media en persoonlijke annotaties.
    Geen automatische garbage collection of destructieve contractstap zonder
    afzonderlijk goedgekeurd beleid.

### Fase 3 — Kalender en FSY-legacy

1. Volledig gecontroleerd Nederlands CFM 2026-manifest met teksten en media;
   echte start/einddata en afwijkende
   intervallen; current-weeklookup in verschillende IANA-zones/DST/jaargrens.
2. Geen beschikbare huidige les: bestaande actieve keuze blijft, leskeuze
   beschikbaar; geen lege kaart. Naar 2027 gaan overschrijft 2026 niet.
3. FSY meerdere lessen/categorieën per maand, selectie blijft bewust.
4. DRAFT met publishedContent migreert oude publicatie én nieuw concept;
   draft-only wordt niet publiek. Titles/images/publishedAt behouden.
5. Oude FSY-route/melding/cursusabonnement openen de juiste nieuwe les.
   Cursusstart wordt nooit inferred READ. Eén actieve scraperwriter.
6. Officiële opdrachten worden tekst, geen automatic Exercise/XP; publicatie
   buiten adminrechten afwijzen; alle contenttalen correct onderscheiden.
7. Vijf bestaande UI-talen behouden. Andere contenttalen zijn uitsluitend
   zichtbaar als hun inhoud daadwerkelijk beschikbaar en gepubliceerd is;
   een UI-vertaling biedt geen ongepubliceerde lesvertaling aan.

### Fase 4 — Annotaties en studiemap

1. Counts en id/payload/color/timestamps van bestaande drie tabellen gelijk.
   Legacy endpoints zijn null-safe na eerste lesson-target row.
2. Passagequote/offsetroundtrip inclusief accents, inline-links, multiline,
   emoji in brontekst, whitespace, meerdere blokken en tekstvergroting.
3. User A kan B's id, selector, deeplink of notitie niet ophalen/wijzigen;
   admin krijgt geen impliciete toegang. Realtime/logs bevatten geen tekst.
4. Edit/delete/retry/concurrent devices gebruiken versions/desire-state;
   pending failure herstelt correct, geen dubbele toggles.
5. Toegevoegd/gewijzigd/verwijderd blok: exact/unique/ambiguous/orphan-
   outcome; originele notitie blijft. Taalwisseling verplaatst geen ranges.
6. Mijn studiemap toont alle bronnen, zoekt/filters/pagineert zonder missers;
   hidden-source item blijft privé bewerkbaar, volledige verborgen tekst niet.
7. Exacte deeplink + terugkeer, keyboardselectie en native touchselectie;
   geen verspringende leestekst of overlay achter header.
8. Annoteren en mapbezoek wijzigen XP/reeks/activityfeed niet.

### Fase 5 — Spelcontent

1. Matrix per GameCatalog-entry: supported-kind/mode/taal/familie, adminscope,
   globale instelling, voldoende pool en lesvereiste. UI/API/resume coherent.
2. Onbekende of lege collectie geeft geen ongescoped query/BOM-fallback.
3. ActiveLesson/source/publication veranderen na start; frozen spel blijft
   identiek en nieuwe start gebruikt nieuwe correcte pool.
4. Alle woorden/vraag-/beeldtargets komen uit toegestane echte bronnen;
   privénotities zijn nooit input. Niet-geselecteerde les lekt niet in pool.
5. Verborgen Woord later: authenticated turns, hostrole, geen gasten bij netwerkspel,
   letter/whole-wordretry, gedeeld foutenbudget en presentatiescherm zonder antwoord.

### Bestaande functionaliteit als regressiebaseline

- learning-rules/progress: alle leesroutes, legacy XP, reset en repeatdiscount.
- content-switch/edition en course-sync: ids/cursors/links/taal behouden.
- streak/time/social: idempotentie, IANA/DST, freezes, vrienden/groepsreeks.
- WordGame/hints: zes pogingen, BOM-pool, 60 minuten accountbrede cooldown, dagwissel om 18:00,
  geen dubbele afschrijving, score/XP/leaderboard.
- Puzzel: geometry1/2/rulesVersion, snap/group/anchor, draglift, zoom/pan/
  rotatie bij Meester, save/resume/question/replay, persoonlijke hints, 216 beelden.
- Woordzoeker: geselecteerde difficulty, generatie/XP, geen reekswijziging.
- Scrabble/ChapterGuess/Family/Alleskenner/liveStudy: bestaande flow en rollen.
- shell/focus/live-data/Kompas/artwork/i18n; geen contentrechten gewijzigd.

Volledige productchecks lopen per codefase; geen nieuwe test toevoegen die
slechts het documentatievoorstel of CSS-klassennamen kopieert.

## 4. Risicomatrix

**Kritiek** = blokkeert de betreffende implementatie-uitrol.
**Hoog** = verplicht oplossen/testen in genoemde fase.
**Later** = mag wachten als er nog geen concrete afhankelijkheid is.

| ID | Risico en huidige aanwijzing | Prioriteit / gate | Maatregel en bewijs |
|---|---|---|---|
| R1 | Verborgen bronnen via login-only hoofdstuk/read-API | Kritiek, fase 1 | Centrale actor/publicatiegate; directe API-tests |
| R2 | Bronvermenging door BOM-default/undefined queryfilter | Kritiek, fase 1/5 | Expliciete adapter+context, fail closed, tests op poolherkomst |
| R3 | Oude identiteit deelt nieuwe editie ten onrechte | Kritiek vóór tweede familie | Bestaande sleutels behouden, nieuwe namespace, collisionaudit |
| R4 | Annotaties verdwijnen door versecascade | Kritiek vóór nieuwe import | Delete-impactgate/retire; annotatieaantallen en hersteltest |
| R5 | Oefeningen regenereren met nieuwe ids, historieverlies | Kritiek vóór aangepast importpad | Geen algemene runSeed, behoud bestaande credits/sessies, versionupdates |
| R6 | FSY-DRAFT wordt als nooit gepubliceerd behandeld | Kritiek, fase 3 | aanwezigheid van publishedContent afzonderlijk migreren en checksummen |
| R7 | Twee FSY-schrijvers/overlappende imports | Kritiek, fase 3 | DB-lease en writerhandover; doubleworker/failuretest |
| R8 | Import deels publiek ondanks fout | Kritiek, fase 2 | Conceptbatches + atomische pointer, foutinjectie/controle op beschikbare media |
| R9 | Ambigue tekstankers na edit | Hoog, fase 2/4 | Stabiele ids+quote; orphan bewaren, geen fuzzy automapping |
| R10 | Cross-language textpositions fout overgezet | Hoog, fase 2/4 | Positie/ranges per editie, bewezen mapping of expliciet begin |
| R11 | Private notes uitlekken via admin/API/realtime | Kritiek, fase 4 | Eigenaargate, private queries, geen payloadtekst, multiusertests |
| R12 | MarkRead en activity half verwerkt/dubbel | Kritiek, fase 2 | Eén transactie, vaste logische activiteitssleutel, vergrendelingsvolgorde User → progress |
| R13 | Cache toont vorige les/taal of oud concept | Hoog, fase 1/2 | Full context/revisiesleutels en events na commit; tests met trage verzoeken |
| R14 | Header/overlay/safearea of dubbele scroll | Hoog, iedere UI-fase | Eén shell/portal native modal; computed browsermetingen |
| R15 | Oude nul-lescontext leidt tot crash/reset | Kritiek, fase 1 | Nullcompatibiliteit/lazyinit; fixtures van bestaande accounts |
| R16 | Kalender leidt zelf tot nieuwe actieve les | Hoog, fase 3 | Persistente gebruikerskeuze; huidige-weekactie expliciet, DST-/grensfixtures |
| R17 | Lege lessen/cursus-/spelkaarten | Hoog, fase 1/3/5 | Werkelijke publicatie/poolvoorwaarden, geen kaart met alleen metadata |
| R18 | Grote beelden/lessen vertragen layout/ankers | Hoog, fase 2/3 | Gereserveerde afmetingen, lazy loading, begrensde preview en profiel van lange les |
| R19 | Native keyboard/selection/back afwijkt | Hoog, fase 2/4 | WebView/simulator/toesteltest, platformhelper; geen releaseclaim zonder bewijs |
| R20 | Approllback faalt op null verseId | Kritiek, fase 4 | Compatibele rollbackimage vóór eerste lestarget-write |
| R21 | Opgeslagen URL/meldingslink breekt | Hoog, fase 1/3/4 | Behouden adapters, legacydeeplinkmatrix |
| R22 | Nieuwe platformabstracties groter dan gebruik | Hoog, ontwerp-review | Geen framework/queue/zoekcluster; JSON-blokken, bestaande services |
| R23 | Onbekende bronstructuur/voorwaarden/media | Kritiek vóór import | Officiële voorbereiding en registratie van verleende rechten, geen verzonnen URLs |
| R24 | SSRF/path traversal/onjuiste mediabestanden | Kritiek, fase 2 | HTTPS-allowlist voor redirects, MIME/bytegrenzen, checksum/storageKey, kwaadaardige testfixtures |
| R25 | Offline verwachtingen groter dan huidige app | Hoog, UX-communicatie | Herstelbare fout/local pendingpositie; geen nieuwe offlinebelofte |
| R26 | Oud FSY-ontwerp/media ontbreken bij conversie | Hoog, fase 3 | Legacybody behouden, nieuwe volledige bronreview, completenessmanifest |
| R27 | Opruiming/contract wist publicaties of persoonlijke gegevens | Kritiek vóór iedere destructieve stap | Bewaarbeleid D4 handhaven; geen automatische GC of destructieve contractmigratie zonder afzonderlijk goedgekeurd beleid |

Latere optimalisaties: fulltext-index als SQL-zoekmetingen dat vragen,
aanvullende videoadapters en bulkeditiemapping. Mediaopruiming is geen gepland
automatisme en vereist eerst afzonderlijk goedgekeurd beleid. Geen blokkade voor
de eerste bron-/leesfase zolang gates voor correctheid, privacy en herstel blijven staan.

## 5. Gates vóór productie en na uitrol

Per fase vereist: groene gerichte unit-/echte DB-/browserchecks,
TypeScript/lint/i18n/Prisma-validatie en schone productiebuild op exact PR-HEAD.
Migratie op kopie/wegwerpdata, constraintpariteit en bewezen herstel.
Beoordeling door de eigenaar van concrete UI/broninhoud, vertalingen en rechtenvoorwaarden.

Bij uitrol: eerst additief schema, dan compatibele app, dan feature/publicatie
expliciet activeren. Na commit alleen centrale invalidatie. Meet zonder
privéteksten: mislukte contentzoekopdrachten, ontbrekende verwijzingen, contextconflicten,
importfouten en verdwenen recordcounts. Bij dalende aantallen persoonlijke records, inhoud uit de verkeerde
bron of publiek concept: nieuwe writes/starts direct stoppen en rollback
volgens document 03; geen tweede 'fix'-import op productie stapelen.

Geen oude FSY-/annotatie-/routecode verwijderen tot de contractgates uit
document 03 en een afgesproken observatieperiode aantoonbaar gehaald zijn.
