# Development-pipeline — dev.versado.app

`main` is productie; `develop` is de integratiebranch, begonnen op
`24627a4bfed2d93a3bb4aace1439a9d53dafdbcf`. De eigenaar meldt dat de afzonderlijke
NAS-ontwikkelomgeving, database, Redis, opslag en Cloudflare-verbinding werken.
Dit is geen door Codex uitgevoerde NAS- of deploymentcontrole.
Volgens de eigenaar is de pipeline actief en is `develop` beschermd met verplichte
Actions. Dezelfde werkafspraken gelden voor alle ontwikkelagents via het centrale
[branch- en mergebeleid](AI-DEVELOPMENT-WORKFLOW.md#branch--en-mergebeleid).

## Van feature naar develop en main

1. Haal `origin/develop` op en maak daarvan een featurebranch. Open een PR naar
   `develop`; volg voor review, toestemming en bestaande PR's het centrale beleid.
2. Behoud de bescherming van `develop` met de verplichte checks:
   **Development-controles**, **PR-image (jehova-app)** en
   **PR-image (jehova-proxy)**. Vereis review en blokkeer directe/force-pushes.
   Beheer van branchregels is een eigenaarshandeling; agents omzeilen die niet.
3. Een push naar `develop` voert de controles opnieuw uit. Alleen daarna worden
   beide bestaande Dockerfiles gebouwd en uitsluitend development-images gepubliceerd.
   Geen automatische merge, NAS-verbinding of Portainer-update.
4. Maak voor een geteste dev-versie een afzonderlijke PR `develop` → `main`.
   Vermeld de geteste commit, beide image-digests, testresultaten en migratie-impact.
   Bevries tijdelijk de kandidaat of gebruik een releasebranch vanaf die exacte
   commit; nieuwe commits op `develop` mogen de goedgekeurde kandidaat niet stil
   veranderen. Wacht op de bestaande main-controles en expliciete mergegoedkeuring.
   De ongewijzigde productie-workflow kan na die bewuste merge productie-images
   publiceren; productie-uitrol blijft een afzonderlijke eigenaarshandeling.
5. Laat na wijzigingen op `main` de gecontroleerde synchronisatie naar `develop`
   uitvoeren volgens het centrale branchbeleid. Bewaar daarbij de bestaande
   Audio V2-, content-, sessie- en beloningscontroles.

## Welke images verschijnen?

De workflow is `.github/workflows/development.yml`:

| Gebeurtenis | Controles | Registry-writes |
|---|---|---|
| PR naar develop | Lint, types/Prisma, pipeline-, security-, native-, release-, stack- en proxytests; app- en proxybuild | Geen; geen login en alleen `contents: read` |
| Push naar develop | Dezelfde technische controles, daarna beide Dockerbuilds | Alleen app/proxy: `dev-sha-<volledige-40-teken-SHA>` en daarna `dev` |
| Push naar main of andere branch, handmatige dispatch | Geen development-run | Geen |

Images: `ghcr.io/rjgout/jehova-app` en `ghcr.io/rjgout/jehova-proxy`.
Nooit `latest`, generieke `sha-*` of een development-deploy-agent. De bestaande
productie-workflow, Dockerfiles, opslag- en migratiearchitectuur zijn ongewijzigd.

PR-jobs hebben geen package-write-rechten. Alleen de afgeschermde develop-pushjob
heeft `packages: write`, met de eigen tijdelijke `GITHUB_TOKEN`; geen NAS-,
Portainer-, Cloudflare- of productiecredentials. Een bestaande GHCR-package moet
de repository wel schrijftoegang geven; de eigenaar controleert dit zo nodig bij
de eerste publicatie of een wijziging van package-rechten. Imagepublicatie
werkt geen NAS-stack bij.

Beide builds zijn klaar vóór de eerste registry-write. Een mislukte controle of
build kan dus geen nieuwe dev-tag publiceren. Registratiefouten stoppen de run.
Een gedeeltelijk geslaagde commit-tagpush blijft beschikbaar; een retry hergebruikt
bestaande commit-tags en overschrijft ze niet. Dit garandeert onveranderlijkheid
binnen deze pipeline; een registrybeheerder kan tags buiten de pipeline wijzigen.
Een digest (`@sha256:…`) is de definitieve inhoudsidentiteit.

Publicaties op develop worden geserialiseerd en niet geannuleerd. Vóór het
bijwerken van `dev` controleert de workflow de actuele develop-head; achterhaalde
runs bewaren alleen hun commit-tags. PR-updates annuleren oude PR-runs. Beide
paden gebruiken dezelfde gescheiden BuildKit-caches; geen dubbele push- én
PR-run op featurebranches en geen losse tweede webproductiebuild in de controlejob.

**Geen registrytransactie over twee images:** als de tweede dev-aliasupdate door
een registryfout mislukt, kan alleen de eerste alias vernieuwd zijn. De run blijft
rood. Werk Portainer daarom uitsluitend bij na een volledig groene run, met het
app/proxy-paar van dezelfde commit en bij voorkeur beide digests. Retry dezelfde
run om het paar te voltooien. Er is geen automatische deployment of rollback.

## Native testbackend en huidige blokkade

Alleen `https://dev.versado.app` wordt aan `internal` toegevoegd in
`scripts/native/distribution-origins.json`; `store-test` blijft leeg. De
request-origins `capacitor://localhost` en `https://localhost`, CORS-headers,
releaseprofiel en signingguards veranderen niet. Deze backend-allowlist is geen
CORS-uitzondering en bewijst geen bereikbaarheid achter Access.

De eigenaar rapporteerde HTTP 200, API-versie 1 en native CORS vóór de nog te
beoordelen Access-inrichting. **`account-deletion-v1` ontbreekt op deze basis**.
WP4 staat in #202 en #205; deze PR dupliceert of merge't die implementaties niet.
De volgende alleen-lezen controle moet daarom terecht afkeuren totdat de vereiste
WP4-functionaliteit bewust in de dev-versie is geïntegreerd:

```bash
npm run native:check-test-backend -- https://dev.versado.app --profile internal
```

Niet omzeilen met een beperkte `--expect-capability`-lijst. Een geslaagde
development-build is geen M0-, TestFlight-, Play- of publieke releasegoedkeuring.
Zie ook [M0-protocol](MOBILE-1-0-INTEGRATIE.md).

## Cloudflare Access: browserlogin is geen native login

De bestaande `NativeApiClient` gebruikt `credentials: "omit"`,
`redirect: "error"`, `X-Versado-Client: native-v1` en de bestaande Versado
Bearer-sessie. Hij stuurt geen `CF_Authorization`-browsercookie of Access-serviceheaders.
De browsercookies van Safari/Chrome worden bovendien niet vanzelf de sessie van
de lokale Capacitor-app. Een Access-loginredirect, HTML-loginpagina of 401/403
blokkeert de API; alleen een browserlogin toevoegen lost dit niet op.

JSON/Bearer-verzoeken vanuit de WebView vereisen ook een CORS-preflight. Die
OPTIONS-aanvraag bevat geen Access-authenticatie. Een GET 200 zonder Access is
dus geen bewijs dat native POST/refresh of iOS/Android achter Access werken.

**Voorstel voor een afzonderlijk goed te keuren interne testoplossing:** een
Access **Service Auth**-beleid uitsluitend voor de testbackend, met afzonderlijke,
intrekbare, kort ingestelde servicecredentials per testtoestel/tester. Houd de
gewone browser-Access-authenticatie voor het beheer intact. Gebruik beide
`CF-Access-Client-Id`/`CF-Access-Client-Secret`-headers; hergebruik hiervoor nooit
de `Authorization`-header van de Versado-sessie. Bewaar credentials uitsluitend
in Keychain/Keystore via een bewuste tester-enrollment, nooit in git, buildvars,
de appbundel, browseropslag of publieke appdistributie. Geen gedeeld ingebakken
servicetoken, publieke Worker of pad-bypass.

Dit vraagt **nog** een beoordeelde native transport-/enrollmentwijziging en een
eigenaarsbesluit over Access-beleid, looptijd en intrekking. De huidige client
ondersteunt dit niet. Servicecredentials zijn een extra toegangspoort en
vervangen nooit de bestaande Versado-gebruikersauthenticatie of serverautorisatie.
Een beheerde Cloudflare One Client/private-netwerkoplossing kan als alternatief
worden onderzocht; ook daarvan moet de echte native HTTPS-route worden bewezen.

Voor WebView-verkeer moet Access OPTIONS afhandelen met uitsluitend de twee
bestaande native origins en de noodzakelijke exacte methoden/headers, of moet een
afzonderlijk beoordeelde native HTTP-transportoplossing de WebView-preflight
vermijden. Implementeer geen wildcard of brede OPTIONS/API-bypass. De huidige
Versado-CORS-configuratie staat de extra serviceheaders niet vanzelf toe; voeg
die niet zonder afzonderlijke beoordeling toe.

Acceptatie vóór deze toegang als werkend geldt: op **beide echte platforms**
capabilities, preflight, login, refresh, logout en eventuele socketverbinding
testen; verlopen/ingetrokken Access-credentials moeten veilig weigeren, een
vreemde origin moet geweigerd blijven. Geen cookie-export, TLS-uitschakeling of
loginredirect volgen om een groene backendcheck te forceren. Store-test blijft
dicht tot deze toegangsstrategie en de overige releaseblokkades zijn beoordeeld.

Geraadpleegde officiële documentatie:

- [Access-servicecredentials en Service Auth](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Access en CORS/preflight](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/)

## Eigenaar: dev-image in Portainer bijwerken en herstellen

Geen van onderstaande NAS-handelingen is door Codex uitgevoerd. Gebruik uitsluitend
de bestaande afzonderlijke development-stack, eigen database/Redis/opslag en
`APP_URL=https://dev.versado.app`. Geen productievolume, netwerk, secrets of
container selecteren; geen deploy-agent of Docker-socket toevoegen.

1. **Alleen lezen — GitHub/Portainer:** controleer de geheel groene develop-run
   en noteer SHA plus beide digests uit de publicatiestap. Noteer ook het huidige
   app/proxy-paar en de bijbehorende configuratie. Alleen `dev` bekijken/pullen
   kiest geen betrouwbare, blijvend vastgelegde releasekandidaat.
2. **Wijzigend — back-up:** maak en controleer volgens het bestaande beheerplan
   een samenhangende back-up van uitsluitend de dev-database en dev-opslag.
   Beoordeel de migraties van de kandidaat. Een back-up maken voert zelf geen
   migratie of import uit.
3. **Wijzigend — Portainer → bestaande development-stack → Editor:** wijzig
   uitsluitend beide app/proxy-imagereferenties naar hetzelfde goedgekeurde
   `dev-sha-<SHA>`-paar, bij voorkeur `ghcr.io/rjgout/jehova-app@sha256:<digest>`
   en `ghcr.io/rjgout/jehova-proxy@sha256:<digest>`. Behoud namen, volumes,
   netwerken en dev-geheimen. Gebruik Update/Redeploy met opnieuw pullen.
   **Dit herstart containers en de bestaande app-entrypoint voert migraties en
   app-initialisatie uit op de dev-database. Dit is geen alleen-lezen controle.**
4. **Alleen lezen — Portainer/app:** controleer image-digests, health en logs,
   app-buildidentiteit en vervolgens de backendcheck hierboven. De ontbrekende
   deletion-capability of Access-blokkade blijft een echte afkeuring. Functionele
   inlog-/schrijftests uitsluitend bewust met synthetische dev-accounts.
5. **Rollback — wijzigend, uitsluitend na compatibiliteitsbesluit:** stel in
   dezelfde dev-stack het vooraf genoteerde app/proxy-digestpaar terug en
   redeploy bewust. Oudere code met een nieuw schema is niet automatisch veilig.
   Is de oude versie niet compatibel, stop dan de dev-app en herstel database
   **en** bijpassende dev-opslag vanuit dezelfde geteste back-up vóór herstart.
   Dit verliest nieuwere testdata; geen `migrate reset`, blinde downmigration,
   seed of herstel naar productie gebruiken. Wijzig geen historische migraties.

De GitHub-workflow start geen Portainer-actie, migratie, import, container of NAS-download.
