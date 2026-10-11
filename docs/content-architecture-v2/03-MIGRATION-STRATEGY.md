# 03 — Migratie, compatibiliteit en databescherming

Dit document beschrijft toekomstige migraties. In fase 0 is geen schema
gewijzigd, migratie uitgevoerd of database aangeraakt. Uitgangspunt:
main `b5aafbf`; doelmodel in [02](02-TARGET-ARCHITECTURE.md).

Vastgesteld bewaarbeleid D4: alle bestaande publicaties, relevante revisies,
snapshots, gerefereerde media en persoonlijke annotaties blijven behouden.
Geen automatische garbage collection of destructieve contractmigratie zonder
afzonderlijk goedgekeurd beleid. De onderstaande contractgates zijn
technische voorwaarden, geen toestemming om gegevens te verwijderen.

## 1. Vóór de eerste implementatie-uitrol

Maak een toegestane alleen-lezen inventaris, zonder privéteksten in logs:

- Collecties: id, work/family/language, enabled/visible, echte contentaantallen.
- Werk-null, dubbele bronidentiteiten, gelijke orders en bestaande afwijkingen.
- Per FSY-les: id, collectie, jaar/maand/categorie/slug, status, hash,
  presence en hash van publishedContent, publishedAt en bron-URL.
- FSY-cursus-id's, abonnementen, activeCourseId en bestaande links in meldingen.
- Aantallen Book/Chapter/Verse, Course/links/progress, ReadingSession,
  ContentProgress, credits en ExerciseSession per relevante bron.
- Aantallen en targetintegriteit van Bookmark/Highlight/Note; steekproeven
  uitsluitend met toestemming van de eigenaar in een privé testcontext.
- Oude `contentKey`-families en verschillende edities die dezelfde key gebruiken.
- Actieve spelrecords, rules-/geometryversies en vaste bronafhankelijkheden.

**Geen van deze productieaantallen is in fase 0 vastgesteld.** Plan daarom
geen delete/backfill op basis van de aanname dat FSY geen gebruikers heeft.
De content-only status-API bevat niet alle benodigde aantallen; persoonlijke
gegevens mogen niet worden toegevoegd aan die openbare servicecontracten.

Neem vóór DDL/backfill een databasebackup en consistente mediavolume-snapshot.
Test herstel in een geïsoleerde database, met schema- en bronversies vastgelegd.
Test ook rollback van de appimage; alleen een geslaagde pg_dump is geen
bewezen herstel. Bij rollout geen algemene runSeed starten.

**Expliciete uitzondering voor de hervatting van fase 1A:** de eigenaar heeft
uitsluitend lezende productie-inventarisatie toegestaan, dagelijkse volledige
Synology Hyper Backup bevestigd en besloten de aanvullende geïsoleerde
herstelproef over te slaan. Maak voor deze opdracht geen nieuwe backup of
herstelproef. De onbewezen herstelbaarheid en mogelijk onbewezen database-/
mediadekking worden als geaccepteerd risico geregistreerd in [fase-1A-status](07-PHASE-1A-STATUS.md).
De werkelijke inventarisatie en conflictbeoordeling blijven vereist vóór de
additieve schema-PR. Dit geeft geen toestemming voor productie-DDL, backfill,
containerherstart, import of verwijdering en is geen vrijstelling voor latere fasen.

## 2. Tabelbeleid

| Groep | Behandeling | Bescherming |
|---|---|---|
| User | activeContentCollectionId/contentLanguage/activeCourseId behouden; nieuwe context in aparte tabel | Geen ongevraagde leskeuze of cursusreset voor bestaande gebruikers |
| Book, Chapter, Verse | Geen nieuwe studiecontent hierin; id's/nummers/audio behouden | Geen delete/recreate of wijziging van bestaande Book.key |
| Course, CourseChapter, CourseLesson | Bestaande records en routebetekenis behouden | Nieuwe leestekst maakt geen lege cursus; oude FSY-cursus blijft adapter |
| UserCourseProgress, UserCourseLessonProgress, IntroLessonProgress, KidsStoryProgress, PodcastEpisodeProgress en PodcastPlaybackProgress | Bestaande gebruikersgegevens ongewijzigd | Geen herinterpretatie van cursusstart als les gelezen |
| ContentProgress | Additieve studieles-/revisieverwijzingen; legacy chapter-fields/sleutels behouden | Oude beloningstellers nooit resetten, geen nieuw XP door nieuwe sleutel |
| ContentExerciseCredit, ExerciseSession, ExerciseAttempt | Historie behouden; geen oefenregeneratie in studiemigratie | Geen cascade via import of lesverwijdering |
| XPTransaction, CompetitionXpEvent, StreakActivity, StreakDay en sociale gegevens | Ongewijzigd | Geen backfill als nieuwe activiteit; geen notitiebeloning |
| Bestaande spel-, puzzel-, ranking- en hintrecords | Ongewijzigd tot concrete adapter-PR in fase 5 | Lopende sessies houden oorspronkelijke bron/rulesVersion |
| ContentCollection | Bronrelatie en publicatiecompatibiliteit additief | enabled/visible niet overschrijven tijdens import |
| FsyLesson/FsySettings | Tijdelijk behouden als legacybron en routeadapter | Gepubliceerde kopie én conceptinhoud migreren; niets verwijderen in fase 3 |
| Bookmark, Highlight, Note | Bestaande tabellen uitbreiden met nullable lestargets/selector/version | Oude id's, userId, verseId, kleur, tekst en tijdstippen behouden |
| Nieuwe tabellen | ContentWork, StudyPeriod/Lesson/Edition/Revision, UserStudyContext, ReadingPosition, ContentReference/Media/ImportRun | Alleen aanmaken per goedgekeurde fase; geen lege hypothetische modellen |

Een optionele toekomstige `CourseStudyLink` en targets voor daadwerkelijk
interactieve studiecursussen worden pas met die cursus-PR toegevoegd. De
oude hoofdstuk-Exercise/ExerciseSession-verplichtingen worden niet voortijdig
nullable gemaakt om officiële vragen als quiz te modelleren.

## 3. Expand-and-contract per stap

### M1 — Bronfundament en compatibele context (fase 1)

1. Voeg ContentWork en UserStudyContext toe. Registreer daadwerkelijk bekende
   werken en kind/displayGroup. `ContentCollection.work` blijft de compatibele
   string/key; een FK kan na controle daarop aansluiten. Geen twee duurzame
   velden met onafhankelijk veranderbare werkidentiteit.
2. Null-work collecties krijgen alleen na inventaris een unieke key die hun
   huidige `workOf = collection.id` behoudt. Een unknown werk blijft OTHER;
   niet op naam gokken dat het Schrifturen zijn.
3. Voeg publicationState met `LEGACY`-backfill voor bestaande collecties toe.
   Nieuwe collecties DRAFT/onzichtbaar. Kopieer geen zichtbaar=true naar nieuwe
   bronrecords. Oud enabled/visible-gedrag blijft exact voor bestaande bronnen,
   behalve de bewust te dichten toegangsgaten.
4. UserStudyContext mag vóór de lesmodellen een gevalideerde legacy-leskey
   bewaren. Alleen bestaande FSY wordt in deze fase door een adapter herkend;
   CFM heeft nog geen te kiezen gepubliceerde inhoud. Geen verzonnen CFM-rijen.
5. Geen actieve context bij bestaande user: geen crash, geen automatische
   wijziging van actieve collectie/cursus. Init pas bij bewuste programmakeuze.
6. Nieuwe query-/routecode eerst achter een gerichte releasegate; dezelfde
   services blijven verantwoordelijk, geen langdurige dubbele kiezerlogica.

Alle DDL/backfills krijgen controles op aantallen en onbekende werkwaarden.
Een onbekende case stopt of blijft legacy; de migration mag niet stilzwijgend
een bron verborgen/zichtbaar maken. Striktere FK's pas na complete mapping.

### M2 — Lesidentiteit, revisies en lezen (fase 2)

1. Voeg StudyPeriod/Lesson/Edition/Revision, ReadingPosition,
   ContentReference/Media/ImportRun toe. Gebruik FK RESTRICT voor gepubliceerde
   of door gebruikers gerefereerde inhoud; retire vervangt delete.
2. Zet legacy-leskey om naar FK wanneer de corresponderende les is
   gemigreerd. Bewaar zolang nodig een expliciete mapping in de legacy-FSY-rij:
   `studyLessonEditionId?` als uniek, controleerbaar adapterveld. De bron is
   nog steeds StudyLesson; het legacyveld is geen tweede selectie.
3. ContentProgress krijgt nullable verwijzingen naar les en gelezenrevisie.
   `readStatus/readAt` werken voor nieuwe logische leskeys; chapter-gebruik
   blijft onveranderd. Nieuwe entries ontstaan door gebruikersactie, niet door
   oude cursusabonnementen als gelezen te interpreteren.
4. Geen scrollvoortgang uit het openen van een FsyLesson afleiden. Er is geen
   bestaande precieze FSY-positie aangetroffen; initialiseer nieuwe positie
   pas bij lezen. Eventuele onbekende persoonlijke records eerst onderzoeken.
5. Publicatie/read-status/positie/annotaties hebben onafhankelijke versions.
   Freeze een open tekstversie tijdens een leesbezoek; publicatie-update toont
   een herstelbare melding of remapt via ankers, zonder plotselinge tekstsprong.

### M3 — FSY en CFM content (fase 3)

Voor **iedere** FsyLesson-rij:

1. Leg legacy-id, collectie, sourceUrl en year/month/category/slug vast als
   herkomst/mapping. Canonieke identiteit wordt niet uit Nederlandse titel
   afgeleid. De migrator is idempotent op legacy-id en gecontroleerde sourceKey.
2. Maak of koppel de logische period/lesson en de concrete lessonEdition.
   Officiële meertalige gelijkheid vereist een gecontroleerde mapping; dezelfde
   maand/slug alleen is niet automatisch voldoende.
3. Als `publishedContent != null`: importeer **die tekstkopie** als legacy-
   publicatierevisie, ook wanneer FsyLesson.status DRAFT is. Behoud
   publishedTitle, publishedImages en publishedAt. Markeer bronhistorie
   `LEGACY_MIGRATED`, zonder een nieuwe scrape of publicatiedatum te verzinnen.
4. Als current content/hash verschilt: importeer tevens een aparte concept-
   revisie. Gebruik geen huidige sourceHash als bewijs van de oude publicatie;
   bereken voor die body een eigen revisiehash.
5. Als alleen concept bestaat: publicatiepointer blijft null. Geen eerste
   automatisch publieke les.
6. De oude scraper verloor links/inline-structuur. Vul die pas met een nieuwe,
   gecontroleerde bronimport aan, niet met aannames tijdens de legacyconversie.
   Bewaar bronpayload/snapshot voor review van de eerste volledige update.

Behoud `/fsy/<legacyId>` als serveradapter naar de nieuwe edition, of tijdelijk
renderadapter op dezelfde route. Een zichtbare redirect is pas toegestaan na
test van meldingen, back/forward en native links. Het oude FSY-cursus-id en
abonnement blijven werken; de leslijst opent de gedeelde reader. Leren → Lezen
is de nieuwe primair bedoelde plek, geen duplicaatlijst met eigen status.

Vóór het omschakelen van writers: laat de oude FSY-scheduler uitsluitend
controleren of zet de FSY-schrijfactie gericht stil. Maak de nieuwe adapter de
enige schrijver. Een oude `autoPublish=true` mag niet ongemerkt doorwerken in
het nieuwe publicatiesysteem; behoud de historische instelling maar migreer
nieuwe publicatie naar gecontroleerde review. Overlap tussen twee scrapers is
een stopcriterium, niet iets om achteraf te repareren.

CFM 2026 begint als nieuwe bron/period met echte officiële ids en kalender;
de eerste uitrol is de volledige, gecontroleerde Nederlandse content.
Geen voortgangsbackfill, geen import naar FSY en geen 52-wekengenerator.
Publiceer alleen volledig gevalideerde lesedities. Een manifest kan ontbrekende
lessen registreren, maar de UI mag geen niet-functionele leeskaart aanbieden.
Andere contenttalen verschijnen pas wanneer werkelijk beschikbaar en
gepubliceerd; de vijf bestaande UI-talen blijven behouden. Verwijzingen
worden vóór publicatie volgens fase 2D gevalideerd: intern uitsluitend bij
bewezen canonieke én editie-equivalentie, anders bekende officiële externe
bron of nette melding. Dit blokkeert M1/fase 1A niet.

### M4 — Annotaties en studiemap (fase 4)

Er is **geen kopie van alle oude annotaties naar een nieuwe tabel nodig**.

1. Maak verseId nullable en voeg lessonEditionId/revisionId/selector/targetKey/
   anchorStatus/mutationVersion toe aan de drie bestaande modellen. Backfill
   bestaande rows als verse-target, met versie 0 en status EXACT; note-text,
   kleur en timestamps blijven byte-identiek.
2. Voeg XOR CHECK en FK/indexen toe na inventaris. Bestaande `(userId,verseId)`
   unique blijft; nieuwe bookmark-targetdedupe staat naast deze constraint.
   Een null verseId mag nooit de legacy-API-filter verruimen.
3. Vers-toegang in bestaande readers en nieuwe annotatieservice gebruiken
   dezelfde userId. List/API responses vermelden een type en targetvariant.
4. Oude endpoints blijven verse-only adapters; zij lezen alleen `verseId != null`.
   Nieuwe writes gebruiken expliciete desired-state PUT/DELETE met version.
   De oude togglecontracten blijven tijdelijk ondersteund, maar de nieuwe UI
   verstuurt ze niet. Geen dubbele writers met elk een ander targetformaat.
5. Oude bladwijzerpagina krijgt de centrale query/projection; `/bookmarks`
   kan naar een bookmarkfilter van de map routeren. Oude verse-link blijft
   bruikbaar en nieuwe links voegen het exacte vers-/passageanker toe.
6. Nieuwe lestargets beginnen pas na een bewezen migratie-/readbacktest en
   complete privacytest. Oude annotaties hoeven niet in een offsetselector
   te worden omgezet: het vers-id is al een veilige volledige-vers-selector.

Bescherm zowel vers- als lesannotaties bij bronupdates. Nieuwe study-targets
hebben RESTRICT; oude Verse cascade is een expliciet gevaar. De importgate
moet delete van geannoteerde verzen tegenhouden of content soft-retiren. Een
latere FK-wijziging van Cascade naar Restrict is een aparte geteste schema-
wijziging met aangepaste importfoutmelding, niet een ongeteste globale switch.

### M5 — Speladapters en frozen context (fase 5)

Voeg bron-/les-/revisievelden uitsluitend toe aan de bestaande spelmodellen
die een concrete adapter krijgen. Backfill oude sessies met bewezen originele
bron uit hun inhoud/snapshots; nooit de huidige activeContent van de gebruiker.
Als de bron niet bewijsbaar is: legacy adapter/rulesVersion behouden en geen
nieuwe bronafhankelijke acties toestaan. Nieuwe defaults mogen oude sessions
niet onder nieuwe regels hervatten.

WordGame blijft BOM-gebaseerd met zijn betaalde hintpool/cooldown, ranking en
18:00-dag. PuzzleSession houdt geometry/rulesVersion, persoonlijke hintbron,
antwoord, records en actionId. Nieuwe lesson-word pools zijn een andere
capability; niet dezelfde dag-/antwoordhistorie herinterpreteren.

## 4. Identiteitscompatibiliteit

Een globale wijziging van `contentKeyForChapter` is **niet toegestaan** zonder
een separate audit/backfill: ContentProgress, credits, sessies,
StreakActivity en XPmetadata gebruiken de oude sleutel.

Voorkeursstrategie: behoud een expliciete legacy mapping per bestaande editie-
familie en gebruik de huidige key. Nieuwe families krijgen een namespace met
work+editionKey. Nieuwe studiecontent heeft een eigen study-namespace. Bij
een toekomstige keyconversie:

- oude en nieuwe key eerst één-op-één inventariseren; niet twee legacyrows
  samenvoegen op alleen boeknaam;
- beloningstellers en activitykeys mee mappen zonder nieuwe activiteiten;
- reads via compatibele keyresolver, één schrijver per logische key;
- geen XPTransaction of StreakDay herberekenen;
- collisions eerst blokkeren en inhoudelijk beoordelen.

Sectie-id's zijn blijvende bron-/redactionele ids, geen volgnummer of teksthash.
Updates bewaren ankeraliases in de nieuwe revisiebody; rollback kent de oude
id's nog. Ambigue mapping laat het originele anker staan als ORPHANED.
Een andere taal of editie krijgt geen automatische passage-offsetbackfill.

## 5. Routes, caches en live data

Behoud alle bestaande lees-, cursus-, FSY-, tools-, bookmark- en spelroutes.
Nieuwe routes registreren in contentRouting/contentSwitch, navigation,
focusMode en SubpageBackBar. Meldingen en native deeplinks blijven adapters
gebruiken; een GET mag geen verborgen inhoud alsnog beschikbaar maken.

Contextswitch bewaart keuze en resolved bestemming coherent. Latere responses
van een oude les worden weggegooid op query-key/version. Additieve live-data-
scopes/events zijn backwards compatible; geef oude clients geen private
selector of notitietekst via realtime.

Na publicatie veranderen revision-keys; invalidatie voor aanbod en resolver.
ReadingPosition-save remount de reader niet. Mijn studiemap is accountbreed en
blijft gevuld als activeContent wijzigt. Server-side plan-cache moet worden
gewist bij echte oefenupdates. Een rollback invalideert dezelfde datasets.

## 6. Rollback per migratie en uitrol

| Stap | App-/feature-rollback | Databehoud en grens |
|---|---|---|
| M1 | Terug naar oude kiezer/context, nieuwe velden/tabel laten staan | Oude activeContent blijft leesbaar; nieuwe lescontext wordt niet verwijderd |
| M2 | Studie-reader/publicatiegate uit, oude Schrifturen-routes behouden | Revisies/media/positions blijven; DB-schema niet downgraden |
| M3 | Oude FSY-route als adapter naar gemigreerde publicatie of oude snapshot | Stop nieuwe writer vóór oude writer hervat; kies één writer; rollback als specifieke nieuwe readeractie, niet algemene runSeed |
| M4 | Contextmenu/map uit; verse-only adapter aan | Nieuwe lestargets blijven privé en bewaard; oud bookmark-endpoint moet null verseId's uitsluiten |
| M5 | Nieuwe spelstarts uit, bestaande sessies via frozen legacyadapter | Geen snapshot/answer/rewardrecords wijzigen of sessies naar huidige context remappen |

**Belangrijke M4-grens:** een volledig oude appimage heeft joins die uitgaan
van verplichte verseId. Nadat de eerste lesannotatie is geschreven, is blind
terugrollen naar die image niet veilig. Lever daarom vóór activatie een
compatibele rollbackimage met verse-only filters/null-safe readers. Anders
uitsluitend de nieuwe feature uitschakelen, niet naar een ongeschikte oude
binary gaan. Dit is een expliciete releasegate.

Voor inhoud is rollback een atomische publicatiepointer naar een eerdere
gevalideerde revisie; originele selectors worden bewaard. Bestaande
publicaties, relevante revisies, snapshots, gerefereerde media en persoonlijke
annotaties worden niet als onderdeel van rollback verwijderd. Opruiming is
nu niet toegestaan: een toekomstige opruimactie vereist afzonderlijk
goedgekeurd beleid én analyse van alle revisie-/privéreferenties. Geen
automatische garbage collection of vooraf ingevulde bewaartermijn.
Voor DDL blijft de expand-fase staan; geen down-migration die nieuwe
gebruikersgegevens weggooit. Alleen bij werkelijk beschadigde data een
gecontroleerd backupherstel, met write-stop en export/replay van sinds de
backup nieuw ontstane privégegevens. Herstel is geen ongedocumenteerde SQL-fix.

## 7. Contract en verwijderingsgates

Oude implementaties mogen pas verdwijnen als:

1. Per legacy-FSY-id een geteste mapping bestaat; publicatie- en conceptchecksums
   matchen en geen draft als published is overgezet.
2. Bestaande annotation-id's/user/target/payload/timestamps aantoonbaar gelijk
   zijn; geen orphan veroorzaakt door delete, en privacytests slagen.
3. Cursusabonnementen/cursors en beloningshistorie dezelfde waarden houden.
4. Oude routes/deeplinks, app-resume en offline/netwerkretry zijn getest.
5. Slechts één actuele schrijver bestaat; legacyjob is gestopt, niet parallel.
6. Production readback en een afgesproken observatieperiode geen onverwachte
   dalingen in counts, failed requests of content-scoping tonen.
7. Herstel/rollback met recente backup én nieuwe annotation-targets slaagt.
8. Eigenaar de concrete contract-PR afzonderlijk heeft goedgekeurd.
9. Voor iedere destructieve datastap een afzonderlijk goedgekeurd beleid
   bestaat. Codecontract of een geslaagde observatie-/herstelproef vervangt
   dat besluit niet; zonder dit beleid alle genoemde gegevens behouden.

Bewaar routeadapters waar externe links bestaan ook na codecontract. Geen
contract-delete in fase 0 of als onderdeel van een 'opruim'-PR zonder bewijs.

### Bewijstoestand hervatting 1A

De eigenaar heeft de echte admininventarisatie van 2026-10-11T18:51:50.752Z
aangeleverd. Zod, identiteitsanalyse en migratiechecksums zijn offline gecontroleerd:
21 collecties, zeven werken, geen null-work/conflicten of gemeten relatiegaten.
De inventarisatieblokkade is opgeheven. De additieve 1A-migratie wordt uitsluitend
in een wegwerpdatabase getest. Het overslaan van de aanvullende backupherstelproef
blijft expliciete risicoacceptatie; backupmetadata en herstelbaarheid zijn niet
bewezen. Geen nieuwe productiequery, migratie, seed, import, restart of deploy
in deze opdracht. Afzonderlijke productie-uitroltoestemming blijft nodig wegens
automatische Prisma-migraties bij appstart. Details: [status](07-PHASE-1A-STATUS.md).
