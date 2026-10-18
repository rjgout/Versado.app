# Fase 3D — één bewuste actieve les

Stacked op fase 3C (PR #141); geen code uit open PR #140. Geen schemawijziging, publicatie, import of zichtbaarheidsschakelaar.

## Contract

`UserStudyContext` blijft de enige actieve-lesvoorkeur, onafhankelijk per workKey. De bestaande versie/actionId-API accepteert nu ook `study:<StudyLesson.id>`. De concrete editie komt uitsluitend uit de server-side gekozen collectie. Een ontbrekende vertaling krijgt geen fallback. Bestaande `fsy:<id>`-keuzes blijven werken, zowel voor legacy als overgedragen lessen. Bij een andere bron blijft de logische keuze opgeslagen; de beschikbaarheid wordt opnieuw gecontroleerd.

`getStudyCatalogue` retourneert maximaal 200 gepubliceerde edities (met expliciete truncatiestatus), kalender-/maand-/categoriegegevens, eigen leesstatus en actieve context. Het aanbod gebruikt normale contentrechten; geen concepten of impliciete preview. Lesbodies worden niet voor iedere cataloguskaart geladen. Kalenderdatums kiezen niets: alleen een bewuste actie kan de unieke actuele kalenderles selecteren. Maandlessen krijgen geen weekmodel. Ongemigreerde FSY-publicaties kunnen via dezelfde picker worden gekozen zonder tweede catalogusvermelding.

De gedeelde ProgramLessonPicker staat onder Leren; Vandaag en Spelen tonen dezelfde actieve les en Verdergaan. Spelkaarten blijven hun bestaande echte availability gebruiken. De oude FSY-cursusroute blijft bestaan en leest voor overgedragen lessen de gedeelde publicatiepointer; een ingetrokken gedeelde les valt nooit terug op een oude kopie.

## Mutaties en privacy

Geen automatische keuze op GET, kalenderwissel of deeplink. Alleen server-authenticated userId, expectedVersion en actionId via de bestaande contextservice. Eén verzoek tegelijk per picker; onzekere retry behoudt dezelfde actionId, conflict vereist bewust verversen. Geen optimistische definitieve keuze. Ontkoppelde componenten navigeren niet op late responses. Bestaande centrale live-data-scopes verversen de panelen; geen nieuwe globale listeners. Geen writes naar User, activeCourseId, leesstatus, voortgang, XP, reeks of podcastpositie.

## Validatie en grenzen

Gerichte context-/selectie-/shellregressies: 49 geslaagd. i18n: alle nieuwe teksten en Kompas-uitleg in vijf talen; bestaande vertaalachterstand blijft apart. De browsercontrole vond en corrigeerde null-legacy-keyselectie en intrinsieke minimumbreedte van de nieuwe kaarten bij 320px/200% tekst. Definitief: 5 geïsoleerde integratietests geslaagd; alle 69 Kompas-tests in dezelfde eigen testdatabase geslaagd (de 9 DB-tests die bij de losse lokale unitrun waren overgeslagen zijn hier daadwerkelijk uitgevoerd). Verder 52 live-data-tests geslaagd. Een schone productiebuild, TypeScript, gerichte ESLint en i18n slagen. Browsermatrix: 320px licht/Nederlands/200%, 390px donker/Duits, 768px licht/Frans, 1280px donker/Engels en 844×390 donker/Spaans/200%. Echte keuze, Vandaag/Leren/Spelen, terug/vooruit en geen beloningen geslaagd. Aanvullend: verloren netwerkresponse met dezelfde actionId bij retry en HTTP 409 met expliciet herladen getest. Bewijs wordt als CI-artifact `study-reader-browser` bewaard.

De actieve les wordt nooit automatisch gekozen door een reader-deeplink. Een bewuste selectie onder Leren is leidend. De catalogus toont alleen werkelijke gepubliceerde vertalingen; er worden geen nieuwe programma's, cursussen of lesvertalingen aangemaakt. Historische cursusvoortgang wordt niet naar lesvoortgang omgerekend. Echte iOS-/Android-toestellen en productie zijn niet getest.

## Uitrol en rollback

Eerst 3C reviewen/mergen, daarna deze kleine UI/context-PR onafhankelijk reviewen. De eigenaar verzorgt de uitrol en live acceptatie. Geen migratie in 3D; een vorige appimage kan terug, maar een oude client begrijpt nieuwe `study:`-voorkeuren niet en moet die veilig als niet-beschikbaar laten staan. Niet verwijderen of terugschrijven naar een andere les. Geen productie-/NAS-acties door Codex.

CI-vervolg: de nieuwe fout-/retrytest begrenst zijn alert-selector tot de programmakiezer. Next.js' eigen route-announcer kan eveneens role=alert hebben; dat is geen annotatie- of opslagfout. De bestaande foutasserties zijn behouden.

De picker toont het werkelijke aantal beschikbare gepubliceerde lessen (bij truncatie uitsluitend de begrensde-melding). De componentidentiteit bindt account, werk en concrete collectie, zodat een gewijzigde uitgave lopende UI-selectie ongeldig maakt. Een eigen versiecommit remount de picker niet; realtimeverversing mag de bevestigde navigatie niet verliezen.

Reviewcorrectie: FSY-kaartmetadata gebruikt dezelfde `FSY_CATEGORY_KEYS` en bestaande vertalingen als de legacyreader. De sleutels staan gedeeld in `fsyPresentation`; de oude export blijft compatibel. De echte maand en het jaar worden in de UI-taal geformatteerd, onbekende historische categorieën gebruiken de bestaande lesfallback. Geen CFM-datum- of kalenderwijziging. Unit- en productiebrowserregressies controleren alle vijf talen, gedeelde en legacylessen, volgorde en 320px/200% tekst.
