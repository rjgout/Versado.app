# Legpuzzel 2.0, fase 4: persoonlijke records, vriendenranglijsten en privacy

Verslag met bewijs: `21-PHASE-4-IMPLEMENTATION-REPORT.md`. Regels voor wedstrijden: `18-PHASE-3-MULTIPLAYER-ARCHITECTURE.md` §4 en §12.

## 1. Productregels (vast)
- Twee hintcategorieën: `NO_HINTS` (helemaal geen hint) en `WITH_HINTS` (één of meer hints, inbegrepen of persoonlijk).
  Een gratis inbegrepen hint telt als hintgebruik. Geen derde categorie, geen aparte lijst voor inbegrepen hints.
- Modi: `SOLO` en `MATCH` hebben aparte records en lijsten. **Samen heeft geen snelheidsrecord.**
- Vergelijking per exacte puzzelvariant (`PuzzleVariant`: afbeelding en geometrie via `PuzzleDefinition`, aantal stukken,
  moeilijkheid, spelregelversie). Andere afbeelding, aantal stukken, niveau of regel/geometrieversie = ander record.
- Maximaal vier posities per gebruiker en variant: Solo/Match × Zonder/Met hints.
- Vriendenranglijst: alleen jijzelf en geaccepteerde vrienden die `sharePuzzleRecords` aan hebben. Geen wereldwijde of groepsranglijst.

## 2. Oorzaak van de eerdere fout
`answerSoloPuzzle` deed een `upsert` op `PuzzlePersonalRecord (userId_variantId)` met `update: {}`. Alleen de eerste geldige
tijd werd dus opgeslagen en latere, snellere tijden werden genegeerd; er was ook geen onderscheid tussen hintcategorieën.

## 3. Datamodel (keuze)
Nieuw model **`PuzzleBestRecord`** in plaats van een uitbreiding van `PuzzlePersonalRecord`:
- `PuzzlePersonalRecord` heeft een unieke sleutel `(userId, variantId)` en `sessionId @unique`; vier categorieën per variant passen daar niet in
  zonder die sleutel te wijzigen (een niet-additieve wijziging op bestaande productierijen). Het blijft ongewijzigd bestaan als historisch
  "eerste geldige prestatie"-register en wordt nog steeds geschreven, maar niet meer als beste tijd gelezen.
- `PuzzleBestRecord`: `userId, variantId, mode (PuzzleRecordMode), hintCategory (PuzzleHintCategory), elapsedMs, hintsUsed, extraHintsUsed,
  completedAt, sessionId (bron), matchParticipantId?, createdAt, updatedAt`. Uniek op `(userId, variantId, mode, hintCategory)`;
  index `(variantId, mode, hintCategory, elapsedMs)` voor snelle ranglijsten en `(userId, mode)` voor het eigen overzicht.
- Een record heeft altijd een bron (sessie); het ontstaat alleen uit een server-gevalideerde geldige prestatie.
- `User.sharePuzzleRecords Boolean @default(false)`: aparte, standaard uitgeschakelde toestemming, los van `shareAchievements`.
- Migratie `20261030100000_puzzle_best_records`: uitsluitend additief (enums, tabel, kolom). Geen backfill in de migratie.

## 4. Vervangen van een record (atomair)
`registerBestRecord(tx, candidate)` (`src/lib/puzzle/records.ts`) is één PostgreSQL-statement:
`INSERT ... ON CONFLICT (userId, variantId, mode, hintCategory) DO UPDATE ... WHERE (nieuw) < (bestaand)` met de vergelijking
`(elapsedMs, extraHintsUsed, hintsUsed, completedAt, sessionId)`. De `WHERE` wordt geëvalueerd tegen de vergrendelde bestaande rij, dus
gelijktijdige updates kunnen een snellere tijd nooit door een langzamere overschrijven. Dezelfde bron opnieuw is niet "strikt beter" en
dus een no-op: idempotent bij retries en herhaalde antwoorden. Geen `findFirst` gevolgd door `update`.

Volgorde (records én ranglijsten, `compareRecords`): 1) laagste `elapsedMs` (milliseconden), 2) minste persoonlijke extra hints,
3) minste hints in totaal, 4) vroegste voltooiing, 5) stabiele sleutel (gebruiker/sessie). Tijden worden alleen voor weergave afgerond
(`formatPuzzleTime`: tiende seconde onder een minuut, anders hele seconden). Dit verandert nooit een definitieve wedstrijduitslag of de
rang binnen één wedstrijd.

## 5. Wanneer ontstaat een record
- **Solo**: bij een geldig antwoord (goede vraag, geometrisch voltooide puzzel) in dezelfde transactie als de reeksclaim, nooit bij een
  herhaald antwoord. Tijd = `completedAt - startedAt`; de vraagtijd telt niet mee. Een fout antwoord geeft geen record. De reeksregels, XP en
  hinttegoeden zijn ongewijzigd.
- **Tegen elkaar** (alleen `resultRules = 2`): in `finishAttempt`, dezelfde transactie als de officiële finish. Onafhankelijk van winst en van de
  vraag; DNF, ongeldig en versie-1-wedstrijden leveren niets op. Een retry met dezelfde `actionId` maakt geen tweede record (de engine
  retourneert de opgeslagen uitkomst en voert hooks niet opnieuw uit).
- **Samen**: geen snelheidsrecord.

## 6. Oude en nieuwe wedstrijdregels
Wedstrijden met `resultRules = 1` (de klok stopte bij het juiste antwoord, een fout antwoord gaf `INVALID`) zijn niet vergelijkbaar met versie 2 (de klok
stopt bij het voltooien van de puzzel). Alleen versie 2 doet mee aan records en ranglijsten. Versie-1-uitslagen blijven ongewijzigd en bereikbaar bij hun
oorspronkelijke wedstrijd; ze worden niet herschreven, niet herberekend en niet stilzwijgend naar de nieuwe lijst verplaatst. De ranglijstpagina
meldt dit bij Tegen elkaar.

## 7. Privacy en autorisatie (server-side)
- `/api/puzzle/records` levert uitsluitend de eigen records van de ingelogde gebruiker (altijd zichtbaar voor jezelf, onafhankelijk van delen).
- `/api/puzzle/leaderboard` bepaalt de toegestane gebruikers **op de server**: de kijker plus geaccepteerde vrienden (`Friendship.status = ACCEPTED`,
  beide richtingen) met `sharePuzzleRecords = true`. De API kent geen parameter om gebruikers toe te voegen; PENDING/DECLINED/verbroken
  vriendschappen geven geen inzage. Eén query voor alle vrienden (geen N+1).
- Vriendenprofielen: `getFriendProfile` voegt `puzzleRecords` toe via `sharedRecordsOf` (vriendschap én toestemming); anders `null`. Dit hangt niet af
  van `shareAchievements`; omgekeerd geeft `sharePuzzleRecords` geen toegang tot andere prestaties.
- Uitzetten verbergt records onmiddellijk (de filter is een live-query, geen kopie); de gegevens blijven bewaard en zijn bij weer aanzetten opnieuw zichtbaar.
- Alle responses: `Cache-Control: private, no-store` (leaderboard ook `Vary: Cookie`); geen server-side cache over gebruikers heen.
- Een onbekende variant geeft een neutrale lege uitkomst (`leaderboard: null`), zonder interne gegevens. Response bevat alleen id, handle, discriminator
  en avatar-instellingen (geen e-mail, privacyvelden of sessie-ids).
- Toegang: `puzzleRouteUser()` (ingelogd, legpuzzel aan en in de contentkeuze).

## 8. API-contracten
- `GET /api/puzzle/records?mode&hintCategory&pieceCount&difficulty` → `{ records: OwnRecordView[] }` (max. 200, nieuwste eerst).
- `GET /api/puzzle/leaderboard?variantId|(imageId,pieceCount,difficulty)&mode&hintCategory` → `{ leaderboard: { variant, mode, hintCategory, rows[], viewerShares } | null }`, max. 50 rijen.
- Solo-antwoord (`/api/jigsaw-v2` `answer`) bevat optioneel `record: { variantId, result: CREATED|IMPROVED|UNCHANGED, hintCategory, elapsedMs, previousElapsedMs }`.
- Wedstrijdweergave (`getMatch`): `variantId` en `me.record` (is deze poging mijn huidige beste?).

## 9. Historische backfill
Afzonderlijk, herhaalbaar, idempotent: `scripts/puzzle/backfill-best-records.ts` (standaard dry-run; `--apply` schrijft). Bron: beantwoorde Solo-sessies met
aantoonbaar goed antwoord, `completedAt` en leesbare snapshot (hints), aangevuld met `PuzzlePersonalRecord`-rijen waarvan de sessie ontbreekt; versie-2-wedstrijden met
`FINISHED` en opgeslagen tijd. Niet overgenomen: foute/onbeantwoorde antwoorden, sessies zonder betrouwbare metadata, versie-1-wedstrijden, DNF/INVALID. Per
sleutel wint de beste tijd via dezelfde comparator; een bestaand beter record wordt nooit overschreven. Raakt geen reeksen, hinttegoeden, activiteiten,
notificaties of wedstrijdresultaten en verwijdert niets. Oefenen op een wegwerpdatabase: `scripts/puzzle/seed-backfill-fixture.ts`.

## 10. Uitrol en terugdraaien
1. Migratie uitrollen (`prisma migrate deploy`, additief). Nieuwe privacyinstelling staat voor iedereen uit.
2. App uitrollen. Nieuwe records ontstaan vanaf dat moment bij geldige voltooiingen.
3. **Dry-run** op productie (alleen lezen): `npx tsx scripts/puzzle/backfill-best-records.ts`. Controleer de aantallen; pas daarna bewust `--apply` (eventueel buiten piektijd).
   Er is geen automatische productiebackfill.
4. Terugdraaien: eerdere appversie terugzetten. `PuzzleBestRecord`, `sharePuzzleRecords` en de enums blijven ongebruikt staan; `PuzzlePersonalRecord` is nooit gewijzigd. Een oude
   app leest alleen de oude tabellen en wordt niet onbetrouwbaar door extra rijen. Geen destructieve migratie nodig.
5. Privacy kan nooit "terugdraaien naar zichtbaar": de standaard is uit en een gebruiker beslist zelf.

## 11. Geluid, bewegingen en toegankelijkheid
Geen nieuwe audio-architectuur: er is geen geschikte centrale geluidsinfrastructuur voor spelers in de puzzel, dus de recordmelding is stil (documentatie, geen omvangrijke nieuwe code).
De melding is een rustige tekstkaart (`role="status"`) zonder animatie of overlay en dus geen botsing met de voltooiingskaart of de reeksviering (`celebrationGate`).
Filters zijn knoppen met `aria-pressed` in gegroepeerde `fieldset`/`role="group"`; rijen dragen betekenis in tekst; touch targets ≥ 44 px; getest op 320 px en 200% tekst.
