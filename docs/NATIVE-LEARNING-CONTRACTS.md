# Native schriftvragen en afronding — B3c-1

Dit is de server-/contractfase van issue #238. Er verschijnt nog geen vragenknop
of resultaatpagina in de native lezer. B3c-2 sluit de bestaande ExerciseCard,
ExerciseSessionQuestions en SummaryScreen aan. Geen fysieke toestelacceptatie.

## Hergebruik en commitgrens

De bestaande `issueExerciseSession`, `submitExerciseSession`,
`completeReadingLesson`, `completeReadingOnlyStep`, `completeChapterReading`
en `advanceCourseProgress` blijven de domeinservices. Zij kunnen nu deelnemen
in een aangeleverde Prisma-transactie. Native roept geen webroutehandler aan.
Webaanroepen blijven ondersteund; vragenloze webafronding neemt dezelfde User-lock
als native om een lockinversie te voorkomen. Expliciet een hoofdstuk lezen is nu eveneens
één transactie voor leesstatus en reeksclaim. XP-bedragen/berekening wijzigen niet.

Een oude stapgrens die afwijkt van het huidige oefenplan filtert in de gedeelde
service eerst de werkelijke bronverzen. Een hoofdstukvraag zonder bronvers hoort
alleen bij de laatste stap. Native kent geen eigen selectie-/beloningsalgoritme.

Alle mutaties gebruiken de bestaande `commitAccountMutation`: User → NativeSession
→ collectie → cursus → boek → hoofdstuk → leesdoel → verzen → oefeningen.
De hoofdstuklock is exclusief om ook nieuwe vraag-/versinserts via foreign keys
tot na de commit te laten wachten. Cursuslocks blijven gedeeld.
De scope wordt voor en binnen de transactie opnieuw opgebouwd met dezelfde
read-only cursus-/readerrechten. Sessiegeldigheid wordt ook na de callback
gecontroleerd. Rijlocks serialiseren intrekking en mutatie; tijdverloop wordt
apart gecontroleerd. Een na rechtsgeldige commit uitgevoerde logout draait
geen beloning terug. Signalen/notificaties volgen pas na commit, nooit bij replay.

## Contract v1

Capability: `scripture-learning-v1`. De UI blijft bij een oudere backend expliciet
niet ondersteund; geen terugval naar de oude hoofdstukafrondingsproef.

Basis: `/api/v1/native/courses/<courseId>/read/<steps|chapters>/<targetId>/learning`.
Exacte methoden/paden zijn toegestaan in TypeScript, Swift en Java.

| Methode | Suffix | Functie |
| --- | --- | --- |
| POST | `/start` | Expliciet vragen uitdelen; actionId is een vaste UUID |
| GET | `/sessions/<UUID>` | Bestaande set en eventueel definitief resultaat hervatten |
| POST | `/check` | Eigen uitgedeelde vraag beoordelen, zonder voortgangswrite |
| POST | `/submit` | Exact de uitgedeelde antwoorden definitief verwerken |
| POST | `/read` | Expliciet hoofdstuk lezen of stap zonder vragen afronden |

Alle POST-input bevat actieve collectie, selectieversie, UI-taal, hoofdstuk en
versgrenzen. Cursus/methode/doel komen uit het gevalideerde pad. De Bearer-sessie
levert gebruiker/sessie; de client levert nooit score, XP of eindstatus.
`/check` vraagt sessionId/exerciseId/given; antwoorden verlaten de server uitsluitend
na expliciete beantwoording van een eigen uitgedeelde vraag of definitieve inzending.

`start` en `read` gebruiken elk een eigen vaste actionId. Een lege uitgedeelde set
is geen afronding. `read` weigert een leesstap waarvoor vragen beschikbaar zijn.
Een leesstap rondt nooit het hele hoofdstuk af. Hoofdstukken oefenen zonder expliciet
lezen maakt geen READ-status; Vrije keuze blijft optioneel oefenen ondersteunen.
De volgende cursor wordt door de bestaande domeinservice bepaald en samen met
het oorspronkelijke resultaat vastgelegd.

## Herstel en migratie

De bestaande databaseconstraint staat `ExerciseSession.result` alleen toe na
`submittedAt`. Daarom is de additieve migratie
`20261209120000_native_learning_context` noodzakelijk. Zij voegt uitsluitend een
nullable `nativeContext` toe aan ExerciseSession, met versie-/doelconstraint en
immutabilitytrigger. Bestaande rijen blijven null. Geen nieuwe voortgangstabel,
backfill, seed of wijziging van een eerder toegepaste migratie.

De context bewaart native sessie, account-/bron-/route-identiteit, teksthash en de
uitgedeelde publieke vragen. De uiteindelijke resultaatstempel staat pas bij commit
in `result`, samen met de hash van de exacte inzending. De bestaande `result_check`
blijft intact. Antwoordvolgorde mag variëren; dubbele/ontbrekende/vreemde vraag-ID's
worden geweigerd. Een afwijkende antwoordherhaling geeft 409.

Beloning, credits, attempts, leesstap/cursuscursor en resultaat zijn één commit.
Een fout rolt alles terug. Een identieke replay leest het oorspronkelijke resultaat
zonder opnieuw de domeinservice uit te voeren. Verloren HTTP-response of procesuitval
na commit wordt via GET opgelost. Vóór commit blijft de transactie terugrolbaar.

Een receipt is maximaal zeven dagen hervatbaar en gebonden aan dezelfde native
sessie en bronselectie. Account-/sessie-/bron-ABA-/taal-/tekstwijziging of ingetrokken
rechten worden opnieuw gecontroleerd, ook voor een reeds opgeslagen resultaat.
De huidige teksten of een gewijzigde scope worden nooit stilzwijgend geaccepteerd.

Een downgrade vóór gebruik kan naar de eerdere appimage terwijl de nullable kolom
blijft staan. Na gebruik blijven receipts en resultaten behouden; verwijder de
kolom niet als rollbackactie. Een eventuele databaseterugzet vereist een afzonderlijk
gecontroleerd herstelplan. Geen migratie/deployment uitgevoerd op dev of productie.

## Aansluiting B3c-2

`nativeLearningClient` gebruikt uitsluitend de bestaande NativeSessionClient.
Geen automatische POST-retry, ook niet na 401. Na een onzekere uitkomst eerst
GET status; eventueel expliciet dezelfde actionId/sessionId en antwoorden herhalen.
Geen offline outbox. Een aan een oud account gekoppelde adapter wordt ongeldig.

De toekomstige gedeelde UI invalideert uitsluitend na bevestigde mutatie de bestaande
Vandaag-/cursus-/profielgegevens via LiveDataStore en de bestaande XP-eventlaag.
Een mislukte vervolg-GET mag de bevestigde uitkomst niet terugdraaien. Geen nieuwe
cache of lokale voortgangswaarheid. GET hervatten mag nooit automatisch een nieuwe
set of mutatie starten.

Leespositie, scrollen, annotaties, audio en navigatie roepen geen van deze acties
impliciet aan. CFM, vragenbank/imports, Audio V2-beheer en de stabilisatieissues
#258/#259 blijven buiten deze wijziging.

## Verificatie

De definitieve PR bevat de werkelijk uitgevoerde resultaten en CI op de head.
De gerichte suite gebruikt uitsluitend synthetische content in eigen PostgreSQL en
Redis: vijf talen/drie leesmethoden, stapgrenzen, web/native-beloningen en herhaling,
GET-fingerprints van alle tabellen, antwoordcontrole, concurrency in twee processen,
identieke/afwijkende replay, verloren resultaat, rollback en lockwachtraces.
TypeScript/ESLint, bestaande native/webregressies, productiebuild, native bundel,
Access-policy en iOS-/Android-compilatie blijven verplichte technische controles.
Fysieke vragenbediening hoort bij B3c-2 en is niet uitgevoerd in B3c-1.


### Gerichte auditcorrecties en lokaal bewijs

- Legacy-stapgrenzen filteren werkelijke bronverzen vóór de willekeurige keuze.
- Native mutaties gebruiken verse oefenplannen in de transactie. Prisma 7 exposeert
  `$transaction` ook op haar transactieproxy; daarom mag uitsluitend de canonieke
  rootclient de bestaande procescache gebruiken. De stale-cacheproef was eerst rood
  en is na deze correctie groen.
- Historische `courseLessonId`-remaps uit `applyLessonPlan` blijven mogelijk; de
  oorspronkelijke native context/resultaten worden niet naar een nieuwe route herschreven.
- Bij een krimpende vraagset blijven `answered` en `rewardCorrect` monotone historische
  tellers. Dezelfde XP-tarieven blijven gelden; een negatieve `baseXp`-uitkomst en verlaging van `baseXpEarned`/historische
  credits worden voorkomen. `User.xpTotal` werd in het bestaande pad niet negatief
  bijgeboekt, omdat `awardXp` alleen positieve bedragen verwerkt. De historische
  tellerverlaging kon wel heruitbetaling na heruitbreiding mogelijk maken. Pure én echte transactietests dekken dit.
- De onafhankelijke code-/securityreview gaf GO zonder resterende P0–P2-bevindingen,
  onder voorwaarde van groene definitieve CI en platformcompilaties.

Werkelijk lokaal uitgevoerd: 18/18 geïsoleerde integratietests zonder skips,
164 native-unit/contracttests, 80 datatests, 13 leervoortgangsregels, TypeScript,
gerichte ESLint zonder waarschuwingen/fouten, schone Next-productiebuild,
pariteitscontrole (6/6), interne native bundel, Capacitor-sync en distributiecontrole
voor iOS/Android. Migratiebehoud/foutrollback en bestaande constraintbescherming
zijn uitsluitend op wegwerpdatabases/schema's getest. De PR geeft de CI-status
op de definitieve SHA; Linux-compilatie geldt niet als iOS-/Android-apparaatacceptatie.


### Afbakening browserheropening

De eerste volledige CI-run stopte in de bestaande readerbrowser bij herladen na
het intrekken en herstellen van collectierechten. Dezelfde ongewijzigde proef
passeerde dat punt lokaal. De proef wachtte op verdwenen tekst, terwijl het
`reader:test-resume`-event ook bootstrap/refresh en de HTTP-geëmuleerde Keychain
activeert. Vóór de afzonderlijke heropenproef wordt nu op `networkidle` gewacht.
De onafhankelijke reviewer bevestigde deze minimale testafbakening; alle negatieve
rechten-/tekstasserties blijven staan. Er is geen authenticatiecode gewijzigd,
geen verse sessie gesimuleerd en geen test verwijderd of versoepeld. De precieze
interne refresh/storage-interleaving van de eerste CI-fout is zonder extra
requestcorrelatie niet volledig bewezen; de definitieve PR-checks tonen het
resultaat na de expliciete synchronisatie.


### Historische migratieproef

De bestaande `test-access-isolated.mjs` bouwt bewust eerst een oudere database
zonder `study_exercise_sessions`. Die historische selectie sluit daarom ook de
nieuwe afhankelijke `native_learning_context` uit. De latere ongewijzigde volledige
upgrade past beide migraties alsnog in volgorde toe. Extra SQL-asserties bewijzen
dat de drie context-/resultaatkolommen vóór die upgrade ontbreken, daarna bestaan,
en dat de nieuwe migratie daadwerkelijk voltooid is. Dit is geen skip van de
nieuwe migratie en wijzigt geen bestaande migratie of CFM-importfunctionaliteit.
De exacte bestaande CI-opdracht wordt lokaal met een eigen wegwerpdatabase en
synthetische CFM-fixtures gecontroleerd, zonder externe downloads of productie.
