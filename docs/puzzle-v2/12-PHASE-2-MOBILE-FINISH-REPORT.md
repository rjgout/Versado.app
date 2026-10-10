# Legpuzzel V2 — mobiele fase-2-afwerking

Branch: `fix/legpuzzel-v2-mobile-finish`, vanaf actuele main `9cb9c0b`.
Onderzoek is vooraf vastgelegd in commit `16b7351` en document 11.
Dit rapport hoort bij de implementatiecommit op dezelfde branch. PR en
commitlinks staan in de oplevering. Fase 3 en multiplayer blijven buiten scope.

## Correcties en oorzaken

| Punt | Werkelijke oorzaak en correctie |
| --- | --- |
| Klein speelveld / schermvulling | Shell-marges/maximumbreedte en automatisch fitten van alle parkeerplaatsen verkleinden het bord en de stukken. Alleen het actieve bord vult nu `100dvh` onder de bestaande gemeten terugbalk, met safe areas. De camera begint bij bruikbare stukken of de grootste verbonden groep; alles tonen blijft een expliciete menuactie. |
| Aansluitingen | Het omkeren van een gedeelde rand keerde alleen het tab-teken om, waardoor positie, skew en Bézier-controlpunten verschilden. Buren volgen nu hetzelfde canonieke pad in tegengestelde richting. Verbonden groepen krijgen één echte buitencontour met gaten en één beelduitsnede; interne clips en dubbele strokes vervallen. Geen dikkere outlines of naadmaskers. |
| Op zijn plek vallen | De versleepte groep was het vaste merge-anker, waardoor de stilstaande buur versprong. Nu trekt het bewegende stuk/de groep naar de stationaire buur. Bij vervolgverbindingen blijft dat eerste anker vast. Een geaccepteerde snap beweegt kort naar de exacte serverpositie; reduced motion slaat die beweging over. World-toleranties en servervalidatie blijven behouden. |
| Terugnavigatie | Alle lokale Solo-stappen hadden dezelfde route, waardoor de algemene terugbalk naar Spelen ging. De bestaande centrale balk krijgt nu een lokale terugactie: bord, complete afbeelding, resultaat en replay naar puzzelkeuze; vraag naar complete afbeelding/Verder. Alleen de catalogus verlaat de puzzelcontext via de normale bovenliggende appnavigatie. Late responses kunnen een verlaten sessie niet terugzetten. |
| Voltooiingstekst | Resultaatteksten en StreakContinuationCard zetten de reeks centraal. Resultaat toont nu Puzzel compleet en positieve puzzel-/vraagfeedback in vijf talen. De reekskaart en generieke Spelen-link vervallen; Nog een puzzel en replay blijven. Centrale antwoord-, activiteit-, belonings- en reeksafhandeling zijn ongewijzigd. |
| Oude UI | De ongebruikte JigsawClient bestond nog naast de enige actieve V2-route. Die component is verwijderd. De actuele route heeft geen legacy-querytoggle/fallback. Alle moeilijkheden en oude v1/hintvoortgang gebruiken dezelfde Solo-interface; uitsluitend Meester toont na selectie een toegankelijke draaiknop. |
| Responsive / hervatten | Image.onload en resize fitten opnieuw. Image.onload tekent nu alleen; resize behoudt zoom en wereldmidden binnen tafelgrenzen. Menu is begrensd op beschikbare breedte/hoogte; contextknoppen overlappen ook bij 200% tekst niet. De browser vond bovendien een geannuleerd frame-id dat bij een dubbele mount bleef staan: cleanup wist dat id nu. |

De legacy `/api/jigsaw` blijft niet-visuele tokencompatibiliteit voor bestaande
pogingen bieden. Historische hintmetadata en vertaalde compatibiliteitskeys
blijven bewaard; zij openen geen oude UI. De huidige serviceworker slaat geen
pagina's/data op. Oude screenshots zijn zonder build-id niet aan een tweede
actieve route in de huidige build toe te schrijven.

## Bestanden

- `src/app/globals.css`: actieve bordviewport en veilige randen.
- `src/components/JigsawV2Client.tsx`: camera, groepsrendering, snapbeweging,
  terugstappen, late-responsebeveiliging, contextbediening en resultaat.
- `src/components/JigsawClient.tsx`: verwijderd.
- `src/components/SubpageBackBar.tsx`, `src/lib/backTarget.ts`: optionele lokale
  terugactie binnen de bestaande balk; andere gebruikers houden hun gedrag.
- `src/lib/puzzle/geometry.ts`, `engine.ts`, `viewport.ts`: complementaire paden,
  groepscontour, stationair snapanker, startcamera en resize.
- `src/lib/i18n/messages/{nl,en,de,fr,es}.ts`: drie resultaatteksten per taal.
- `tests/puzzle-fit.test.ts`, `puzzle-engine.test.ts`, `puzzle-flow.browser.mjs`,
  `puzzle-mobile.browser.mjs`: reproducties en engine-/flow-/mobiele regressies.
- `package.json`, `scripts/puzzle/test-isolated.mjs`,
  `.github/workflows/puzzle-v2.yml`: nieuwe tests in lokale en CI-runner.
- `docs/puzzle-v2/02-PRODUCT-SPECIFICATION.md`, `06-TEST-STRATEGY.md`,
  `11-PHASE-2-MOBILE-FINISH-INVESTIGATION.md` en dit rapport: actueel contract,
  onderzoek en onderbouwing.

## Verificatie

De nieuwe rand- en stationaire-snapreproducties faalden beide op de oude code.
Na herstel slagen zij. De randtest vergelijkt 7.584 gedeelde randen op werkelijke
Bézier-punten/controlpunten, voor v1/v2, alle vijf rasters en twaalf seeds.
Groepscontourtests controleren ook gaten en hoekraakpunten.

| Controle | Resultaat |
| --- | --- |
| Engine + legacy | 29 geslaagd, geen skips |
| Geïsoleerde database-integratie | 16 geslaagd, geen skips; eigen tijdelijke PostgreSQL, alle 132 migraties, daarna opgeruimd |
| Focus / centrale shell | 21 geslaagd |
| Live-data-regressies | 51 geslaagd |
| Kompas incl. database-integratie | 69 geslaagd op dezelfde geïsoleerde database, geen skips |
| Reekskalender | 1 geslaagd |
| TypeScript | Geslaagd; na laatste wijziging en opnieuw na schone build |
| ESLint | Geen fouten; 133 bestaande waarschuwingen, gerichte controle zonder waarschuwingen |
| i18n | Alle 72 puzzelsleutels compleet in nl/en/de/fr/es; algemene bestaande 423 ontbrekende keys per vertaling blijven buiten deze correctie |
| Productiebuild | Schone `next build` geslaagd; aanvullende `tsc --noEmit` geslaagd |
| Echte browserflow + mobiele browser | Beide geslaagd in ontwikkelmodus én tegen de schone productiebuild; geen runtimefouten; alle 6×874 naadpixels exact gelijk aan referentie (gemeten maximale afwijking 0) |

De browserflow gebruikt echte sessies, API-responses en databasegegevens:
216 afbeeldingen over negen pagina's, zoeken/pagineren/selecteren buiten de
eerste twintig, hervatten/wisselen, echte laatste verbinding, afbeelding,
Verder, vraag, herladen, verloren completion- en antwoordresponses, positieve
felicitatie, replay, historische vraag en kalenderdagregels. De centrale
terugknop wordt vanuit bord, complete afbeelding, vraag, resultaat en replay
gecontroleerd.

De mobiele browser controleert fullscreen/scroll op 320×568, 390×844, 430×932,
844×390 landscape, 768×1024 en 1440×900. Rond een aangesloten rand vergelijkt
hij 874 echte canvaspixels per schermmaat met de oorspronkelijke afbeelding.
Daarnaast: resize zonder nieuwe fit, veilige randen, echte CDP-touch-pinch/pan
en groep-groep snap met vervolgverbinding, vier moeilijkheden, draaien bij
Meester, oude v1/hintstatus, 320px/200% tekst en een bereikbaar landscape-menu.
Runtimefouten worden apart verzameld. Alleen het niet-productieve Next-
ontwikkelicoon wordt in de mobiele test verborgen zodat het geen spelknop
bedekt. Screenshots en pixelmetingen worden als CI-artifact bewaard.

## Behoud en resterende acceptatie

Geometry-versie, seeds, opgeslagen posities, klassieke vormen, pannen, pinch,
groepsverplaatsing, vraag/replay, contentrechten en centrale server-side
sessie-/reeksregels zijn behouden. Geen schemawijziging en geen productie-
databaseactie. De bestaande sessie-integraties bewijzen geen dubbele beloning,
onbeperkte nieuwe pogingen en een geldige voltooiing op een volgende dag.

Chromium-emulatie en automatische pixeltests vervangen de subjectieve live
acceptatie op een fysieke iPhone/Android/Capacitor-webview niet. Safari/WebKit,
native safe areas, achtergrond/hervatten en het snapgevoel moeten daar nog
worden bevestigd na deployment. Er wordt geen fase-2-productgoedkeuring of
start van fase 3 geclaimd; deze branch wordt als PR ter review aangeboden.
