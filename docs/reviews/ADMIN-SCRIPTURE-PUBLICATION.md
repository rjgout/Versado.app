# Gecontroleerde Bijbelpublicatie in het bestaande beheer

## Oorzaak en bestaande architectuur

`enabled`, `visibleToUsers` en `publicationState` zijn onafhankelijke voorwaarden. De OTB-import bewaart bestaande instellingen en maakt nieuwe collecties als concept. De bestaande pagina Content beheerde alleen inschakeling van de kiezer en zichtbaarheid. De bestaande actie ‘Schriftbronnen bijwerken’ controleert/importeeert bronupdates, maar publiceert geen `ContentCollection`. Daardoor kunnen tien zichtbare, ingeschakelde conceptuitgaven terecht ontbreken in beide gebruikerscatalogi.

De centrale regels in `contentAccess.ts` blijven ongewijzigd: normaal gebruik vereist `LEGACY`/`PUBLISHED`, een geldige werkrelatie en een ingeschakelde collectie; gewone gebruikers hebben bovendien zichtbaarheid nodig. Beheerpreview is een afzonderlijk recht. Studie-/CFM-publicatie gaat over andere modellen en wordt niet aangepast.

## Gerichte uitbreiding

In **Adminbackend → Content → Content**, onder de bestaande zichtbaarheidsschakelaars, staat ‘Schriftuitgaven publiceren’. Per OTB-uitgave ziet de beheerder werk, naam, taal, beide instellingen, publicatiestatus, controletellingen en blokkeerredenen. Publiceer één gecontroleerd concept of selecteer gecontroleerde concepten per Testament. De bevestiging noemt precies de gekozen uitgaven en de gevolgen van hun bestaande zichtbaarheid.

De actie schrijft uitsluitend `ContentCollection.publicationState = PUBLISHED` en een afgeronde registratie van het nieuwe type `SCRIPTURE_RELEASE` in het **bestaande** `ContentUpdateRun`-logboek. De additieve enum-migratie publiceert niets. Identiteiten, teksten, instellingen, cursussen, oefeningen, audio en gebruikersvoortgang blijven staan. Er komt geen tweede CMS, import, audiopublicatie of algemene concept-vrijgave.

## Controlebewijs en publicatievoorwaarden

`scripts/otb/publication-evidence.json` bevat tien verwachte tekstdigests en tellingen uit de bestaande gepinde OTB-commit. Het bevat geen Bijbeltekst. Reproduceren:

```sh
node --import tsx scripts/otb/build-publication-evidence.mjs /pad/naar/schone-gepinde-checkout
```

De generator vereist een schone Git-checkout op de exacte bestaande source-lock, leest de upstreamlicentie (CC BY-SA 4.0) en gebruikt de bestaande OTB-parser, boekmapping en vijf-talige bronvalidator. Er moet een identieke canonieke structuur zonder gemelde problemen zijn, met 39/27 boeken en 929/260 hoofdstukken. De digest omvat alle boekidentiteiten, titels, volgordes, hoofdstukken, versnummers en genormaliseerde teksten die de bestaande importer schrijft. Dit is een tekst-/structuurcontrole, geen onafhankelijke theologische beoordeling van de vertaling.

De server controleert uitsluitend de tien expliciete OTB-collectie-identiteiten. Werk, SCRIPTURE-type, taal, editie, bron-URL, bronvermelding en licentie moeten overeenkomen. Aantallen en alle tekst-/structuurvelden van de importer moeten exact het bronbewijs volgen. Extra hoofdstukkoppen worden geweigerd: de OTB-importer levert hiervoor geen geverifieerde tekst. Andere uitgaven kunnen niet via deze actie worden vrijgegeven. Een afwijking wordt gemeld, niet automatisch gerepareerd. Een latere bronupdate vereist opnieuw gegenereerd, gereviewd bewijs; gewijzigde inhoud kan nooit met oud bewijs worden vrijgegeven.

Voorcontrole levert een token over metadata, tekst, structuur en database-identiteiten. Bevestiging leest alles opnieuw. Gewijzigde zichtbaarheid of inhoud maakt de bekeken bevestiging ongeldig. De server controleert actuele beheerdersrechten en sessieversie; de API vereist een adminsessie, toegestane Origin, begrensde JSON en een strikte selectie met expliciete bevestiging.

## Gelijktijdigheid, integriteit en herhaling

De hele selectie en het logboek worden in één bestaande Prisma-transactie verwerkt, met de normale transactielimiet. Het bestaande content-importslot wordt transactioneel gedeeld; een import en publicatie kunnen niet tegelijk plaatsvinden. Collecties, beheerder en werken worden op de benodigde rijen vergrendeld. Alleen tijdens de definitieve controle worden Book/Chapter/Verse kort in SHARE-modus vastgezet: zo kunnen ook onverwachte tekstschrijvers geen extra rijen tussen controle en commit invoegen. Een actieve tekstschrijver laat de actie direct veilig mislukken; gewone leesverzoeken en voortgangstabellen blijven beschikbaar. Er wordt geen timeout verhoogd.

Een conflict, incompleetheid, gewijzigd controletoken of fout betekent rollback van de volledige selectie, inclusief auditregistratie. Geen gedeeltelijke publicatie. Actie-ID plus actor en aanvraaghash maken een herhaald identiek verzoek tot een no-op; een andere selectie bij hetzelfde ID wordt geweigerd. De UI verstuurt na een onzeker antwoord nooit automatisch opnieuw, maar haalt de actuele status op.

Na succesvolle publicatie of een wijziging aan bestaande collectie-zichtbaarheid stuurt de bestaande Socket.IO-laag alleen het bestaande `contentChanged`-event. Web en native maken hun eigen cataloguscache ongeldig en halen opnieuw geautoriseerde gegevens op. Focus, hervatten, herladen en opnieuw inloggen blijven de bestaande verversingspaden gebruiken. Het event bevat geen tekst, selectie, gebruiker of rechten.

## Bediening door de eigenaar

1. Na onafhankelijke review, toestemming, merge en afzonderlijk goedgekeurde uitrol: open Adminbackend → Content → Content.
2. Open de sectie Content. Controleer per uitgave werk/taal, status en verificatieresultaten. Bij een blokkade: niet handmatig omzeilen; onderzoek de opgegeven afwijking.
3. Selecteer de gewenste geverifieerde concepten van Oude of Nieuwe Testament, of publiceer een afzonderlijke uitgave.
4. Lees de bevestiging en bevestig expliciet. Een al ingeschakelde, zichtbare uitgave wordt na publicatie meteen aangeboden; verborgen/uitgeschakelde uitgaven blijven dat.
5. Controleer de vernieuwde status. Bij een onderbroken aanvraag eerst opnieuw controleren; een aanvraag kan al verwerkt zijn.
6. Gebruik de **bestaande zichtbaarheidsschakelaar** om een gepubliceerde uitgave te verbergen of weer te tonen. Publicatiestatus, teksten en voortgang worden daarmee niet verwijderd of teruggezet naar concept.

Deze ontwikkeling voert geen van die eigenaarshandelingen op de draaiende backend uit.

## Native-lezer: afzonderlijke functionele uitbreiding

De web- en nativecatalogus gebruiken al `getContentPickerContext` en de centrale rechten. Publicatie maakt de juiste uitgaven selecteerbaar, met vijf talen en afzonderlijke werken voor Oude/Nieuwe Testament. Dat betekent niet automatisch dat iedere native-bestemming deze bron al ondersteunt.

`NativeLearningView.tsx` biedt de Schriftlezer uitsluitend aan voor het actieve werk `bofm`; `native/reader.server.ts` vereist bij het uitlezen nogmaals `work: "bofm"`, naast centrale leesrechten en cursus-/staprechten. Deze grenzen blijven in deze PR intact. De OTB-import maakt tekst, geen nieuwe cursussen of oefeningen; publicatie maakt die evenmin aan. Het bestaande cursusaanbod en bestemmingresolver bepalen dus of een gekozen uitgave een cursusbestemming heeft.

Een afzonderlijke OTB-lezerwijziging moet beide expliciete bofm-beperkingen vervangen door een gecontroleerd contract voor de ondersteunde Schriftwerken, met de bestaande cursus-/hoofdstuk-/stapselectie, selectieversie/ABA-controle en sessiehercontrole. Controleer daarbij de bestaande cursusplannen en boekidentiteit (`gen` … `rev`, tegenover `bofm/...`), hervatten/voortgangssleutels, annotaties, verwijzingen, alle vijf talen en veilige onbeschikbaarheid bij ontbrekende cursussen. Audio moet zijn eigen bestaande bronrechten en beschikbaarheidscontrole behouden. Geen booleaanse ‘alle werken’-vrijgave en geen tweede lezer. Dit wordt hier uitsluitend gerapporteerd, niet geïmplementeerd.

## Verificatie

De gerichte suite gebruikt de echte productiehandlers en de bestaande importer op een eigen Postgres-container, met de echte gepinde tekst van alle tien uitgaven. Er is geen productie-bypass of synthetisch goedkeuringsbewijs. Browserproeven gebruiken dezelfde productiebuild, echte admincookies, vijf talen, kleine iPhone-viewporten, 200% tekst, licht/donker, toetsenbord, focus en annulering/bevestiging. Exacte resultaten en CI-head worden in de draft-PR vastgelegd.

Aanvullend: de bestaande `syncCourses` kan Schriftcursussen voor andere collecties synchroniseren wanneer dat bestaande beheerpad bewust wordt uitgevoerd. Publicatie roept dit niet aan en verandert geen cursusplan of abonnement. Ontbrekende cursussen moeten dus via het bestaande cursusbeheer worden beoordeeld, niet stilzwijgend tijdens publiceren worden aangemaakt.

### Oorspronkelijke lokale controles op `0c1029a4`

Basis: `develop` op `a5eb9e16f210544ccc959a349bb680e9e55c7697`. Geen overlappende open PR voor deze publicatiebediening aangetroffen.

| Controle | Resultaat |
| --- | --- |
| `npm ci`, Prisma generate/validate, volledige TypeScriptcontrole | Geslaagd |
| Schone `npm run build` | Geslaagd |
| Gerichte ESLint | Geen fouten of waarschuwingen in de gewijzigde publicatiecode/tests |
| Volledige `npm run lint` | Geen fouten; 174 bestaande waarschuwingen |
| Beveiligingsbeleid + Prisma/Effect-regressies; productie-audit | Geslaagd; `npm audit --omit=dev --audit-level=high`: 0 kwetsbaarheden |
| Centrale contenttoegang/inventaris | 40 geslaagd |
| Bestaande OTB-tests | Geslaagd |
| Live-data/cachelaag | 57 geslaagd |
| Audio-contracten | 19 geslaagd |
| Annotaties | 56 geslaagd |
| Privacy-inventaris | 2 geslaagd |
| Native unit-/contract-/lokale distributiebundeltests en native-data | Geslaagd |
| iOS-release-/signingguards | 47 geslaagd, 1 bestaande macOS-specifieke proef niet uitvoerbaar op Linux |
| Android-releaseguards | 5 geslaagd, 1 bestaande signingproef niet uitvoerbaar zonder Android-signingomgeving |
| Native store-readinessguards en broninventaris | Geslaagd; geen signingrun of platformupload uitgevoerd |

De gerichte publicatiesuite omvat de echte importer/routehandlers, bronbewijs voor **330 boeken, 5.945 hoofdstukken en 155.515 verzen**, autorisatie/Origin/payload, incomplete/afwijkende tekst en identiteit, niet-geverifieerde extra hoofdstukkoppen, gewijzigd controletoken, twee beheerders, import-/tekstschrijverslot, auditfout met volledige rollback, idempotentie, verborgen/uitgeschakelde publicatie, één selectie van alle tien uitgaven en de bestaande web-/native-selectie heen/terug. Voor/na-fingerprints controleren **23 bestaande tabellen**, inclusief tekst, cursuskoppelingen, oefeningen, annotaties, voortgang en echte audiomodellen. Er worden ook een OTB-hervatpunt, privénotitie en legacy-audiometadata als behoudsfixtures gebruikt. Er wordt geen audiopublicatie aangemaakt.

Browserproeven: tien combinaties over alle vijf talen, 320/375/390/430 px, licht met normale tekst en donker met 200% tekst. Getest: geen horizontale paginaoverflow, semantische checkboxen/toetsenbordselectie, vijf uitgaven samen selecteren, bevestigingsdialoog/focus, Escape zonder mutatie, één echte bevestiging en blijvende status na herladen. Screenshots en JSON-resultaten staan in het CI-artifact `scripture-publication-browser`. Dit is browserbewijs, geen fysieke iPhone-/VoiceOver-acceptatie.

**Oorspronkelijke losse testfout, inmiddels hersteld:** op `0c1029a4` had `npm run test:content-picker` 47 geslaagde tests en één fout in `tests/navigation-departure.test.ts`. De synthetische `window` miste `history`, terwijl `currentEntryKey()` `history.state` leest. De fout is opnieuw bevestigd op de ongewijzigde develop-commit hierboven, met dezelfde Node/dependencies. Alleen de fixture is aangevuld met `history: { state: null }`, zoals een browser aanvankelijk aanbiedt. Productienavigatie en alle bestaande assertions zijn ongewijzigd. De suite slaagt nu met **48/48**; de bestaande Development-workflow voert de vertrektest voortaan expliciet uit.

Herhalen op eigen testomgeving, na `npm ci`, generate en productiebuild:

```sh
export OTB_PUBLICATION_TEST_SOURCE=/tmp/versado-otb-publication-source
node scripts/otb/prepare-publication-test-source.mjs
node scripts/content-architecture/test-access-isolated.mjs --focused --scripture-publication --browser
```

De bestaande runner start en verwijdert zelf de lokale Postgres-container. De bronvoorbereiding downloadt alleen de vastgepinde publieke Git-bron; de testimport gaat uitsluitend naar deze gecontroleerde wegwerpdatabase. De bestaande migratieproeven behouden hun synthetische records; hun onvolledige OTB-voorbeelden worden vóór de echte bronproef in eigen verborgen fixturecollecties ondergebracht. Er is geen onbetrouwbaar synthetisch publicatiebewijs of productie-override.

De draft-PR vermeldt de uiteindelijke head en actuele CI-status. Onafhankelijke review, eigenaarstoestemming en een apart goedgekeurde backenduitrol blijven nodig. Deze PR publiceert geen collectie op de draaiende backend en breidt de native-lezer niet uit.

Oorspronkelijke lokale ronde op `0c1029a4`: **18/18 gerichte tests en 10/10 mobiele browsercombinaties geslaagd**, inclusief de extra hoofdstukkopcontrole, echte bevestiging/herladen en de volledige afsluitende fixture-inventaris en beschikbaarheidsbenchmark. De aanvraag voor één atomaire selectie van tien uitgaven duurde lokaal ongeveer **1,45 seconde**; de bestaande Prisma-transactielimiet is niet verhoogd.


## Herstel na Native Foundation-run 45003946835

### Bewezen oorzaak en gerichte correctie

De productievolgorde was correct. `scripts/audio/test-isolated.mjs` stelt `20261127120000_content_beheer_v2` bewust uit om behoud van bestaande audio en latere toevoeging van Contentbeheer te toetsen. De nieuwe `20261209130000_scripture_release_audit` stond echter al in de eerste tijdelijke keten. Daardoor probeerde die `ContentUpdateKind` uit te breiden vóór de CREATE TYPE van Contentbeheer V2. De GitHub-job en een eigen lokale reproductie op de oorspronkelijke PR-head tonen dezelfde **P3018 / PostgreSQL 42704**.

De audioproef stelt nu ook de afhankelijke enumuitbreiding uit en past haar pas na Contentbeheer V2 toe. De bestaande Audio V2- en Contentbeheer-behoudscontroles blijven staan; na de enumuitbreiding worden de audiogegevens nogmaals gecontroleerd. Nieuwe SQL-asserties bewijzen achtereenvolgens: geen enum vóór Contentbeheer (ook na Audio V2), vier bestaande enumwaarden na Contentbeheer, en pas daarna `SCRIPTURE_RELEASE`. De schema-uitbreiding maakt geen beheeractie aan.

Daarnaast installeert dezelfde runner alle migraties zonder filtering op een tweede, lege database in de eigen container. Een tweede deploy moet een no-op zijn. De volledige en de gefaseerde installatie hebben exact dezelfde **172 migratienamen en checksums**. Geen historisch migratiebestand is aangepast, overgeslagen of verwijderd.

Andere gefaseerde runners zijn gecontroleerd:

- Contentarchitectuur: stelt ContentWork/studie-/native-/audiomigraties uit, maar houdt Contentbeheer V2 in de eerste keten; de enumafhankelijkheid is aanwezig. De volledige publicatie-/browserproef gebruikt deze runner opnieuw.
- Native: de fasen stellen authfoundation, security-setup en quizacties uit; Contentbeheer V2 blijft vóór de enumuitbreiding aanwezig. De volledige Native Foundation-CI herhaalt deze fasen op de nieuwe head.
- Dorp: stelt alleen `dorp_worlds` uit; Contentbeheer V2 is aanwezig. De afzonderlijke `--migration-only`-proef slaagt, inclusief bestaande rollback-, gegevens-, constraint- en indexverificaties.
- De vastgepinde main-upgradeproef heeft een expliciet gereviewde migratie-allowlist. Die is niet verruimd om develop-migraties stilzwijgend toe te laten; zij maakt geen deel uit van de relevante develop-PR-workflows.
- Overige geïsoleerde runners passen de volledige repositoryketen toe en stellen Contentbeheer V2 niet apart uit.

### Publicatieveiligheid en efficiëntie opnieuw toetsen

De productiepublicatielogica, bronbewijzen, toegangsregels en transactielimieten zijn in deze herstelronde niet gewijzigd. De gerichte suite herhaalt alle integriteits-, rollen-/sessie-, bulk-, concurrency-, idempotentie- en rollbackscenario’s en de behoudsfingerprints over 23 tabellen. Er is één extra alleen-lezen proef voor de volledige controle via de echte HTTP-routehandlers in de schone productiebuild, met alle tien echte uitgaven.

Vijf verse lokale GET-metingen over **155.515 verzen** gaven 2.323 / 1.600 / 1.321 / 1.468 / 1.430 ms: mediaan **1,47 s**, maximum **2,32 s**. Dit gebeurde terwijl de aparte audioproeven eveneens draaiden. De telling van de grootste editie duurde in een eigen `EXPLAIN ANALYZE` circa **19 ms** en gebruikte bestaande indexen op boeken, hoofdstukken en verzen. De volledige atomaire publicatie van tien uitgaven duurde circa **1,26 s**. Alle tekst-/structuurhashes en actuele rechten worden daarbij opnieuw gecontroleerd; er is geen goedkeuringscache of lichtere controle toegevoegd.

Dit zijn metingen van de werkelijke backendcode en volledige corpusgrootte op de geïsoleerde testmachine, **geen NAS-metingen**. Er is geen NAS-verbinding, productiequery of live publicatie uitgevoerd. De nieuwe route is nog niet door deze PR naar de NAS uitgerold. Conform het repositorybeleid voert de eigenaar de live controle uit; ontbrekende NAS-metingen zijn geen reden om een ontwikkel-PR te blokkeren of om controles te versoepelen.

Na een afzonderlijk goedgekeurde uitrol kan de eigenaar op de bestaande ingelogde Adminbackend-pagina uitsluitend de GET controleren, zonder publicatie of andere mutatie:

```js
(async () => {
  const started = performance.now();
  const response = await fetch("/api/admin/content-switcher/publication", {
    cache: "no-store", credentials: "same-origin"
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { editions } = await response.json();
  console.table({
    milliseconds: Math.round(performance.now() - started),
    editions: editions.length,
    verified: editions.filter(item => item.verified).length,
    publishableDrafts: editions.filter(item => item.canPublish).length
  });
})();
```

Dit logt alleen tellingen en duur, geen cookies, tokens, inhoud of gebruikersidentiteiten. Het gebruikt geen POST. Een langzame of mislukte controle rechtvaardigt geen publicatie zonder verse verificatie.

### Nieuwe verificatieronde

De lokale herstelronde is afgerond:

| Controle | Uitkomst |
| --- | --- |
| Volledige TypeScriptcontrole, schone productiebuild en gerichte lint | Geslaagd; geen nieuwe lintwaarschuwingen |
| Contentpicker inclusief ongewijzigde navigatie-assertions | 48/48 geslaagd |
| Navigatiefixture plus bestaande Development-pipelineguards | 13/13 geslaagd |
| Gefaseerde Audio V2-migratie, enumcheckpoints, volledige schone installatie, herhaalde deploy en checksumvergelijking | Geslaagd; 172 identieke migraties |
| Audio V2-library, officiële audio en legacy-integratie | 30 + 24 + 12 = 66 geslaagd; geen skips |
| Alle drie bestaande audiobrowsersuites | Geslaagd; geen browserexceptions |
| Dorp-migratieproef | Geslaagd, inclusief behoud en foutrollback |
| Gerichte publicatie- en bron-/beveiligingstests | 19/19 geslaagd; geen skips |
| Publicatiebeheer browsergevallen over vijf talen | 10/10 geslaagd, inclusief echte bevestiging en herladen |
| Afsluitende bron-/fixture-integriteit en beschikbaarheidsbenchmark | Geslaagd |
| Beveiligingsbeleid + Prisma/Effect; productie-audit | Geslaagd; 0 kwetsbaarheden |
| Native broninventaris en diffcontrole | Geslaagd |

De uiteindelijke nieuwe head en alle bijbehorende CI-resultaten worden in de bestaande draft-PR vastgelegd. Het eerdere resultaat op `0c1029a4` vervangt geen controle op de nieuwe commit. De PR blijft draft; onafhankelijk review-GO en eigenaarstoestemming blijven voorwaarden voor merge. Geen NAS-deployment, productiedatabasemigratie, Bijbelpublicatie of TestFlight-upload uitgevoerd. CFM en zijn integriteitscontroles zijn niet gewijzigd.
