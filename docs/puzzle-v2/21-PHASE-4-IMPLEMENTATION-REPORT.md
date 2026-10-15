# Fase 4 — verslag: persoonlijke records, vriendenranglijsten en privacy

Ontwerp en regels: `20-PHASE-4-RECORDS-AND-PRIVACY.md`. Branch `feature/puzzle-v2-phase-4-records-leaderboards`. Basis: `origin/main` met PR #94
(navigatie, afgeronde puzzels, wedstrijdregelversie 2). Er is geen nieuwe puzzelengine gebouwd.

## Wat er gebouwd is
- **Recordengine** (`src/lib/puzzle/records.ts`): canoniek model `PuzzleBestRecord`, atomaire "alleen als strikt beter"-registratie, één comparator voor records en ranglijsten.
- **Solo repareert** de eerste-tijd-blijft-staan-fout; **Tegen elkaar** registreert in de officiële finishtransactie (regelversie 2).
- **Privacy**: `User.sharePuzzleRecords` (standaard uit, los van `shareAchievements`), in het bestaande profielprivacyscherm en `/api/account`.
- **API**: `/api/puzzle/records` (eigen records) en `/api/puzzle/leaderboard` (vrienden, server-side gefilterd).
- **UI**: `/jigsaw/records` (filters Solo/Tegen elkaar, hints, aantal stukjes, niveau), `/jigsaw/records/[variantId]` (vriendenranglijst met tabs), sectie op vriendenprofielen,
  link in de Legpuzzel-hub en de privacy-instellingen, rustige recordmelding op de Solo-resultaatkaart en de wedstrijdkaart.
- **Backfill** (`scripts/puzzle/backfill-best-records.ts`, dry-run standaard) en fixture (`seed-backfill-fixture.ts`).
- Kompas (`play.jigsaw` versie 6, nieuwe regel 6), speluitleg en tekstsleutels in nl/en/de/fr/es; CI-workflow en `test:puzzle*`-scripts uitgebreid.

## Databasewijzigingen (additief)
Migratie `20261030100000_puzzle_best_records`: enums `PuzzleRecordMode`, `PuzzleHintCategory`; tabel `PuzzleBestRecord` (uniek + 2 indexen); `User.sharePuzzleRecords BOOLEAN NOT NULL DEFAULT false`.
Geen bestaande rij gewijzigd; bestaande gebruikers houden `false`. `PuzzlePersonalRecord` is ongewijzigd.

## Historische data-analyse en backfill (wegwerpdatabase `backfill_demo`, representatieve fixtures)
| | aantal |
|---|---|
| Solo-sessies bekeken | 144 |
| overgenomen (goed antwoord, voltooid, leesbare snapshot) | 72 |
| onbetrouwbaar (geen antwoordgegevens, kapotte snapshot of niet voltooid) | 54 |
| fout beantwoord | 18 |
| historische recordrijen / waarvan aanvullend overgenomen | 18 / 0 (sessies waren aanwezig) |
| wedstrijddeelnemers bekeken / overgenomen / versie 1 overgeslagen | 6 / 4 / 2 |
| records na dry-run → apply → tweede apply | 38 aangemaakt → 38 → **0 nieuw, 0 verbeterd, 38 ongewijzigd** |
| per categorie | Solo zonder hints 18, Solo met hints 18, Tegen elkaar zonder 1, met 1 |

Reeksen, hinttegoeden, notificaties en wedstrijdwinnaars blijven onaangeroerd (getest). **Niet betrouwbaar overgenomen**: sessies zonder `answerResult` of leesbare snapshot,
niet-voltooide sessies, foute antwoorden, versie-1-wedstrijden, DNF/INVALID; die blijven historisch bestaan. De echte productiecijfers zijn nog niet bepaald: draai eerst de dry-run.

## Testresultaten (geïsoleerde databases)
| Controle | Resultaat |
|---|---|
| Record-unit (comparator, hintcategorie, weergave) | 3/3 |
| Records-integratie (voorbeeld uit de opdracht, tie-breakers, 24 gelijktijdige updates, Solo met/zonder hints, wedstrijd, DNF, versie 1, retry) | 9/9 |
| Backfill-integratie (reconstructie, geen overschrijving, legacyrij, v1/v2-wedstrijden, idempotent, geen bijwerkingen) | 4/4 |
| Privacy/ranglijst-integratie | 4/4 |
| Solo (inclusief hintbudget), Kompas, Samen, wedstrijd: totaal met bovenstaande | 82/82 |
| Multi-instance (2 serverprocessen + PostgreSQL + Redis) | 2/2 |
| Echte browserflow records/privacy (alle 15 stappen, 320 px en 200% tekst) | groen |
| Navigatie-, multiplayer-, flow-, mobiel-, drag-, difficulty-, hint-browsersuites | groen |
| `tsc`, `prisma validate`, eslint (0 fouten), i18n (5 talen gelijk), schone `npm run build` | groen |
| Volledige `tests/*.test.ts` op een deels geseede database, `main` vs deze branch | `main`: 891 geslaagd / 34 mislukt (basislijn); branch: 908 geslaagd / 37 mislukt. Alle 34 basislijnfouten zijn identiek (tests met vaste databasenaam of ontbrekende inhoud). De 3 extra fouten zijn nieuwe wedstrijdtests die `content_bom` (legpuzzelinhoud) nodig hebben, die in die database ontbreekt (`FORBIDDEN`, net als de andere multiplayertests daar); op de voorbereide testdatabases slagen ze (82/82). |

## Prestaties (150 en 300 stukken)
Server (4 gelijktijdige spelers, één PostgreSQL): snapshot 11,5 KB (150) / 24,1 KB (300); delta ≈ 150 B; commit p50/p95 47/75 ms (150) en 54/77 ms (300);
patch-sync ≈ 9–19 ms. Browser (headless Chromium, viewport 390×780 @2x, 12 echte sleepacties): eerste render 1104 ms / 415 ms, framemediaan en p95 16,7 ms,
geen frames > 50 ms, sleep-rondreis ≈ 330 ms (inclusief 12 muisbewegingen), JS-heap ≈ 10 MB, websocketverkeer ≈ 12 KB uit en 12–26 KB in per sessie van 12 sleepacties, herverbinden < 20 ms.
**Dit zijn desktopbrowsermetingen**: ze bewijzen niet dat een oudere iPhone of Android-toestel soepel draait.

## Toegankelijkheid
Controle in de browser op 320 px en 200% tekst (geen horizontale overflow, wrap in kaarten en filters), toetsenbord/`aria-pressed`-knoppen, tekst in plaats van alleen kleur voor records,
touch targets ≥ 44 px, `role="status"` voor de melding, geen animaties (reduced motion niet nodig), dark mode via bestaande tokens. Safe areas en Capacitor-WebView zijn niet apart op toestel gecontroleerd.

## Beperkingen en openstaand
1. Geen test op fysieke iOS/Android-toestellen (rendering, WebView, safe areas); dit moet nog met de hand.
2. Geen realtime push naar vrienden wanneer iemand een record zet; de ranglijst ververst bij openen, focus en na eigen mutations.
3. Geen aparte geluidsfunctie voor records (er is geen geschikte centrale audio-infrastructuur voor spelers); bewust stil.
4. Records worden niet gecorrigeerd als een tijd later onterecht blijkt; het record verwijst wel naar zijn bronsessie.
5. De backfill is niet op productie gedraaid. Eerst een dry-run en een gecontroleerde `--apply`.
6. Een uiterst zeldzame volledige gelijkheid op alle vergelijkvelden wordt beslist op sessie-id (deterministisch maar willekeurig).

## Productieadvies
Migratie → app → dry-run → beoordelen → `--apply` buiten piektijd → fysieke telefoontest van het recordscherm en de ranglijst. Nieuwe records ontstaan al vanaf de uitrol.
Fase 4 is **klaar voor gecontroleerde live acceptatie**, mits de fysieke toesteltest en de productie-dry-run nog worden uitgevoerd.
