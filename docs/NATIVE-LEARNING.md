# Native Leren — B3a-1

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
  persoonlijke weekpad/archief vraagt een volgende B3a-deelstap.
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

Nog fysiek op iPhone en Android na afzonderlijk goedgekeurde app/backendbuild:

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

Geen fysieke acceptatie of volledige cursus-/leespariteit geclaimd.
