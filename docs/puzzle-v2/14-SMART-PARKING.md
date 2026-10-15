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

Resultaten van de laatste run: `npm run test:puzzle` 135/135; TypeScript en ESLint schoon;
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
