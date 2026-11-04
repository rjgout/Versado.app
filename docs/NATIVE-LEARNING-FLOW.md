# Native schriftvragen en afronding — B3c-2

Basis: `develop` na #264 (`66e4f19bcd602740a3ac89142ef186ab481067b3`).
Roadmap #254. Alleen schriftleren; geen CFM, imports of nieuwe beloningsregels.

## Gerichte audit en hergebruik

`LessonFlow` combineerde de webreader, Next-navigatie, webmutaties en de
vraag-/resultaat-JSX. De bestaande kaarten, antwoordcontrolepresentatie,
vraagvoortgang, correctieronde en mascottes zijn mechanisch verplaatst naar
`learning/ExerciseSessionQuestions`. De oorspronkelijke exports blijven bestaan.
Web blijft zijn eigen bestaande API-adapter gebruiken; native levert uitsluitend
`nativeLearningClient.check/submit`. Geen Prisma, Next of socketclient in de
lokale bundel. Hints en oefenfeedback hebben nog geen native contract: native
rendert die acties niet. Web behoudt beide functies.

`learning/LessonSummary` is dezelfde bestaande resultaatpresentatie, met kleine
slots voor navigatie en de reekskaart. Web levert zijn bestaande
`StreakContinuationCard`; native toont de bevestigde serverreeks. De bestaande
leesafrondings-JSX uit `ReadingLessonFlow` staat in `ReadingCompletionSummary`.
Geen gekopieerde native kaarten of berekening van score/XP. De algemene kaart
ondersteunt IMAGE_CHOICE nog steeds voor web; de bestaande schriftservice levert
vijf vraagtypen (meerkeuze, invul, woordbank, waar/onwaar, volgorde).

De huidige web-stapflow heeft geen hoofdstukcorrectieronde: native respecteert
dat verschil. Hoofdstukvragen behouden die bestaande correctieronde. De
mascotdrempels blijven 60% voor stappen en 50% voor hoofdstukken; definitieve
beoordeling en beloningen blijven in de bestaande serverdiensten.

## Expliciete gebruikersflows

- **Stap voor stap:** alleen het geautoriseerde versbereik → Volgende stap →
  bestaande servervragen → serverresultaat → door de server bepaalde volgende
  stap. Een lege set toont een expliciete `/read`-actie en leesresultaat, geen
  verzonnen score. Geen hoofdstukafronding voor een losse stap.
- **Hoofdstuk voor hoofdstuk:** volledig toegestaan hoofdstuk → bewust als
  gelezen markeren → leesresultaat zonder XP → vragen → resultaat → toegestane
  vervolgbestemming. Lezen en oefenen blijven afzonderlijk.
- **Vrije keuze:** bewust lezen; vragen zijn optioneel en opnieuw oefenen is
  mogelijk. Ook oefenen vóór lezen maakt de tekst niet automatisch gelezen:
  het serverresultaat toont de afzonderlijke leesstatus en expliciete leesactie.

De UI gebruikt uitsluitend de vijf bestaande versie-1-contracten onder
`courses/<id>/read/<kind>/<target>/learning`: start, sessions, check, submit en
read. Capability `scripture-learning-v1` is vereist; oudere backends krijgen
geen nieuwe schrijfacties. De bestaande exacte TS/Swift/Java-allowlists en
Bearer-/Service Auth-bridge zijn ongewijzigd. Geen nieuwe endpoint of migratie.

## Checkpoint, autorisatie en herstel

Eén actieve UI-poging staat in de bestaande LiveDataStore, gekoppeld aan
sessie-epoch/stamp, gebruiker, bron, selectieversie, taal, cursus, leesmethode,
doel, hoofdstuk en versbereik. De echte readertekst wordt tevens vergeleken.
Een gewone remount bewaart vragen/antwoorden; bron- of accountwisseling wist
ze. De eigenaar heeft expliciet **werkgeheugen** gekozen. Een volledig door het
OS beëindigd appproces bewaart dus geen UI-checkpoint. Er is geen nieuwe
Keychain-opslag, tweede cache, voortgangstabel of offline outbox.

Een actie krijgt vóór de POST één UUID. Bij een verloren antwoord volgt alleen
status-GET; een reeds gecommit resultaat wordt getoond zonder nieuwe POST.
Zonder bewijs van commit blijft de oorspronkelijke inzending bevroren. Alleen
expliciet opnieuw proberen mag na een status-GET exact dezelfde UUID/antwoorden
versturen. Andere antwoorden worden geweigerd. Dubbel tikken deelt de lopende
actie. Onzekere inzendingen blokkeren onbedoeld weggaan met een bestaande
informatieve bevestiging. Een controlefout wordt geen fout antwoord.

Een ontbrekende start/read-receipt (404) is geen toestemming: eerst de bestaande
scoped reader-GET hercontroleren. Een 404 voor een bekende receipt of een echte
sessie-/Access-/bronweigering schermt oude gegevens af. Vertraagde GETs mogen
een inmiddels gewijzigde poging of bevestigd resultaat niet terugzetten. Oude
callbacks na accountwissel kunnen geen resultaat activeren. De server blijft
ook bij iedere mutatie zijn eigen actuele sessie, rechten, tekst en receipt-
binding (maximaal zeven dagen) controleren.

Pas na een bevestigde servercommit volgt `activityCompleted`-invalidatie van
Vandaag, cursus, voortgang, profiel, XP, reeks en activiteit. Geen optimistische
beloning, algemene cache-reset, browser-WebSocket of automatische schrijfretry.
Vervolgbestemmingen zijn gevalideerde native routes uit de servercursor.

## Samenwerking met lezen, audio en annotaties

De gedeelde reader, annotaties en positiecontracten blijven intact. De overgang
naar vragen stopt audio en ontkoppelt de bestaande native audiobron. De
positieobserver is tijdens vragen/resultaat niet actief. Openen, beantwoorden,
audiobediening of navigeren doet geen aparte leespositie-, READ- of XP-mutatie.
De expliciete afrondingscontracten zijn de enige nieuwe schrijfacties.
Focus en fasescroll gebruiken de bestaande routefocus/scrollRestore-laag.
Geen nieuwe header, focusmodus of speler.

De eigenaar meldde voor de voorafgaande audioreparatie (build 2498) **8/8 PASS**.
Dit is geen fysieke acceptatie van B3c-2. #258/#259 blijven afzonderlijk.

## Testbewijs en grenzen

- Pure controller-/runtimeproeven: UUID-deduplicatie, receiptvalidatie,
  responseverlies vóór/na commit, GET-first retry, bevroren antwoorden,
  stale GET, remount, account-/bronreset, intrekking en lege set.
- Full-shell browser met synthetisch HTTP/OS: drie leesmethoden, vijf werkelijke
  schriftvraagtypen, correcte/foute antwoorden en correctieronde, controlefout,
  expliciete retry, geen automatische POST, account/bron/expiry/denial,
  capabilityfallback, vijf UI-talen en 320px/200% licht/donker.
- Echte geïsoleerde PostgreSQL/Redis: bestaande 18 B3c-1-contractproeven plus
  volledige lokale Foundation → reader → vragen → resultaat voor drie methoden;
  SQL vergelijkt werkelijke XP/attempts met het bevestigde serverresultaat en
  bewijst geen lees-XP. Ook responseverlies ná servercommit wordt geïnjecteerd.
- Bestaande native/data-, webkaart-, focus-, reader-, annotatie- en audiotests
  blijven verplicht. De bestaande CI draait de nieuwe tests zonder nieuwe
  workflow/matrix of externe contentdownloads.

Browserartifacts: `native-foundation-browser`, submappen `learning-flow` en
`versado-native-learning-flow-browser`. Ze bewijzen React/DOM/API-werking;
synthetische OS-uitvoer, compilatie of een simulator zijn geen toestelacceptatie.
Definitieve uitvoerresultaten, head en platformchecks staan bij de PR.

## Afzonderlijk goed te keuren development-uitrol

De B3c-1-migratie `20261209120000_native_learning_context` moet op development
zijn toegepast voordat de bestaande learningcontracten gebruikt worden.
Deze PR voert **geen** dev-migratie of deployment uit. De eigenaar controleert
later migratiestatus/capability en rolt de afzonderlijk goedgekeurde dev-image uit.
Daarna: develop pullen → bestaande interne native bundel → Capacitor-sync →
Xcode/Android-build → fysieke installatie. Geen nieuwe distributieroute.

## PENDING PHYSICAL ACCEPTANCE — iPhone én Android afzonderlijk

| Handeling | Verwacht | Foutsignaal |
| --- | --- | --- |
| Login/2FA, app hervatten | Juiste account/bron, geen dubbele acties | Oude accountgegevens of spontane POST |
| Stap lezen → Volgende stap | Alleen verzen/vragen van die stap | Heel hoofdstuk of lege vragenpagina |
| Vragen beantwoorden; verkeerde keuze | Bestaande feedback; hoofdstukcorrectieronde | Netwerkfout telt als fout antwoord |
| Lezen zonder vragen / hoofdstuk als gelezen | Expliciet leesresultaat, geen XP | Automatische afronding of lees-XP |
| Resultaat → vervolg / leerpad | Echte servercursor, juiste terugroute | Eerste hoofdstuk of oude geschiedenis |
| Internet uit tijdens controle/inzending, herstellen | Keuze blijft; GET-herstel of handmatige retry | Automatische dubbele POST/beloning |
| App achtergrond/voorgrond, gewone schermheropening | Lopende set blijft in werkgeheugen | Nieuwe vragenset of verloren pending |
| Logout, andere account/bron | Geen oude tekst, antwoorden of resultaat | Gegevens van vorig account |
| Audio via knop/versmenu, daarna vragen | Mini-speler werkt tijdens lezen en stopt bij vragen | Audio speelt door of herstart vanzelf |
| Notitie/markering/bladwijzer en leespositie | Bestaande werking blijft | Tekst verdwijnt, conceptverlies of scrollreset |
| 100/200% tekst, licht/donker, safe areas, VoiceOver/TalkBack | Alle acties bereikbaar en benoemd | Overlap, horizontale overflow of focusverlies |

Volledig procesherstel, native hints/oefenfeedback en CFM-vragen vallen buiten
B3c-2. Geen fysieke PASS zonder afzonderlijk bewijs van de eigenaar.

## Afzonderlijk herkenbare reviewbevindingen en reparaties

De gerichte onafhankelijke review is uitgevoerd door een afzonderlijke,
read-only reviewagent. Implementatie/reparatie bleef bij de uitvoerende agent.

| Prioriteit | Bevinding | Reparatie en bewijs |
| --- | --- | --- |
| P1 | Een oude status-GET kon een nieuwere inzending terugzetten | Snapshotrevisie controleren vóór acceptatie; vertraagde-GET-unit |
| P1 | Nieuwe read/start na oud resultaat kon een ontbrekende nieuwe receipt als intrekking behandelen | Bekende ontvangst-ID vergelijken met actie-ID; scoped readerhercontrole, oorspronkelijke UUID en handmatige retry getest |
| P2 | Na oefenen → lezen werd de oude oefenreceipt als leesreceipt hercontroleerd | Actieve fase kiest leesreceipt; expliciete herstelunit |
| P2 | Legacy invulvraag zonder opties had een hardcoded Nederlandse vervolgtekst | Bestaande vertaalde sleutel, geen nieuwe vraag- of beoordelingsregels |
| P2 | Antwoordkeuze bleef wijzigbaar tijdens vertraagde controle | Gedeelde keuze-/woordbankknoppen geblokkeerd tijdens checking; full-shell vertraagde-check-proef |

De echte database-browserproef vond bovendien een P1 vóór oplevering: PostgreSQL
`jsonb` herschikt objectsleutels. Een ruwe JSON-stringvergelijking blokkeerde
identieke vragen daardoor ten onrechte. De nieuwe gerichte proef was eerst rood
(`blocked` versus `questions`); schema-normalisatie maakt uitsluitend de
objectveldvolgorde stabiel. Vraaginhoud en arrayvolgorde blijven beschermd. De
proef is groen; gewijzigde vraaginhoud blijft expliciet geweigerd. De onafhankelijke
review heeft deze correctie afzonderlijk gecontroleerd.

Lokaal uitgevoerd: TypeScript, schone Next-productiebuild, Prisma-validatie,
193 native-units (waaronder 16 nieuwe controllerproeven), 80 datalaagtests, 56 annotatie-, 29 focus- en 19 audiotests;
18 echte learning-SQL-proeven en drie echte native browserflows. De synthetische
full-shell vragen-, audio- en Focus-/routebrowserproeven zijn eveneens verplicht.
De losse webkaart/reeks/CSS-selectie geeft 37 PASS en één bestaande databaseguard-
SKIP omdat die losse opdracht geen database-URL krijgt; dit is geen overgeslagen
nieuwe test. De echte geïsoleerde runners testen cursusrechten/voortgang wel.
Gerichte lint heeft nul fouten en vier reeds bestaande waarschuwingen in de
webadapters (refanalyse, ongebruikte suppressie/variabele). De bestaande
vertaalcontrole meldt 4517/4935 vóór de extra enkelvoudsleutel; bestaande
onvertaalde overige sleutels worden niet als nieuwe dekking geclaimd.

Capacitor-sync en verpakte iOS-/Android-bundelverificatie voor local-internal
zijn lokaal uitgevoerd. Echte platformcompilaties gebeuren via de bestaande CI;
alle definitieve commitchecks en het uiteindelijke onafhankelijke oordeel staan
bij de PR. Geen lokale Xcode-/Android-compilatie of fysieke uitvoer geclaimd.

Vergelijkbare echte browserbeelden (synthetische content, echte API/database):
[webvragen](screenshots/native-learning-flow/questions-web.png),
[native vragen](screenshots/native-learning-flow/questions-native.png) en
[native serverresultaat](screenshots/native-learning-flow/result-native.png).
De vraagvolgorde kan door de bestaande serverselectie verschillen; beide
interfaces gebruiken dezelfde React-vraagkaart. De native afbeelding toont geen
web-hint/feedbackactie, overeenkomstig het expliciete contractverschil.

Aanvullend viewportbewijs: [320px/200% vragen, licht](screenshots/native-learning-flow/questions-320-200-light.png) en [320px/200% resultaat, donker](screenshots/native-learning-flow/result-320-200-dark.png).
