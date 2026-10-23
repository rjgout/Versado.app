# Contentbeheer V2: veilig laden, versies en uitrol

Hoofdregel: een contentupdate mag nooit schade veroorzaken aan bestaande content, gebruikersvoortgang of lopende leeractiviteiten.
Wat niet gewijzigd is, wordt niet opnieuw aangemaakt.

Dit document is de bron van waarheid voor het contentbeheer. Het beschrijft de audit (wat bewezen en wat vermoed is), de regels die nu
gelden, wat er nog komt en wat er bij de uitrol hoort. De gebruikersgerichte stappen staan in `README.md` en `docs/DEPLOY-SYNOLOGY.md`.

## 1. De huidige keten (feitelijk)

`/adminbackend/systeem` → `ReseedClient` → `POST /api/admin/reseed` → `startReseedJob` (`src/lib/reseedJob.ts`, één in-memory job per
proces) → `runSeed` (`src/lib/seed.ts`). `npm run db:seed` roept dezelfde `runSeed` aan. De knop heet in de interface "Content opnieuw
laden" en is dus **niet** alleen "nieuwe content ophalen": `runSeed` doet, in deze volgorde, alles:

1. optioneel studiecontent (CFM-concepten, alleen na snapshotgoedkeuring);
2. Boek van Mormon (nl): verzen, hoofdstukken, **oefeningen**, cursussen (`importBooks` + `syncCourses`) en audiotijden;
3. Bijbel (OTB, alle talen): bron gepind in `scripts/otb/source-lock.json`, download of cache, daarna per hoofdstuk een transactie;
4. Leer en Verbonden, Parel van Grote Waarde en de Engelse/Duitse/Franse/Spaanse uitgaven: dezelfde `importBooks`, per collectie;
5. podcastoefeningen uit `prisma/podcastContent.ts` en `kastVanMormonContent.ts`, daarna de RSS-feeds (`syncPodcastFeed`);
6. FSY (`syncFsyContent`), kindercursus, introductiecursus, Genees-vragen, Slimste Heilige, prestaties;
7. audio spiegelen (`mirrorChapterAudio`, gedownload naar `AUDIO_DIR`).

Er is geen schakeling tussen "nieuwe aanvullende content" en "de Schriften opnieuw importeren".

## 2. Bewezen oorzaken

Gemeten op een wegwerpdatabase met de echte Nederlandse Boek-van-Mormon-bron (10.718 oefeningen) en reproduceerbaar met
`tests/content-import.integration.test.ts`.

| # | Klacht | Bewezen oorzaak |
|---|---|---|
| 1 | Ophalen duurt uitzonderlijk lang | Elke run schreef alles opnieuw: `importBooks` verwijderde **alle** oefeningen en maakte ze met nieuwe `randomUUID()`'s opnieuw aan (ook bij identieke bron), en `syncCourses` (≈ 4,4 s, 2.530 lessen herschreven) draaide na elke collectie opnieuw. De OTB-import opende per hoofdstuk een transactie voor ook ongewijzigde hoofdstukken. Zes Schriftcollecties herhaald: **108,7 s** op main (82,0 s eerste run). |
| 2 | Bijbel verdwijnt uit de contentkiezer | `scripts/otb/import-core.ts` (`upsertCollection`) zette bij **elke** run in de `update`-tak `enabled: true, visibleToUsers: false` (en naam, icoon, volgorde). Een door de beheerder vrijgegeven Bijbel werd dus bij elke reload weer verborgen. De gebruikerskeuze (`User.activeContentCollectionId`) werd niet overschreven; die valt bij een verborgen collectie bij lezen terug op de standaardbron. |
| 3 | Foutmeldingen bij het beantwoorden van cursusvragen | Een oefenset (`ExerciseSession.exerciseIds`, JSON met oefen-id's) verwijst naar `Exercise`-id's. Na een reload bestonden die id's niet meer: `submitExerciseSession` gaf `NOT_FOUND`. Gemeten: 10.718 van 10.718 id's vervangen bij identieke bron; het inleveren van een vóór de reload uitgedeelde set faalde. |

Bijkomende schade van dezelfde oorzaak (de `Exercise`-rij wordt met cascade verwijderd): de antwoordgeschiedenis (`ExerciseAttempt`),
de XP-bijschrijving per vraag (`ContentExerciseCredit`) en de koppeling aan lessen (`CourseLessonExercise`) verdwenen. Daardoor kon
dezelfde vraag na een reload opnieuw XP opleveren. Dezelfde vervang-patronen stonden in de podcast-, kinder- en introductie-importers.
Daarnaast overschreef de podcast-import bij elke run de titel van een bestaande aflevering met de plaatshouder "Aflevering N".

## 3. Vermoedens (niet bewezen)

- De ervaren duur op de NAS wordt mede bepaald door de download van de OTB-bron bij een lege cache, de podcastfeeds en het spiegelen van
  audio; die netwerkonderdelen zijn lokaal niet gemeten.
- Productiegegevens kunnen al verweesde open oefensessies bevatten van eerdere reloads. Dat is vast te stellen met
  `scripts/content-architecture/diagnose-content-integrity-readonly.mjs` (alleen lezen, zie §8).
- Een gedeeltelijk mislukte OTB-import blijft eerder aangevulde hoofdstukken laten staan (per hoofdstuk atomair); dat is veilig maar
  wordt nog niet als "gedeeltelijk" aan de beheerder gemeld (gepland, §6).

## 4. Wat deze wijziging (stap 1, beschermend) doet

Geen schemawijziging, geen migratie, geen nieuwe afhankelijkheid.

- **Stabiele oefen-identiteit** (`src/lib/exerciseSync.ts`, `prisma/importContent.ts`): een oefening is "dezelfde" als type, vers, vraag,
  geaccepteerde antwoorden, woordenbank en de *juiste* opties gelijk zijn. Dan blijven id, opties, antwoordgeschiedenis, XP-bijschrijving,
  lesplek en elke uitgedeelde oefenset intact. Afleiders (onjuiste opties) horen niet bij de identiteit: veranderen alleen die, dan
  worden de opties van dezelfde oefening vervangen. Orde, hint en bronvers worden zo nodig op hun plaats bijgewerkt.
- **Versies**: een inhoudelijk gewijzigde vraag (andere tekst of ander juist antwoord) is een nieuwe vraag met een nieuw id. De oude
  wordt **verwijderd als niemand haar kreeg of beantwoordde**, en anders **buiten gebruik gesteld** (status `RETIRED`, nooit meer
  uitgedeeld, niet gewist). Wie haar al in een open set kreeg, rondt haar nog af; haar antwoordgeschiedenis blijft bestaan. Alle
  gebruikers van oefeningen filteren op `APPROVED` (ook het uitdelen van een set, de beheerderstelling en de koppelingen van Stap voor stap), dus een buiten gebruik gestelde vraag verschijnt nergens meer; alleen de losse check- en hintroutes (`exerciseAccessWhere`) tonen haar nog aan wie haar in een eigen, nog open set heeft, zodat de tussentijdse feedback het inleveren niet tegenspreekt. Een gewijzigd
  antwoord wordt zo nooit stilzwijgend als dezelfde vraag behandeld.
- **Podcast-, kinder- en introductie-oefeningen**: dezelfde regel (`prisma/reconcileExercises.ts`), zonder "buiten gebruik"-status (die
  tabellen hebben die niet; hun voortgang hangt aan aflevering, verhaal of les). Een bestaande podcasttitel wordt niet meer door de
  plaatshouder overschreven.
- **Beheerinstellingen blijven**: de OTB-import maakt een ontbrekende collectie aan (verborgen), maar werkt een bestaande alleen aan in
  bronvermelding en werkidentiteit. `enabled`, `visibleToUsers`, `publicationState`, naam, icoon, volgorde en dus ook de actieve
  contentkeuze van gebruikers blijven zoals de beheerder ze zette, ook bij een mislukte import.
- **Sneller, zonder onnodig werk**: ongewijzigde oefeningen en OTB-hoofdstukken kosten geen schrijfactie of transactie; `syncCourses` slaat
  een ongewijzigde cursus over (geen tijdelijke volgorde, geen herschreven oefenkoppelingen) en draait in `runSeed` één keer na de
  overige collecties (en ook bij een fout halverwege) in plaats van na elke collectie. Zes Schriftcollecties herhaald: 108,7 s → 6,9 s.
- **Eén import tegelijk** (`src/lib/contentImportLock.ts`): `runSeed`, `db:import` en de OTB-CLI houden een advisory-lock op een eigen databaseverbinding vast; een
  tweede start (andere knop of terminal) stopt direct met een duidelijke melding. De lock vervalt vanzelf bij een crash.
- Na een import in hetzelfde proces wordt de oefenplan-cache gewist (`clearExercisePlanCache`).

## 5. Contentversies en audio (huidige stand)

- Tekst en audio hangen zo samen: `Chapter.audioUrl` (bron) en `Verse.audioStart` (begintijd per vers, uit `prisma/bomAudio*.json`),
  de hoofdstukkop-tijden en de lokale kopie via `mirrorChapterAudio`/`playableAudioUrl`. `importChapterAudio` slaat een hoofdstuk over als
  het aantal verzen niet meer klopt (er worden nooit tijdcodes op de verkeerde verzen gezet).
- Verzen worden op hun plaats bijgewerkt (id blijft, dus bladwijzers, markeringen en notities blijven).
- **Nog niet aanwezig**: een registratie van welke audio door een tekstwijziging verouderd is. Een gewijzigd vers laat `audioStart` van
  dat vers zoals het was. Het ontwerp daarvoor staat in §6 (stap 3); automatische regeneratie of verwijdering is uitdrukkelijk niet
  de bedoeling.

## 6. Wat nog komt (voorstel, wacht op akkoord)

Dit zijn architectuurkeuzes en worden daarom eerst voorgelegd.

**Stap 2 — twee gescheiden beheeracties (geen schemawijziging nodig voor de kern)**

- *Nieuwe content ophalen*: een eigen runner (`runContentUpdate`) met alleen de aanvullende bronnen (podcastfeeds en -oefeningen, FSY,
  CFM-concepten na snapshotgoedkeuring, kinder- en introductiecursus). Roept nooit `importBooks`, OTB, `syncCourses` voor Schriften of audio
  aan. Per bron een status (`ok`, `overgeslagen`, `fout`), duur, aantal toegevoegd/bijgewerkt/overgeslagen en foutmelding; een falende
  bron laat bestaande gepubliceerde content staan en maakt het eindresultaat "gedeeltelijk". Dezelfde lock.
- *Schriftbronnen bijwerken*: de bestaande Schriftimport achter een eigen, bewust uitgebreidere kaart. Drie stappen: **controleren**
  (droogloop: vergelijkt de repo-bron en de gepinde OTB-commit met de database, schrijft niets), **voorbereiden** (toont per boek/hoofdstuk
  de wijzigingen, de gevolgen voor oefeningen — behouden/nieuw/buiten gebruik — en voor audio) en **publiceren** met een
  bevestigingsstap. Aanbeveling: de bevestiging is een *planhandtekening* (hash van het berekende plan). De beheerder bevestigt precies dat
  plan; bij publiceren wordt het opnieuw berekend en alleen uitgevoerd als de handtekening klopt. Zo is geen aparte opslag van een
  "voorbereid plan" nodig. Bronversie: voor repo-content de inhoudshash per collectie, voor OTB de pin in `source-lock.json`. Geen nieuwe
  externe bron zonder vastgestelde licentie en herkomst.

**Stap 3 — audio-afhankelijkheden (schemawijziging, daarom apart akkoord)**

Aanbeveling: een klein model `ChapterAudioCheck` (hoofdstuk, tekst-hash op het moment van de laatste goedgekeurde audio, status
`CURRENT | NEEDS_REVIEW`, tijdstempel). Een import vergelijkt de tekst-hash per hoofdstuk; alleen bij een echte tekstwijziging wordt het
hoofdstuk `NEEDS_REVIEW` (met onderscheid naar tijdcodes, transcripties en woordmarkeringen waar die bestaan). Bestaande audio blijft
afspeelbaar; vervanging wordt eerst gevalideerd (aantal verzen, tijdcodes oplopend) en pas daarna omgezet. Geen nieuwe audio-engine.
Alternatief zonder schema: de controlekaart toont alleen het manifest per run (niet blijvend). Voorkeur: het model, omdat de status
anders na elke herstart verloren gaat.

**Stap 4 — gedaan (goedgekeurd):** `ContentStatus.RETIRED` is de aparte status voor buiten gebruik gestelde oefeningen (migratie
`20261127120000_content_beheer_v2`, `ALTER TYPE … ADD VALUE`, achterwaarts compatibel). `REJECTED` blijft uitsluitend "handmatig afgewezen".

## 7. Wanneer gebruik je wat

- **Nieuwe podcastaflevering, FSY-les, kinder- of introcontent**: de normale reload (en, zodra stap 2 er is, *Nieuwe content ophalen*).
  Ongewijzigde content wordt overgeslagen; herhaald uitvoeren verandert niets.
- **Eenmaal per jaar of bij een officiële tekstrevisie**: *Schriftbronnen bijwerken* (stap 2). Tot dan raakt een gewone reload de Schriften
  alleen aan voor zover de bron in de repo is gewijzigd, en dan veilig volgens §4.
- **Nooit** een reload als herstelmiddel voor gebruikersproblemen: dat is niet nodig en is nu ook niet meer destructief.

## 8. Uitrol en herstel

Dit raakt bestaande gebruikersgegevens: behandel het als productiegevoelig. Er is geen productie-import of -herstel uitgevoerd.

1. **Back-up vooraf**: `pg_dump` van de productiedatabase (zie README, Back-ups) en bewaar het bestand buiten de container.
2. **Alleen lezen controleren** (vóór en na): `node scripts/content-architecture/diagnose-content-integrity-readonly.mjs --confirm-readonly`.
   Toont, zonder persoons- of tekstgegevens, het aantal verweesde open oefensessies, oefeningen buiten gebruik, lessen zonder oefeningen,
   en actieve contentkeuzes op een onbeschikbare collectie. `GEEN_BEKENDE_SCHADE` is de gewenste uitkomst.
3. **Compatibiliteit**: geen migratie; de nieuwe code werkt op de bestaande database. De eerste reload na uitrol vergelijkt de bestaande
   oefeningen met de gegenereerde (zelfde generator, deterministisch): wat gelijk is wordt behouden (gemeten: 34.661 van 34.661 bestaande
   oefeningen behouden). Alleen wat in de bron werkelijk anders is, wordt geversioneerd; het logboek meldt de aantallen per collectie
   ("behouden / bijgewerkt / nieuw / buiten gebruik / verwijderd").
4. **Volgorde**: uitrollen (nieuwe container) → diagnose → pas daarna, met afzonderlijke toestemming, een reload → diagnose opnieuw.
5. **Herstel van al getroffen gebruikers**: een verweesde open set is alleen een verloren set: de gebruiker start de oefening opnieuw
   (de set wordt dan nieuw uitgedeeld; oude open sets verlopen vanzelf). Door eerdere reloads cascade-verwijderde
   antwoordgeschiedenis en XP-bijschrijvingen zijn **niet** uit de huidige database te reconstrueren; alleen een back-up van vóór die
   reload bevat ze. Een gerichte herstelroute (credits uit de back-up koppelen aan de nieuwe oefening met dezelfde inhoudshandtekening) is
   technisch mogelijk, maar wordt pas gebouwd na akkoord en na inzicht uit de diagnose.
6. **Rollback**: geen schemawijziging, dus terug naar de vorige image is genoeg. Buiten gebruik gestelde oefeningen (`RETIRED`) worden
   door de oude code ook niet uitgedeeld; er is dus niets terug te draaien. Houd na de uitrol de back-up uit stap 1 aan tot de eerste
   reload veilig is bevestigd.
7. **Verificatie na uitrol**: `/api/health`, de diagnose (stap 2), een tweede reload (logboek meldt overal "0 nieuw, 0 verwijderd"), de
   contentkiezer (Bijbel nog zichtbaar zoals ingesteld) en een testgebruiker die een oefenset uitdeelt vóór en inlevert ná een reload.

## 9. Hoe herken je als beheerder een fout of gedeeltelijke update

- De job eindigt met `status: "error"` en een foutmelding met de fase tussen haakjes (`[Boeken]`, `[Bijbel (OTB)]`, `[Cursussen]`, …):
  alles vóór die fase is wel doorgevoerd en veilig (per stap atomair), alles erna niet.
- Een melding "Er loopt al een contentimport" betekent dat een andere import (knop of terminal) actief is; wacht en probeer opnieuw.
- Het logboek eindigt met "Seed klaar." alleen bij een volledig geslaagde run. Zonder die regel is de update niet volledig.
- Per collectie meldt de log: `Oefeningen: N ongewijzigd behouden, … nieuw, … buiten gebruik gesteld, … verwijderd` en
  `Verzen: … nieuw, … gewijzigd, … verwijderd`. Een herhaalde run met dezelfde bron toont overal 0.

## 8. Beheerkaarten (Adminbackend → Systeem)

Twee afzonderlijke kaarten, beide onder de importlock (`withContentImportLock`) en beide met een logboekrij in `ContentUpdateRun`:

- **Nieuwe content ophalen** (`/api/admin/reseed`, `reseedJob.ts`): `runSeed(..., { scriptures: false })`. Podcasts, FSY, Bijbel (OTB, gepind), CFM-concepten,
  kindercursus, introductie, Genees, De Slimste Heilige en achievements. De Schriftteksten, hun oefeningen en audio blijven onaangeroerd. De CLI
  `npm run db:seed` doet nog steeds alles.
- **Schriftbronnen bijwerken** (`/api/admin/scripture-update`, `contentUpdate.ts`, `scriptureUpdateJob.ts`), drie stappen:
  1. *Controleren*: droogloop (`importBooks({ dryRun: true })`) per bron uit `SCRIPTURE_SOURCES`; schrijft niets naar content, alleen een logrij.
  2. *Voorbereiden*: dezelfde droogloop, maar bewaart het plan en geeft een `planHash` (sha256 over de tellingen en de gewijzigde hoofdstukken). Bij een
     fout in een bron wordt geen handtekening gegeven.
  3. *Publiceren*: alleen met een `planHash` van een geslaagde voorbereiding. Onder de lock wordt het plan opnieuw berekend; wijkt de hash af
     (bronnen of database veranderd), dan wordt er niets geschreven (`PLAN_CHANGED`). Daarna per bron een eigen resultaat; één fout stopt de andere bronnen
     niet maar maakt de run `PARTIAL`/`FAILED`. Cursussen worden één keer na alle bronnen gesynchroniseerd.
  Het gaat om een in-memory job (zoals `reseedJob.ts`); de kaart toont de voortgang met `useLiveQuery` en leidt het voorbereide plan af uit het logboek, dus het
  overleeft een herlaad.
- **Audio ter controle** (`/api/admin/audio-checks`): hoofdstukken met `ChapterAudioCheck.status = NEEDS_REVIEW` (tekst veranderd). Audio blijft afspeelbaar en
  wordt nooit verwijderd. Een beheerder bevestigt per hoofdstuk expliciet (`markAudioCurrent`); nieuwe, gevalideerde audiogegevens zetten het hoofdstuk ook weer op CURRENT.
- Beperking: de gepinde OTB-bron wordt niet in de droogloop vergeleken (dat vraagt een download). Die blijft in *Nieuwe content ophalen*.
- Extra schemabesluit: het model `ContentUpdateRun` (alleen contentgegevens, geen persoonsgegevens) is toegevoegd voor het logboek; zonder dat model gaat de status na een herstart verloren.
- Getest met `tests/content-update.integration.test.ts` (droogloop schrijft niets, handtekening stabiel, verouderd plan geweigerd, alleen het gewijzigde
  hoofdstuk krijgt een audiomarkering, audio en beheerinstellingen blijven, tweede identieke update zonder wijzigingen, lock bezet).
