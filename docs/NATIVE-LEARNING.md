# Native Leren — B3a-1 en B3a-2

Gerichte technische herbeoordeling, afzonderlijk vastgelegde bevindingen en
reparaties, fysieke acceptatiechecklist en het oorspronkelijke B3a-2-plan:
[B3a-1-review](NATIVE-LEARNING-REVIEW.md). Eigen technische controles vervangen
geen afzonderlijke onafhankelijke review of fysieke toestelacceptatie.

Basis: `develop` na de bevestigde squashmerge van #246,
`e3ee1bfab66d6177960539c41a54fcfb3177b982`. Roadmap: #238.

## Gedeelde implementatie

`CoursesClient` behoudt zijn bestaande webqueries, kaartbeheer en mutaties.
De bestaande JSX staat nu in `CoursesView`: dezelfde cursuskaarten, actieve
cursus, voortgang en hervatbestemming. Native gebruikt diezelfde view met
read-only gegevens uit dezelfde serverdiensten (`getUserCourses`,
`getCourseCatalog`, geëxtraheerd uit de bestaande webhandlers).

`ReadingCourseView`, `ChapterListCourseView`, `ReadingPath`, `ChapterPath`,
`CoursePathHeader` en de bestaande leespaddelen worden rechtstreeks hergebruikt.
Alleen Link/Image en de scroll-entrysleutel lopen via platformneutrale poorten.
Web behoudt Next Link/Image, SSR, cookies en zijn bestaande cursusmutaties.
Geen gekopieerde cursuskaart, vragenbank, cursusvolgorde of voortgangstabel.
De gedeelde Hulpmiddelen-kaart laat icoon en label bij grote tekst zo nodig
op aparte regels staan; een lange vertaling wordt geen smalle letterkolom.
De browsercontrole bewaakt maximaal drie labelregels op 320px/200%.

## Read-only contract en rechten

Capability `courses-overview-v1`, versie 1:

- `GET /api/v1/native/courses`: persoonlijke lijst, catalogus, echte opgeslagen
  hervatbestemmingen en persoonlijke kaartvolgorde.
- `GET /api/v1/native/courses/<id>/path`: drie bestaande schriftelijke
  cursusmethoden: Stap voor stap, Hoofdstuk voor hoofdstuk, Vrije keuze.

Alleen die exacte GET-paden zijn toegestaan in TypeScript, Swift en Java.
Geen querystring, schrijfpoort, webcookie-fallback of algemene proxy.
De bestaande Bearer-/Service Auth-bridge en realtimeblokkade blijven behouden.
De server controleert sessie, bronselectie, taal/tijdzone, enabled/publicatierechten en
cursustype; na het ophalen worden sessie/context en cursusrechten hercontroleerd.
Het antwoord bevat geen e-mail, authgegevens, originele volledige User of
schrifttekstkopieën. Een lege toegankelijke catalogus krijgt geen legacybron.

Dezelfde `loadReadingPath` en `loadChapterPath` hebben een expliciete
`readOnly`-optie. Native GET synchroniseert geen cursus/lessen, schrijft geen
cursor en initialiseert geen voortgang. Het bestaande webgedrag blijft de
standaard. Een nog niet ingerichte lesindeling wordt niet automatisch opgebouwd.
De stapcursor blijft een echte versstap; geen vertaling naar het eerste
hoofdstuk of naar Foundation-hoofdstukafronding.

Alle gegevens staan alleen in de bestaande `LiveDataStore`, met account,
sessie-epoch, taal, bron-/selectieversie en cursus-ID in de identiteit.
Late antwoorden na logout/account- of bronwisseling worden geweigerd.
Terugnavigatie gebruikt dezelfde lifecycle/focus/scrollregels; geen offline
mutatiewachtrij of automatisch herhaalde POST.

## Werkende routes en expliciete grenzen

Met capability wordt Leren als bestaande hoofdbestemming zichtbaar.
`/courses` en de drie ondersteunde cursusmethoden werken lokaal; een cursuskaart
kan het echte leerpad openen. Vanuit Vandaag werkt de cursusoverzichtbestemming.
De catalogus kan worden bekeken zonder impliciete inschrijving.

Zonder capability blijft de Leren-tab verborgen. Een directe oude/deeplinkroute
krijgt een expliciete fallback met terugnavigatie, nooit de oude Vandaag-proef.

Dit is de eerste afgebakende B3a-PR, geen volledige B3-oplevering:

- CFM-kaarten en hun serverbepaalde hervatreden staan in het overzicht; het
  persoonlijke weekpad/archief is toegevoegd in B3a-2, zie hieronder.
- Podcast-, kinderen-, introductie-, FSY- en per-boekdetailroutes worden nog
  niet als werkende native detailflow geclaimd.
- Inschrijving/verbergen/herordenen van cursussen blijft buiten deze
  read-only PR; de bestaande webacties blijven beschikbaar.
- Les-, hoofdstuk- en CFM-studiebestemmingen tonen de bestaande veilige melding
  of een expliciete niet-beschikbaarstatus. Geen lege lezer of nepafronding.
- B3b: echte gedeelde lezer/leesposities; B3c: vragen, resultaten en bestaande
  transactionele beloningen; B3d: volledige CFM/persoonlijke studie.

Geen nieuwe CFM-inhoud of publicatie, geen overname van #237, geen migratie,
geen wijzigingen aan productie, NAS, Portainer, Cloudflare of Apple-login.

## Verificatie en fysieke acceptatie

De nieuwe tests vergelijken echte web/native cursuskaarten en de drie
leerpadcomponenten. De geïsoleerde SQL-proeven vergelijken de web-API met het
native contract, controleren volledige gebruikers-/voortgangssnapshots en testen
rechten/intrekking/bronwisseling tijdens daadwerkelijke lockwachttijd.
Browserbewijs staat bij de PR/Actions-artifacts onder `courses`.
Definitieve head, werkelijk uitgevoerde testresultaten en platformcompilaties
staan in de PR; een eerdere groene B2-run geldt niet als bewijs voor B3a.

Uitgebreide toestelchecklist na afzonderlijk goedgekeurde app/backendbuild
(de beperkte B3a-1-bevestiging van de eigenaar staat hieronder):

1. Login/2FA, Access en sessieherstel; Leren-tab met juiste capability.
2. Vergelijk dezelfde gebruiker/bron/taal met web: kaarten, volgorde, echte
   cursuspositie en voortgang; drie leesmethoden, uitklappen en vergrendeling.
3. Terug vanaf leerpad, scrollherstel, bron-/taalwissel en app hervatten.
4. Offline/herstel, logout en accountwisseling tijdens laden; geen oud beeld
   of gegevens van het vorige account en geen schrijf-/beloningsactie.
5. Kleine telefoon, 200% tekst, licht/donker, safe areas, portret/tabletrotatie,
   VoiceOver/TalkBack en selecteerbaarheid.
6. Controleer dat de nog niet ondersteunde lesactie duidelijk wordt uitgelegd
   en geen volledig hoofdstuk afrondt.

Geen aanvullende fysieke acceptatie of volledige cursus-/leespariteit geclaimd.

## B3a-2 — CFM-weekpad en archief

Vanaf de B3a-1-merge `896c2a4d8288e1c050eaac3a1dadab18a3bcd99c`
worden ook `CfmCourseView`, `CfmWeekPath`, `CfmArchiveView`, de stapkaarten en
`MyStepNav` daadwerkelijk gedeeld. De webadapter behoudt de bestaande
voorkeur-/contextmutaties; de native adapter biedt uitsluitend lezen.
Capability `study-course-overview-v1` ontsluit de exacte week-, archief- en
stapplan-GETs. Zie [contract, read-only bewijs en toesteltest](NATIVE-CFM-COURSES.md).

De eigenaar bevestigde B3a-1 op een fysieke iPhone: drie schriftelijke
leespaden, boekgroepen, voortgang en de veilige melding bij niet-ondersteunde
acties. Dit is geen fysieke acceptatie van B3a-2 en geen Android-acceptatie.
De CFM-studielezer, afronding, vragen, leesposities en beloningen blijven buiten
B3a-2; de lesbestemmingen tonen de bestaande veilige melding.

## B3b-1 — gedeelde schriftlezer (read-only)

De drie Boek-van-Mormon-leespaden openen nu de bestaande gedeelde tekstpresentatie via
`scripture-reader-v1`. Stap voor stap toont exact het toegestane versbereik; beide hoofdstukroutes
tonen het gekozen toegestane hoofdstuk. Zie [NATIVE-READER.md](NATIVE-READER.md) voor contracten,
beveiliging, testbewijs, grenzen en fysieke acceptatie. B3b-2/B3c blijven afzonderlijk; de oude
Foundation-hoofdstukafronding wordt vanuit deze nieuwe app niet meer aangeboden.


## B3b-2a

Duurzame hervatpositie en hoofdstuknavigatie staan beschreven in
[NATIVE-READER.md](NATIVE-READER.md#b3b-2a--duurzame-hervatpositie-en-hoofdstuknavigatie).


B3c-1 voegt de [veilige schriftvragen- en afrondingscontracten](NATIVE-LEARNING-CONTRACTS.md)
toe, zonder vrageninterface. De huidige gedeelde lezer blijft leespositie,
annotaties en audio gebruiken zonder impliciete afronding. B3c-2 sluit de bestaande
vragencomponenten pas na afzonderlijke goedkeuring aan.

## B3c-2 — gedeelde schriftvragen en expliciete afronding

De lokale reader gebruikt met `scripture-learning-v1` nu de bestaande
vraagkaarten, leesafrondings- en resultaatpresentatie. De drie schriftmethoden
volgen hun bestaande servercursor; alleen expliciete acties schrijven.
[Architectuur, herstelcontract, testbewijs en fysieke checklist](NATIVE-LEARNING-FLOW.md).
Werkgeheugencheckpoint is door de eigenaar goedgekeurd; geen permanente outbox.
CFM-studielezer en -vragen vallen hierbuiten. Fysieke B3c-2-acceptatie staat open.
