# Fase 1F — Mysterie: persistente pogingen en oorspronkelijke uitgave

## Beginsituatie en scope

Basis: `origin/main` op `058468c`, inclusief de gemergede PR #92 (fase 1E).
De actuele instructies, Mysterie-definities/manifesten, gameavailability,
contentrechten, voortgang, hints, centrale reeksregel en bestaande tests zijn
onderzocht. Dit werk beperkt zich tot Mysterie 001–006 × Ontdekker,
Onderzoeker en Schriftkenner: **18 bestaande varianten**.

Bevestigde oorzaken:

- `MysteryProgress` bewaart resultaten en tutorialstatus, geen onafgemaakte
  bordindeling. Plaatsingen, undo en aangevinkte aanwijzingen stonden in React.
- `canUseMysteryNumber()` en de speelpagina controleerden steeds de huidige
  profielbron. `mysteryReaderHref()` gebruikte eveneens die veranderlijke bron.
- `consumeMysteryHint()` verlaagde wel de centrale voorraad conditioneel,
  maar koppelde de betaling niet aan een poging of actie-ID. Completion nam
  het clientveld `hintCount` over.
- De echte touch-browsertest bevestigde daarnaast dat pointerdown het personage
  selecteerde en de daaropvolgende klik het weer deselecteerde. Selectie bij
  een tap loopt nu uitsluitend via de klik; tijdens echt slepen via pointermove.

De oplossingen, hoofdstukken, fictieverhalen, personages, rastervormen, assets,
vooraf geschreven hints en slotvragen zijn niet gewijzigd. Eerdere uitsluitend
lokale, niet-gecommitte conceptontwerpen worden **niet** geïmporteerd. Geen 007+.

## Datastructuur en migratie

Migratie: `20261028120000_mystery_attempt/migration.sql`.

Nieuwe tabel `MysteryAttempt`:

- Eigen ID, `userId` → User, stabiele `mysteryId` en bestaande difficulty-enum.
- Verplichte `contentCollectionId` → ContentCollection, inclusief inverse relatie.
  `ON DELETE/UPDATE RESTRICT` beschermt historische bronverwijzingen.
- SHA-256 `definitionVersion` over definitie en character-clues. Een gewijzigde
  logische puzzeldefinitie wordt niet stilzwijgend onder een oude poging geopend.
- JSON-plaatsingen en clue-checkboxes; JSON `hintUses` met actie-ID, hintkey en UTC-tijd.
- Status IN_PROGRESS/COMPLETED, `active`, revisie, startactie-ID, laatste actiehash
  en aanmaak-/wijzigingsmomenten.
- Partial unique index `(userId, mysteryId, difficulty) WHERE active`.
- Unieke `(userId, startActionId)` en lookup-/bronindexen.

Er verandert geen bestaande kolom, ID, content-, cursus-, voortgangs- of
beloningssleutel. Geen backfill: vóór deze release bestaat geen betrouwbare
serverregistratie van onafgemaakte pogingen. Oude `MysteryProgress`-resultaten
worden niet herberekend. Gebruikersverwijdering volgt de bestaande Cascade-regel;
geen nieuwe bewaartermijnen of automatische garbage collection.

De DDL is één atomisch DO-statement met 5s lock- en 60s statement-timeout.
Een onverwacht reeds aanwezige tabel geeft `MYSTERY_ATTEMPT_REVIEW_REQUIRED`;
geen stilzwijgende reparatie of overschrijving. Herhaald **Prisma migrate deploy**
slaat de geregistreerde migratie over; los opnieuw uitvoeren van de SQL stopt
bewust voor beoordeling.

## Centrale service en API

`src/lib/mysteries/attempts.ts` is de enige schrijvende domeinservice.
`attemptContract.ts` bevat strikte Zod-requestvalidatie en variantafhankelijke
bordvalidatie. Alleen bestaande personages, bestaande cluekeys, gehele geldige
rastercoördinaten en geen dubbele celbezetting worden geaccepteerd.

`/api/mysteries/attempts`:

- GET met `variant`: uitsluitend de eigen actuele poging; geen creatie of mutatie.
- POST start: server bepaalt de gekozen uitgave, normale leesrechten,
  bestaande availability/scopes/settings, ontgrendeling en het echte bronhoofdstuk.
- POST save/hint/complete: poging-ID, `expectedRevision` en UUID `actionId`.
- Authenticatie vóór serviceaanroep, bestaande Origin/CSRF-controle en no-store.
  Clientvelden zoals userId, contentCollectionId en hintCount zijn verboden.
- 409 bevat alleen de actuele toegestane poging; bij bronintrekking geen bron- of
  hintinhoud. Interne databasefouten geven een herstelbare 503 zonder intern detail.

Lockvolgorde: **gebruiker → poging → historische voortgang**. Alle schrijfacties
vergrendelen dezelfde eigenaar in PostgreSQL. Daardoor worden ook gelijktijdige
creaties, hints, completion en saves op verschillende appinstances geserialiseerd.
De partial unique index blijft de onafhankelijke databasegarantie.

Iedere geslaagde schrijfactie verhoogt de revisie eenmaal. Een herhaalde laatste
save/complete met dezelfde UUID en identieke payload retourneert de bestaande
uitkomst; dezelfde UUID met een andere payload wordt geweigerd. Oude saves na
een nieuwere actie geven conflict en draaien de stand nooit terug.

Oude progress-GET-routes blijven eigen historische metadata leveren. Oude POST-
routes zonder poging/revisie geven 409: vernieuw de pagina. Zij kunnen geen hint
betalen, tutorial muteren of client-hintCount als voltooiingsbewijs gebruiken.
Dit is een bewuste beveiligingsgrens; er bestaat geen ongeregistreerde fallback.

## Nieuwe starts, hervatten en opnieuw spelen

Alle 18 speelroutes gebruiken `MysteryPlayPage` en dezelfde `MysteryClient`.
Een gewone serverpagina-GET maakt geen poging aan. De expliciet geopende
speelervaring start/hervat via één POST. Een bestaande actuele poging wordt
teruggegeven voordat nieuwe-startvoorwaarden worden toegepast.

Nieuwe starts gebruiken de bestaande fase-1D-adapter voor de vaste Mysterie-
content. Een geldige Boek-van-Mormon-uitgave wordt exact opgeslagen; geen
synthetische Nederlandse BOM-fallback bij een expliciet ongeldige voorkeur.
De bestaande vaste Nederlandse contentvoorwaarden voor nieuwe starts blijven
intact. Er zijn geen nieuwe speladapters.

Hervatten, saves, hints en completion gebruiken de **opgeslagen uitgave** en
normale leesrechten, ook voor administrators. Huidige profielbron/contenttaal,
gewijzigde GameSettings of verwijderde GameContentScope veranderen die poging
niet. Het hoofdstukadres komt uit Book.key + chapterStart + opgeslagen collectie.
Catalogus/detailpagina's laten een eigenaar zijn bestaande poging ook na een
profielbronwissel bereiken.

Bij verborgen, disabled of DRAFT-bronnen blijft de rij behouden. De response
bevat herstelbare pogingmetadata, lege bord-/cluegegevens, geen hinttekst en geen
leeslink. De client toont de beschikbaarheidsstatus. Na herstel van toegang kan
dezelfde poging weer verder; een beheerder krijgt geen impliciete previewrechten.

Wissen van het bord is een save binnen dezelfde poging: betaalde hints blijven
staan. Bewust herspelen vanuit het resultaat maakt een nieuwe poging; de oude
krijgt `active=false` en behoudt bord, status, bron en hintenaudit. Een retry van
de startactie maakt geen derde poging. Een oude/inactieve poging kan niets meer
muteren of voltooien. Historische resultaten en eerder verbruikte hints blijven
bewaard. `resume=completed` blijft een resultaatstap met de bestaande vrijblijvende
slotvraag, zonder automatisch een onafgemaakt bord te starten.

## Autosave en concurrency

`client/useAttempt.ts` gebruikt één seriële savewachtrij en 180ms debounce.
Plaatsingen en aangevinkte character-clues worden opgeslagen. Completion en een
hint wachten eerst op de laatste save. Terwijl een hint/controle verwerkt wordt
is de bordbediening inert. Er is geen nieuwe globale focus-, resume- of polling-
listener en geen tweede shell/scrollmanager.

- Alleen een bevestigde serverresponse toont **Opgeslagen**.
- Bij fouten verschijnt onopgeslagen status met retry.
- Unmount/pagehide probeert te flushen met keepalive; beforeunload waarschuwt
  wanneer er nog een dirty bord is.
- Een lokaal noodjournal is uitsluitend per gebruiker en poging voor nog niet
  opgeslagen borddata en dezelfde pending-saveactie. Geen lokaal saldo of
  betaalautoriteit. Een verloren save-response wordt met dezelfde actie herhaald.
- Een conflict houdt de lokale wijzigingen vast en stopt automatische writes.
  Pas expliciet bevestigen van “Nieuwere spelstand ophalen” vervangt het bord.
  Oude undo-geschiedenis wordt dan leeggemaakt.
- Undo blijft sessiegebonden; de laatst opgeslagen plaatsingen en checkboxnotities
  worden over toestellen hersteld. Oude React-state kan niet achteraf worden herleid.

Een toestel dat volledig offline wordt afgesloten kan niet naar een ander
apparaat synchroniseren. Het noodjournal bewaart die niet-bevestigde wijzigingen
op het oorspronkelijke toestel; de interface claimt daarvoor nooit serveropslag.

## Hintenaudit, economie en voltooiing

Iedere hint gebruikt uitsluitend `User.hintBalance`. Binnen dezelfde transactie:
owner/actieve poging/bron/revisie controleren → vooraf geschreven hint bepalen
uit het opgeslagen bord → conditioneel exact één debit (`hintBalance > 0`) →
één auditentry opslaan en revisie verhogen. Falen van enig onderdeel rolt alles
terug. Geen negatieve voorraad, inbegrepen hints, XP-aftrek of parallel saldo.

Een betaalde UUID blijft in `hintUses` bewaard. Retry na verloren response, een
latere save of afronding retourneert dezelfde hint plus actuele poging/voorraad,
zonder nieuwe betaling. Twee verschillende acties op dezelfde oude revisie
kunnen niet beide betalen. Een nieuwe vraag na completion wordt geweigerd.
Na commit volgt bestaande `hints_changed`; de client gebruikt `useHintInventory`
en `liveMutation`, gedeeld met winkel en andere spellen.

Completion toetst de **opgeslagen** oplossing op de server. Dezelfde transactie
rondt de poging af en past `MysteryProgress` alleen bij de eerste variantvoltooiing
aan. Het definitieve hintCount komt uit de audit, nooit de client. De bestaande
centrale activiteitkey `mystery:<id>:<difficulty>:first-completion` blijft behouden.
Retry, replay, tweede toestel en autosave kunnen geen extra reeksactiviteit maken.
Geen nieuwe XP-regel. Historische tutorialdatums en eerste resultaten worden bij
herspelen niet opnieuw geschreven. Ontgrendeling blijft eerste voltooide variant
van het vorige mysterie. De slotvraag blijft de bestaande vrijblijvende stap.

## Validatie en bewijs

Resultaten worden vóór oplevering hieronder vastgelegd met de werkelijk
uitgevoerde controles; CI controleert de exacte uiteindelijke PR-commit.

- Synthetische productiearchitectuur: 21 collecties/7 werken/28 accounts/37 FSY-
  lessen plus voortgang, annotaties, podcasts, beloningen en spellen; geen productie-
  persoonsgegevens. Fingerprints over alle 133 bestaande tabellen vóór/na nieuwe
  DDL zijn gelijk, inclusief oude MysteryProgress-hintCount en tutorialdatum.
- Afgebroken transactie en onverwachte tabel: oude data/schema blijven intact.
  Herhaald migrate deploy: geen open migraties, geen backfill of extra records.
- Alle 18 varianten: unieke identiteit, manifest/raster, board- en personageassets,
  oplossing, clues, vooraf geschreven hints, slotvraag en bronreferentie gecontroleerd.

| Controle | Werkelijk resultaat |
|---|---|
| Mysterie-unit/asset-/manifest-/oplossingstests | 44 geslaagd; alle 18 varianten |
| Mysterie echte HTTP + PostgreSQL | 11 scenario’s geslaagd, inclusief 18 variantstarts/hervatten, transactierollback, revision-/hint-/completionraces |
| Migratiebehoud | 133 bestaande tabellen ongewijzigd; abort, conflicterende tabel, bron-FK en herhaald deploy gecontroleerd |
| Productiebuild Chromium | 320×844, 390×844, 1280×900; licht/donker; 320px ook 200% tekst; touch en toetsenbord; 7 flowrecords en 11 screenshots; 0 browserfouten |
| Bestaande content-/course-/studiecontext-/picker-/availability-integraties | 132 geslaagd |
| Kompas, tijd, leervoortgang, reeksherstel en kalender op eigen DB | 69 + 29 + 26 + 52 + 1 geslaagd; geen definitieve skips |
| Contentaccess/edities/routing/leerregels/centrale reeks/admin-unitregressies | 66 geslaagd |
| Live-data / Focus-shell | 51 / 22 geslaagd |
| Studiecontext/hintselectie/Genees-economie-unitregressies | 12 geslaagd |
| Prisma validate/generate, TypeScript, schone productiebuild | Geslaagd |
| ESLint | 0 fouten; 133 bestaande waarschuwingen; geen waarschuwingen in nieuwe Mysterie-code/tests |
| i18n | Nieuwe meldingen in alle vijf talen; 3543/3961 per aanvullende taal, 418 bestaande ontbrekende sleutels |
| Availability-querybudgetten | 16/7/8/5 voor contextvarianten en 5/3 voor toegestane/geweigerde puzzelstart; behouden |
| GitHub Actions | Exacte gepushte commit en CI-artifact worden op de concept-PR gecontroleerd; die checks blijven een mergevoorwaarde |

Aanvankelijk werden 9 Kompas- en 9 tijdintegraties in de losse commando’s zonder
DB overgeslagen. Beide suites zijn vervolgens op de eigen PostgreSQL opnieuw
uitgevoerd: 69/69 en 29/29, zonder skips. De oude leesintegratie verwachtte geseede
hoofdstukken en een onbekende werkidentiteit zonder ContentWork-relatie. Er is een
uitsluitend synthetische lees-/oefenfixture toegevoegd; de test maakt zijn eigen
OTHER-werk nu expliciet aan en ruimt dit op. Geen seed of applicatielogicawijziging.

De browser controleert drie plaatsingen en checkboxnotities na refresh en een
nieuw browsercontext, inclusief bronwissel; twee gelijktijdige toestellen;
expliciet laden na conflict; netwerkfout en retry; verloren betaalresponse zonder
extra debit; verloren saveresponse met noodjournal; completion, `resume=completed`
en nieuw herspel met behoud van het historische resultaat. Bij desktoprefresh
mag de oorspronkelijke scrollpositie worden hersteld; de layoutmeting bovenaan
wordt afzonderlijk geregistreerd en verandert geen app-scrolllogica.


Screenshots komen uit de echte Next.js-productiebuild en worden buiten Git
bewaard in `/tmp/versado-mystery-browser`, als CI-artifact
`mystery-persistence-browser`. Er worden geen productieaccounts gebruikt.
Echte iOS-/Android-apparaten en Capacitor-installaties zijn niet geclaimd.

Kompas gebruikt de bestaande speluitleg; Mysterie-uitlegversie wordt 2.
Nieuwe opslag-, conflict- en beschikbaarheidsmeldingen plus speluitleg zijn in
nl/en/de/fr/es toegevoegd. Geen wijziging van de contenttaal door UI-vertaling.

## Uitrol en rollback

1. Review de concept-PR, DDL, databehoudbewijs en exacte groene CI-commit.
2. Een afzonderlijk mergebesluit en expliciete toestemming voor uitrol zijn nodig.
   **Synology voert migrate deploy automatisch uit bij containerstart.** Een merge
   of image-update is dus geen vrijblijvende codepreview.
3. Eigenaar controleert de actuele Hyper Backup-job en recente backupdekking voor
   database/media. De aanvullende geïsoleerde productieherstelproef is eerder
   expliciet overgeslagen; onafhankelijke herstelbaarheid blijft onbewezen.
4. Plan een rustig uitrolmoment. De nieuwe tabel is leeg, geen backfill/seeds/imports.
   Bij DDL-timeout/conflict: niet retryen met een ongeteste handmatige reparatie;
   stop en beoordeel migratiestatus. DDL faalt atomair.
5. Na toegestane uitrol: gezondheid/startlog, nieuwe poging, refresh/hervatten,
   originele editie na bronwissel, één hintbetaling, completion/replay controleren.
6. Applicatierollback naar de vorige image kan de additieve tabel laten bestaan.
   **Oude Mysterie-code slaat niet op en betaalt hints zonder pogingenaudit.**
   Zet Mysterie daarom tijdelijk uit voor nieuwe starts bij zo'n rollback en gebruik
   niet ongemerkt de oude hintflow. Bewaar alle nieuwe pogingen en hintenaudit;
   forward-fix heeft de voorkeur. Geen tabellen verwijderen of hints opnieuw crediteren.

Deze opdracht voert geen productiequery, migratie, backup, import, merge of deploy
uit. Fase 1F kan pas operationeel worden afgesloten na PR-review, afzonderlijke
merge-/uitroltoestemming en productieacceptatie. De overige fase-1-functionaliteit
blijft buiten wijzigingen aan spelregels of bronnen; latere contentfasen en nieuwe
mysteries blijven buiten scope.

## Gewijzigde bestanden

- `.github/workflows/content-access.yml`
- `docs/content-architecture-v2/12-PHASE-1F-MYSTERY-PERSISTENCE.md`
- `package.json`
- `prisma/migrations/20261028120000_mystery_attempt/migration.sql`
- `prisma/schema.prisma`
- `scripts/content-architecture/test-access-isolated.mjs`
- `src/app/api/mysteries/001/hint/route.ts`
- `src/app/api/mysteries/001a/progress/route.ts`
- `src/app/api/mysteries/001b/progress/route.ts`
- `src/app/api/mysteries/001c/progress/route.ts`
- `src/app/api/mysteries/002/[variant]/progress/route.ts`
- `src/app/api/mysteries/002/hint/route.ts`
- `src/app/api/mysteries/[mystery]/[variant]/progress/route.ts`
- `src/app/api/mysteries/[mystery]/hint/route.ts`
- `src/app/api/mysteries/attempts/route.ts`
- `src/app/mysteries/001a/play/page.tsx`
- `src/app/mysteries/001b/play/page.tsx`
- `src/app/mysteries/001c/play/page.tsx`
- `src/app/mysteries/002a/play/page.tsx`
- `src/app/mysteries/002b/play/page.tsx`
- `src/app/mysteries/002c/play/page.tsx`
- `src/app/mysteries/003a/play/page.tsx`
- `src/app/mysteries/003b/play/page.tsx`
- `src/app/mysteries/003c/play/page.tsx`
- `src/app/mysteries/004a/play/page.tsx`
- `src/app/mysteries/004b/play/page.tsx`
- `src/app/mysteries/004c/play/page.tsx`
- `src/app/mysteries/005a/play/page.tsx`
- `src/app/mysteries/005b/play/page.tsx`
- `src/app/mysteries/005c/play/page.tsx`
- `src/app/mysteries/006a/play/page.tsx`
- `src/app/mysteries/006b/play/page.tsx`
- `src/app/mysteries/006c/play/page.tsx`
- `src/app/mysteries/page.tsx`
- `src/components/mysteries/Mystery001aClient.tsx`
- `src/components/mysteries/MysteryDetailPage.tsx`
- `src/components/mysteries/MysteryPlayPage.tsx`
- `src/lib/i18n/messages/de.ts`
- `src/lib/i18n/messages/en.ts`
- `src/lib/i18n/messages/es.ts`
- `src/lib/i18n/messages/fr.ts`
- `src/lib/i18n/messages/nl.ts`
- `src/lib/kompas/registry.ts`
- `src/lib/mysteries/attemptContract.ts`
- `src/lib/mysteries/attempts.ts`
- `src/lib/mysteries/client/useAttempt.ts`
- `src/lib/mysteries/hints.ts`
- `src/lib/mysteries/legacyRoute.ts`
- `src/lib/mysteries/progress.ts`
- `tests/fixtures/mystery-learning.mjs`
- `tests/fixtures/mystery.ts`
- `tests/game-availability.integration.test.ts`
- `tests/learning-progress.integration.test.ts`
- `tests/mystery-attempt-migration.mjs`
- `tests/mystery-attempt.browser.mjs`
- `tests/mystery-attempt.integration.test.ts`
- `tests/mystery-attempt.test.ts`
