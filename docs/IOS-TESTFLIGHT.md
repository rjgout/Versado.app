# Versado naar TestFlight vanuit GitHub

De workflow **iOS TestFlight** (`native-ios-release.yml`) werkt uitsluitend
handmatig vanaf `develop`, met de exact geselecteerde commit en environment
`testflight`. Archive én IPA-export gebruiken dezelfde bestaande Apple
Distribution-identiteit en het app-specifieke App Store-profiel. Er is geen
automatische provisioning-aanmaak of fallback naar Development-signing.
`upload` staat standaard op `false`. `main` blijft een afzonderlijk releasetraject.

## Status en herkomst van het herstel

- [Run 43093200972](https://github.com/rjgout/Versado.app/actions/runs/43093200972)
  op `2c4d5ded6baafd7b832d7a4d346658d7a0ed655c` archiveerde met Apple Development
  (“Created via API”) en exporteerde daarna naar App Store Connect. De
  onafhankelijke IPA-guard keurde af: `profiel: onverwachte keychain-groep`.
- [Run 43172836913](https://github.com/rjgout/Versado.app/actions/runs/43172836913)
  op `dadd8d465beaaf7657942555a97dfc1a7b52128b` faalde eerder: certificaatmaximum
  en geen passend iOS App Development-profiel. Workflow/projectinstellingen,
  runner-image `20261102.0473.1` en Xcode 26.6 waren gelijk.
- De oude workflow archiveerde automatisch met Development-signing, zonder
  hergebruik van een privésleutel op de tijdelijke runner. Apple Distribution
  werd pas bij export gekozen. Automatische provisioning kon daardoor opnieuw
  Development-certificaten aanvragen. De logs tonen niet welke run hoeveel
  certificaten heeft aangemaakt.
- #273 levert de geschoonde keychaindiagnose. Die blijft intact.
- Het vooronderzoek uit draft-PR #274 is hier verwerkt. Het eerdere keuzepunt is
  vervallen: de eigenaar heeft inmiddels op Windows een Distribution-certificaat
  mét privésleutel, een beveiligde `AppleDistribution.p12`, het profiel
  `Versado_App_Store_Distribution.mobileprovision` en een beveiligde reservekopie.
  Volgens de eigenaar verloopt het certificaat op 12 november 2027; de code
  controleert de werkelijke geldigheid. AES256-SHA256-import op macOS is nog
  **niet** met deze bestanden aangetoond.

De goedgekeurde `store-test`-origin is `https://api-test.versado.app`.
`https://dev.versado.app` blijft de afzonderlijke interne website met Cloudflare
Access. Geen Cloudflare-credentials in TestFlight-bundels.

## Wat de workflow doet

1. Controleert handmatige start, exacte branch `develop`, exacte bron-SHA,
   profiel/kanaal, versie/buildnummer en vereiste configuratie.
2. Bouwt de lokale native bundel, synchroniseert Capacitor en controleert de
   backend, API-origin, assets en bestaande distributieguards.
3. Decodeert uitsluitend de bestaande eigenaarbestanden in een privémap onder
   `RUNNER_TEMP` (0700; bestanden 0600). Maakt lokaal een tijdelijke keychain
   met een willekeurig wachtwoord en importeert de bestaande `.p12`. Geen `-A`
   voor onbeperkte sleuteltoegang.
4. Vereist één geldige codesigningidentiteit met privésleutel, Apple
   Distribution-certificaat, Apple WWDR-issuer, verwacht team en geldige datums.
   macOS moet die identiteit als geldig herkennen. Een los certificaat zonder
   privésleutel wordt afgekeurd.
5. Vereist een geldig iOS App Store-profiel voor exact `app.versado.app`, het
   verwachte team en exact hetzelfde certificaat. Controleert onder meer UUID,
   geldigheid, geen apparaten/enterprise, `get-task-allow=false`,
   `beta-reports-active=true` en de bestaande strikte entitlementpolicy.
6. Installeert alleen dat profiel in de profielmap van Xcode 26. Een reeds
   bestaand bestand met dezelfde UUID wordt niet overschreven.
7. Stelt tijdelijk uitsluitend **App/Release** in op `Manual`, de concrete
   certificaatfingerprint, het team en de profiel-UUID. `plutil` verifieert dat
   alle overige projectdata gelijk blijven. Het projectbestand in Git, Debug,
   simulatorinstellingen en frameworktargets worden niet aangepast.
8. Archiveert zonder provisioning-updates of Apple-API-authenticatie. Exporteert
   met `signingStyle=manual`, dezelfde certificaatfingerprint en een expliciete
   profielmapping voor `app.versado.app`. Geen versienummerherschrijving.
9. Voert de bestaande archief- én onafhankelijke IPA-validatie uit, inclusief
   echte app-entitlements, broncommit, metadata, backend, assets, privacy en
   signing. Pas daarna kan de afzonderlijke uploadkeuze worden uitgevoerd.
10. Herstelt project en keychainzoeklijst en verwijdert het geïnstalleerde
    profiel, tijdelijke keychain, `.p12`, profielkopieën, API-sleutel en lokale
    archive/export/uitpakmappen. Dit gebeurt bij fouten, via een EXIT-trap en
    een `always()`-stap. Een mislukte cleanup maakt de job rood en wordt opnieuw
    geprobeerd; bij abrupt runnerverlies vernietigt GitHub de tijdelijke machine.

De App Store Connect `.p8` is alleen voor de bestaande alleen-lezen app-preflight
en de expliciet gekozen upload. Xcode krijgt geen API-authenticatie of
`-allowProvisioningUpdates`/`-allowProvisioningDeviceRegistration`.

Native tooluitvoer met mogelijke identiteiten wordt niet rechtstreeks gelogd.
Archive/exportlogs blijven tijdelijk privé en worden verwijderd; fouten leveren
alleen vaste, geschoonde categorieën. Alleen een volledig gevalideerde IPA en
`build.json` komen in het bestaande artifact (7 dagen). De normale IPA bevat
zijn ingebedde openbare profiel; nooit de signingprivésleutel. Losse
signingmiddelen, keychains en ruwe signinglogs worden niet geüpload of gecachet.

## GitHub-configuratie — uitsluitend eigenaar

Controleer vóór toevoeging van signingsecrets:

1. Repository → Settings → Environments → exact **testflight**.
2. Deployment branches: uitsluitend **develop**, geen tags of PR-branches.
   Gebruik vereiste reviewers en voorkom zelfgoedkeuring waar beschikbaar.
3. De workflow mag uitsluitend `workflow_dispatch` gebruiken; checkout is exact
   `github.sha` zonder bewaarde Git-credentials. Onbetrouwbare PR-code krijgt
   geen toegang tot deze environment. Normale PR-tests gebruiken synthetische
   middelen, geen echte secrets.

Voeg uitsluitend aan deze environment toe:

| Secret | Inhoud |
|---|---|
| `IOS_DISTRIBUTION_P12_BASE64` | Base64 van de bestaande beveiligde `AppleDistribution.p12` |
| `IOS_DISTRIBUTION_P12_PASSWORD` | Het bestaande wachtwoord van die PKCS#12-export |
| `IOS_PROVISIONING_PROFILE_BASE64` | Base64 van het bestaande `Versado_App_Store_Distribution.mobileprovision` |

Behoud `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_P8_BASE64`, `IOS_TEAM_ID` en
variabele `NATIVE_STORE_TEST_API_ORIGIN=https://api-test.versado.app`.
`IOS_XCODE_APP` blijft optioneel voor een exacte Xcode-installatie.

Op Windows kan PowerShell de Base64 rechtstreeks naar het lokale klembord
zetten. Vervang onderstaande voorbeeldpaden door de echte lokale paden:

```powershell
Set-Clipboard -Value ([Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\veilig\AppleDistribution.p12')))
```

Plak alleen in de GitHub-environmentsecret `IOS_DISTRIBUTION_P12_BASE64`.
Daarna voor het profiel:

```powershell
Set-Clipboard -Value ([Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\veilig\Versado_App_Store_Distribution.mobileprovision')))
```

Plak alleen in `IOS_PROVISIONING_PROFILE_BASE64`. Vul het P12-wachtwoord
rechtstreeks in de daarvoor bestemde secret in. Base64 is geen versleuteling:
deel geen bestanden, waarden of wachtwoorden in chat, code, issues of PR's.
Gebruik hiervoor geen gedeeld/cloudgesynchroniseerd klembord of klembordhistorie;
wis het lokale klembord na gebruik en behoud de beveiligde reservekopie.
Geen nieuwe certificaten/profielen maken en niets intrekken voor deze inrichting.

## Eerst een afzonderlijk toegestane macOS-importcontrole

Deze controle is een afzonderlijke **mode** in de bestaande workflow, geen
nieuwe workflowregistratie of signingdienst. Start hem pas na onafhankelijke
review, mergegoedkeuring, veilige inrichting van de environment en **expliciete
toestemming voor de importcontrole**.

Kies Actions → iOS TestFlight → **develop**:

- `app_version`: bijvoorbeeld `0.1.0` (verplicht invoerveld; geen appbuild in deze mode).
- `upload`: **false**.
- `signing_import_only`: **true**.

Alleen `branch-check` en `signing-import-check` mogen lopen;
`testflight-archive` moet worden overgeslagen. De importjob krijgt uitsluitend
het team en de drie nieuwe signingsecrets. Geen App Store Connect-sleutel,
backendcheck, npm-build, `xcodebuild`, app-signing of upload. Hij controleert
macOS-import, geldige Distribution-identiteit met privésleutel, profielmatch en
de bestaande profielpolicy en ruimt alles op. De broncommit wordt gecontroleerd.

Als de UI nog invoervelden van de oude default-branch toont, kan de eigenaar
na diezelfde toestemming expliciet de develop-versie kiezen:

```sh
gh workflow run native-ios-release.yml --repo rjgout/Versado.app --ref develop \
  -f app_version=0.1.0 -F upload=false -F signing_import_only=true
```

Importcontrole plus `upload=true` wordt vóór environmentgebruik afgekeurd.
Een importcontrole is geen geslaagde IPA-build. Bij AES256-SHA256/importproblemen
wordt veilig gestopt met een vaste foutmelding; wachtwoord, Base64 en PKCS#12-
compatibiliteit moeten gericht worden onderzocht. Geen automatische herverpakking,
legacy-fallback of verzwakking van encryptie.

## De eerdere keychaingroepfout blijft open

[TN3125](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles#The-how)
beschrijft een ruimere profielallowlist met bijvoorbeeld `com.apple.token`.
De huidige Versado-policy staat dat meervoudige patroon nog niet toe.
Deze signingwijziging versoepelt die policy niet.

De profiel-preflight hergebruikt dezelfde bestaande controles. Daardoor kan ook
de importcontrole na een geslaagde P12-import nog afkeuren op
`profiel: onverwachte keychain-groep`. De log meldt eerst de geslaagde import en
identiteitscontrole, gevolgd door de geschoonde diagnose uit #273. Dat levert
bewijs vóór een dure archive, zonder de fout te omzeilen. De daadwerkelijke
app-entitlements worden pas door de onafhankelijke IPA-guard beoordeeld.

De concrete profielgroepen van de eerste IPA blijven onbekend. Ook een
legacy App ID Prefix uit [TN2311](https://developer.apple.com/library/archive/technotes/tn2311/_index.html)
wordt niet automatisch toegestaan. Deel bij een volgende fout uitsluitend de
geschoonde diagnose, geen profiel, teamcodes of sleutels.

## Daarna bouwen zonder upload — alleen na nieuwe toestemming

Na geslaagde importcontrole en beoordeling van eventuele profielproblemen kan
de eigenaar afzonderlijk een signingrun toestaan: **develop**,
`signing_import_only=false`, `upload=false`, gewenste versie. Alle bestaande
guards moeten slagen. Controleer samenvatting, bron-SHA en SHA-256 van de IPA.

Voor het vaststellen van hergebruik controleert de eigenaar vóór en na de run
de bestaande certificaten en aanmaaktijden in Apple Developer, zonder iets te
wijzigen. Rapporteer alleen aantallen en “geen nieuwe certificaten”. Archive en
export hebben geen automatische provisioning of API-authenticatie; een
ontbrekend lokaal middel veroorzaakt een fout, geen aanvraag van een nieuw middel.

Een latere upload vereist aparte toestemming en een **nieuwe run** met
`upload=true`, uitsluitend na volledige IPA-validatie. `github.run_number`
levert het buildnummer (1..9999); geen automatische hernummering of hergebruik
na een geaccepteerde upload. Apple-acceptatie is nog geen verwerking, installatie
of publieke App Store-publicatie. De workflow nodigt geen testers uit.

## Grenzen en officiële bronnen

`releaseApproved=false` en het publieke `release`-profiel blijven geblokkeerd.
De oude kopie van de workflow op `main` is niet gewijzigd; configureer geen
legacy secrets/environment en start geen main-run. Een publieke App Store-release
of wijziging aan main vereist een afzonderlijk besluit.

- [Apple: signingidentiteiten en privésleutels](https://developer.apple.com/documentation/xcode/sharing-your-teams-signing-certificates)
- [Apple: cloud-managed certificaten](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/)
- [Apple: App Store Connect-profielen](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)
- [Apple: Xcode-beheerde profielen staan niet in het profielenoverzicht](https://developer.apple.com/help/account/provisioning-profiles/edit-download-or-delete-profiles/)
- [GitHub: bestaande certificaten en profielen op tijdelijke macOS-runners](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)

**NO-GO voor een automatische volgende fase.** Geen signingbuild, importcontrole,
upload, secretwijziging of merge is door deze wijziging uitgevoerd. De bestaande
Windows-bestanden blijven uitsluitend bij de eigenaar. Review en eigenaarstoestemming
blijven voor iedere volgende bewuste handeling vereist.
