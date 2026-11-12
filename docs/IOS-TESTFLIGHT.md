# Versado naar TestFlight vanuit GitHub

De workflow **iOS TestFlight** (`native-ios-release.yml`) werkt uitsluitend
handmatig vanaf `develop`, met de exact geselecteerde commit. De eigenaar heeft
geen lokale Xcode-installatie nodig. `main` is voor een later, afzonderlijk
publiek releasetraject; dat traject wordt hier niet geactiveerd.

## Huidige status: archivering geblokkeerd, eerdere IPA-validatie nog open

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

## Onderzoek herhaalbare signing — 12 november 2026

Dit is een onderbouwd voorstel, geen gewijzigde signingimplementatie. De eigenaar
wil eerst weten welke bestaande signingmiddelen herbruikbaar zijn en heeft nog
geen `.p12` beschikbaar. Geen certificaten/profielen aanmaken, intrekken of
verwijderen en geen volgende signingrun starten tijdens dit onderzoek.

### Vergelijking van de twee runs

| Onderdeel | Run 43093200972 | Run 43172836913 |
|---|---|---|
| Broncommit | `2c4d5ded6baafd7b832d7a4d346658d7a0ed655c` | `dadd8d465beaaf7657942555a97dfc1a7b52128b` |
| Runner-image | `macos-26-arm64`, `20261102.0473.1` | dezelfde imageversie |
| Xcode | 26.6, build 17F113 | dezelfde Xcode-versie |
| Archiefsigning | Apple Development, label “Created via API” | probeert iOS App Development-provisioning |
| Uitkomst | archive en export geslaagd; IPA-keychainguard keurt af | archive faalt: `maximum number of certificates` en ontbrekend Development-profiel |
| IPA-diagnose uit #273 | nog niet aanwezig | niet bereikt, want archive faalt eerder |

[Run 1](https://github.com/rjgout/Versado.app/actions/runs/43093200972) en
[run 2](https://github.com/rjgout/Versado.app/actions/runs/43172836913) zijn inmiddels
beide afgerond; hun logs zijn vergeleken. Workflow, project-signinginstellingen
en archive-/exportopdrachten zijn tussen deze commits identiek. Geen bewijs van
een gewijzigde signingmethode, Xcode-versie of runner-image als oorzaak.

**Oorzaak:** `Release` kiest de optimalisatieconfiguratie, niet automatisch een
Distribution-signingidentiteit. Het project bevat ook voor Release
`CODE_SIGN_IDENTITY = "iPhone Developer"`. De workflow archiveert met
`CODE_SIGN_STYLE=Automatic` en `-allowProvisioningUpdates`, zonder import van
een bewaarde identiteit met privésleutel. Pas de afzonderlijke export kiest
`app-store-connect` en `Apple Distribution`. De eerste run gebruikte dus ook
Development-signing voor het archief, gevolgd door Distribution-export.
Dat tweestappenmodel is op zichzelf geldig; ontbrekend duurzaam hergebruik op
wegwerprunners maakt de huidige inrichting niet betrouwbaar herhaalbaar.

GitHub-hosted runners zijn tijdelijke machines; een lokaal aangemaakte
signingprivésleutel en profielen blijven niet voor de volgende runner beschikbaar.
Een certificaat in Apple Developer alleen levert die privésleutel niet opnieuw.
De huidige workflow laat Xcode bij iedere schone runner de ontbrekende middelen
automatisch regelen en kan daardoor opnieuw Development-certificaten aanvragen.
De tweede run loopt daarbij aantoonbaar tegen het certificaatmaximum aan en heeft
dan geen passend lokaal Development-profiel. Steeds certificaten verwijderen
herstelt deze werkwijze niet structureel.

De eigenaar ziet tien via API gemaakte Development-certificaten, een persoonlijk
Development-certificaat en een Distribution Managed-certificaat. Die telling is
niet onafhankelijk via Apple geïnspecteerd. De logs tonen niet hoeveel certificaten
iedere run heeft aangemaakt; schrijf dus niet alle tien aan één specifieke run
toe. De eerste log noemt een gebruikt provisioningprofiel; het profielbestand
en de signingprivésleutel zijn daarmee niet als herbruikbare middelen beschikbaar.

### Wat de officiële documentatie wel en niet bewijst

- [Apple: signingidentiteiten delen](https://developer.apple.com/documentation/xcode/sharing-your-teams-signing-certificates):
  een certificaat **en** bijbehorende privésleutel zijn nodig; een volledige
  identiteit kan als wachtwoordbeveiligde PKCS#12 worden geëxporteerd. Een `.cer`
  of de App Store Connect `.p8` API-sleutel vervangt die signingprivésleutel niet.
- [Apple: cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/):
  beheerde distributiecertificaten worden op afstand beheerd en gebruikt voor
  cloud signing in de distributiewerkwijze. De bestaande export kan daarvan
  gebruik blijven maken. Het Managed-certificaat is geen beschikbare lokale
  `.p12` met exporteerbare privésleutel voor de huidige Development-archiefstap.
  De eerste export is bewezen geslaagd; de log bewijst niet welk Managed-certificaat
  daarvoor precies is gebruikt. Apple kan Managed-certificaten bovendien zelf
  roteren; “nooit een nieuw certificaat van enig type” is bij die route geen
  ongeclausuleerde garantie.
- [Apple: profielen beheren](https://developer.apple.com/help/account/provisioning-profiles/edit-download-or-delete-profiles/):
  “Xcode-managed development provisioning profiles and distribution provisioning
  profiles don’t appear in your developer account.” Een leeg profielenoverzicht
  bewijst dus niet dat automatische provisioning nooit een profiel heeft gemaakt.
- [Apple: Development-profiel](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile/)
  vereist een passend App ID, bestaand Development-certificaat en geregistreerde
  apparaten. Een [App Store Connect-profiel](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)
  gebruikt een expliciet App ID en één Distribution-certificaat.
- [GitHub: Xcode-apps ondertekenen](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications):
  importeer een bewaarde `.p12` en profiel vanuit secrets in een tijdelijke
  runner-keychain, gebruik ze voor de build en ruim ze op. Er is geen lokale
  Xcode-installatie nodig om de terugkerende GitHub-builds uit te voeren.

Alleen `Apple Distribution` als archive-override invullen bewijst niet dat een
Managed-privésleutel lokaal beschikbaar komt. Een ongetekend archive vervolgens
via cloud signing exporteren is voor Versado niet gevalideerd. Dat wordt zonder
passende onderbouwing en afzonderlijke toestemming geen productiepad. Geen
Xcode Cloud, self-hosted runner, Fastlane Match of nieuwe signingdienst nodig
voor het hier onderzochte hergebruik.

### Kleinste oplossing hangt af van de bestaande privésleutel

| Beschikbaar middel | Kleinste onderbouwde route | Gevolg voor automatisch aanmaken |
|---|---|---|
| Bestaande Development-identiteit mét privésleutel en passend profiel | Importeer beide tijdelijk; archiveer expliciet met die identiteit en dat profiel, zonder provisioning-updates. Behoud de bestaande automatische App Store Connect-export. | De archive-opdracht kan geen nieuw Development-certificaat aanvragen. Managed Distribution-rotatie bij export blijft een afzonderlijk Apple-proces. |
| Bestaande exporteerbare Apple Distribution-identiteit mét privésleutel en App Store Connect-profiel | Gebruik diezelfde distributiemiddelen expliciet voor archive én export; geen provisioning-updates in beide opdrachten. | Geen Development-signing nodig; Xcode krijgt geen automatische provisioning-opdracht om certificaten te maken. |
| Alleen een Managed Distribution-certificaat en geen bruikbare lokale privésleutel | Geen bewezen complete vervanging voor de huidige archiefstap. Onderzoek eerst een bestaande sleutel bij de maker; anders is een afzonderlijk eigenaarsbesluit nodig over eenmalig lokaal beheerde Distribution-middelen. | Geen volgende build als proef om de quota te omzeilen. |

**Advies:** controleer eerst bestaande privésleutels. Als de persoonlijke
Development-sleutel beschikbaar is, is de eerste route de kleinste wijziging en
blijft de huidige distributiewerkwijze behouden. Als een Distribution-sleutel
beschikbaar is, vermijdt de tweede route Development-signing volledig. Kies geen
nieuwe architectuur op basis van de nog onbekende sleutelbeschikbaarheid.

Een implementatie moet de bestaande archive-opdracht gericht aanpassen:
`CODE_SIGN_STYLE=Manual`, de gevalideerde bestaande signingidentiteit en het
passende profiel expliciet selecteren, en `-allowProvisioningUpdates` plus
API-authenticatie uit **die archive-opdracht** verwijderen. Voor de volledig
expliciete Distribution-route geldt hetzelfde voor export, met een expliciete
profielmapping voor `app.versado.app`. Ontbrekend, verkeerd, verlopen of niet bij
team/app/certificaat passend materiaal moet vóór archivering stoppen; nooit
terugvallen op automatische certificaataanmaak. Dit is nog niet geïmplementeerd.

### Eerst door de eigenaar controleren — zonder lokale Xcode-installatie

1. Open **Sleutelhangertoegang / Keychain Access** op de Mac en zoek onder de
   geschikte sleutelhanger(s) bij **Mijn certificaten / My Certificates** naar de
   bestaande Apple Development- of Apple Distribution-identiteit. Klap de regel
   open: er moet een bijbehorende **privésleutel** staan. Alleen bekijken; niets
   verwijderen, intrekken, nieuw aanvragen of inloggen in Xcode om iets te maken.
2. Geef alleen door of een bruikbare privésleutel aanwezig is en welk type
   identiteit het betreft. Deel geen namen, teamcodes, certificaatbestanden,
   wachtwoorden of sleutels in chat. De nu bevestigde status is **nog onbekend**.
3. Na keuze en goedkeuring van de route: exporteer de bestaande volledige
   identiteit via [Sleutelhangertoegang](https://support.apple.com/guide/keychain-access/import-and-export-keychain-items-kyca35961/mac)
   als wachtwoordbeveiligde `.p12`. Daarvoor
   is geen lokale Xcode-installatie nodig. Beveilig de export en reservekopie;
   exporteer niet de complete sleutelhanger. Een Managed-certificaat uit de
   Developer-website downloaden geeft niet alsnog zijn privésleutel.
4. Controleer dan een bestaand, geldig en downloadbaar profiel voor exact
   `app.versado.app`, het verwachte team en het gekozen certificaat. Een
   Development-route vereist ook een passend geregistreerd apparaat. Als er
   geen bruikbaar profiel is, moet de eigenaar na afzonderlijk akkoord eenmalig
   het juiste profiel laten maken; de agent maakt nu niets aan.
5. Alleen wanneer er geen herbruikbare identiteit bestaat: besluit apart of een
   eenmalig beheerde Apple Distribution-identiteit nodig is. Die kan via de
   [macOS-certificaatassistent/CSR](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/)
   en Apple Developer worden ingericht zonder
   Xcode-installatie. Dit onderzoek geeft geen toestemming voor die aanmaak.
6. Na goedgekeurde implementatie plaatst de eigenaar de `.p12`, het wachtwoord
   en het profiel uitsluitend in environment `testflight`. Definitieve secretnamen
   volgen uit die implementatie. De bestaande vier secrets en backendvariabele
   blijven bestaan. Geen bestanden in repository, cache, chat of artifacts.

### Aantonen dat een latere run geen Development-certificaten maakt

Vóór toestemming voor een volgende run moet de diff tonen dat de archive-opdracht
geen `-allowProvisioningUpdates`, `-allowProvisioningDeviceRegistration` of
API-authenticatie krijgt en uitsluitend vooraf gecontroleerd materiaal gebruikt.
Voor volledig expliciete Distribution-signing moet dat ook voor export gelden.
Tests moeten ontbrekende/foute middelen laten afkeuren zonder netwerkmutaties.
De bestaande ontwikkel-/simulatorconfiguratie en IPA-guards blijven intact.

De eigenaar vergelijkt daarnaast vóór en na een afzonderlijk toegestane
`upload=false`-run de bestaande Development-certificaten en aanmaaktijden in
Apple Developer, zonder ze te wijzigen. Deel alleen aantallen en het resultaat
“geen nieuwe Development-certificaten”; houd identificaties lokaal. Beoordeel
ook eventuele Distribution-rotatie apart. Een alleen-lezen inventaris kan helpen,
maar detectie achteraf vervangt het uitsluiten van aanmaak in de opdracht niet.
Gebruik geen algemene signing- of provisioning-logs als artifact.

Een latere run moet expliciet aantonen dat de gekozen identiteit en het profiel
zijn hergebruikt; alleen een geslaagde build is onvoldoende bewijs. De bestaande
IPA-validatie, inclusief de geschoonde keychaindiagnose uit #273, blijft vereist.
De eerdere IPA-keychainfout is niet door een archive-signingwijziging opgelost.

**Nu NO-GO voor een volgende signingrun.** Eerst sleutelbeschikbaarheid bevestigen,
route kiezen, gerichte implementatie en tests, onafhankelijke review en
mergetoestemming. Geen workflow, secrets of Apple-middelen gewijzigd in dit
onderzoek; alle builds blijven daarna via GitHub Actions uitvoerbaar.

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

Tijdens het eerdere onderzoek voor #273 meldde GitHub run 43093200972 nog als
`in_progress` en gaf de joblog HTTP 502. Inmiddels zijn beide runlogs beschikbaar;
zie de signingvergelijking hierboven. Er is nog geen IPA-artifact of volledig
exportprofiel beschikbaar. **NO-GO voor een claim dat de IPA-keychainfout is
opgelost.** Los eerst de archiefsigning op. Pas na gerichte implementatie, groene
CI, onafhankelijke review en afzonderlijke eigenaarstoestemming kan een nieuwe
`upload=false`-run de geschoonde IPA-diagnose leveren. Een nieuwe afkeuring mag
niet worden omzeild.

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
een herstelde TestFlight-build: archive-signing is geblokkeerd en de werkelijke
IPA-profieloorzaak is nog onbekend.
Een diagnose-run vereist afzonderlijke review/CI en eigenaarstoestemming.
Upload en publieke release blijven afzonderlijke besluiten.
