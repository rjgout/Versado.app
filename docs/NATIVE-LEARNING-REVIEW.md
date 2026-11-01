# B3a-1 — technische review en acceptatie

Beoordeelde commit: `bbe597ef13b7bfbf11004708bc53443f2962d93c`.
Vergelijkingsbasis: `e3ee1bfab66d6177960539c41a54fcfb3177b982` (develop na #246).
PR: #249. Roadmap: #238.

## Status en onafhankelijkheidsgrens

Dit is een nieuwe kritische codecontrole met aanvullende negatieve proeven,
uitgevoerd door dezelfde Codex-sessie die de implementatie maakte. Dit is geen
GO van een afzonderlijke onafhankelijke reviewer. Volgens het bestaande
AI-ontwikkelbeleid vervangen eigen controles die onafhankelijke GO niet.
Fysieke acceptatie blijft **PENDING PHYSICAL ACCEPTANCE**.

Initieel oordeel op de beoordeelde commit: **GEBLOKKEERD** door R1 hieronder.
De reviewbevindingen en rode regressies zijn vóór de herstelcode afzonderlijk
vastgelegd in `be43ef3056c5ac82c6e0bbf81402419f167dc0d4`. De uiteindelijke
herstelhead en CI-resultaten staan in de PR.

## Bevindingen op de oorspronkelijke commit

| ID | Ernst | Bewijs / oorzaak | Herstelstatus |
| --- | --- | --- | --- |
| R1 | P1 | Na een geslaagde pad-GET leidt een 503 bij achtergrondverversing tot `query.error`; `NativeLearningView` vervangt dan de hele view. Een open boekgroep en de gefocuste knop verdwijnen. Nieuwe browserproef faalt: 0 paden waar 1 bevestigd pad moest blijven. | HERSTELD; nieuwe SQL-/browserregressies groen. |
| R2 | P2 | Het cursusoverzicht gebruikt key-suffix `"list"`; een volgens contract/Prisma geldige cursus-ID `list` gebruikt dezelfde key. Een warme overzichtscache voorkomt de pad-GET en toont opnieuw het overzicht. Nieuwe browserproef met echte cursus-ID reproduceert dit. | HERSTELD; nieuwe SQL-/browserregressies groen. |
| R3 | P2 | `nativeCourses` controleert na aggregatie sessie/bron, maar niet opnieuw of de afzonderlijke cursussen nog enabled/toegankelijk zijn. Een echte lock op `CourseLesson` maakt zichtbaar dat een ondertussen uitgeschakelde cursus toch in het antwoord staat. | HERSTELD; nieuwe SQL-/browserregressies groen. |

Geen P0 aangetoond. R3 geeft verouderde cursusmetadata; de bestaande afzonderlijke
pad-GET controleert de bevoegdheid opnieuw en verleent daarmee geen lees- of
mutatierechten aan een uitgeschakelde cursus. Geen dataverlies of dubbele
beloningen aangetoond.

## Afzonderlijke gerichte reparaties

- **R1:** behoud dezelfde bevestigde component en DOM bij bekende tijdelijke
  transport-/5xx-fouten. Toon daarna een vertaalde status met handmatige retry;
  de nieuwe melding verplaatst of focust de bestaande boekknop niet.
  Autorisatie-, Access-weigerings-, bron- en contractfouten blijven blokkeren.
  Er ontstaat geen offline schrijfactie of beloning.
- **R2:** onderscheid resource `overview` van `path` en neem de cursus-ID
  afzonderlijk op in dezelfde LiveDataStore-key. Actor, taal en bronversie
  blijven onderdeel van de identiteit; er komt geen tweede cache.
- **R3:** pas na aggregatie opnieuw dezelfde `cfmCourseListWhere`-rechtenfilter
  toe op persoonlijke cursussen én catalogus, gevolgd door de bestaande
  sessie-/contextcontrole. CFM-ankeridentiteiten blijven gelijk aan de bestaande
  selectie. Alleen reads; geen nieuwe transactie of mutatie.

De nieuwe browsercontrole verifieert ook handmatig herstel na de 503 met behoud
van dezelfde DOM-boekgroep. Unitgevallen begrenzen expliciet welke fouten
bevestigde data mogen behouden; een onbekende fout krijgt dit privilege niet.
De eerste screenshot van de herstelmelding maakte een te smalle tekstkolom
naast het lange retrylabel zichtbaar. De melding gebruikt nu een verticale
indeling; een 320px-regressie bewaakt de beschikbare leesbreedte. Dit is een
beperkte correctie aan de nieuwe melding, zonder wijziging van de webkaarten.

## Methode en overige codebevindingen

- Alle 54 gewijzigde bestanden geïnventariseerd: applicatiecode, platformpoorten,
  contracten, tests, vertalingen, workflowfilters en documentatie. De gegenereerde
  inventaris wordt mechanisch geregenereerd/gecontroleerd.
- De webquery-/mutatiefunctie van `CoursesClient` vóór de JSX-extractie is
  bytegelijk aan de huidige adapterfunctie. De kernselectie en
  voortgangsberekening van de oude webhandlers is ongewijzigd in de gedeelde
  `courseList.server`-/`courseCatalog.server`-diensten aangetroffen.
- Geen tweede cursus-, lees-, belonings- of sessiesysteem. De echte bestaande
  React-leerpaden worden geïmporteerd; Link/Image gebruiken de bestaande
  platformpoorten. `NextNavigationProvider` omvat de webpagina's, zodat web
  Next Link/Image en SSR behoudt. De lokale bundle bevat geen Next/Prisma/servercode.
- `readOnly` schakelt bij native GET de bestaande synchronisatie, cursor-upsert
  en eerste voortgangsinitialisatie uit; het bestaande webgedrag blijft de
  standaard. `getStudyCourseSummary` gebruikt de read-only catalogus/tellingen.
- De GET-routes zijn expliciet in TypeScript/Swift/Java; nieuwe schrijfpoorten,
  cookiesessie, CORS-verruiming, proxy, Access-bypass en browser-WebSocket ontbreken.
  De bestaande sessiecontrole weigert intrekking/verloop, verplichte
  wachtwoordsetup en ontbrekende beheerder-TOTP.
- Account/sessie-epoch, geselecteerde bron/versie en taal zitten in de querygrens;
  late account-/bronantwoorden worden in de bestaande runtime geweigerd.
- De centrale routefocus gebruikt preventScroll; historyherstel heeft voorrang
  op automatische padpositionering. Uitgeklapte boeken zijn lokale presentatiestaat,
  geen voortgang. Het bestaande algemene informatiehint-vlagje is niet persoons-
  of voortgangsdata en introduceert geen tweede cursuscache.
- De extra view-/wiretypes geven geen tweede domeinwaarheid. De compacte native
  adapter is minder leesbaar dan de bestaande views; herformattering/een bredere
  refactor is geen acceptatievereiste (P3, onderhoudspunt).
- CFM-weken/archief, cursusbeheer, lezers, vragen en beloningen zijn expliciet
  niet opgeleverd. Niet-werkende lesbestemmingen geven uitleg; geen stille route
  naar eerste hoofdstuk of Foundation-afronding.

## Aanvullende automatische acceptatie

De bestaande geïsoleerde runner wordt hergebruikt; geen productiegegevens.
Nieuwe gevallen dekken bestaande blinde vlekken: meerdere boekgroepen,
bevestigd pad + mislukte vervolg-GET, daadwerkelijke DOM-/focusidentiteit,
legale ID `list`, herhaalde GETs met volledige voortgangs-/sessiesnapshots,
bron-/sessieverloop/setup tijdens daadwerkelijke SQL-lockwachttijd en het
intrekken van een cursus tijdens aggregatie. De bestaande vijf-talige
web/native-, accountwissel-, offline-, layout-, media- en platformketen blijft.

Het vervalgeval laat een geldige toekomstige sessievervaltijd verstrijken
terwijl de query geblokkeerd is; databaseconstraints worden niet omzeild.
Nieuwe regressies worden nooit geskipt of versoepeld. Lokale gerichte proeven
vinden vóór een codepush plaats; CI blijft de volledige standaardketen draaien.
De werkelijk behaalde resultaten worden na herstel in de PR vastgelegd.

Na de gerichte reparaties lokaal uitgevoerd: TypeScript, een schone
Next-productiebuild, native bundel, beide Capacitor-syncs en assetverificaties,
104 native + 80 datalaagtests, 44 leespad-, 101 CFM-, 28 shell/layout- en
6 pariteitstests; allemaal geslaagd. Prisma-validatie en de broninventaris zijn
geldig. De volledige geïsoleerde keten behaalt 69 SQL- en 64 twee-procestests,
zonder skips. De bestaande routefocusbrowserproef (16 combinaties, 3 fallbacks,
8 gecombineerde flows) en mobiele CSS-test slagen. Lint: 0 fouten, 171 bestaande
waarschuwingen; gerichte gewijzigde code lint schoon. De bestaande
vertaalachterstand bedraagt 418 sleutels per overige taal; de nieuwe melding is
wel in alle vijf talen vertaald. Vijf bestaande Turbopack-tracingwaarschuwingen
veranderen de buildstatus niet. Nieuwe CI- en browserresultaten: zie PR #249;
oude groene checks worden niet als bewijs voor een nieuwe head gebruikt.

Na de laatste beperkte layoutcorrectie zijn de schone productiebuild, native
bundel/sync/verificatie en gerichte lint opnieuw geslaagd; de 6/6 cursus-SQL-tests
en volledige vijf-talige cursusbrowserproef zijn opnieuw groen. Er zijn 54
web-/native-vergelijkingsschermafbeeldingen plus twee nieuwe reviewpreviews.
De 503-proef bewaakt leesbreedte, DOM-identiteit, open boekgroep, focus en
handmatige retry; de legale ID `list` opent aantoonbaar het eigen pad.

Technisch herbeoordelingsoordeel na herstel: **goedgekeurd met aandachtspunten**
voor de geteste B3a-1-scope. Geen bekende onbehandelde P0/P1 in de gewijzigde
functionaliteit aangetoond. Een afzonderlijke onafhankelijke GO, groene checks
op de definitieve head en toestemming blijven voorwaarden voor merge. Fysieke
acceptatie blijft open; dit oordeel geeft geen releasevrijgave.

## PENDING PHYSICAL ACCEPTANCE — iPhone en Android

Alle onderstaande gevallen staan voor **beide fysieke platformen PENDING**.
Een compile-, simulator- of Chromium-resultaat vult deze tabel niet in.

| Handeling | Verwacht resultaat | Let concreet op |
| --- | --- | --- |
| Start interne app, meld aan met 2FA, sluit volledig en heropen. | Zelfde account veilig hersteld; Leren alleen bij passende capability. | Loginlus, verdwenen Access-inrichting, verkeerde gebruiker, lege pagina. |
| Vergelijk drie cursusmethoden en bron/taal met web. | Zelfde kaarten, voortgang, echte versstap en slots. | Eerste hoofdstuk i.p.v. cursor, verkeerde uitgave, vrijgegeven slot. |
| Klap meerdere boeken open; onderbreek/hervat en verlies/herstel netwerk. | Geen verlies van bevestigde view/boekstaat/focus; begrijpelijke fout en leesherstel. | Inklappen, scrollsprong, verdwenen focus, eindeloos laden. |
| Vandaag → Leren → cursuspad → terug; heropen een directe padroute. | Juiste bestemming en geschiedenis; positie hersteld. | Teruglus, verkeerde cursus, sprong naar boven of externe website. |
| Meld A af tijdens laden en meld B aan; wissel bron tijdens padladen. | Alleen B / nieuwe bron zichtbaar; oude antwoorden verworpen. | Oude naam/kaart/tekst/afbeelding, verkeerde voortgang. |
| Trek sessie/toegang elders in en hervat. | Geen bruikbare afgeschermde data; veilige aanmelding/fallback. | Verder bladeren met ingetrokken sessie, ongewenste writes. |
| 200% tekst, licht/donker, kleine telefoon en tabletrotatie. | Geen afsnijden/overflow; veilige randen en bruikbare bediening. | Onder systeembalk verborgen knop, letterkolom, horizontaal schuiven. |
| VoiceOver/TalkBack en extern toetsenbord: koppen, boekknoppen, slots en melding. | Betekenisvolle namen/status, zichtbare tabfocus en logische terugfocus. | Stil slot, dubbele actie, focusval, focus buiten dialoog. |
| Kies een nog niet ondersteunde lesactie. | Uitleg; geen afronding, XP, reeks of automatische schrijfretry. | Volledig hoofdstuk afgerond, beloning, verborgen wachtrij. |

## B3a-2 — oorspronkelijk implementatieplan bij de B3a-1-review

1. **Bronnen behouden.** Hergebruik `CfmCourseView`, `CfmWeekPath`,
   `CfmArchiveView`, `MyStepNav` en de bestaande leespaddelen. Webbronnen zijn
   `/courses/[courseId]/pad` en `/courses/[courseId]/archief`. Gebruik
   `getStudyCatalogue(actor, now, {collectionId: course.contentCollectionId})`,
   `getStudyCourseSummary`, `resolveWeekSelection`, `groupArchiveByYear` en
   `modeOfStudyCourse`. Geen kopie van een weekpad of selectiealgoritme.
2. **Echte weekregel.** Alleen de eenduidige gepubliceerde kalenderweek heet
   Deze week; daarna de expliciet gekozen week, daarna recent werkelijk
   bestudeerd (`lastStudiedAt`), anders neutraal overzicht. Geen oudste
   onafgeronde week als achterstand. `catalogue` haalt echte studieactiviteit uit
   stap-open/afronding, leesposities en readAt; een gekozen week telt niet als studie.
3. **Archief is een projectie.** `cfmProgramme` archiveert één kalendermaand
   na `endsOnExclusive`, met maandafkapping aan maandultimo. Groepeer per officiële
   jaargang/werk, chronologisch, met bestaande les-/editie-ID's. Niets verwijderen,
   kopiëren, publiceren of als afgerond markeren. Behoud `truncated` en bestaande
   begrenzing van 600 cataloguslessen; geen verborgen incomplete lijst presenteren.
4. **Presentatie/data splitsen.** Web behoudt zijn lazy `WeekSteps`-query en
   bestaande `remember`-gedrag via een webadapter. `CfmCourseView.remember` doet
   nu PUTs voor voorkeur en studiecontext; een read-only native weekklik mag die
   niet blind overnemen. `PersonalStudyParts` en de week-/archieflinks gebruiken
   nog Next; verplaats alleen de echte presentatiedelen naar de AppNavigation/
   Image-poort, zonder compatibiliteitsshim. Gebruik #246 voor privébeelden.
5. **Aparte capability/contracten.** Voorstel: `study-course-overview-v1` met
   versie-1 GETs `courses/<id>/weeks`, `courses/<id>/archive` en voor een uitgeklapte
   week `courses/<id>/weeks/<editionId>/steps`. Behoud de bestaande B3a-1-path-DTO
   en zijn 404 voor CFM op oude clients. Geef mode, cursus-/collectie-ID,
   selectie-/taal-/tijdzonecontext, publicatierevisie, weekidentiteiten/periode,
   read/deelname, hervatreden, archiefgroepen en media-ID's; geen volledige lesbody.
   Nieuwe koude padroute bepaalt type via dezelfde geautoriseerde cursusquery in
   LiveDataStore; CFM naar weekadapter, schriftelijke routes ongewijzigd. Alleen
   de lokale archiefroute en exacte GETs worden expliciet in TS/Swift/Java toegevoegd.
6. **Belangrijke read-only afhankelijkheid.** `getStepProgressForEdition` roept
   `getStepProgress` aan, dat via `coverLegacyProgress` **createMany** kan doen.
   Die bestaande GET mag dus niet simpelweg als read-only native contract worden
   doorgelust. Plan eerst een expliciete read-only projectie/optie binnen dezelfde
   domeinservice, met dezelfde deterministische legacydekking zonder opslag; web
   behoudt zijn huidige gedrag. Geen tweede stapstatus-/voortgangstabel of eigen
   native afrondingsregel. Dit werk hoort in B3a-2, niet in deze PR.
7. **Rechten/revisies/cache.** Controleer cursus, anker/jaargang, gepubliceerde
   editie, retired/disabled/hidden en daadwerkelijke gebruikersrechten; valideer
   dezelfde publicatierevisies en sessie/context na aggregatie opnieuw. Identity:
   actor + epoch + cursus + anker/selectieversie + taal/tijdzone + current/archive;
   stepplan tevens editie + revisie/fingerprint. Gebruik dezelfde store/scopes,
   lazy queries per actieve/open week, dedupe, hervatten en middernachtverversing
   uit bestaande tijdzonehelpers. Geen extra cache, onveilige socket of POST-retry.
8. **Grenzen en acceptatie.** B3a-2 laat weken/archief/stappen/statussen zien;
   echte StudyReader/leespositie is B3b/B3d, vraag-/resultaat-/beloningsflow B3c/B3d.
   Niet-ondersteunde bestemmingen blijven expliciet afgeschermd. Test kalender,
   gekozen/bestudeerde week, geen hervatweek, twee jaargangen/archiefgrens,
   legacydekking zonder writes, revisie-intrekking tijdens laden, account/bron,
   Access, zes stappen zonder totaalscore, web/native layout en beide builds.

Historische grens van PR #249: daarin geen B3a-2-code, CFM-importgegevens of inhoud aanpassen. De daaropvolgende B3a-2-implementatie staat afzonderlijk beschreven in [NATIVE-CFM-COURSES.md](NATIVE-CFM-COURSES.md); dit verandert het eerdere onafhankelijke reviewoordeel niet.
