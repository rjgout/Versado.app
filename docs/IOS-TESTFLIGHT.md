# Versado naar TestFlight vanuit GitHub

De workflow **iOS TestFlight** (`native-ios-release.yml`) werkt uitsluitend
handmatig vanaf `develop`, met de exact geselecteerde commit. De eigenaar heeft
geen lokale Xcode-installatie nodig. `main` is voor een later, afzonderlijk
publiek releasetraject; dat traject wordt hier niet geactiveerd.

## Huidige status: nog geen eerste ondertekende build

De `store-test`-allowlist is bewust leeg. `https://dev.versado.app` staat alleen
in `internal` en is beschermd door Cloudflare Access. De bestaande native
Service Auth-bridge accepteert uitsluitend `local-internal` + kanaal `internal`
+ `NATIVE_INTERNAL_ACCESS=1` voor die exacte origin. Enrollment bewaart het
credentialpaar in aparte Keychain/Keystore-opslag; het hoort nooit in de bundel.
Een `local-store-test`-client mag die bridge niet inschakelen. Browsercookies of
een Access-loginredirect bieden geen bewezen alternatief voor de lokale client.
Realtime is in de huidige interne Access-route bovendien expliciet geblokkeerd.

**Daarom: NO-GO voor een succesvolle testbuild en voor upload zolang dit niet is
opgelost.** Een run mag veilig afkeuren vóór signing; een compileproef of interne
build is geen TestFlight-kandidaat. Alleen een environmentvariabele invullen
opent de allowlist niet.

Er is een afzonderlijk architectuur- en uitrolbesluit nodig: ontwerp een voor
TestFlight geschikte, individueel intrekbare native toegangsketen naar de
bestaande beschermde development-backend, met OS-opslag/enrollment, exacte
routebeperkingen en behoud van Versado-login, 2FA en sessie-intrekking. Beoordeel
audio/media en realtime afzonderlijk. Dit is een voorstel, geen geïmplementeerde
of goedgekeurde wijziging. Geen Access uitschakelen, bypass, gebundelde
servicecredentials, publieke dev-backend of productiebackend gebruiken.

Na dat besluit zijn echte toesteltests van toegang, herstart, logout,
accountwisseling, ingetrokken toegang, verlopen sessies en benodigde API's nodig.
Bewijs ook gescheiden dev-accounts en opslag, zonder productieaccounts of
productiedata. Pas daarna kan een afzonderlijke reviewbare wijziging de
`store-test`-allowlist openen. Deze PR verandert geen Cloudflare-, DNS-, NAS-,
Portainer-, database- of accountinstellingen en voert geen live backendtest uit.

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
   huidige beoogde development-origin is `https://dev.versado.app`, maar deze
   blijft geblokkeerd totdat bovenstaande architectuur is geaccepteerd.
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

Als GitHub de Run workflow-knop niet toont: `workflow_dispatch` moet volgens
GitHub ook op de default branch bekend zijn. Wijzig of merge `main` hiervoor
niet stilzwijgend. De eigenaar moet dat repositorybeleid afzonderlijk oplossen;
ook een CLI-dispatch omzeilt die GitHub-voorwaarde niet. Dit is niet in een echte
dispatch getest.

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
ondertekende testbuild, echte upload en publieke App Store-release; code kan
wel als draft-PR onafhankelijk worden beoordeeld.
