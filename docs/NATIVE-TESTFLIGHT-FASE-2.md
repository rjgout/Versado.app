# Versado TestFlight — fase 2: volledige functiepariteit en apparaatacceptatie

**Start:** 13 november 2026, na installatie van iOS TestFlight `0.1.0 (11)`.
**Bron:** `develop` commit `fea24e027e027f0b8d6b2a3cabe250937eec7cca`.
**Uitgangspunt:** de eigenaar bevestigde zeven foutloos verlopen eerste iPhone-proeven;
zie [toestelrapport](NATIVE-DEVICE-TEST-REPORT.md). Op 13 november 2026 heeft
de eigenaar daarnaast expliciet besloten dat **alle beschikbare webappfuncties
ook op iOS beschikbaar moeten worden**, in plaats van de uitgeklede eerste
TestFlight-interface. [Issue #238](https://github.com/rjgout/Versado.app/issues/238)
is de uitvoeringsopdracht. Dit document is test- en releaseplanning, geen
automatische implementatieopdracht of releasegoedkeuring.

## Grenzen die ongewijzigd blijven

- TestFlight-build 11 blijft gekoppeld aan `https://api-test.versado.app`,
  de afgescheiden testomgeving. Geen productieaccounts/-data overnemen.
- `develop` en `main` blijven gescheiden; publieke `release` blijft
  geblokkeerd met `releaseApproved:false`. Geen automatische signingrun of upload.
- Kritieke bevindingen blijven P0/P1-werk. **Featurepariteit is nu juist de
  hoofddoelstelling**: implementeer iedere ontbrekende webfunctie als complete,
  reviewbare, getest gedeelde web/native verticale slice. Geen placeholders,
  remote WebView, generieke cookie-/Bearer-bypass of eigen nieuwe spelregels.
- Testers, toestelidentiteiten, e-mailadressen, tokens en persoonsdata niet
  in openbaar toegankelijke GitHub-documentatie opnemen.
- De bestaande functiepariteit en [multiplatformopdracht #238](https://github.com/rjgout/Versado.app/issues/238)
  blijven leidend. [Optie B](NATIVE-MOBILE-1-0-OPTIE-B.md) is een
  **voorstel** voor tijdelijke uitzonderingen, niet formeel aangenomen en geen
  grond om webfuncties voor iOS uit te sluiten.

## Prioriteit 0 — van uitgeklede TestFlight naar volledige iOS-app

De huidige `0.1.0 (11)` is de **distributie- en basisrooktest**, niet de
productvolledige iOS-app. Bestaande iOS-code heeft grotendeels Vandaag en Leren;
de volledige webnavigatie en veel scherm-/actiecontracten ontbreken. De eigenaar
wil dat de volgende builds zichtbare functionele vooruitgang geven en dat het
**uiteindelijke doel 100% functiepariteit** blijft; geen web-only uitzonderingen
zonder een afzonderlijk expliciet eigenaarbesluit.

[Issue #238 — geactualiseerde uitvoeringsopdracht](https://github.com/rjgout/Versado.app/issues/238#issuecomment-6847979708)
beschrijft het hergebruik van echte gedeelde React-weergaven, domein-/backendregels,
strikte native sessie- en autorisatiepoorten, pariteitstabel en kleine code-PR's.
Prioriteer de ontbrekende gebruikerservaring in bestaande webonderdelen:
volledig profiel/instellingen, Vandaag/Leren/CFM/lezer; daarna alle Spelen,
Vrienden/groepen/social/multiplayer, overige tools, Dorp, Lofzangen, studiemap,
FSY, meldingen/push, en bestaande autorisatiegebonden beheerschermen. Alle
daadwerkelijk bereikbare webfuncties moeten worden getrieerd; geen stilzwijgend
wegstrepen van iets dat lastig is.

Elke tussenbuild kan nog onvolledig zijn en wordt als zodanig gelabeld. Alleen
volledig werkende routes worden zichtbaar. Een volgende TestFlight-upload volgt
pas na een inhoudelijke code-PR met groen gerichte CI, onafhankelijke review en
afzonderlijke toestemming van de eigenaar. De bestaande signing-/uploadketen,
Apple-certificaten en `develop`/productiescheiding blijven intact.

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

**Nu eerst:** start een echte, gebruikerszichtbare **implementatie-PR** vanuit
actuele `develop` volgens #238, parallel aan gerichte P0-dieptetests. Het reeds
vastgelegde testtoestel is iPhone 17 Pro Max op iOS 27.2.1. Er is geen nieuw
certificaat, provisioningprofiel, infrastructuur, backenddeployment of
TestFlight-upload nodig voor deze documentatiestap.
