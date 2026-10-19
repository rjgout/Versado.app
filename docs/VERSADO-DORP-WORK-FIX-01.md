# Versado Dorp — integratie Work fix-01

Branch: `codex/versado-dorp-fase-1a`

Draft-PR: [#147](https://github.com/rjgout/Versado.app/pull/147). Niet mergen of deployen.

## Gelezen bronmateriaal

De integratie volgt `README.md`, `CHANGELOG.md`, `QUALITY-REPORT.md`, `ENGINE-HANDOFF.md`,
`replacement-manifest.json`, `tests/TERRAIN-RENDER-CONTRACT.md` en `research/TECHNICAL-RECIPE.md` uit
`versado-dorp-bom-v1-fix-01`. Previews en testmetingen zijn uitsluitend als technische referentie gebruikt; geen
preview, researchmaster of PNG-bronbestand is naar de client gekopieerd.

## Pakketvalidatie

- alle 296 door `PACKAGE-FILES.json` geïndexeerde bestanden hebben de opgegeven bytegrootte en SHA-256;
- het manifest bevat exact 56 unieke hoofdassets: 15 vervangingen, 32 toevoegingen en 9 behouden beelden met
  bijgewerkte registratie;
- alle 56 runtime-WebP's zijn aanwezig en hebben hun manifesthash;
- alle 66 aanvullende 64×32- en 32×16-terrein-LOD's zijn aanwezig en hebben hun manifesthash;
- alle object-ID's bestaan in de bestaande openbare Work-catalogus;
- footprints en levels komen overeen met die catalogus; alle ankers liggen genormaliseerd binnen 0–1 en alle
  wereldmaten zijn positief;
- de meegeleverde Work-validatie rapporteert 541/541 geslaagde controles.

De app bevat een afgeslankt, veilig runtime-manifest in
`src/lib/dorp/work/metadata/fix-01-runtime-manifest.json`. `previous`, researchgegevens, generatieprompts,
PNG-masters en hoofdstukgegevens worden niet gebundeld.

## Terrein en paden

De oude techniek die iedere tegel afzonderlijk op fractionele afmetingen schaalde is verwijderd. De renderer:

1. kiest per zoomniveau de 128×64-, 64×32- of 32×16-runtimebron;
2. stelt zichtbare tegels op één geheel raster samen in een transparante buffer;
3. schaalt die compositie eenmaal naar een gecachte zichtbare terreinlaag;
4. verschuift die laag tijdens panning zonder afzonderlijke tegelranden opnieuw te filteren.

De cache heeft extra wereldmarge en wordt alleen vernieuwd wanneer camera, radius, DPR, LOD, assetrevisie of padlaag
dat noodzakelijk maakt. Op brede schermen gebruikt het hoofdcanvas bewust DPR1; op telefoons maximaal DPR2. Dit
voorkomt een viervoudig desktopoppervlak zonder de mobiele artregistratie te wijzigen.

Zand/gras gebruikt gedeelde wereldhoeklabels: noord=1, oost=2, zuid=4 en west=8. Maskers 1–14 kiezen exact de
bijbehorende overgangssprite; 0 is gras en 15 zand. Daardoor kiest een gedeelde hoek nooit onafhankelijk twee
verschillende materialen.

De padlaag blijft los van gebouwen en opslagrechten. Buurmaskers gebruiken exact het Work-contract: +u/SE=1,
+v/SW=2, −u/NW=4 en −v/NE=8. Alle vijftien gebakken richtingssprites zijn aangesloten zonder rotatie of spiegeling.
De R8-testfixture bevat rechte stukken, meerdere bochten, eindes, T-aansluitingen, een kruising en een aansluiting
bij een gebouw.

In de werkelijke Canvas-opnames zijn geen rasterkieren, transparante binnennaden of verspringende texturen gezien
bij normale zoom, detailzoom, wielzoom, panning of echte multi-touch pinch. Chunkgrenzen bestaan in deze
viewportbuffer niet: de zichtbare laag wordt uit één gedeelde rastercompositie opgebouwd.

## Gebouwen, bos en bewoners

- familiehuis en schrijvershuis gebruiken op L1–L3 exact hetzelfde anker `(0.5, 0.81640625)` en wereldcanvas
  `512×512`;
- ontmoetingshuis gebruikt op L1–L3 exact hetzelfde anker `(0.5, 0.825)` en wereldcanvas `640×640`;
- footprints blijven respectievelijk 3×3, 3×3 en 4×4 en positie, botsing en opslagcontract veranderen niet;
- de tempel gebruikt uitsluitend het opnieuw geëxporteerde L1-bestand en behoudt zijn 12×12-footprint;
- alle vier bosrollen gebruiken hun manifestanker en wereldmaat, elk met twee deterministisch gekozen varianten;
- de bosrand gebruikt twee ringen op R+4 en R+7: 80 modules op R8, 115 op R14 en 395 op R62. Niet-zichtbare
  modules worden geculld en blijven niet-bouwbare systeemdecoratie;
- bewoners gebruiken nu hun eigen voetenanker en wereldmaat in plaats van de oude vaste 96×96-tekening;
- Abish is toegevoegd als `vd-c014` met de reeds bestaande canonieke personage-ID `abish`.

## Opslag, voortgang en beveiliging

Opslagcontract v2 is ongewijzigd. Bestaande lokale testindelingen, instance-ID's en upgradeniveaus blijven geldig.
De uitgebreidere standaardpadfixture verschijnt na een expliciete reset; bestaande paden worden niet stilzwijgend
overschreven. R8, R62, zestien uitbreidingen, eigendomsrechten, featureflag en server-side admincontrole zijn
ongewijzigd. Er is geen XP, leesvoortgang, beloning of privé-hoofdstukmapping geraakt.

## Browsercontrole

Gecontroleerd in Chromium op 320×568, 390×844 en 1280×800:

- panning en cursorgerichte wielzoom veranderen de camera onmiddellijk;
- echte browser-multi-touch pinch verandert zoom/middenpunt, geeft geen browserfout en eindigt niet als selectie;
- detail-, normaal-, huidige-kaart- en R62-weergaven werken;
- R8 en R62, bosrand, volledige padenfixture, gebouwselectie, L1→L3 en Abish-selectie zijn doorlopen;
- `scrollWidth` bleef gelijk aan 320, 390 en 1280 pixels;
- de headless ontwikkelmeting tijdens voortdurende desktop-panning kwam na het opbouwen van de caches rond 30 fps
  uit. Dit is beter dan de koude ongecachete compositie, maar geen 60-fps-bewijs; een fysiek mobiel toestel en een
  productieprofiel blijven nodig voor een definitief framebudget.

## Screenshots en vergelijking

| Situatie | Bewijs |
| --- | --- |
| Voor herstel | [Fase 1B R8](versado-dorp/screenshots/fase-1b-start-r8-390.png) |
| Na herstel | [Fix-01 R8](versado-dorp/screenshots/fix-01-start-r8-390.png) |
| 320 px | [Mobiele R8](versado-dorp/screenshots/fix-01-mobile-r8-320.png) |
| Desktop en bosrand | [Desktop R8](versado-dorp/screenshots/fix-01-desktop-r8.png) |
| Volledige paden op detailzoom | [Paden](versado-dorp/screenshots/fix-01-paths-detail-desktop.png) |
| Geregistreerde L3-upgrade | [Upgrade](versado-dorp/screenshots/fix-01-upgrade-l3-390.png) |
| Abish | [Bewonerselectie](versado-dorp/screenshots/fix-01-abish-390.png) |
| Maximale wereld | [R62-LOD](versado-dorp/screenshots/fix-01-world-r62-390.png) |

## Eindvalidatie

- `npm run test:dorp`: 45/45 geslaagd, inclusief kaart, camera, opslag, routebeveiliging, alle 56
  hoofdassets en 66 terrein-LOD-bestanden;
- `npm run test:character-assets`: 6/6 geslaagd, inclusief de canonieke personagemapping;
- `npx tsc --noEmit`: geslaagd;
- `npm run lint -- --quiet`: geslaagd;
- `npm run build`: geslaagd en alle 241 pagina's gegenereerd. Omdat de lokale PostgreSQL in deze ontwikkelomgeving
  niet draait, logt de bestaande brandingopslag tijdens prerendering verwachte verbindingsmeldingen. Daarnaast
  blijft de bestaande Turbopack-waarschuwing over dynamische filesystem-tracing in `studyContent/storage.ts`
  zichtbaar; geen van beide komt uit de dorpsintegratie of maakt de build rood;
- `git diff --check`: geslaagd;
- de tijdelijke lokale browser-QA-toegang is verwijderd; de route vereist in de opgeleverde code opnieuw zowel
  `VERSADO_DORP_PROTOTYPE_ENABLED=true` als server-side beheerderstoegang.

## Resterende punten

- de 512×256-detailexports zijn niet geladen: de standaardruntime plus twee LOD's leveren de vereiste naadloze
  compositie met een veel lager mobiel geheugenbudget. Detailruntime kan later achter een gemeten high-DPI-keuze;
- R62 gebruikt bij volledige uitzoom bewust dezelfde vereenvoudigde LOD als fase 1B. De objectstippen komen uit de
  echte wereldstaat, maar individuele sprites en bosmodules zijn op die schaal niet herkenbaar;
- de terrein- en spritecaches begrenzen de bekende headless kosten, maar performance moet nog op representatieve
  iOS- en Android-hardware worden geprofileerd. Dit blokkeert de technische integratie niet, maar wel een harde
  60-fps-productieclaim.
