# Versado Dorp — fase 1A technisch rapport

Branch: `codex/versado-dorp-fase-1a`

Draft-PR: [#145](https://github.com/rjgout/Versado.app/pull/145); niet mergen of deployen.

## Scope en integratie

Dit prototype staat op de afgeschermde route `/dev/versado-dorp`. De route bestaat alleen bij
`VERSADO_DORP_PROTOTYPE_ENABLED=true` en controleert daarna server-side of de gebruiker is ingelogd en admin is.
De route staat niet in `GAME_CATALOG`, de hoofdnavigatie of een publieke API. Zij gebruikt de bestaande Focus-route
en vraagt uitsluitend zolang het actieve speelveld gemonteerd is via `useImmersiveShell()` om de bestaande
Immersive-modus. Er is geen nieuwe shell, fullscreencontroller, XP-, lees-, reeks- of beloningslogica toegevoegd.

De bronlevering is gelezen vanaf `/shared/work-assets/inbox/versado-dorp-bom-v1/`. Alleen de 36 openbare
runtime-WebP's en de twee veilige broncatalogi zijn overgenomen. De mappen onder `assets/`, `catalog/` en `metadata/`
houden hun Work-structuur. `server-only/chapter-rewards.json`, CSV's en layouts zijn niet gekopieerd, geïmporteerd of
naar de client gestuurd.

## Rendererkeuze

De renderer is Canvas 2D zonder nieuwe dependency. Dat past bij de vaste orthografische 2:1-projectie en voorkomt
duizenden DOM-elementen en React-renders per tegel. React beheert alleen menu- en selectiestaat; camera en pointers
blijven in refs. Het canvas schaalt voor device-pixel-ratio (begrensd op 2), cullt terreintegels buiten de viewport,
sorteert sprites op de voorste footprinttegel (`u+v`) en gebruikt bij overzichtszoom een geometrische LOD in plaats
van 12.061 detailtegels. De wereldstaat blijft daarbij één bron van waarheid.

Projectie bij zoom 1:

```text
sx = 64 × (u - v)
sy = 32 × (u + v)
```

De renderer bewaart `u`, `v`, footprint, level en een toekomstige facing los van schermpixels. Een latere vaste
rotatiestand kan daardoor de coördinaten transformeren zonder opgeslagen objecten te verplaatsen; er zijn nu bewust
geen ontbrekende richtingsbeelden gespiegeld.

## Werkende prototypefuncties

- muis-/éénvinger-panning, pinch, muiswiel, in-/uitknoppen, centreren, detail, normaal en volledige wereld;
- exact cirkelmasker `u² + v² <= R²`, met footprints die volledig binnen het masker moeten liggen;
- echte Work-terrein-, bos-, gebouw-, prop-, natuur- en bewonerssprites;
- bouwinventaris met uitsluitend pilotobjecten, expliciet aangeduid als testfixtures;
- plaatsingspreview, groene/rode footprint, botsingscontrole, bevestigen en “Stel een plek voor”;
- selecteren via logische footprint (dus niet via transparante PNG-marges), verplaatsen en terugnemen;
- L1–L3 voor de drie pilotgebouwen met onveranderde logische footprint; tempel alleen L1 omdat L2/L3 ontbreken;
- vier ontwikkelfasen R14, R17, R38 en R62; de bosmodules schuiven mee en bestaande objecten houden coördinaten;
- vier canonieke bewoners: `nephi`, `sariah`, `ammon-missionary` en `lehi`;
- lokale opslag onder `versado-dorp-prototype-v1`, inclusief validatie, versieafwijzing en reset.

Latere serveropslag kan hetzelfde kleine contract gebruiken: per wereld een versie en fase, en per object een
server-ID, openbaar object-ID, integer `u/v`, level en later facing. De server moet dezelfde catalogus-, footprint-,
cirkel- en overlapvalidatie herhalen in één transactie. Lokale data mag niet worden gemigreerd naar productiebezit.

## Onderzoek startkaart

De plaatsingsaantallen hieronder tellen alle geldige ankerposities waarbij de volledige footprint in de cirkel ligt.

| Radius | Bouwbare tegels | 3×3-posities | 4×4-posities | 12×12-tempelposities | Radius na 16× +3 | Tegels daarna |
|---:|---:|---:|---:|---:|---:|---:|
| 14 | 613 | 505 | 456 | 136 | 62 | 12.061 |
| 10 | 317 | 241 | 208 | 24 | 58 | 10.557 |
| 8 | 197 | 137 | 112 | 0 | 56 | 9.845 |
| 7 | 149 | 97 | 76 | 0 | 55 | 9.477 |

R10 lost het ontwerpdoel niet op: de tempel past er nog steeds. R7 blokkeert de tempel, maar laat weinig marge voor
paden, meerdere kleine gebouwen en decoratie. **Aanbeveling voor het latere productbesluit: R8**. Die maat blokkeert
de tempel puur fysiek, laat nog ruim honderd 3×3/4×4-ankerposities en oogt op mobiel als een doelbewust compact
startdorp. Dit vereist wel een apart besluit over de groeireeks: zestien stappen van +3 eindigen dan op R56 en niet
op de goedgekeurde R62. Voeg daarom niet stilzwijgend hoofdstukvereisten of andere stappen toe. Het prototype houdt
conform opdracht R14 en de bestaande 14→62-regels.

## Assetvalidatie en registratie

Direct bruikbaar in deze technische pilot:

- de vier bewonerssprites, met de bestaande canonieke IDs;
- alle geleverde props en natuurcutouts, met logische footprintselectie;
- de vier bosmodules als overlappende, deterministische rand (niet als naadloze puzzelstukken);
- de tempel L1;
- de drie gebouwreeksen, mits de renderer de per-level Work-registratie toepast.

De renderer gebruikt de masterafmeting × `suggestedWorldScale` en het level-specifieke genormaliseerde anker uit het
manifest. Daarmee komt de voorgestelde voorste footprinthoek steeds op dezelfde wereldcoördinaat; de PNG-afmeting
of onderrand bepaalt nooit collision of depth.

De geleverde levels hebben aantoonbaar geen uniforme bronregistratie:

| Reeks | L1 anker / schaal | L2 anker / schaal | L3 anker / schaal |
|---|---|---|---|
| Familiehuis | .5251,.9027 / .382851 | .5343,.9266 / .374269 | .5287,.9649 / .348457 |
| Schrijvershuis | .5012,.9019 / .347511 | .5052,.9314 / .333044 | .5028,.9721 / .308930 |
| Ontmoetingshuis | .5116,.8868 / .471889 | .5136,.9019 / .454707 | .5100,.9354 / .428452 |

Deze correcties zijn daarom runtime-registratie, geen bewijs dat de bronart productierijp uitwisselbaar is.

## Terrein- en padproef

De vaste testpatch bevat een 3×3 basisgrasvlak, droog/bloemrijk/zand naast gras, elf rechte padtegels, een bocht en
een aansluiting richting gebouwen. De renderer verbergt niets met CSS: alle bronnen worden als 128×64-diamant op
hun echte alpha getekend. De proef bevestigt dat beeldverhouding en transparantie technisch leesbaar zijn, maar de
bronregistratie is nog niet productierijp: tussen aangrenzende tegels blijven duidelijk zichtbare lichte rasterkieren,
de varianten sluiten qua randkleur niet doorlopend aan en de herhaling van gelijke tegels is opvallend. De bocht vormt
zonder eind-, T- en kruissprite bovendien geen complete padenfamilie. Dit is in de screenshots reproduceerbaar en is
niet met CSS, overlap of maskering verborgen.

## Concrete herstelopdrachten voor Work

1. `terrain-grass`, `terrain-dry-grass`, `terrain-flower-grass` en `terrain-sand`: lever elk op exact hetzelfde
   2:1-gronddiamant met identieke vier hoekcoördinaten en nul-alpha buiten de diamant. Laat tegenoverliggende
   randpixels kleur en alpha doorlopend aansluiten; behoud palet, licht van linksboven en 128×64-logische schaal.
2. `terrain-path-straight` en `terrain-path-corner`: registreer de padmiddellijn op dezelfde tegelassen en laat breedte,
   randkleur en alpha exact samenvallen op elk aansluitpunt. Behoud de huidige aardetextuur. Produceer daarna aparte
   einde-, T- en kruissprites; rek of maskeer de bestaande twee niet om die vormen te faken.
3. De negen `building-family-house-*`, `building-scribe-house-*` en `building-assembly-house-*`: exporteer iedere
   reeks vanuit één vast broncanvas met exact dezelfde voorste footprinthoek en hetzelfde grondvlak per level.
   Behoud silhouettegroei, licht, 3×3/3×3/4×4-footprint en huidige details; wijzig geen footprint om L3 passend te maken.
4. `landmark-temple-l1`: L1 is bruikbaar; produceer pas L2/L3 wanneer dezelfde 12×12-grondregistratie gegarandeerd
   kan worden. Het prototype toont bewust geen verzonnen niveaus.
5. Bosmodules: behoud organische overlap en transparante kronen, maar lever voor productiewerk een aanbevolen
   overlapafstand/anker per module en minstens twee varianten per randrol om zichtbare ritmische herhaling op R62 te
   verminderen. Maak ze niet geforceerd naadloos als dat de organische rand schaadt.
6. De losse Abish-sprite ontbreekt. Gebruik uitsluitend haar bestaande canon (zijvlecht, tealkleurige jurk, ivoren
   omslag); vervang haar niet door een nieuw personage of een spiegeling.

## Gewijzigde onderdelen

- nieuwe afgeschermde route en Canvas-client onder `src/app/dev/versado-dorp/` en `src/components/dorp/`;
- pure catalogus-, geometrie-, toegangs- en opslaglogica onder `src/lib/dorp/`;
- Focus-registratie in `src/lib/focusMode.ts` en een uitgeschakelde voorbeeldflag in `.env.example`;
- 36 originele openbare Work-WebP's onder `public/versado-dorp-bom-v1/assets/`, met de veilige catalogi onder
  `src/lib/dorp/work/`;
- gerichte tests in `tests/dorp.test.ts`, testscript in `package.json`, dit rapport en de browserscreenshots.

De bestaande Kompas-inhoud is niet uitgebreid: dit is een verborgen beheerderstest, geen publiek onderdeel of spel.
Zodra het dorp als gebruikersfunctie wordt vrijgegeven, moet het conform de Kompas-regels eerst als onderwerp en
eventuele rondleiding worden ontworpen.

## Validatie en bekende grenzen

De pure tests dekken geometrie, fases, footprints, overlap, verplaatsen, upgrades, opslag, assets, bewonerscanon,
featureflag, admincontrole, ontbreken van `server-only` onder `public/` en de bestaande shellregels.

- `npm run test:dorp`: 34 tests geslaagd;
- `npm run test:character-assets`: 6 tests geslaagd;
- `npx tsc --noEmit`: geslaagd;
- ESLint op alle gewijzigde TypeScript-bestanden: 0 fouten en 0 waarschuwingen;
- volledige `npm run lint`: geslaagd met 167 reeds bestaande waarschuwingen en 0 fouten;
- `npm run build`: geslaagd; de afgeschermde route staat in de productiebuild;
- `npm run test:kompas`: de statische controles slagen; 9 bestaande database-integratietests kunnen lokaal niet
  draaien doordat de gedeelde ontwikkeldatabase de op `main` aanwezige kolom `User.sharePuzzleRecords` mist. De
  database is voor deze opdracht bewust niet gemigreerd.

Docker is in deze werkcontainer niet beschikbaar. Daardoor kon geen geïsoleerde Postgres-container worden gestart;
dit verandert de pure dorpchecks en productiebuild niet. De laatste checks hieronder worden vóór de PR nogmaals op
de definitieve bron uitgevoerd.

### Browsermetingen en screenshots

Gevalideerd in headless Chromium op 320×568, 390×844, 844×390 en 1280 px breed. Op 320 px en in liggend formaat is
`scrollWidth` exact gelijk aan de viewport: geen horizontale overflow. Muisdrag, muiswiel en een via Chromium
gesynthetiseerd pinchgebaar werkten; de bouwinventaris, voorgestelde plaatsing, bevestiging, lokale opslag, R62-fase
en wereld-LOD zijn in dezelfde browsersessie doorlopen. Herladen herstelde de opgeslagen wereld. Er waren geen
clientexceptions. Een echt iOS-/Android-toestel blijft nodig voor de uiteindelijke vingergevoel- en safe-area-check.

Indicatieve meting op 390×844 in R62-overzicht: `domInteractive` 466 ms, `loadEventEnd` 632 ms, 60 gemeten frames
gemiddeld 16,23 ms (circa 61,6 fps), langzaamste frame 16,8 ms en gebruikte JS-heap 30,5 MiB. Dit zijn lokale
headless-metingen, geen productiebudget of vervanging voor een hardwareprofiel. De eerste assetrijke render vraagt in
de ontwikkelserver merkbaar langer dan de DOM-load; de productiebuild zelf is wel geslaagd.

- [Mobiel 320 px](versado-dorp/screenshots/prototype-mobile-320.png)
- [Mobiel 390 px](versado-dorp/screenshots/prototype-mobile-390.png)
- [Bouwinventaris 390 px](versado-dorp/screenshots/prototype-inventory-390.png)
- [Liggende telefoon en R62-LOD](versado-dorp/screenshots/prototype-landscape.png)
- [Desktop](versado-dorp/screenshots/prototype-desktop.png)

De screenshots zijn van de daadwerkelijk draaiende Canvas-renderer met de geleverde Work-sprites. Voor de opname is
uitsluitend lokaal en tijdelijk de login/database-afhankelijkheid overgeslagen; die bypass is niet onderdeel van de
branch. De definitieve route blijft zowel featureflag- als server-side adminbeveiligd.
