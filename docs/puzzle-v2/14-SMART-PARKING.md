# Legpuzzel V2 — slim parkeren, botsingsdetectie en ruimte maken

Branch `feature/puzzle-smart-parking`, vanaf de nieuwste `origin/main`. Geldt voor Solo,
Samen en Tegen elkaar. Geen nieuwe regelversie en geen databasemigratie.

## Oorzaak

Groepen werden getekend en aangeraakt in de opgeslagen arrayvolgorde. Een stuk dat op een
andere groep werd neergelegd, kon daardoor eronder terechtkomen en onbereikbaar worden
(vooral op een klein scherm). Er bestond geen botsingsbegrip en geen manier om ruimte te
maken; de bestaande sleepprioriteit (`13-DRAG-PRIORITY.md`) gold alleen tijdens het slepen.

## Gedrag

1. **Laatst bewogen groep blijft bovenaan** (`stacking.ts`): lokaal, alleen presentatie.
   Render en hit-test gebruiken dezelfde volgorde, dus wat je bovenaan ziet pak je ook op.
   De hele groep blijft samen (lift, schaduw en selectie blijven). Er wordt niets in de
   snapshot opgeslagen.
2. **Eerst verbinden**: na loslaten wordt eerst gecontroleerd op een geldige snap en op
   bordverankering. Alleen zonder verbinding start de parkeertijd van **1.500 ms**
   (`parking.ts`, `PARKING_DELAY_MS`).
3. **Eén annuleerbare timer** (`createParking`): opnieuw oppakken, nieuwe sleep, pannen,
   pinch, zoomknoppen/wiel, toetsenbordverplaatsing, sessiewissel en afronding annuleren of
   verschuiven de timer; na een cameraverplaatsing volgt opnieuw 1,5 s rust. Een verlopen
   timer geeft nooit zomaar toestemming: de client vraagt eerst `parkingReady()` ("go" /
   "wait" / "stop") en controleert met `settleWouldMove` of er iets op te lossen valt.
   Verouderde runs worden herkend via een epoch-teller (geen races of lekkende timers).
4. **Ruimte maken** (`collision.ts`): zie algoritme. Resultaat is een glijdende
   verschuiving van 180 ms (zachte ease-out, geen stuiter, geen geluid of haptiek). Bij
   verminderde beweging verspringt het direct. De animatie is alleen presentatie
   (`motion.beginShift`).

## Algoritme (`src/lib/puzzle/collision.ts`)

Eén zuiver, deterministisch, gedeeld pad: `planSettle` → `settleGroups` (toepassen),
`settleWouldMove` (voorbeeld), `overlappingGroups` (diagnose).

- Per stuk een kernrechthoek (zonder uitsteeksel) voor alle rotaties 0/90/180/270; een
  spatial hash voor bezetting zodat het schaalt naar 300 stukken.
- Prioriteiten, strikt in deze volgorde: (1) geldige snap of bordverankering wint
  (`reason: "snap-possible"`, geen verplaatsingen); (2) verankerde groepen bewegen nooit;
  (3) groepen die een andere speler vasthoudt bewegen nooit (`immovable`); (4) de laatst
  neergelegde groep blijft liggen; (5) minimale verplaatsing.
- Kandidaatplekken worden op afstand gesorteerd met vaste tiebreaker op groep-id: geen
  heen-en-weer en altijd hetzelfde resultaat bij dezelfde stand. Stappen van 0,5, straal
  maximaal 6; een kettingreactie (een groep verdringt een andere) heeft straal 3, diepte 2
  en maximaal 10 verdrongen groepen, met terugdraaien als het niet past.
- Ligt de neergelegde groep zelf op een vaste groep (verankerd of vastgehouden), dan zoekt
  zij zelf een vrije plek in plaats van die groep te verplaatsen.
- Verbindende stukken tellen niet als botsing (alleen penetratie boven
  `DETECT_PENETRATION`); een bruikbare plek heeft `PLACEMENT_CLEARANCE`.
- **Geen ruimte**: expliciet `reason: "blocked"` met `unresolved`; er wordt niets
  verplaatst. De groep blijft bovenaan en bereikbaar. Dit is nooit een foutmelding.
- Een nieuw stuk dat de puzzel afmaakt, snapt/verankert eerst en rondt af; er is geen settle
  bij een voltooide puzzel (`completedAt`) en een settle telt nooit als verbinding (geen
  XP, record, reeks of beloning).

## Voorlopig lokaal versus definitief

| Laag | Waar | Wat |
| --- | --- | --- |
| Stapelvolgorde / parkeerprioriteit | alleen lokaal (`stacking.ts`) | presentatie; niet opgeslagen, niet gedeeld |
| Verschuiving 180 ms | alleen lokaal (`motion`) | presentatie |
| Wereldposities | snapshot | canoniek; wijzigen alleen via de server |

## Solo en Tegen elkaar

Nieuwe actie `{ kind: "settle", groupId }` (zod in `schemas.ts`, `api/jigsaw-v2`,
`api/puzzle/match`) via `applySoloAction`. De server berekent altijd zelf opnieuw uit de
huidige snapshot; clientposities worden nooit vertrouwd. Idempotent via de bestaande
action-id: een herhaling geeft hetzelfde resultaat; geen wijziging → geen nieuwe versie en
geen actielog. Tegen elkaar gebruikt dezelfde regels; start, eerlijkheid en timing blijven
gelijk (geen verplichte wachttijd).

## Samen

Server blijft enige waarheid. `settle` in `coop.ts` heeft geen eigen lock nodig maar
respecteert alle actieve locks van anderen (`immovable`); is de focusgroep zelf vastgehouden
door een ander, dan is het een no-op. Alle verschuivingen van één settle komen atomair in
één versie en één delta (bestaande delta/reconnect/action-id-mechanismen, geen polling erbij).
Gelijktijdige spelers: de tweede settle rekent op de nieuwe stand; het resultaat blijft
deterministisch. Een mislukte of verloren settle-respons is stil (de gebruiker merkt niets,
de volgende interactie of resync lost het op).

## Oude sessies

Geen automatisch herschikken bij openen. Een oude sessie met overlappende groepen blijft
zoals ze was tot de speler zelf iets neerlegt. Geen rules-versiebump.

## Toetsenbord en toegankelijkheid

Pijltjes, gegroepeerde commits, selectie en rotatie (Master) blijven werken; een
toetsenbordverplaatsing verschuift alleen de timer. Geen extra schermlezermeldingen bij
ruimte maken.

## Tests

| Bestand | Dekking |
| --- | --- |
| `tests/puzzle-collision.test.ts` | overlappen, rotaties (Master), verankerd/vastgehouden, snap eerst, laatste stuk, geen ruimte, begrensde ketens, determinisme, geen doorrekenen bij oude sessies |
| `tests/puzzle-parking.test.ts` | timer: 1,5 s, annuleren/uitstellen, epoch, readiness go/wait/stop, geen lekken |
| `tests/puzzle-settle.integration.test.ts` | server settle in Solo/Samen/Match: idempotent, locks, atomair, geen XP/reeks/record |
| `tests/puzzle-parking.browser.mjs` | echte muis/touch (desktop, mobiel, minder beweging) en Samen: bovenop, oppakken, 1,5 s, pannen/zoomen/pinch, vastgehouden groep, laatste stuk, runtimefouten |
| `tests/puzzle-drag.browser.mjs` | bijgewerkt naar het nieuwe gedrag |

Resultaten van de eerste oplevering: `npm run test:puzzle` 135/135; TypeScript en ESLint schoon;
i18n zonder nieuwe teksten; parkeer-browsertest 67/67; overige bestaande browsertests
(flow, mobile, drag, difficulty, hint-inventory, feedback) groen; integratie op de
geïsoleerde lokale PostgreSQL alle groen, op één bekende uitzondering na bij herhaald
draaien op een vervuilde database (`versieovergang`, uniekheidsconflict van testdata; groen
na opschonen, niet door deze wijziging).

## Prestaties (`scripts/puzzle/perf-settle.ts`, één CPU-kern, mediaan van 21 rondes)

| Stukken | planSettle normale stand | planSettle slechtste geval (alles opgehoopt) | Bestaand snapzoeken |
| --- | --- | --- | --- |
| 24 | 0,12 ms | 1,8 ms | ≈ 0,01 ms |
| 96 | 0,15 ms | 8,9 ms | ≈ 0,01 ms |
| 150 | 0,20 ms | 14,8 ms | ≈ 0,01 ms |
| 300 | 0,39 ms | 36,6 ms | ≈ 0,01 ms |

De berekening draait niet per frame maar één keer per parkeermoment. Vóór deze wijziging was
er geen vergelijkbare berekening; het slepen zelf is niet veranderd (alleen een extra
volgorde-lookup bij render/hit-test, begrensd op 64 opgetilde groepen).

## Bekende beperkingen

- Stapelvolgorde is per apparaat; twee spelers in Samen kunnen een andere onderlinge
  volgorde zien tot er ruimte gemaakt is.
- Is er echt geen vrije plek, dan blijft de groep bovenop liggen (bereikbaar, niet verplaatst).
- Meting is op een ontwikkelmachine; framerate op oude telefoons niet gemeten.

## Nog op echte apparaten te testen

iOS Safari en Android Chrome: oppakken/parkeren/pannen met één en twee vingers, pinch tijdens
parkeertijd, achtergrond/terug, trage verbinding in Samen, Android-systeemterug, schermlezer
(VoiceOver/TalkBack) en grote tekst.

---

# Herstel na code-review (PR #117)

Drie bevindingen uit de review en twee aanvullende aandachtspunten zijn opgelost. Geen nieuwe puzzelfuncties.

## 1. Botsingsdetectie bij verbonden groepen

**Oorzaak.** `Occupancy.hits()` markeerde een kandidaat-rechthoek als "gezien" met één teller voor de hele vraag (alle stukken van de
groep), nog vóórdat getoetst was of die kandidaat het huidige stuk raakt. Een kandidaat die al bij het eerste stuk (in een nabije
cel) was onderzocht maar daar niet raakte, werd bij het tweede of een later stuk van dezelfde verbonden groep overgeslagen. Een botsing
die alleen een later stuk raakt bleef dus onopgemerkt (geen settle, of een onvolledige).

**Oplossing.** De markering geldt nu per vraagstuk (`++stamp` per stuk): binnen één stuk voorkomt ze nog steeds dubbel werk bij een
kandidaat die in meerdere cellen staat; tussen stukken wordt opnieuw getoetst. Groepen die al als botsend gevonden zijn worden
overgeslagen (dat houdt de kosten laag). Rotaties, snaptoleranties en `DETECT_PENETRATION` zijn ongewijzigd; aangrenzende
niet-overlappende stukken blijven geen botsing.

**Regressietests** (`tests/puzzle-collision.test.ts`, falen aantoonbaar met de oude code): een losse groep die uitsluitend het tweede
stuk van een verbonden paar raakt, bij 0/90/180/270° en in beide richtingen (de verbonden groep als focus én als te verplaatsen groep):
de botsing wordt gevonden, `planSettle` geeft `moved`, er blijft geen overlap, de groep blijft intact (leden, verbindingen, positie
van de focus) en de uitkomst is deterministisch; plus een blok van zes stukken waarvan alleen het laatste stuk raakt.

## 2. Automatisch uitwijken en zichtbaarheid

**Oorzaak.** `planSettle` controleerde alleen of een verplaatste groep binnen de hele werktafel bleef. Op een telefoon is de tafel
vele malen groter dan het beeld: een verplaatsing van vier tot zes stukbreedtes kon het geparkeerde (of weggeduwde) stuk buiten beeld
brengen, juist wanneer de speler het tijdelijk boven een vastgezet deel parkeerde om de camera te verschuiven.

**Oplossing: de wereldtafel en het beeld zijn twee dingen.**

| | Wat | Wie bepaalt het |
| --- | --- | --- |
| Wereldtafel | Canonieke groepsposities | alleen de server |
| Zichtbaar beeld | Het deel van de tafel dat de aanvrager nu ziet (camera + zoom, met 0,5 stuk marge) | de client van de aanvrager, als beperkende hint |

`settle` krijgt een optionele `viewport` (`visibleWorldRect`, `viewport.ts`; geldig bereik afgedwongen in `viewportSchema`). Die hint kan
alleen **beperken**, nooit een positie opleggen:

- groepen die niet (deels) in beeld zijn bewegen niet (net als vastgezette en door anderen vastgehouden groepen);
- een groep die in beeld is komt na het uitwijken altijd volledig in beeld te liggen (past ze niet in het beeld, dan blijft haar
  middelpunt in beeld);
- is er geen veilige plek in beeld, dan verplaatst er niets (`reason: "blocked"`): de focusgroep blijft bovenop liggen en bereikbaar, er
  wordt geen actie verstuurd (de client voorspelt hetzelfde met `settleWouldMove`) en er komt geen nieuwe versie;
- verbinden en verankeren, vastgezette groepen, locks van anderen en de laatste-stukregel gaan ongewijzigd voor.

De server rekent altijd opnieuw vanuit de actuele snapshot. Een verouderde clientcontrole is daarom geen veiligheidsgarantie die nodig is:
ook de beperking wordt op de actuele serverstand toegepast.

### Garanties bij Samen (lokaal versus gezamenlijk)

De server kent de camera van de andere deelnemers niet en gebruikt de stand van één deelnemer nooit als waarheid voor iedereen.

| Garantie | Geldt voor |
| --- | --- |
| Een door settle verplaatst stuk ligt volledig in het beeld van de speler die de actie aanvroeg; ligt het niet in beeld, dan beweegt het niet | de aanvrager (lokaal) |
| Het geparkeerde stuk blijft bovenop (lokale stapelvolgorde) en altijd opnieuw op te pakken | iedere speler (lokaal) |
| Geen camerabeweging wordt geforceerd; er zijn geen nieuwe synchronisatiestromen of polling | iedereen |
| Vastgezette groepen en groepen die een ander vasthoudt bewegen nooit; één atomaire versie/delta; idempotent per action-ID | iedereen (server) |
| Een verplaatst stuk is ook zichtbaar voor een *andere* speler met een ander beeld | **niet gegarandeerd** |

Beperking: een andere deelnemer kan een stuk zien schuiven dat in zijn eigen beeld buiten de rand ligt of zelf een andere
onderlinge stapelvolgorde zien tot er ruimte gemaakt is. Verplaatsingen zijn begrensd (maximaal 6 stukbreedtes, nooit groepen die een
ander vasthoudt) en gebeuren alleen rond een groep die iemand zojuist losliet. Dit is bewust de minst verrassende keuze: liever
niets verplaatsen dan een stuk buiten het beeld van de speler die het zojuist neerlegde.

Zonder `viewport` (oudere client) geldt alleen de tafelrand; alle huidige clients sturen hem mee. Een speler die tijdens de aanvraag de
camera verschuift, kan een stuk buiten het nieuwe beeld zien belanden: de hint is van het moment van versturen (daarom 0,5 stuk marge).

## 3. Aanwijzen tijdens de schuifanimatie

**Oorzaak.** Tijdens de 180 ms-schuif tekent `motion.groups()` de tijdelijke (geanimeerde) positie, maar `picked()` zocht in de
bevestigde positie. Een tik op het zichtbare stuk kon daardoor het verkeerde (of een onderliggend) stuk raken, of niets.

**Oplossing.** `motion.hitGroups()` geeft de lijst met dezelfde objecten en volgorde als de snapshot, maar met de getekende positie voor
groepen die glijden; een groep die door een snap in een andere opgaat blijft op haar bevestigde plek aanwijsbaar. `picked()` in
`JigsawV2Client` en `PuzzleTable` gebruikt dat. De stapelvolgorde (`stacking`) blijft dezelfde voor tekenen en aanwijzen. De
spelregels, de snap en de commit gebruiken uitsluitend de bevestigde stand; de animatiepositie wordt nooit opgeslagen. Wordt een glijdende groep
opgepakt, dan vervalt haar glijbeweging vanzelf (de getoonde positie wijkt dan af van het doel) en volgt ze de vinger zonder sprong.

## 4. Trage verbinding

**Oorzaak.** De settle liep via `runBoard`/`run` en zette `pending`; tot het antwoord er was werd elke pointerdown genegeerd. Bij een
verbinding van 1–3 s kon de speler een stuk niet oppakken. Daarnaast zette `update()` bij een late respons de getoonde stand terug,
ook het stuk dat de speler net vasthield.

**Oplossing.**

- Settle is een achtergrondactie (`settleFlight`): `pending` wordt niet gezet. Oppakken, pannen, zoomen en pinchen werken direct.
- Een volgende speleractie wacht in `action()` (Solo/Tegen elkaar) of `onCommit` (Samen) op de bevestiging van de lopende settle, met
  een bovengrens van 5 s (`SETTLE_WAIT_MS`), en vertrekt dan met de bevestigde versie. Een settle kan een nieuwere speleractie dus nooit
  ongedaan maken en veroorzaakt geen versieconflict.
- Een late of dubbele respons met een lagere versie dan de bevestigde stand wordt genegeerd.
- De respons verplaatst nooit het stuk dat de speler op dat moment vasthoudt of met de toetsen verplaatst (`withHeldPose`); de animatie
  slaat dat stuk ook over.
- Timeout, verloren respons of fout: stil herstel (hervatten); er komt geen foutmelding want de speler vroeg hier niet om. Het action-ID
  blijft idempotent; een retry verplaatst niets dubbel.
- Een andere speler die tijdens de aanvraag iets verplaatst: de server rekent op de actuele stand (met alle locks); in Samen volgt de
  client het bestaande delta-/resync-pad.

Bekende rest: na de 5 s wachttijd (extreem trage verbinding) vertrekt de speleractie met de laatst bekende versie; bij een alsnog
binnenkomende settle volgt dan het bestaande versieconflict-pad (stil hervatten in Solo, `resync` in Samen).

## Nieuwe tests

| Bestand | Dekking |
| --- | --- |
| `tests/puzzle-collision.test.ts` | multi-stuk-botsing (0/90/180/270°, beide richtingen, 6-stuksblok); `visibleWorldRect`; uitwijken blijft in beeld (390 × 844, 360 × 740, sterk ingezoomd); geen veilige plek in beeld; groepen buiten beeld bewegen niet; groep groter dan het beeld |
| `tests/puzzle-parking.test.ts` | `motion.hitGroups`: aanwijzen tijdens het schuiven (zichtbare plek wint, lege eindplek niet, verbonden groep als geheel, snap-groepen) |
| `tests/puzzle-settle.integration.test.ts` | server: viewport beperkt het uitwijken (geen versie/actie bij "blocked"), ruim beeld verplaatst binnen het beeld; schema-validatie van de viewport |
| `tests/puzzle-visibility.browser.mjs` | echte touch/muis op 390 × 844, 360 × 740 en desktop: groot vastgezet deel, zoom 0 / ×1,8 / maximaal, geen veilige plek (blijft liggen, niets verstuurd, opnieuw op te pakken), pannen en oppakken binnen de parkeertijd, trage settle (2,5 s vertraagd: oppakken, volgen van de vinger, late respons, bevestigde versies), aanwijzen tijdens een stilgezette animatie (juiste stuk, geen sprong, lege eindplek niet aanwijsbaar), Samen met twee verschillende camera- en zoomstanden |
| `scripts/puzzle/test-isolated.mjs` | de zichtbaarheidstest zit nu in de officiële runner (en dus in CI) |

## Prestaties na de correctie (`scripts/puzzle/perf-settle.ts`)

De juiste deduplicatie onderzoekt meer paren, dus het kunstmatige slechtste geval (alle stukken in één hoop) is ongeveer twee keer zo duur;
de normale stand en een groot verbonden blok blijven ruim onder één frame.

| Stukken | normale stand | slechtste geval (alles opgehoopt) | verbonden blok (helft van de stukken): leden → tijd |
| --- | --- | --- | --- |
| 24 | 0,11 ms | 2,0 ms | 2 → 0,5 ms |
| 96 | 0,29 ms | 13 ms | 24 → 2,9 ms |
| 150 | 0,31 ms | 28 ms | 50 → 4,7 ms |
| 300 | 0,37 ms | 70 ms | 129 → 5,6 ms |

## Resterende beperkingen

- Stapelvolgorde en aanwijzen zijn per apparaat; bij Samen zien deelnemers een andere onderlinge volgorde tot er ruimte gemaakt is.
- Verplaatsingen door settle zijn alleen gegarandeerd zichtbaar voor de aanvrager (zie Samen); anderen kunnen een stuk zien schuiven.
- De viewport-hint is van het moment van versturen.
- De framerate op oude telefoons is niet gemeten; echte iOS/Android-apparaten blijven nodig (zie hierboven).
