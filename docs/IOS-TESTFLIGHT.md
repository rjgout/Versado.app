# Versado naar TestFlight vanuit GitHub

De workflow **iOS TestFlight** (`native-ios-release.yml`) werkt uitsluitend
handmatig vanaf `develop`, met de exact geselecteerde commit. De eigenaar heeft
geen lokale Xcode-installatie nodig. `main` is voor een later, afzonderlijk
publiek releasetraject; dat traject wordt hier niet geactiveerd.

## Huidige status: eerste export, IPA-validatie nog niet afgerond

De gecontroleerde `store-test`-origin is `https://api-test.versado.app` (PR #272).
De website `https://dev.versado.app` blijft een afzonderlijke interne origin met
Cloudflare Access; die credentials horen niet in een TestFlight-bundel.

De eigenaar rapporteert voor run [43093200972](https://github.com/rjgout/Versado.app/actions/runs/43093200972)
op develop `2c4d5ded6baafd7b832d7a4d346658d7a0ed655c`, versie `0.1.0`,
`upload=false`: preflight, Release-archive, archiefvalidatie en IPA-export geslaagd;
IPA-validatie faalt met `profiel: onverwachte keychain-groep`. Niets geüpload.
De werkelijke profielgroepen en App ID Prefix zijn niet beschikbaar. Zie de
veilige diagnose hieronder; de acceptatieregels blijven ongewijzigd.
Geen nieuwe signingrun of upload zonder afzonderlijke eigenaarstoestemming.

## GitHub en Apple voorbereiden — eigenaar

1. Repository → Settings → Environments → maak exact **`testflight`**.
   Kies bij Deployment branches and tags **Selected branches and tags** en voeg
   uitsluitend branch **`develop`** toe, geen tags. Voeg vereiste reviewers toe
   en voorkom zelfgoedkeuring waar het GitHub-abonnement dat ondersteunt.
2. Voeg uitsluitend in deze environment de vier secrets toe:

   | Secret | Inhoud |
   |---|---|
   | `ASC_KEY_ID` | App Store Connect Key ID |
   | `ASC_ISSUER_ID` | Issuer ID van de teamsleutel |
   | `ASC_API_KEY_P8_BASE64` | Base64 van de `.p8` private key |
   | `IOS_TEAM_ID` | Apple Developer Team ID |

   Gebruik een teamsleutel met toegang tot **Versado** en passende rechten voor
   cloud-managed Apple Distribution-certificaten, automatische provisioning en
   upload. Controleer de Apple-rol en certificaatrechten afzonderlijk; alleen
   leesrechten bewijzen geen signing- of uploadrechten. Kopieer geen sleutel of
   certificaat uit Ringtools. Configureer test en toekomstige productie bewust
   afzonderlijk. Deel secretwaarden nooit in chat, logs of artifacts.
3. Voeg environmentvariabele **`NATIVE_STORE_TEST_API_ORIGIN`** toe: de exacte,
   afzonderlijk goedgekeurde HTTPS-testorigin zonder afsluitende slash. De
   goedgekeurde testorigin is `https://api-test.versado.app`; gebruik geen
   website-origin of productie-origin.
   Optioneel: `IOS_XCODE_APP` voor een exacte Xcode-installatie op de runner.
4. Controleer de bestaande Apple-registratie: naam **Versado**, Bundle ID
   **`app.versado.app`**, juiste team. Maak geen nieuwe registratie. De workflow
   controleert de naam en Bundle ID via een alleen-lezen App Store Connect-call.
   API-sleutelacceptatie bewijst nog geen effectieve signing-/uploadrechten;
   daarvoor is later een afzonderlijk toegestane echte run nodig.
5. Beoordeel export compliance, privacylabels en Apple-overeenkomsten in App
   Store Connect. Activeer geen Sign in with Apple, APNs of Associated Domains
   voor deze taak. De IPA-poort weigert onverwachte entitlements.

## Eerst bouwen zonder upload, later bewust uploaden

Na onafhankelijke review, bewuste merge naar `develop`, backendvrijgave en
aparte toestemming voor echte signing:

1. GitHub → Actions → **iOS TestFlight** → Run workflow → **develop**.
2. Vul `app_version` in, bijvoorbeeld `0.1.0`; laat **upload uit**.
3. Keur de `testflight`-environmentaanvraag bewust goed. Alle beveiligingspoorten
   moeten slagen. Download het IPA-artifact en controleer samenvatting en SHA-256.
4. Pas na aparte uploadtoestemming start je een **nieuwe run** vanaf de gewenste
   `develop`-commit, met **upload aan**. De build wordt opnieuw gemaakt en
   gecontroleerd; geen willekeurig ouder artifact wordt geüpload.
5. Open App Store Connect → Apps → **Versado** → **TestFlight** → iOS-builds.
   Een geaccepteerde upload moet eerst door Apple worden verwerkt. Controleer
   verwerkingsfouten, exportvragen en testinformatie voordat je testers toewijst.
   De workflow wijzigt geen groepen, nodigt geen externe testers uit en dient
   niets in voor publieke App Store-publicatie.

`github.run_number` levert het buildnummer. De workflow accepteert uitsluitend
1..9999 (de eerste component van Apples CFBundleVersion heeft maximaal vier
cijfers) en laat Xcode het nummer nooit herschrijven. Start na een geaccepteerde
upload een nieuwe run; een rerun hergebruikt hetzelfde nummer en kan door Apple
als dubbel worden afgekeurd. Verlaag nooit het nummer en migreer bij uitputting
via een afzonderlijke wijziging. Controleer voor de eerste upload dat bestaande
Apple-builds voor deze appversie geen hoger nummer gebruiken.

De default branch is `main`; de bestaande workflow is daar al actief met
`workflow_dispatch` geregistreerd. De GitHub-voorwaarde voor workflowregistratie
is dus aanwezig. De startknop kan tot een bewuste latere synchronisatie nog de
oude workflownaam tonen. Selecteer na merge van deze PR expliciet **develop**:
GitHub gebruikt dan de workflowinhoud van die branch, met het nieuwe uploadveld.
Een echte dispatch is niet uitgevoerd.

**Legacy op main:** de ongewijzigde kopie bevat nog de oude main/ios-testflight-
archiefroute. Deze PR kan die kopie niet verwijderen zonder de expliciet verboden
wijziging aan main. Configureer daarvoor geen oude secrets of legacy environment;
gebruik uitsluitend de op develop beperkte `testflight`-environment. De eigenaar
moet een afzonderlijk besluit nemen over het uitschakelen/opruimen van de oude
route voordat repositorybreed kan worden geclaimd dat geen main-archiefroute meer
bestaat. Geen main-run starten. Er is nu alleen environment `testflight` gezien,
met branchbeleid `develop`; vereiste reviewers zijn niet aangetroffen. Het
controleren van secret-/variabelemetadata werd door GitHub geweigerd (HTTP 403).
Er zijn geen instellingen gewijzigd.

## Wat wordt gecontroleerd?

Node 24, iOS SDK ≥ 26, exacte commit, profiel/kanaal, versie/buildnummer,
`npm ci`, uitsluitend Prisma-generatie (geen migraties), volledige bestaande
backendcheck inclusief capabilities en CORS, native build, Capacitor-sync en
bestaande distributieguards. De archive gebruikt expliciet Release. De export
gebruikt `app-store-connect`, `destination=export`, Apple Distribution en
`manageAppVersionAndBuildNumber=false`.

De uitgepakte uiteindelijke IPA krijgt opnieuw asset-/hash-/CSP-/backend- en
credentialpatrooncontroles, plus `codesign --verify --deep --strict`, exact team,
Bundle ID, appnaam, versies, App Store-profiel zonder apparaten/enterprise,
geldigheidsdatum, `get-task-allow=false`, beperkte entitlements en een leesbaar
privacymanifest zonder tracking. Patrooncontroles bewijzen geen afwezigheid van
elk denkbaar onbekend geheim; echte signing en toestelacceptatie zijn hier niet
uitgevoerd. Het ingebedde provisioningprofiel wordt lokaal gedecodeerd zonder
de inhoud te loggen. De tijdelijke API-sleutel staat alleen in een runner-tempmap
met beperkte rechten en wordt met een EXIT-trap en `always()`-opruimstap verwijderd.

## Fouten oplossen

| Fase | Actie |
|---|---|
| Branch/environment | Kies develop; controleer geselecteerde branchregels en reviewers. |
| Secrets/Apple-preflight | Controleer de vier namen, base64/P-256, Key/Issuer ID, team en apprechten; print geen waarden. |
| Backend | Laat de blokkade intact. Beoordeel Access, allowlist, volledige capabilities (ook account-deletion), CORS en dev-isolatie; geen beperkte capabilitycheck als omweg. |
| Archive | Bekijk loggroep Archivering; controleer Xcode/SDK en provisioningrechten. |
| Export/signing | Controleer Apple Distribution, certificaatrechten en een geldig App Store-profiel voor het juiste team en app-ID. |
| IPA-validatie | Herstel de genoemde identiteit, assets, metadata, privacy of entitlements; sla de poort nooit over. |
| Upload | Controleer Apple-rol, afspraken, unieke oplopende buildversie en Apple-foutmelding; herstart na acceptatie met een nieuwe run. |

Bij falen vóór upload is geen upload gestart. Bij een netwerkfout tijdens upload
kan acceptatie onduidelijk zijn: controleer App Store Connect vóór een nieuwe
poging. De samenvatting noemt bron/SHA, versie/build, identiteit, backend, Xcode,
IPA-hash en beschikbare signing-/uploadresultaten. Apple-acceptatie betekent
geen verwerkte build en geen beschikbaarheid voor testers.

## Tijdelijke diagnose van afgekeurde keychainrechten

Apple’s [TN3125, “The how”](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles#The-how)
toont een profiel met een prefixwildcard en exact `com.apple.token`. Het profiel
is een entitlement-allowlist: “Every entitlement claimed by the app must be in
the profile’s allowlist but the reverse isn’t true.” Een synthetisch profiel met
dit patroon reproduceert de gemelde fout: onze enkele-groepregel is voor dat
Apple-voorbeeld te streng. Dat bewijst niet dat deze groepen in de mislukte IPA
stonden. Een vreemde groep geeft dezelfde foutmelding.

[TN2311](https://developer.apple.com/library/archive/technotes/tn2311/_index.html)
beschrijft legacy App ID Prefixes die van Team ID kunnen afwijken. Die begrippen
zijn niet universeel gelijk. Zonder het echte profiel is niet vast te stellen
of dat hier speelt. Er wordt geen andere prefix of keychaingroep toegestaan;
`distributionProblems()` en alle signing-/IPA-/uploadguards blijven ongewijzigd.

Als de distributiecontrole een fout geeft, voegt `ipaProblems()` een JSON-regel
`Signingdiagnose (geschoond; geen acceptatiebesluit)` aan de foutmelding toe:

- Per app/profiel: aanwezig/afwezig/misvormd, aantal groepen/duplicaten en aantallen
  per vaste categorie: `expected-app`, `expected-wildcard`, `apple-token`,
  `profile-prefix-app`, `profile-prefix-wildcard`, `other`, `malformed`.
- Vergelijkingen met het verwachte signingteam en de exacte appidentiteit;
  afzonderlijk de prefix uit app-ID, profiel-app-ID en `ApplicationIdentifierPrefix`.
  Niet bepaalbaar is `null`; ontbrekende gegevens worden niet als overeenkomst gezien.
- `appKeychainCoveredByProfile` beschrijft alleen dekking door exacte groepen of
  een prefixwildcard; het kent geen rechten toe. Profieldekking maakt een
  ongeoorloofde appclaim niet toegestaan.

De uitvoer bevat geen concrete groep-, team- of prefixwaarden, profielnaam/UUID,
certificaten of sleutels. Alleen bij afkeuring, geen extra artifacts of Apple-calls.
De bestaande fout blijft bestaan en upload blijft geblokkeerd. Na een expliciet
toegestane nieuwe run met `upload=false` deelt de eigenaar alleen deze geschoonde
regel. Beoordeel daarmee de oorzaak vóór een eventuele gerichte reparatie; sta
geen onbekende waarden toe. Verwijder de tijdelijke diagnose na die reparatie.

GitHub bevestigt de mislukte distributiestap van run 43093200972, maar meldde de
run tijdens dit onderzoek nog als `in_progress`; de joblog gaf HTTP 502 en er waren
geen artifacts. De eigenaar heeft bevestigd geen aanvullende profielgegevens te
hebben. **NO-GO voor een claim dat de IPA-fout is opgelost.** Na groene relevante
CI, onafhankelijke review en eigenaarstoestemming kan een diagnose-run op develop
met `upload=false` worden uitgevoerd; een nieuwe afkeuring kan daarbij verwacht
worden. Geen signingbuild gestart door deze wijziging.

## Herkomst en grenzen

Versado leverde al profielen, lokale bundeling, distributiechecks, privacy manifest
en archiefguards. Ringtools (`68b1234217a4c93eb4cacc9eb42dc8f9c0dc11d7`)
leverde het patroon voor vier secretnamen, tijdelijke sleutel, automatische
signing, export en onafhankelijke signing-/profielcontrole. Geen Ringtools-code,
certificaten, appidentiteit, APNs- of Associated Domains-configuratie gekopieerd.

Apple noemt altool nog als uploadmethode op
[Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
(gecontroleerd tijdens implementatie). De workflow gebruikt `xcrun altool` met
API-authenticatie en een tijdelijke `API_PRIVATE_KEYS_DIR`.

`releaseApproved` blijft false en het `release`-profiel blijft geblokkeerd.
Geen promotie naar main of publieke releaseworkflow. Momenteel **NO-GO** voor
een herstelde TestFlight-build: de werkelijke profieloorzaak is nog onbekend.
Een diagnose-run vereist afzonderlijke review/CI en eigenaarstoestemming.
Upload en publieke release blijven afzonderlijke besluiten.
