# Contentbeheer V2: veilig laden, versies en uitrol

Hoofdregel: een contentupdate mag nooit schade veroorzaken aan bestaande content, gebruikersvoortgang of lopende leeractiviteiten.
Wat niet gewijzigd is, wordt niet opnieuw aangemaakt.

Dit document is de bron van waarheid voor het contentbeheer. Het beschrijft de audit (wat bewezen en wat vermoed is), de regels die nu
gelden, wat er nog komt en wat er bij de uitrol hoort. De gebruikersgerichte stappen staan in `README.md` en `docs/DEPLOY-SYNOLOGY.md`.

## 1. De huidige keten

Adminbackend → Systeem heeft twee gescheiden beheerkaarten:

- **Nieuwe content ophalen** → `/api/admin/reseed` → `startReseedJob` → `runSeed(..., { scriptures: false })`.
  Dit verwerkt aanvullende content, met dezelfde bestaande bron- en snapshotgoedkeuringen. Schriftteksten, hun oefeningen,
  schriftcursussen, audio en vers-tijdcodes blijven buiten deze actie. De bestaande expliciete CFM-vrijgaveregels blijven gelden;
  deze scheiding introduceert geen toestemming voor andere automatische publicatie.
- **Schriftbronnen bijwerken** → `/api/admin/scripture-update` → controleren → voorbereiden → publiceren met planHash.
  Alleen deze bewuste actie kan de repo-Schriftbronnen bijwerken. Spiegelen van legacy-MP3's is een afzonderlijke bevestigde actie.

De CLI `npm run db:seed` blijft bewust de **volledige** seed inclusief Schriften uitvoeren; gebruik hem nooit als vervanging voor de
veilige aanvullende beheerkaart. Beide paden gebruiken de bestaande PostgreSQL-importlock. De zes uitsluitend voor Audio V2
verborgen tekstuitgaven worden nooit automatisch naar cursussen gepromoveerd.

De bevindingen in §2 betreffen de oorspronkelijke implementatie; huidige garanties en beperkingen staan hieronder.

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
- Een gedeeltelijk mislukte Schriftimport kan eerder gecommitte hoofdstukken behouden. De run meldt FAILED/PARTIAL; zie §6.

## 4. Wat deze wijziging (stap 1, beschermend) doet

De oorspronkelijke bescherming uit #184 had geen schemawijziging. Contentbeheer V2 voegt de additieve migratie uit §8 toe.

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

## 5. Contentversies en audio

Legacy-audio bestaat uit `Chapter.audioUrl`, hoofdstukkoptijden, `Verse.audioStart` en lokale MP3's. `ChapterAudioCheck` legt de
laatst bevestigde teksthash vast. Een tekstwijziging markeert het hoofdstuk als NEEDS_REVIEW, met behoud van de audio en tijdcodes.
Ongewijzigde audiogegevens lossen die controle niet op. Alleen geldige nieuwe audiogegevens of expliciete beheerbevestiging doen dat.
Audio, gewijzigde vers-tijdcodes en de controle delen per hoofdstuk één transactie: een schrijffout laat de vorige stand intact.

Audio V2 blijft een afzonderlijke, onveranderlijke registratie met expliciete publicatiepointer en exacte brontekstbinding.
Een legacy-controle bevestigen publiceert geen V2-opname en omzeilt nooit de bronhash. De 19 oorspronkelijke reviewgevallen
worden door deze integratie niet vrijgegeven. Bijbel-, CFM- en FSY-audio veranderen niet.

## 6. Controleren → Voorbereiden → Publiceren

Controleren en voorbereiden zijn drooglopen voor content; zij schrijven wel een beheerlogrij. Alleen voorbereiden kan de reeds
gepinde OTB-bron downloaden. Publiceren downloadt of spiegelt niets, herberekent het plan onder de gedeelde importlock en weigert
een gewijzigde bron of databasestand. De planHash bindt de volledige broninhoud, tellingen, hoofdstukwijzigingen en relevante
content-/audiocontrolestand. Gebruiksgegevens blijven buiten de hash; hun behoud wordt in de importtransacties gecontroleerd.

Publicatie is per bron/hoofdstuk, niet één transactie over alle Schriften. Een fout rolt het getroffen hoofdstuk terug, maar kan
eerdere hoofdstukken laten staan; de run meldt FAILED/PARTIAL. Na een deelfout opnieuw controleren en voorbereiden, niet een oude
planHash forceren. De eerdere run en fout blijven in het logboek. Een identieke geslaagde herimport behoudt bestaande identiteiten.

Iedere run heeft vóór zijn logrij een PostgreSQL-sessielock op zijn eigen run-ID, ook tijdens bronvoorbereiding buiten de algemene
importlock. Herstel markeert alleen oude RUNNING-rijen waarvoor die eigenaarslock vrij is. Een beheer-GET op een andere instance
mag een actieve run dus niet als onderbroken markeren. Bij procesuitval vervalt de lock en blijft de rij FAILED/INTERRUPTED zichtbaar;
een retry krijgt een nieuwe rij. Een onschrijfbaar startlogboek blokkeert de import. Een fout bij de eindregistratie wordt als fout
getoond, niet stil als succes. In-memory voortgang is tijdelijk; het duurzame runlogboek is leidend na herstart.

## 7. Wanneer gebruik je wat

- **Nieuwe podcastaflevering, FSY-les, kinder- of introcontent**: de normale reload (en, zodra stap 2 er is, *Nieuwe content ophalen*).
  Ongewijzigde content wordt overgeslagen; herhaald uitvoeren verandert niets.
- **Bij een officiële tekstrevisie**: bewust *Schriftbronnen bijwerken*. Een aanvullende update raakt die Schriften niet.
- **Nooit** een reload als herstelmiddel voor gebruikersproblemen: dat is niet nodig en is nu ook niet meer destructief.

## 8. Uitrol en herstel

Dit raakt bestaande gebruikersgegevens: behandel het als productiegevoelig. Er is geen productie-import of -herstel uitgevoerd.

1. **Back-up vooraf**: consistente PostgreSQL- en persistente audioback-up buiten de container, onder goedgekeurd onderhoud; zie het acceptatieplan in PR #211.
2. **Alleen lezen controleren** (vóór en na): `node scripts/content-architecture/diagnose-content-integrity-readonly.mjs --confirm-readonly`.
   Toont, zonder persoons- of tekstgegevens, het aantal verweesde open oefensessies, oefeningen buiten gebruik, lessen zonder oefeningen,
   en actieve contentkeuzes op een onbeschikbare collectie. `GEEN_BEKENDE_SCHADE` is de gewenste uitkomst.
3. **Compatibiliteit**: de normale migratieketen bevat `20261127120000_content_beheer_v2`: RETIRED, ChapterAudioCheck met backfill
   voor bestaande legacy-audio en ContentUpdateRun. Geen oude migratie aanpassen of hernoemen. De migratie mag ook volgen op een
   database waar Audio V2 al aanwezig is; het geïsoleerde bewijs staat in `scripts/audio/test-isolated.mjs`.
4. **Volgorde**: eerst afzonderlijke toestemming op back-up, beoordeelde image en onderhoud. Stop alle oude app-/importprocessen;
   migreer met de normale keten; start de nieuwe image; diagnoseer. Pas daarna, met apart akkoord, een expliciete contentactie.
   Oude processen met de algemene reload mogen niet naast de nieuwe beheerflow blijven schrijven.
5. **Herstel van al getroffen gebruikers**: een verweesde open set is alleen een verloren set: de gebruiker start de oefening opnieuw
   (de set wordt dan nieuw uitgedeeld; oude open sets verlopen vanzelf). Door eerdere reloads cascade-verwijderde
   antwoordgeschiedenis en XP-bijschrijvingen zijn **niet** uit de huidige database te reconstrueren; alleen een back-up van vóór die
   reload bevat ze. Een gerichte herstelroute (credits uit de back-up koppelen aan de nieuwe oefening met dezelfde inhoudshandtekening) is
   technisch mogelijk, maar wordt pas gebouwd na akkoord en na inzicht uit de diagnose.
6. **Rollback**: verwijder geen enumwaarden, tabellen of migratiehistorie. Een teruggezette oudere image is alleen veilig als zijn
   omgang met RETIRED vooraf bewezen is; laat oude algemene reloads uit. Kies bij twijfel een vooruitfix. Een volledige database-
   restore verliest nieuwere voortgang en vereist een afzonderlijk herstelbesluit plus de bijpassende audioback-up.
7. **Verificatie na uitrol**: `/api/health`, de diagnose (stap 2), een tweede reload (logboek meldt overal "0 nieuw, 0 verwijderd"), de
   contentkiezer (Bijbel nog zichtbaar zoals ingesteld) en een testgebruiker die een oefenset uitdeelt vóór en inlevert ná een reload.

## 9. Hoe herken je als beheerder een fout of gedeeltelijke update

- De job eindigt met `status: "error"` en een foutmelding met de fase tussen haakjes (`[Boeken]`, `[Bijbel (OTB)]`, `[Cursussen]`, …):
  alles vóór die fase is wel doorgevoerd en veilig (per stap atomair), alles erna niet.
- Een melding "Er loopt al een contentimport" betekent dat een andere import (knop of terminal) actief is; wacht en probeer opnieuw.
- Het logboek eindigt met "Seed klaar." alleen bij een volledig geslaagde run. Zonder die regel is de update niet volledig.
- Per collectie meldt de log: `Oefeningen: N ongewijzigd behouden, … nieuw, … buiten gebruik gesteld, … verwijderd` en
  `Verzen: … nieuw, … gewijzigd, … verwijderd`. Een herhaalde run met dezelfde bron toont overal 0.

## 10. Beheerkaarten (Adminbackend → Systeem)

Twee afzonderlijke kaarten, beide onder de importlock (`withContentImportLock`) en beide met een logboekrij in `ContentUpdateRun`:

- **Nieuwe content ophalen** (`/api/admin/reseed`, `reseedJob.ts`): `runSeed(..., { scriptures: false })`. Podcasts, FSY, CFM-concepten, kindercursus,
  introductie, Genees, De Slimste Heilige en achievements. De Schriftteksten, hun oefeningen, de **OTB-bijbel** en het **spiegelen van audiobestanden**
  blijven onaangeroerd en staan alleen in de Schriftflow. De CLI `npm run db:seed` doet nog steeds alles.
- **Schriftbronnen bijwerken** (`/api/admin/scripture-update`, `contentUpdate.ts`, `scriptureUpdateJob.ts`), drie stappen:
  1. *Controleren*: droogloop (`importBooks({ dryRun: true })`) per bron uit `SCRIPTURE_SOURCES` plus de gepinde OTB-bijbel (`importOtbFull({ dryRun: true })`).
     Schrijft niets naar content, alleen een logrij. De OTB-bron wordt hier nooit gedownload: staat ze niet in de cache, dan meldt de controle "bron nog niet voorbereid".
  2. *Voorbereiden*: dezelfde droogloop, maar bewaart het plan en geeft een `planHash`. Alleen deze stap downloadt de gepinde OTB-bron (aparte bronvoorbereiding, vóór de
     lock). De `planHash` is **inhoudsgebonden**: per bron de tellingen, de gewijzigde hoofdstukken, een sha256 over de volledige broninhoud (boeken, verzen, koppen,
     audiotijden) en een md5 over de relevante databasestand van de collectie (verzen, hoofdstukken, oefeningstatus, audiocontrole; gebruiksgegevens zoals pogingen en
     sessies horen er bewust niet bij, die wijzigen continu en de import vangt ze zelf af in de transactie). Voor de Bijbel: de gepinde OTB-commit en de inhoud van elk
     wijzigend hoofdstuk. Bij een fout in een bron (ook een mislukte OTB-download) wordt geen handtekening gegeven.
  3. *Publiceren*: alleen met een `planHash` van een geslaagde voorbereiding. Onder de lock wordt het plan opnieuw berekend; wijkt de hash af (bronnen of database
     veranderd), dan wordt er niets geschreven (`PLAN_CHANGED`). Daarna per bron een eigen resultaat; één fout stopt de andere bronnen niet maar maakt de run
     `PARTIAL`/`FAILED`. Cursussen worden één keer na alle bronnen gesynchroniseerd. Er wordt nooit iets gedownload of gespiegeld.
  Het gaat om een in-memory job (zoals `reseedJob.ts`); de kaart toont de voortgang met `useLiveQuery` en leidt het voorbereide plan af uit het logboek, dus het
  overleeft een herlaad en een herstart. Een run die na een herstart nog `RUNNING` staat, wordt als `FAILED` (`INTERRUPTED`) gemarkeerd (`markInterruptedRuns`).
- **Audio ter controle** (`/api/admin/audio-checks`): hoofdstukken met `ChapterAudioCheck.status = NEEDS_REVIEW` (tekst veranderd). Audio blijft afspeelbaar en
  wordt nooit verwijderd. Een beheerder bevestigt per hoofdstuk expliciet (`markAudioCurrent`); nieuwe, gevalideerde audiogegevens zetten het hoofdstuk ook weer
  op CURRENT. **Audiobestanden spiegelen** (`mirrorChapterAudio`) is een aparte knop op dezelfde kaart; tot dan spelen hoofdstukken van de bron.
- Extra schemabesluit: het model `ContentUpdateRun` (alleen contentgegevens, geen persoonsgegevens) is toegevoegd voor het logboek; zonder dat model gaat de status
  na een herstart verloren. De migratie is additief: hij backfillt alleen de nieuwe audiocontroletabel en verandert geen bestaande content of voortgang.

### Aanbevolen volgorde bij een Schriftupdate (door de eigenaar uit te voeren)
1. Alleen na uitroltoestemming: volg §8, met passende database- én audioback-up, migratie en controle van de nieuwe image.
2. *Nieuwe content ophalen* raakt de Schriften niet meer; gebruik die voor feeds en overige content.
3. *Schriftbronnen bijwerken*: **Controleren** (niets wordt geschreven), dan **Voorbereiden** (downloadt de OTB-bron en toont per bron de tellingen), lees het plan
   (verzen nieuw/gewijzigd/verwijderd, oefeningen behouden/nieuw/buiten gebruik, hoofdstukken met audio die ter controle worden aangemerkt) en pas daarna **Publiceren**.
4. Loop de lijst *Audio ter controle* na; bevestig een hoofdstuk pas als de audio nog bij de tekst past.
5. Spiegel eventueel nieuwe audiobestanden met de aparte knop.

### Herstel
- `PLAN_CHANGED` of "geen voorbereid plan": de bron of de database veranderde na het voorbereiden; bereid opnieuw voor. Er is dan niets geschreven.
- "Er loopt al een contentimport": wacht tot die klaar is (de lock vervalt vanzelf met de verbinding).
- `PARTIAL`: per bron staat wat gelukt is; een herhaalde publicatie na opnieuw voorbereiden doet alleen nog wat ontbreekt (idempotent).
- Terugdraaien van tekst: publiceer de vorige bronversie; verzen behouden hun id's en `RETIRED`-oefeningen blijven bestaan voor wie ze kreeg.
- Productie-uitrol, live tests en metingen (o.a. de duur van de OTB-validatie op echte bronnen) zijn aan de eigenaar.

Getest met `tests/content-update.integration.test.ts` (droogloop schrijft niets; handtekening stabiel en inhoudsgebonden; verouderd of afwijkend plan geweigerd; OTB in de
droogloop, download alleen bij voorbereiden, publiceren behoudt beheerinstellingen; alleen het gewijzigde hoofdstuk krijgt een audiomarkering; tweede identieke update zonder
wijzigingen; lock bezet; onderbroken run; normale update raakt OTB en audiospiegeling niet).

### Samenwerking met Audio V2 (#194)

De schriftupdatecontroles en `ChapterAudioCheck` blijven bestaan naast de onveranderlijke opnamen en expliciete publicatiepointer van
Audio V2. Een bevestiging van legacy-audio wijzigt geen V2-opname of publicatie en omzeilt nooit de exacte brontekstbinding van V2.
Ontbrekende of ongeldige legacy-audiogegevens behouden bestaande audio en tijdcodes; ook hoofdstukkoptijden moeten eindig, niet-negatief
én geordend zijn. Ongewijzigde audiogegevens lossen een openstaande controle niet op. Bij nieuwe geldige gegevens worden hoofdstukaudio,
verstijdcodes en de bijbehorende controle per hoofdstuk in dezelfde transactie bijgewerkt; een schrijffout draait alle drie terug.

De bestaande migratienamen blijven intact. De geïsoleerde audiorunner test expliciet dat `20261127120000_content_beheer_v2` ook ná
`20261204120000_audio_library_v2` kan worden toegepast, inclusief de controlebackfill voor al aanwezige audio en behoud van bestaande data.
De audio-integratietests bewaken rollback/retry, de ongewijzigde V2-publicatie en het ontbreken van een brontekstbypass via legacy-bevestiging.
Browserregressies bewaken beide beheerschermen, rechten/origin, planbevestiging, annuleren, lopende taken, 320/390/768 px en tekstschaling.
