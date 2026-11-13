# Versado TestFlight — fase 2: stabiliteit en apparaatacceptatie

**Start:** 13 november 2026, na installatie van iOS TestFlight `0.1.0 (11)`.
**Bron:** `develop` commit `fea24e027e027f0b8d6b2a3cabe250937eec7cca`.
**Uitgangspunt:** de eigenaar bevestigde zeven foutloos verlopen eerste iPhone-proeven;
zie [toestelrapport](NATIVE-DEVICE-TEST-REPORT.md). Dit is een operationeel
testplan, geen automatische implementatieopdracht of releasegoedkeuring.

## Grenzen die ongewijzigd blijven

- TestFlight-build 11 blijft gekoppeld aan `https://api-test.versado.app`,
  de afgescheiden testomgeving. Geen productieaccounts/-data overnemen.
- `develop` en `main` blijven gescheiden; publieke `release` blijft
  geblokkeerd met `releaseApproved:false`. Geen automatische signingrun of upload.
- Kritieke bevindingen eerst reproduceren en als kleine reviewbare GitHub-PR
  repareren; geen grote feature-uitbreiding tijdens deze stabilisatieronde.
- Testers, toestelidentiteiten, e-mailadressen, tokens en persoonsdata niet
  in openbaar toegankelijke GitHub-documentatie opnemen.
- De bestaande functiepariteit en [multiplatformopdracht #238](https://github.com/rjgout/Versado.app/issues/238)
  blijven leidend. [Optie B](NATIVE-MOBILE-1-0-OPTIE-B.md) is een
  **voorstel** voor tijdelijke uitzonderingen, niet automatisch formeel aangenomen.

## Stap A — Dieptetest op dezelfde iPhone (WP15, prioriteit P0)

Voer elke proef echt uit en leg `PASS/FAIL/NOT TESTED` met datum, toestelmodel,
iOS-versie, appbuild, testaccounttype en verwachte/feitelijke uitkomst vast.
De zeven eerdere proeven zijn de rooktest, niet al deze scenario's.

| Onderdeel | Gerichte proef | Acceptatie |
|---|---|---|
| Toegang | Login, logout, TOTP waar actief, account wisselen, ingetrokken sessie, verlopen token, herinstallatie | Geen oude toegang of vorige accountdata; veilige hervatting |
| Lezer en voortgang | Drie schriftleespaden, heropenen, beantwoorden, expliciet afronden, snelle dubbele taps, wissel account | Alleen bevestigde servermutaties; geen dubbele voortgang of XP |
| CFM | Stap voor stap en Vrije studie, nieuw/oud weekpad, hervatten | Juiste stappen, vragen en voortgang, geen lege/dode route |
| Audio | Start, pauze, seek/Range, achtergrond, onderbreking door telefoongesprek/andere audio, netwerkverlies | Herstel zonder dubbele stream of onbeveiligde toegang |
| Netwerk en sockets | Start offline, wifi/mobiele data wisselen, verbinding verliezen tijdens opslaan, opnieuw verbinden | Zichtbare fout/herstel; geen ongecontroleerde retry of duplicaat |
| Toegankelijkheid | VoiceOver, 200% tekst, donkere modus, lange tekst in nl/en/de/fr/es, toetsenbord/safe areas | Geen onbereikbare bediening of horizontale overflow |
| Accountverwijdering | Volledige native flow **alleen met synthetisch wegwerpaccount**, inclusief herauthenticatie en sessie-intrekking | Geen toegang meer; geen productieaccount geraakt |
| Juridische toegang | Privacyverklaring, voorwaarden en verwijderingsinformatie vanuit app | Werkende en juiste verwijzingen, geen lege schermen |

Bij een `FAIL`: reproduceerstappen en verwacht/feitelijk gedrag als GitHub-issue
met ernst `P0/P1/P2`. `P0` = toegang/gegevensverlies/privacy/beveiliging of
app start niet; `P1` = kritieke leerflow/voortgang structureel defect.
Geen nieuwe distributie naar een bredere groep bij open P0.

## Stap B — Tweede toestelronde (WP15, prioriteit P1)

Test een kleinere kritieke set op **kleine iPhone (320 pt / iOS 15 indien beschikbaar)**,
recentere iPhone en iPad in portret én landschap. Noteer eerst model/OS om
de bestaande iPhone eerlijk aan een matrixregel te koppelen. Daarna dezelfde
kernflows op twee Android-telefoonfabrikanten en een Android-tablet via een
**afzonderlijk goedgekeurd** Android-testkanaal, niet door een iOS-IPA te hergebruiken.

App-breed: eerste installatie, login/logout, heropenen, tekst/safe areas,
VoiceOver/TalkBack, offline/herstel, lezer en voortgang, audio en accountbeheer.
Actualiseer het [toestelrapport](NATIVE-DEVICE-TEST-REPORT.md) per werkelijk toestel.
Geen `PASS` op basis van simulator, CI of een ander model.

## Stap C — Kleine interne bèta (WP15)

Pas als stap A geen open P0 oplevert en de eigenaar de groepsuitbreiding
goedkeurt: nodig een kleine groep vertrouwde interne testers uit via App Store
Connect. Geef hen een kort testscript (installatie, onboarding, Vandaag, Leren,
afronden, audio, herstart, feedback). Controleer TestFlight-feedback en crashes
zonder accountgegevens, en koppel bevindingen aan GitHub-issues. Alleen wijzigingen
met gerichte tests en groene CI gaan via review en expliciet merge-/uploadbesluit
naar een **nieuwe** TestFlight-build.

## Stap D — Releasegereedheid (WP4/WP5/WP16 en pariteit)

Voer vóór externe tests of een publieke release de actuele
`npm run native:store-readiness -- --strict` op de gekozen releasebasis uit,
beoordeel de **inhoudelijke** open blockers en leg per item bewijs en een
eigenaarbesluit vast. Minimaal: accountverwijdering en herauthenticatie,
voorwaarden/privacylabels/export compliance, minimum-native-versiebeleid,
functiepariteit en expliciet goedgekeurde uitzonderingen, rechten en appmetadata,
testaccount voor review, rollback/updatepad en volledige fysieke apparaatmatrix.
Een geslaagde upload/rooktest is geen vrijgave van deze verplichtingen.

## Beoordelingsmomenten en opleveringen

| Moment | Vereiste oplevering | Besluit |
|---|---|---|
| Na stap A | Aanvulling toestelrapport, P0/P1-issues, model/iOS bekend | Wel/niet meer interne testers |
| Na stap B | Volledige relevante toestelmatrix, inclusief Android apart | Wel/niet uitgebreide bèta |
| Na stap C | Samenvatting stabiliteit, feedback/crashes en gesloten bugs | Wel/niet externe TestFlight |
| Na stap D | Releasechecklist, privacy/pariteit en onafhankelijke review | Afzonderlijk besluit over `main` en App Store |

**Nu eerst:** noteer het exacte iPhone-model en iOS-versie in het verslag,
voer de dieptetests van stap A uit en registreer bevindingen. Geen nieuw
certificaat, provisioningprofiel, infrastructuur, backenddeployment of
TestFlight-upload nodig voor deze documentatiestap.
