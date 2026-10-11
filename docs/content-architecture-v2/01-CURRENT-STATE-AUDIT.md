# 01 — Audit van de huidige implementatie

## Afbakening en bewijs

Bron: main `b5aafbf`, 11 oktober 2026. Instructies: `CLAUDE.md`, de symlink
`AGENTS.md`, `docs/VERSADO-DESIGN.md`, `docs/LAYOUT.md`; daarnaast de relevante
delen van `docs/LEERVOORTGANG.md`, `docs/DATA-REFRESH.md`, tijd-/platformregels
en de OTB-importdocumentatie. Er is niets functioneels aangepast.

**Vastgesteld** hieronder betekent gelezen in actuele code/schema/tests.
**Risico** beschrijft een gevolg daarvan, zonder te claimen dat dit live is
gereproduceerd. **Advies** hoort bij het doelontwerp, niet bij de huidige app.

Geen productiedatabase, officiële CFM-site of FSY-site is in deze audit
bevraagd. Er zijn geen imports, migraties, seeds of adminmutaties uitgevoerd.
Databaseaantallen, daadwerkelijk ingeschakelde bronnen en volledigheid van
officiële inhoud kunnen daarom niet uit deze audit worden afgeleid.

## 1. Collecties, identiteiten en gebruikerscontext

| Onderdeel | Vastgesteld | Consequentie |
|---|---|---|
| `ContentCollection` in `prisma/schema.prisma` | `work`, `editionKey`, `language`, unieke combinatie daarvan; `enabled`, `visibleToUsers`, herkomst/licentie; relaties naar boeken, cursussen, FSY, spelkoppelingen en gebruikers | Bruikbaar als concrete taaleditie; geen bronsoort, algemene publicatieversie of periode |
| `Book` / `Chapter` / `Verse` | Boek heeft optionele `key`, unieke `(collectionId,key)`; hoofdstuk uniek per boek/nummer; vers uniek per hoofdstuk/nummer | Stabiele locaties zijn beschikbaar; boeknamen/slugs zijn niet geschikt als identiteit |
| `User` | `activeContentCollectionId`, `contentLanguage`, `activeCourseId`; geen actieve studieles | Cursuskeuze is geen programmakeuze of leespositie |
| `src/lib/contentCollections.ts` | `getContentContext`, `setActiveContentCollection`, `setContentLanguage`, `resolveEditionIdForFamily` | Centrale serverbron voor context; normale gebruikers zien enabled+visible, admins enabled |
| `src/lib/contentRouting.ts` | Pure routeclassificatie, taal-/collectiekeuze, zoekparameterremapping | Herbruikbaar; nieuw routekind moet centraal worden toegevoegd |
| `src/lib/contentSwitch.ts` | Equivalenten voor cursus, hoofdstuk, leesstap, FSY, podcast, tools en spellen | Geen aparte navigatielogica per nieuwe pagina bouwen |
| `/api/content-context` | Geauthenticeerde GET/PUT; met `location` route-uitkomst, zonder `location` kale instelling | Bestaande profieltaalflow blijft compatibel |

`getContentContext` groepeert per `work`, met collectie-id als fallback bij
een null-werk. `pickEditions` kiest op taal-fallback en databasevolgorde, niet
op expliciete editie-familie. `pickTargetCollection` probeert bij taalwissel
eerst dezelfde familie maar valt terug op een andere familie in dat werk.
`resolveEditionIdForFamily` kan een familie filteren; de oudere resolver doet
dat niet. De laatste BOM-fallback geeft het vaste `content_bom` terug, ook
wanneer de zichtbare query niets oplevert. Een lege collectielijst krijgt
zelfs een synthetische standaardcollectie in `getContentContext`.

**Risico:** impliciete fallback kan editiebeleid of zichtbaarheid omzeilen.
De bestaande helper `src/lib/contentEdition.ts` controleert families wel
expliciet; de hoofdstukaudio-API gebruikt deze familiebeperking in zijn query.
Er is dus geen noodzaak voor een tweede identiteitsframework.

Sortering van collecties is nu alleen `order asc`; meerdere gelijke orders
hebben geen expliciete tie-breaker. Bij een toekomstige grotere catalogus is
`order,id` nodig voor stabiele weergave/paginering.

### Wisselgedrag

`applyContentSwitch` kan `stay`, `redirect` of `unavailable` opleveren. Bij
`unavailable` wordt niets opgeslagen; een dialoog kan alsnog `force` laten
opslaan en naar een hub sturen. Cursusequivalenten worden op type en eventuele
podcast gevonden, niet op een algemene logische cursusidentiteit. Een
hoofdstukequivalent gebruikt `Book.key` en nummer binnen de doelcollectie.
FSY gebruikt jaar, maand en slug, zonder de publiceerbaarheid van dat
equivalent hier te controleren. Spellen controleren een scope-rij, niet
genoeg speldata.

`ContentSwitcher.tsx` doet een fetch PUT met huidige route, daarna
`router.replace` indien nodig en `router.refresh`. De layout geeft
paginakinderen een key `active.id:contentLanguage`. De `LiveDataProvider`
geeft dezelfde twee contextwaarden door. Er is geen les-id in beide keys.

**Advies:** behoud route-equivalenten maar vervang de gebruikersbevestiging
voor bronkeuze door een directe wissel met een bruikbare brongebonden hub.
Een taal zonder toegankelijke publicatie wordt niet aangeboden. Alle
werkelijke mutaties lopen later via `jsonMutation`/live-data.

### Zichtbaarheid en toegang

`isContentCollectionSelectable` controleert voor gewone gebruikers enabled
en visible; null en admin zijn een expliciete bypass. De helper wordt op
onder meer `/lesson/[chapterId]`, `/reading-lesson/[lessonId]`, cursusdetail
en `/fsy/[lessonId]` gebruikt.

De volgende gecontroleerde API's valideren login en het bestaan van content,
maar hebben geen overeenkomstige collectiezichtbaarheidscontrole:

- `src/app/api/chapters/[chapterId]/route.ts` (tekst en goedgekeurde vragen).
- `src/app/api/chapters/[chapterId]/read/route.ts` (gelezen/reeks).
- `src/app/api/reading-sessions/route.ts` (start leesregistratie).
- `src/app/api/live/create/route.ts` (hoofdstuk-id voor een live spel).
- `src/app/api/verses/[verseId]/{bookmark,highlight,note}/route.ts`.

`/api/bookmarks` toont de eigen bladwijzers uit alle collecties, ook zonder
collectie-toegangfilter. Dit is privédata van de eigenaar, maar volledige
actuele verborgen brontekst opnieuw laden vereist een bewuste policy.
`/api/content-api/status` is een afzonderlijke sleutelbeveiligde content-only
route; hij geeft globale aantallen, geen gebruikersdata, en telt FSY niet mee.

**Kritiek vóór uitbreiding:** UI-verbergen is geen servertoegangscontrole.
Fase 1 moet dezelfde toegangsgate op lezen, preview, mutations en nieuwe
spelstarts zetten. Adminpreview krijgt een expliciete route/context.

## 2. Shell, lagen en scrollen

De eerder genoemde `z-20`-header is **niet meer actueel**:

- `StickyHeader.tsx`: fixed `z-30`; `BottomNav.tsx`: fixed `z-30`.
- `versado/ContentCard.tsx`: lokaal actiemenu `z-20`.
- `SortableList.tsx`: FLIP met `node.animate(transform...)`; `DragOverlay`
  expliciet `zIndex={25}`.
- `ContentSwitcher.tsx`: fixed bodyportal `z-40`, met gemeten menupositie en
  begrensde hoogte boven de onderste navigatie.

`ShellMetrics.tsx` is de centrale meetplek. `docs/LAYOUT.md` beschrijft
`--header-height`, `--header-offset`, `--nav-height`, `--vs-safe-area-*`,
grote tekst en toetsenbord. Gewone pagina's scrollen in het venster.
`NavigationScroll.tsx` en `navigationHistory.ts` bewaren tijdelijke
geschiedenis-scrollposities; fallback zonder Navigation API deelt positie
per URL. Dit is geen persistente leesvoortgang.

`focusMode.ts` kent `/fsy/:id`, Schrifturen-leesroutes en spellen.
`SubpageBackBar.tsx` kent ook FSY, met `/courses` als fallback. Geen eigen
header of tweede scrollmanager nodig. `ChapterPopup.tsx` gebruikt bodyportal
`z-50`, Escape en body-scrolllock, maar geen aangetroffen focus-trap of
expliciet focusherstel. De native `dialog.showModal()`-patronen van
`PuzzleHintPanel.tsx`/`WordGameHintPanel.tsx` bieden een veiliger modalbasis.

**Verificatie:** huidige source-contracttests zijn opnieuw uitgevoerd.
Er is in fase 0 geen nieuwe browsermeting/screenshot gemaakt. De bestaande
browserregressies staan in `tests/header-wordsearch.browser.mjs` en
`scripts/layout-audit/`; historisch bewijs vervangt geen toekomstig V2-bewijs.

## 3. Leren, lezen, cursussen en beloningen

### Modellen en services

`Course` heeft een concrete collectie en een `CourseType`; `CourseChapter`
en `CourseLesson` leveren hoofdstukvolgorde en versbereik. De types omvatten
Schrifturen-routes, INTRO, KIDS, PODCAST en FSY. De eigen vraagfamilies voor
podcast/kinderen/intro blijven buiten `Chapter/Verse`.

`src/lib/courses.ts` synchroniseert cursussen. De standaardcollectie is de
eerste enabled collectie op order; BOM-intro/kinderen worden aan deze keuze
gekoppeld. Dit is een hardcoded afhankelijkheid van sorteervolgorde, geen
algemene capability. Andere collecties met boeken krijgen Schrifturen-
cursussen. `CourseChapter`-links worden herbouwd. `applyLessonPlan` behoudt
leesles-id's op `(course,chapter,startVerse)`, verplaatst orders via tijdelijke
negatieve waarden en remapt bekende cursors/sessies/voortgang bij verwijdering.
Als er geen doelles is, of de doelles al gebruikersvoortgang bevat, kan
verwijderen van de oude les nog oude records cascaderen. Dat is geen algemeen
verliesvrij migratiepatroon voor nieuwe studiecontent.

`UserCourseProgress`: abonnement, huidige chapter/lesson, combo en activiteit.
Uitschrijven behoudt deze rij. `markCourseStarted` registreert de cursus en
activeCourse, niet een concrete FSY-les. `courseSummaries.ts`,
`learning/courseProgress.ts` en `today.ts` gebruiken gezamenlijke berekeningen.
`courseResume.ts` heeft specifieke hervatroutes voor Schrifturen, intro,
kinderen en podcasts; geen FSY-lescursor.

### Drie verschillende statussen

| Huidig gegeven | Betekenis | Wat ontbreekt voor studies |
|---|---|---|
| `ReadingSession` | Hoofdstuk geopend, startedAt/finishedAt | Geen sectiepositie of duurzaam resume |
| `ContentProgress.readVerse` | Bereikt versbereik via leesstappen | Geen sectie-/blokanker voor doorlopende tekst |
| `ContentProgress.readStatus/readAt` | Begonnen/gelezen | Voor studies expliciete status per logische les |
| `exerciseAnswered/exercisesCompletedAt` en cursusprogress | Oefeningen/route voltooid | Losse koppeling aan een studieles, zonder officiële opdrachten als quiz te behandelen |

`learning/contentIdentity.ts` gebruikt `Book.key#chapter`, anders
`chapter:<id>`. Dit deelt voortgang tussen talen, maar bevat **geen werk of
editie-familie als afzonderlijke dimensie**. Voor bestaande BOM-keys zit het
werk in `Book.key`; OTB gebruikt kale keys zoals `gen` en `jhn`.
`scripts/otb/canonical.ts` gebruikt juist work+editionKey+bookKey+chapter+verse.
Deze twee identiteiten mogen niet blind als uitwisselbaar worden behandeld.

`LessonFlow.tsx` opent leesregistratie, gebruikt `ReaderView` en een expliciete
gelezenactie; `ReadingLessonFlow.tsx` biedt lezen → vragen → resultaat.
De page-handlers geven annotations, audio, oefensessie en contentstatus mee.
Deze routes zijn geen semantische studie-JSON-renderer en hoeven niet ineens
herschreven te worden.

### XP en reeks

`learning/contentProgress.ts` is de centrale schrijver voor hoofdstukprogress,
credits en exercise sessions. De server deelt de set uit. Inleveren claimt
`submittedAt`, valideert alle uitgedeelde antwoorden, vergrendelt gebruiker
en content en registreert credits. `learning/rewards.ts`: begrensde basis-XP,
één bonus, bestaande herhalingskorting en legacy-tegoed. Reset wist lezen/
zichtbare oefenvoortgang maar bewaart beloningstellers.

Openen, scrollen en annoteren geven geen XP of reeks. Expliciet een hoofdstuk
als gelezen markeren telt eenmalig via `recordLearningActivity` met
`read:<contentKey>`. Een leesstap zonder vragen gebruikt `read-step:<lessonId>`.
`ContentProgress` opslaan en reeks registreren zijn bij
`completeChapterReading` momenteel aparte transactiestappen; een fout ertussen
kan een onvolledige afhandeling geven. Nieuwe studieafronding moet wel één
transactie hebben. Bestaande `StreakActivity(user,key)` voorkomt dubbele
activiteiten, ook bij retries op volgende dagen. Reeksdag hangt af van IANA-
tijdzone en centrale regels. Woordzoeker blijft de gedocumenteerde tijdelijke
uitzondering: XP, geen reeks. Deze audit verandert geen beloningsregel.

## 4. FSY

### Aangetroffen inhoud en opslag

`FsyLesson` bewaart collectie, jaar, maand, categorie, slug, bron-URL/hash,
JSON-tekstblokken en images; plus publishedTitle/Content/Images/At.
Uniek op collectie+sourceUrl en collectie+year+month+slug.
`FsySettings` regelt autoPublish en laatste controle/fout. Migratie:
`20260922150000_fsy_content`; later work/language/visibility/edition-migraties.
Er is geen afzonderlijk FSY-progress-, notitie- of leespositiemodel aangetroffen.
Wel bestaan de FSY-cursus, gebruikersabonnementen en eventuele opgeslagen
links/meldingen; die moeten behouden blijven.

Er staat geen volledige FSY-lesdataset in de bekeken seedbestanden. Inhoud
komt live binnen via `fsyContent.ts`. Daarom is **het aantal bestaande lessen
en gepubliceerde versies onbekend**. Schema-afwezigheid bewijst niet dat er
geen persoonlijke context buiten FSY-modellen bestaat.

### Synchronisatie en publicatie

`syncFsyContent` bezoekt twaalf maandintro's van het huidige UTC-jaar, uitsluitend
met `lang=nld`. Categorieën zijn slug-mappings (intro, zondagen, jongeren-
activiteiten, OTHER); de daadwerkelijke bronstructuur moet later gecontroleerd
worden. `runFsyWeeklyCheckIfDue` draait maandag 03:00 Amsterdam, zesdaagse
minimumafstand. `scheduler.ts` en `runSeed` roepen deze bestaande services aan.

De regex-parser maakt heading, paragraph, list-item, quote en image. Hij
verwijdert HTML en daardoor inline-links, nadruk, geneste structuur en
bronankers. Alle kopniveaus worden dezelfde heading. Afbeeldingen blijven
externe URL's. Nieuwe/gewijzigde inhoud krijgt een hash en conceptstatus;
de eerder gepubliceerde tekstkopie blijft bestaan. Publiceren overschrijft
die ene kopie: er is geen revisiegeschiedenis of pointerrollback.

De publieke lesroute en cursuslijst controleren `publishedContent != null`,
niet uitsluitend `status=PUBLISHED`. Dit is belangrijk: een gepubliceerde
les met nieuwe conceptwijzigingen is DRAFT, maar de oude publicatie is nog
terecht leesbaar. Alleen PUBLISHED-status migreren zou die publicatie verliezen.
De publieke route controleert de collectie-toegang en markeert cursusstart.

Fouten per pagina worden gelogd en overgeslagen; een gedeeltelijk mislukte run
kan uiteindelijk `lastError=null` krijgen. `syncInFlight` voorkomt overlap
binnen één proces, geen overlap tussen processen. Het huidige autoPublish-
pad kan zonder aparte kwaliteitsgate publiceren. Geen stopzetting uitgevoerd.

### UI en beheer

`FsyContentBlocks` gebruikt indices als React-key, externe img en oude
slate/brand-stijlen; geen tekstselectors/verwijzingen. `FsyLessonView` gebruikt
FocusLayout, maar nog bronlink onder iedere les en geen leesacties.
`FsyCourseView` groepeert op jaar/maand. `AdminFsyClient` en
`/api/admin/fsy` bieden status, conceptpreview, instelling en handmatige sync;
`/api/admin/fsy/[lessonId]/publish` publiceert een les. UI gebruikt fetch zonder
nieuwe centrale invalidaties. Deze delen kunnen later vervangen worden;
oude inhoud, id's, routebetekenis en cursusgegevens niet zonder inventaris.

## 5. Admin, import en media

`/adminbackend/content` combineert AdminContentSwitcherClient,
AdminCoursesClient, AdminFsyClient en een link naar OTB-preview.
`/api/admin/reseed` start een in-process `reseedJob` met logbuffer/progress;
`runSeed` verwerkt ook alle andere bronfamilies, FSY en audio. Niet geschikt
als automatische, kleine CFM-publicatieactie zonder afbakening.

`prisma/importContent.ts` behoudt bestaande vers-id's bij tekstupdates, maar
verwijdert verzen buiten het nieuwe bereik. Oefeningen worden in één
transactie verwijderd en opnieuw met nieuwe id's gemaakt. `ExerciseAttempt`,
`ContentExerciseCredit` en vraagkoppelingen hebben cascaderelaties. Voor nieuwe
imports zijn versiebehoud en expliciete impactanalyse noodzakelijk; de huidige
tekstupdate is niet atomair met de gehele bronpublicatie.

### OTB

`scripts/otb/import-core.ts` valideert de SHA-marker en volledige skeleton
vóór writes. `source-lock.json` pint SHA
`31d411ac1c2d277242a3bd85697f354eaa11526b`, editie `otb`, vijf locales en
CC BY-SA 4.0 metadata. `trialConfig.ts` omvat alle 66 boeken, verdeeld over
OT en NT: tien verborgen collecties. `importOtbTrial` is nu een alias van
`importOtbFull`. Per hoofdstuk atomische upserts; verse-id's en audiovelden
blijven, verdwenen verzen worden hier niet automatisch gewist. Geen oefeningen,
audio of cursussen worden door die importer zelf gemaakt.

`upsertCollection` zet bij iedere run `visibleToUsers=false`. Daarna kunnen
latere `syncCourses`-aanroepen in dezelfde algemene seed wel cursussen voor
collecties met boeken aanmaken. Dus de README-claim over proefomvang en geen
cursusrecords geldt niet voor de volledige huidige seedketen.

`/adminbackend/content-preview` is admin-only en specifiek OT/NT, OTB en
vijf talen; het hergebruikt ReaderView met `preview`. De source-lock en
validate-before-write zijn sterke patronen. Een volledige externe
bronvalidatie is in deze audit niet uitgevoerd.

### Media

Geen gedeeld lesmediaregister aangetroffen. Bestaande bouwstenen:
`artwork.ts`/MediaArtwork voor appcovers en Next-afbeeldingen;
`audioMirror.ts` voor allowlisted HTTPS, MIME-/lengtechecks, tijdelijk bestand
en atomische rename naar `AUDIO_DIR`; branding heeft begrensde data-URL's en
een persistent gedeeld volume. `next.config.js` heeft geen algemene remote
lesson-image configuratie. FSY hotlinkt afbeeldingen. Hergebruik het veilige
download-/volumeprincipe, niet brandingvelden als lesmediaopslag.

## 6. Persoonlijke studie

`Bookmark`, `Highlight`, `Note` hebben alle `userId` en verplichte `verseId`,
uniek per gebruiker/vers. Verse-delete cascade verwijdert deze gegevens.
Highlight heeft een kleur (default yellow), Note maximaal 2000 tekens in API,
Bookmark alleen createdAt. Een marker betreft het volledige vers, geen range.

ReaderView in `LessonFlow.tsx` toont drie knoppen per vers; lokale optimistische
state gevolgd door fetch. Bookmark/highlight gebruiken een toggle-POST,
waardoor een netwerkretry opnieuw om kan schakelen; Note gebruikt een upsert-
PUT en leeg betekent verwijderen. Er is geen aangetroffen uniforme mutation-
invalidatie voor alle drie acties en geen duidelijke rollback van mislukte
optimistische annotaties. Eigenaarschap wordt wel via userId gecontroleerd.

`/bookmarks`, `BookmarksClient` en `/api/bookmarks` bieden alleen bladwijzers,
zonder zoeken/typefilter/bronfilter. De API haalt alle eigen bronnen op;
de query heeft scope content maar geen `contentScoped: true`. Links wijzen
naar het hoofdstuk, niet expliciet naar het betreffende vers.
Er is nog geen Mijn studiemap en geen algemene notitie-/highlightlijst.

## 7. Spellen en realtime

`gameCatalog.ts` centraliseert id, route, settings-key en teksten.
`isGameVisible` combineert GameContentScope met globale GameSettings, met
adminuitzondering voor globaal uit. `GameContentScope` is alleen een
spel/collectie-koppelrij, zonder les, taalpolicy of voldoende-inhoudtest.

`/api/admin/game-scopes` bevat `SCRIPTURE_WORKS=[bofm,dc-testament,pgp]`
en een tweede vaste GAME_KEYS-lijst die onder meer word-search mist.
GET sluit OT/NT en studies uit; PUT controleert alleen het bestaan van de
collectie. Hierdoor kunnen admininstelling en technische support verschillen.

| Spel/keten | Feitelijke huidige bronafhankelijkheid |
|---|---|
| Woord van de Dag | `wordGame.ts` en betaalde hints gebruiken uitsluitend bomWords.json, vaste vijfletterpool; API GET heeft login, geen actieve-brongate |
| Scrabble | `scrabble/dictionary.ts` gebruikt uitsluitend bomWords.json |
| Woordzoeker | `wordSearch/game.ts` eist BOFM+scope; woordpool BOM per taal, personen/boeken scoped, `Place`-namen ongescoped; hervatten zoekt laatste actieve gebruikersspel zonder collectie-filter |
| Legpuzzel | Manifest en vragen van BOM-kinderverhalen; V2 eigen variant/session/action-architectuur; 216 manifestbeelden zijn geen generieke collectie-afbeeldingen |
| Raad het hoofdstuk | `chapterGuess.ts` kiest zonder expliciete editie BOM; default null kan een undefined queryfilter geven; start-API heeft geen actieve-broncontrole |
| Gezinsavond | `familyGame.ts` zoekt goedgekeurde oefeningen in BOM bij ontbrekende editie; lokale hostgasten zijn expliciete bestaande spelregels |
| Alleskenner | Eigen inhoudspool en vertalingen; BOM-passage-/boeknaamhelpers, niet simpelweg alle actieve hoofdstukken |
| Snelle Zendeling/Mysteries | Eigen gameplay/content/rules; geen generieke studieadapter aannemen |

**Risico:** scope toevoegen alleen kan UI zichtbaar maken terwijl achterliggende
woorden, vragen of beelden nog uit BOM komen. Voor bestaande vaste BOM-spellen
is dit vaak een bewuste bronregel, geen verzoek om hun gameplay te veranderen.
Maak die regel expliciet en voorkom onbevoegde bronfallback.

`src/server/gameServer.ts` gebruikt geauthenticeerde sockets, user-rooms,
Redis-adapter en in-memory kamers voor specifieke modes. `src/server/study.ts`
en `lib/study/units.ts` leveren gezamenlijke stappen, publieke vragen zonder
antwoorden en een hostgestuurde leesfase. FSY staat expliciet niet in
STUDY_COURSE_TYPES. Voor Het Verborgen Woord zijn deze transport-/authpatronen
bruikbaar, maar het hostgast-patroon van Gezinsavond is niet toegestaan voor
het toekomstige netwerkspel.

## 8. Live data, caching en compatibiliteit

`src/lib/data/hooks.ts`, store/client/mutation/scopes en
`components/LiveDataProvider.tsx` regelen openen, focus/reconnect, mutations
en gerichte socket-signalen. ContentScoped-key omvat collectie+taal, niet
actieve les, publicatierevisie of contextversie. De pagina-key heeft dezelfde
beperking. `contentChanged` raakt onder meer Vandaag/cursussen/games/progress.
Een privéannotatie-event en actieve-les-event bestaan nog niet.

`learning/contentProgress.ts` heeft een in-process oefenplan-cache van tien
minuten per chapterId. Een wijziging/publicatie heeft nog geen algemene
revision-key of import-invalidatie voor deze cache. Nieuwe leespagina's moeten
ankers, effectieve editie en revisie expliciet in keys opnemen. Geen
keepPreviousData bij contentwissels; studiemap juist accountbreed scopen.

`server.ts` importeert eager gameServer/scheduler. Nieuwe resolvers die daar
worden gebruikt mogen geen `next/headers` of sessiecookie-API importeren.
Routes geven actor/context als parameter. Bestaande meldingslinks en
native/PWA-links moeten blijven werken; oude routes niet verwijderen.

## 9. Conclusie van de audit

Herbruikbaar zijn collecties, editie-identiteit, routewissel, shell,
live-data, cursusprogress, centrale beloningen, importvalidatie, veilige
mediabestanden en transportauth. Nieuw nodig zijn studielesidentiteiten,
versies, lescontext, semantische tekst en passageankers. De belangrijkste
voorbereiding is consistentie en databescherming, geen herschrijving van
Schrifturen of introductie van een generiek CMS-framework.

Voor de aanbevolen wijzigingen zie [02](02-TARGET-ARCHITECTURE.md).
De werkelijk uitgevoerde controles en onbewezen situaties staan in
[05](05-TEST-AND-RISK-PLAN.md).
