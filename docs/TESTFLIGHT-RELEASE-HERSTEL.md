# TestFlight-releaseherstel na ce2830aa

Gerichte reparatie vanaf develop `ce2830aa6018dfc83da4c7993d6069d4779804b5`.
Geen signing, upload, NAS-uitrol of merge uitgevoerd. Buildnummer 23 is niet toegekend.
CFM blijft gepauzeerd; publicatie-, audio- en CFM-hashvoorwaarden blijven ongewijzigd.

## Bewezen contractfout en herstel

De cursusbeheerhook gebruikt de bestaande persoonlijke lijst `courses`. Zowel de native
GET-routecontrole als de PUT-bodycontrole stond uitsluitend `games` toe. Daardoor kon
het bestaande cursusbeheer zijn voorkeur niet via de native brug ophalen/opslaan.
De TypeScript-, Swift- en Java-grenzen accepteren nu precies `games` en `courses`.
GET vereist één listKey zonder extra parameters; PUT accepteert geen query.
De bestaande strikte backend-bodyvalidatie, 16 KiB-grens, actorcontrole, Origin- en
sessiecontrole blijven behouden. De webhandler en opslagtransactie veranderen niet.

`tests/native-course-order.integration.test.mjs` gaat via de echte Next-native-dispatch
naar de oorspronkelijke handlers op een eigen PostgreSQL en eigen testgebruikers:
ophalen/opslaan, eerder/later, toevoegen, verbergen/terugzetten met ongewijzigde cursor
en leesvoortgang, web/native-uitwisseling, vreemde cookies, ongeldige invoer en intrekking.
Deze test draait mee in de bestaande geïsoleerde spelketen, zonder nieuwe CI-matrix.

## Mobiele weergave

De competitiecontainer had in de gedeelde flex-shell geen begrensde eigen breedte.
De divisies bepaalden daardoor de paginabreedte (gereproduceerd: 1360 px document bij
320 px/200%). De container krijgt nu `w-full min-w-0`, de divisiescroller een eigen
breedtegrens. Ranglijstrijen mogen bij grote tekst omlopen zodat namen en cijfers
zichtbaar blijven. Reeks en XP krijgen dezelfde expliciete breedtebegrenzing.
Geen globale overflow-maskering en geen wijziging aan ShellMetrics/safe-area-offsets.
Competitie blijft onder Vrienden. Enkelvoud langste reeks is toegevoegd voor nl/en/de/fr/es.

De browserproef gebruikt de echte gedeelde shell en native progressieclients met
synthetische HTTP-antwoorden. Hij controleert 60 combinaties: vijf talen, 320/375/390/430 px,
100/200% tekst, licht/donker, React-tabbar en gesimuleerde UIKit-tabbarhoogtes.
Controles: documentbreedte, intern scrollbare divisies, alle ranglijsttabs, zichtbare
gebruikersnamen, enkelvoud en bereikbaarheid van de laatste inhoud boven de gemeten tabbar.
Dit is browserbewijs, geen fysieke iPhone- of UIKit-renderacceptatie.

Reproduceren: `CHROMIUM_PATH=/pad/naar/chromium node --import tsx tests/native-progress-layout.browser.mjs`.
Volledige beelden en resultaten: `/tmp/versado-native-browser/progress-layout`, tevens het
bestaande Native Foundation-browserartifact. Representatieve beelden:

- [Competitie, 390 px licht](screenshots/testflight-release-herstel/competitie-390-licht.png)
- [Competitie, 320 px en 200% tekst](screenshots/testflight-release-herstel/competitie-320-grote-tekst.png)
- [Reeks onderaan, 320 px en 200% tekst](screenshots/testflight-release-herstel/reeks-onderaan-320.png)
- [XP onderaan, donker en 200% tekst](screenshots/testflight-release-herstel/xp-onderaan-donker.png)

## Artifactupload afzonderlijk beoordelen

Run [44409490341](https://github.com/rjgout/Versado.app/actions/runs/44409490341),
commit ce2830aa: de iOS-simulatorcompile en Android-compile slaagden.
De afzonderlijke iOS-glass-evidence-job compileerde de meetapp en genereerde screenshots.
Alleen upload-artifact faalde bij `ArtifactService/CreateArtifact` na vijf pogingen
met `Request timeout`. De al toegestane ene jobherhaling had dezelfde uitkomst:
compilatie/screenshotgeneratie geslaagd, artifactupload mislukt. Niet opnieuw gestart.

De uploader van uitsluitend deze meetapp-job is bijgewerkt van v4 naar op commit gepinde
v7 (Node 24), met een expliciete fout als bestanden ontbreken. Pad, bewaartermijn en
foutstatus blijven intact. Dit bewijst nog niet dat de GitHub-service-timeout is opgelost;
de uploaduitkomst van de nieuwe PR-check moet dat afzonderlijk aantonen.
[PR #281](https://github.com/rjgout/Versado.app/pull/281) bevat relevante Node24-updates,
maar mist deze later toegevoegde meetapp-job. Die PR is niet overgenomen of gemerged;
de werkende signing-/releaseworkflow is in dit herstel niet gewijzigd.

## Backend en veilige eigenaarscontrole

De bestaande alleen-lezen controle slaagt:
`node --use-env-proxy scripts/native/check-test-backend.mjs https://api-test.versado.app --profile store-test`.
Dit bevestigt het geadverteerde contract en de geteste beveiligingsgrenzen, geen
geauthenticeerde cursuswerking of werkelijk draaiende image-revisie. De reparatie
vergt zowel de nieuwe lokaal gebundelde transportpolicies als de nieuwe backendcode.

Directe NAS-toegang is hier niet beschikbaar. De eigenaar kan het reeds voorbereide,
alleen-lezen script op de NAS uitvoeren met de twee bestaande DEV-containernamen:

```sh
sh scripts/native/check-dev-backend-readonly.sh DEV_APP_CONTAINER DEV_PROXY_CONTAINER
```

Het leest image-references, RepoDigests, OCI-revisies, aanwezigheid van de audiomount
en uitsluitend aantallen bekende `bron weggelaten`-redencategorieën uit bestaande logs.
Het toont geen container-environment, ruwe logs, bronpaden of audiobestanden en doet
geen pull/restart/deployment. Ontbrekende diagnostiek bewijst geen audiobeschikbaarheid.

Ter vergelijking: voor ce2830aa publiceerde groene DEV-run 44409470099:

- app `ghcr.io/rjgout/jehova-app@sha256:00bce56ac145efdaadd4159a9fc8729fe65afaff7b02a6423287366764d890c2`
- proxy `ghcr.io/rjgout/jehova-proxy@sha256:14550cb3ac7dfc1dd545448af5842d1a324ab356b3e6a7a08fd53d3fe1645096`

Dit zijn gepubliceerde digests, geen vastgestelde NAS-digests, en zij bevatten deze
nieuwe backendreparatie nog niet. Na goedgekeurde integratie moet de eigenaar de nieuw
gepubliceerde exacte app/proxy-digests vergelijken met de draaiende containers.
Bewaar vóór een eventuele uitrol de huidige image-references/digests als rollbackpaar;
geen database- of audiowijziging is voor dit herstel nodig. Uitrol en rollback blijven
eigenaarsbesluiten. De concrete audio-reden is zonder zijn lokale uitvoer onbekend;
geen opname, hashcontrole of publicatierecht is aangepast.

## Vrijgavevoorwaarden

Lokale resultaten en exacte-head CI staan in de PR-beschrijving. Groene bestaande
checks blijven vereist, inclusief afzonderlijke compile-, screenshot- en uploadstatus.
Onafhankelijke review en expliciete toestemming blijven vereist vóór merge.
Voor signing blijft NO-GO totdat die checks, de backenduitrol/digestcontrole en de
releasevoorwaarden bevestigd zijn. Pas bij een echte toegestane distributierun wordt
het dan geldige unieke buildnummer gekozen; er is geen buildnummer gereserveerd.
