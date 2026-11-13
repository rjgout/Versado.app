# Versado — fysiek apparaattestrapport (WP15)

<!-- device-matrix-status: in-progress -->

**Status: eerste iPhone-smoketest bevestigd; volledige apparaatmatrix OPEN.**
Dit is een groeiend acceptatieverslag, geen bewijs van een publieke iOS-/Android-release.
Een aangevinkte test betekent dat de **eigenaar** de proef heeft uitgevoerd en als
foutloos heeft gemeld. Het is geen onafhankelijke instrumentatie of CI-assertie.

## Testregistratie — 13 november 2026

| Veld | Vastlegging |
|---|---|
| Product | Versado iOS, via Apple TestFlight |
| Versie/build | `0.1.0 (11)` |
| Broncommit | `fea24e027e027f0b8d6b2a3cabe250937eec7cca` (`develop`) |
| Distributie | [geslaagde GitHub-upload 43388294751](https://github.com/rjgout/Versado.app/actions/runs/43388294751); door Apple verwerkt en intern geïnstalleerd volgens eigenaar |
| Apple-buildstatus | Build 11 upload `Complete`, gekoppeld aan interne groep `Versado Intern` (door eigenaar getoond) |
| Backend in bundel | `https://api-test.versado.app` (`local-store-test` / `testflight`); geen productierelease |
| Uitvoerder | Eigenaar, zelfrapportage via gesprek op 13 november 2026 |
| Testtoestel | Fysieke iPhone, exact model **nog niet genoteerd** |
| iOS-versie | **Nog niet genoteerd** |
| Meetbewijs | TestFlight-installatie en gebruikersbevestiging; geen bijgevoegde crashtelemetrie, apparaatlogs, screenshots per stap of automatische eind-tot-eindmeting |
| Persoonsgegevens | Geen accountadres, tokens, certificaten of sleutelmateriaal in dit rapport |

### Bevestigde eerste zeven scenario's

| # | Scenario | Status | Bewijsgrens |
|---|---|---|---|
| 1 | App starten, afsluiten en opnieuw openen | **PASS — eigenaar** | Herinstallatie / koude start zonder netwerk niet apart bevestigd |
| 2 | Inloggen, uitloggen en ingelogd blijven | **PASS — eigenaar** | Sessieverval, intrekking, accountwisseling en TOTP niet afzonderlijk bevestigd |
| 3 | Vandaag, Leren en hoofdstukken lezen | **PASS — eigenaar** | Niet alle leespaden, bronrechten, CFM-vormen en talen apart afgetekend |
| 4 | Vragen beantwoorden en voortgang opslaan | **PASS — eigenaar** | Geen onafhankelijk bewijs voor dubbele XP-/reeksverwerking, races of replay |
| 5 | Audio afspelen en achtergrondgedrag | **PASS — eigenaar** | Onderbreking door bellen, seek/Range en netwerkverlies tijdens stream nog apart te testen |
| 6 | Navigatie, toetsenbord en schermindeling | **PASS — eigenaar** | VoiceOver, 200% tekst, kleinste iPhone, iPad en alle talen nog niet afgetekend |
| 7 | Wifi uitschakelen, herstellen en opnieuw synchroniseren | **PASS — eigenaar** | Geen bewijs dat mobiele data, write-races en socketticketverloop apart getest zijn |

**Resultaat van deze sessie:** zeven door de eigenaar als foutloos gemelde
iPhone-scenario's; **nul gemelde fouten in deze zeven proeven**. Dit zegt niet dat
de app geen andere bugs heeft of dat de volledige uitrolmatrix is voltooid.

## Vereiste apparaten voor volledige WP15-releasegate

De volgende vaste matrixregels worden pas `PASS` na daadwerkelijke tests op
de betreffende toestellen, met model/OS, testdatum, stappen, uitkomst en reviewer.
`PENDING` is bewust niet gelijk aan geslaagd.

| Matrixsleutel | Status | Vereist bewijs |
|---|---|---|
| iphone-small | PENDING | Kleine iPhone/320 pt, minimale ondersteunde iOS-versie, reflow en toegankelijkheid |
| iphone-recent | PENDING | Recente iPhone/recente iOS, volledige kritieke flow en lifecycle |
| ipad | PENDING | iPad, beide oriëntaties, toetsenbord, VoiceOver en responsive gedrag |
| android-phone-a | PENDING | Eerste Android-fabrikant, ondersteunde ondergrens, login/sessies/offline en terugnavigatie |
| android-phone-b | PENDING | Tweede Android-fabrikant, recente Android-versie, dezelfde kritieke flow |
| android-tablet | PENDING | Android-tablet, beide oriëntaties, TalkBack en lifecycle |

De reeds geteste iPhone kan later als `iphone-small` en/of `iphone-recent`
worden geregistreerd **als het exacte model/iOS en alle vereiste scenario's
aantoonbaar passen**; dat wordt niet automatisch aangenomen.

## Nog niet afgetekende dieptetests

- Beveiliging: registratie/bevestiging, TOTP indien van toepassing, accountwisseling,
  ingetrokken/verlopen sessies, herinstallatie, veilige Keychain-opslag en accountverwijdering
  met **uitsluitend een synthetisch wegwerpaccount**.
- Netwerk: eerste start offline, netwerkverlies tijdens een schrijfopdracht,
  herverbinden zonder dubbel opslaan/XP, audio seek/Range, websocketreconnect.
- UI/toegankelijkheid: VoiceOver, 200% tekst, donkere modus, safe areas,
  lange teksten en alle ondersteunde talen (nl/en/de/fr/es).
- Functioneel: CFM Stap voor stap / Vrije studie, drie schriftleespaden,
  voortgang na herstart en accountwissel, instellingen/privacy/juridische toegang.
- Compatibiliteit: tweede iPhone, iPad, Android-telefoons van twee fabrikanten en Android-tablet;
  op ieder toestel ook installatie, lifecycle en terugnavigatie.
- Telemetrie/bewijs: eventuele TestFlight-crashes/feedback, korte reproduceerstappen,
  datum, toestel/iOS, verwachte/feitelijke uitkomst en link naar issue/PR.

## Vrijgavegrenzen

- **GO:** alleen voor voortgezet **intern iOS-TestFlight-testen** van build 11.
- **GEEN GO:** externe TestFlight-uitrol, Play-distributie, publieke App Store,
  `main`, productiedeployment of het opheffen van `releaseApproved:false`.
- Nieuwe testresultaten alleen toevoegen na de werkelijke apparaattest, zonder
  persoonlijke tokens, gebruikersgegevens, App Store-sleutels of volledige logs.
- De volledige releasegate `device-test-report` mag pas worden afgesloten
  nadat alle zes matrixregels `PASS` zijn **en** een expliciete menselijke
  beoordelaar de verzamelde resultaten heeft geaccepteerd. Het readiness-script
  kan alleen de geregistreerde status controleren, niet de waarheid op het toestel.

Vervolg: [TestFlight-fase 2](NATIVE-TESTFLIGHT-FASE-2.md).
