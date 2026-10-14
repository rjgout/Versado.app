# Fase 2E — Expliciet markeren als gelezen

## Beginsituatie en vastgesteld hergebruik

Fase 2C bewaart een `ReadingPosition` per gebruiker en leseditie. Die positie
is bewust geen afronding: openen, scrollen, 100% bereiken, opnieuw laden,
ReferencePreview en Meer lezen schrijven geen `ContentProgress` en roepen geen
reeksservice aan. De bestaande hoofdstuklezer gebruikt `ContentProgress` voor
de zelfstandige `READING`/`READ`-status en `StreakActivity` plus
`recordLearningActivity()` voor een idempotente, centrale reeksactiviteit.

Dat bestaande model is voldoende voor studielessen. Daarom is er in fase 2E
geen Prisma-wijziging, geen backfill en geen nieuwe voortgangs- of
activiteitstabel. Een les krijgt een logische inhoudssleutel:

```
study:<workKey>:<periodId>:<sourceKey>
```

De sleutel hoort bij `StudyLesson`, niet bij `StudyLessonEdition` of
`StudyRevision`. Een taalwissel, heropening en nieuwe immutable revisie houden
dezelfde status. `periodId` voorkomt dat een hergebruikte bronkey uit een ander
programmajaar dezelfde inhoud wordt.

## Implementatie

`src/lib/studyContent/readStatus.ts` is de enige nieuwe schrijfservice. Bij een
bewuste actie gebeurt binnen één PostgreSQL-transactie:

1. vastzetten en normaal autoriseren van de actuele gepubliceerde leseditie;
2. vergrendelen van de gebruiker en de logische `ContentProgress`-sleutel;
3. claimen van `READ` zonder wijziging van oefen- of beloningsvelden;
4. claimen van `recordLearningActivity(kind=READING, key=read:<contentKey>)`.

De bestaande unieke `ContentProgress(userId, contentKey)` en
`StreakActivity(userId, key)` maken dit semantisch idempotent. Herhaalde
actionId's, dubbel tikken, twee apparaten en verloren responses krijgen de
opgeslagen READ-status terug; zij maken geen tweede activiteit. De service
geeft geen XP, munten, hints, spelbeloningen, cursusvoortgang of
`ReadingPosition` uit.

De lockvolgorde is editie (SHARE) → User (`FOR UPDATE`) → logische
voortgangs-advisorylock → de bestaande centrale reeksservice. Daarmee kan een
publicatiepointer niet tussen de rechtencontrole en de READ-claim wisselen.
Een technische transactiefout rolt zowel `ContentProgress` als
`StreakActivity` terug.

Een eerste actie vereist de actuele gepubliceerde revisie. Heeft een retry
inmiddels al een bestaande READ-status, dan wordt die uitsluitend teruggegeven,
ook na een publicatie-update. Dit herstelt een onzekere response zonder een
oude revisie alsnog als nieuwe eerste afronding te accepteren.

## API, privacy en rechten

`POST /api/study-read` accepteert uitsluitend `lessonEditionId`, `revisionId`
en een UUID `actionId`; er is geen client-`userId`, contentkey of bronrecht in
het contract. De route vereist sessie, de bestaande gebonden
`X-Reading-Session`, Origin/CSRF-controle, een begrensde body en retourneert
`Cache-Control: no-store, private` met `Vary: Cookie`.

Alleen normaal leesbare, gepubliceerde inhoud mag een nieuwe READ opleveren.
DRAFT, verborgen, disabled of ingetrokken collecties blijven voor gewone
gebruikers én admins via deze gebruikersroute gesloten. Bestaande persoonlijke
voortgang wordt nooit verwijderd wanneer toegang later vervalt; de route lekt
dan geen lesinhoud of andermans voortgang.

## Interface en reekservaring

`StudyReader` toont vóór afronding één duidelijke knop **Markeren als gelezen**
en vermeldt dat scrollen geen afronding is. Daarna verschijnt een rustige,
persistente gelezenstatus; de leespositie blijft apart bewaard en opnieuw lezen
blijft mogelijk. De bediening gebruikt bestaande Versado-knoppen, surfaces,
tokens en de Focus-shell; er is geen nieuwe toolbar of overlay.

De bestaande `streak_changed`-uitzending gebeurt pas na commit. De route
`/study-lesson/...` is al een activity-route, zodat de centrale
`celebrationGate` een eventuele reeksviering pas buiten de primaire
leesafronding toont. Een tweede actie heeft geen tweede kaart of activiteit.
Alle nieuwe teksten zijn toegevoegd voor nl, en, de, fr en es.

## Testbewijs

Uitgevoerd op een eigen PostgreSQL-container met alle bestaande migraties en
synthetische fixtures; geen productiegegevens, migratie of import gebruikt.

- 7 gerichte API-/integratietests: geen impliciete READ, expliciete atomische
  READ, retries/dubbel tikken/twee apparaten, auth/Origin/sessie/IDOR,
  revisiebehoud, verborgen bron en geforceerde transactierollback.
- 22 Chromium-productiebuildgevallen: 320px, 390px, desktop en landscape;
  licht/donker; 100%/200% tekst; vijf UI-talen en toetsenbord; herladen en
  netwerkretry. Geen horizontale overflow of browserfouten in die matrix.
- Een gecombineerde geïsoleerde regressieronde bevestigt daarnaast 14
  ReferenceResolver-integratietests, 27 ReferencePreview-browsergevallen, 15
  ReadingPosition-integratietests en 20 bestaande StudyReader-browserflows.
  Reader, preview en terugkeercontext blijven zonder impliciete READ,
  economie- of voortgangsmutatie samenwerken.
- Prisma-validatie/generatie, TypeScript, de i18n-structuurcontrole, de
  leer-, reeks- en tijdregressies en een schone productiebuild zijn uitgevoerd.
  ESLint eindigt zonder fouten; de repository heeft 136 bestaande warnings
  buiten dit werkpakket.
- De bestaande migratie- en inventarisatiebewijzen van 1A–2D draaiden mee in
  de geïsoleerde runner. De foutinjectie meldt bewust een PostgreSQL-fout in
  de testlog; de assertion bevestigt dat beide writes zijn teruggedraaid.

De bestaande contentarchitectuur-CI voert voortaan de expliciete-READ-
browsermatrix mee uit en bewaart zowel reader- als READ-screenshots als
artifact. Geen fysieke iOS/Android/Safari/Capacitor- of screenreadertest wordt
geclaimd.

## Performance, uitrol en rollback

Er is geen polling, extra globale listener, realtime-topic of schemaobject
toegevoegd. Een initiële readerweergave doet één gerichte voortgangslookup;
een markeeractie is één korte transactie met de bestaande reeksqueries. De
geïsoleerde availability-querybudgetten bleven in de gecombineerde ronde
binnen hun bestaande grenzen. Dit is geen productiemeting.

Omdat er geen schemawijziging is, voert deze fase bij deployment geen Prisma
DDL uit. De Synology-containerstart, merge en deployment blijven afzonderlijk
te beoordelen. Terugdraaien betekent de vorige appimage gebruiken; bestaande
`ContentProgress`- en `StreakActivity`-rijen blijven behouden en worden niet
verwijderd. De eerder geaccepteerde Hyper Backup-restorerisicoacceptatie is
ongewijzigd: er is geen onafhankelijke hersteltest uitgevoerd.

## Bekende grenzen

De adapter geldt uitsluitend voor de nieuwe `StudyReader` en actuele
gepubliceerde studielessen. Bestaande Schriftuurhoofdstukken en legacy-FSY
houden hun eigen, ongewijzigde routes. Een activiteit kan volgens de bestaande
centrale regels een reeksdag, terugkeerstatus of bestaande freeze-effecten
opleveren; fase 2E voegt daar geen XP-, munt- of eigen beloningsregel aan toe.

## Correctieronde na PR-review

De aanvullende review bevestigde dat de bestaande centrale
`celebrationGate` ook voor `/study-lesson/...` de juiste eigenaar is. Die route
is een activity-route: na een succesvolle READ blijft de rustige,
persistente gelezenstatus dus de primaire feedback. `streak_changed` ververst
wel de centrale reeksstatus, maar de provider claimt en toont een eventuele
reeksviering pas nadat de gebruiker de leesactiviteit verlaat. Zij komt
daarmee niet over deze bevestiging of boven een volgende activiteit te staan.
Er is geen nieuwe overlay, manager of eventbus toegevoegd.

De browsermatrix controleert nu expliciet de gelezenstatus zonder
reeksoverlay, maakt daarvan een screenshot en navigeert vervolgens naar
Vandaag om te bewijzen dat dezelfde centrale viering daar pas verschijnt.
De bestaande gate-regressie bevat daarnaast expliciet de StudyReader-route en
bevestigt dat een routewissel tussen activiteiten de viering nog steeds
uitstelt.

`StudyReader` bewaart een nog onzekere READ-actionId tabgebonden in
`sessionStorage`, met een sleutel die de sessie, leseditie en immutable
revisie bevat. Een netwerkfout of verloren response hergebruikt die UUID;
een bevestigde respons of definitieve 4xx-afwijzing ruimt alleen die context
op. Bij heropenen met een al opgeslagen READ-status wordt een eventueel oud
pending item voor precies die context eveneens opgeruimd. Een andere les,
revisie, sessie of apparaat kan de UUID niet hergebruiken. De server-side
logische `ContentProgress`- en `StreakActivity`-constraints blijven de
uiteindelijke idempotentiegarantie.

Nieuwe regressies dekken daarom een netwerkfout vóór verzending, een door de
server gecommitte request waarvan de response verloren gaat, dezelfde UUID bij
retry, de bevestigde centrale status zonder dubbele activiteit en isolatie
tussen les, revisie en sessie. De bestaande integratietests blijven de
parallelle/twee-apparaten- en transactierollbackgevallen dekken. De
correctieronde gebruikt uitsluitend de geïsoleerde testdatabase en geen
productiegegevens. Fysieke Safari-, iOS-, Android- en Capacitor-controles
blijven buiten deze geautomatiseerde browsermatrix.
