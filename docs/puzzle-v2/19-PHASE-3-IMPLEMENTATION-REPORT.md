# Fase 3 — verslag: Samen en Tegen elkaar

Architectuur: `18-PHASE-3-MULTIPLAYER-ARCHITECTURE.md`. Branch
`feature/puzzle-v2-multiplayer-phase-3`. Fase 4 (vriendenranglijsten, globale
records) is niet gestart.

## Wat er is
- **Samen** (max 4, live en asynchroon, serverautoritaire gedeelde puzzel, locks in
  PostgreSQL, persoonlijke camera/hints, reeks via een eigen gemaakte verbinding, geen XP, geen vraag).
- **Tegen elkaar** (2–4, live-lobby met aftelling en asynchrone wedstrijden, dezelfde
  variant/seed/start/vraag, serverklok, alleen een goed antwoord geeft een tijd, uitslagbeleid, DNF).
- Uitnodigen onder vrienden, notificaties via `notifyUser`, Actieve spellen, open acties/Vandaag,
  Kompas (versie 4) en speluitleg, vijf talen, migratie `20261026100000_puzzle_multiplayer` (additief).

## Bewijs (alles lokaal, geïsoleerde testdatabases)
| Controle | Resultaat |
|---|---|
| `npx tsc --noEmit`, `prisma validate`, eslint (0 fouten), i18n-check (5 talen gelijk) | groen |
| Schone `rm -rf .next && npm run build` | groen |
| Samen (10) + wedstrijden (8) integratietests, opnieuw uitgevoerd na de laatste wijziging | 18/18 |
| Wedstrijd van uitnodiging tot uitslag, fout antwoord, live start, DNF, verlopen uitnodiging, activiteitsbron | getest |
| Reeks over meerdere kalenderdagen (+1, +1, +1; na gat terugkeerregel; claim per dag) | getest |
| Multi-instance: twee `server.ts`-processen + PostgreSQL + Redis (aanwezigheid, locks, deltas, gelijktijdige commits, idempotentie, verloren verbinding, sync, herstart, meldingen over instances) | 2/2 |
| Solo-regressie: 40 integratietests + 5 Solo-browsersuites | groen |
| Eigen browsertest: 300 stukken (±16,7 ms/frame), 320 px, 200% tekst, keuzepagina → live wedstrijd → lobby → start → beide borden | groen |
| Unit/architectuur: live-data, puzzle, Kompas, focus (142 tests) | groen |
| Volledige `tests/*.test.ts` | 782 pass / 78 fail; **de 78 zijn identiek op `main`** (basislijn 764 pass / 78 fail): omgevingsfouten door een onvolledig geseede database en twee tests die een vaste databasenaam eisen (die slagen apart) |

## Prestatie (server, één Postgres, vier gelijktijdige spelers; `scripts/puzzle/perf-multiplayer.ts`)
| Stukken | snapshot | delta | commit p50/p95 | state p95 | patch-sync |
|---|---|---|---|---|---|
| 24 | 1,8 KB | ~150 B | 55 / 103 ms | 41 ms | 14 ms |
| 96 | 7,1 KB | ~150 B | 42 / 70 ms | 17 ms | 11 ms |
| 150 | 11,5 KB | ~150 B | 42 / 68 ms | 17 ms | 11 ms |
| 300 | 24,1 KB | ~150 B | 44 / 65 ms | 19 ms | 11 ms |

Snap-zoeken is niet merkbaar (<0,1 ms). 300 stukken is server- en renderkant
aangetoond in headless Chromium; er is **niet** op echte telefoons gemeten.

## Openstaand / beperkingen (eerlijk)
1. Geen test op fysieke iOS/Android-toestellen; 300 stukken is op echte mobiele hardware niet bewezen.
2. Multi-instance getest met twee instances op één machine, niet over meerdere hosts.
3. Individuele uitnodiging intrekken in een wedstrijd bestaat alleen in de API (de organisator kan in de lobby wel annuleren).
4. Samen: één reeksclaim per dag; een terugkeerdag die meerdere activiteiten vraagt wordt niet door meerdere verbindingen op dezelfde dag gehaald.
5. De 78 bestaande testfouten (omgeving) zijn niet opgelost; ze zijn identiek op `main`.
6. Notificaties volgen de bestaande voorkeur "sociaal"; er is geen aparte puzzelinstelling.
7. De organisator krijgt geen meldingen voor ingetrokken uitnodigingen van gasten (alleen de ontvanger).

## Uitrol
Zie §11 van het architectuurdocument: migratie eerst (additief), daarna app op alle
instances; Redis nodig voor deltas over instances; terugdraaien = vorige versie,
geen destructieve migratie. Na integratie met Contentarchitectuur fase 1D
beperkt `GameSettings.jigsawEnabled` nieuwe starts; geldige bestaande partijen
blijven bereikbaar met normale oorspronkelijke bronrechten. Verborgen,
uitgeschakelde of DRAFT-bronnen blijven voor normaal lezen geblokkeerd,
ook voor beheerders. Zie `docs/content-architecture-v2/10-PHASE-1D-STATUS.md`.

## Oordeel
Alle essentiële acceptatiecriteria zijn aantoonbaar gehaald binnen de lokale
testomgeving; de beperkingen hierboven (vooral echte mobiele toestellen en
multi-host) blijven open en horen bij de beoordeling van "300 stukken ondersteund".

## Correctieronde na fase 3 (navigatie, afgeronde puzzels, wedstrijdtijd)

Branch `fix/puzzle-v2-navigation-completion-timing`.

1. **Terugknop.** Root cause: het terugdoel stond op het vaste pad `/jigsaw` terwijl de multiplayerroutes
   dynamisch zijn (de override paste nooit), `SubpageBackBar` kende de routes niet en de catalogus gebruikte
   browsergeschiedenis. Oplossing: `lib/puzzle/navigation.ts` + `PuzzleBackTarget`, `replace`-navigatie,
   één eigenaar per scherm. Zie architectuur §13.
2. **Afgeronde puzzels als actief.** Root cause: `listCoopOverview` leverde ook `COMPLETED` en het overzicht
   gaf elke sessie "Verder puzzelen"; `getPuzzleActivity` rekende een klaar-maar-nog-lopende wedstrijdpoging
   (en een oude `INVALID`) niet als wachtend. Oplossing: gedeelde indeling uitnodiging/actief/wachten/afgerond.
3. **Wedstrijdtijd.** Root cause: `answerMatch` was het afrekenmoment (tijd = antwoordmoment, fout antwoord =
   `INVALID`). Oplossing: `finishAttempt` in de laatste puzzelcommit (regelversie 2); vraag losgekoppeld.
   Zie architectuur §4 en §12.

Nieuwe status: participant `FINISHED` bij voltooien (met `finishedAt`/`elapsedMs`) en een aparte vraagstatus
(`answeredAt`, `answeredCorrect`); `INVALID` bestaat alleen nog voor oude (versie 1) wedstrijden.

Tests: wedstrijd-integratietests uitgebreid (puzzeltijd stopt bij voltooien, fout/goed/geen antwoord, deadline,
retry zonder tweede finish, gelijktijdig voltooien, antwoordlek, oude regels, overzicht), navigatie-unittests,
een echte browsertest voor navigatie en de wedstrijdflow na voltooien, en alle eerdere suites opnieuw.
