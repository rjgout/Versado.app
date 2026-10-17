# Fase 4B — contextuele annotatiebediening

Basis: main `e15cfec6` (gemergede 4A). Alleen readerbediening en gerichte
read-uitbreiding; geen migratie, studiemap, revisieherstel of productiehandeling.

## Koppeling en exacte selectie

`AnnotationActions` gebruikt voor beide readers hetzelfde native dialog/bodyportal-
patroon als Sheet/ReferencePreview: mobiele bottomsheet, compacte desktopdialoog,
safe areas, begrensde scrollruimte, achtergrondscrollbeveiliging en focusherstel
zonder scroll, expliciete Tab-wrap en herstel als een verwijderknop verdwijnt. Eén rustige actie-ingang vervangt de drie versknoppen. Longpress
werkt op de ingang; native tekstselectie, links en mobiele handvatten krijgen
geen blokkerende pointerhandlers. Keyboard/touch gebruiken dezelfde acties.

`domSelector.ts` vergelijkt tekstankers met de gepinde immutable revisie.
RichContentBlocks voegt `data-study-text` toe naast de bestaande sectie-/blokankers,
ook bij lijstitems, cellen, vragen, citaten en bijschriften. Geneste semantische
ankers gebruiken `data-study-anchor`; `data-study-block` blijft exclusief voor
de bestaande hoofdblokken van ReadingPosition, zodat geneste annotaties geen
ongeldige autosavecoördinaten introduceren. Een browserassertie bewaakt deze scheiding. Inlineonderdelen sluiten
rechtstreeks aan; citaattoeschrijving gebruikt een expliciete witruimtegrens.
Browser-UTF-16-grenzen worden Unicode-codepunten na NFC/witruimte-normalisatie.
Een halve surrogate, NFC-compositiegrens, afwijkende DOM, dubbel anker,
sectieoverschrijding of te grote selectie wordt geweigerd. Iedere selector gaat
lokaal door `validatePassageSelector`; de server valideert opnieuw. Een blokactie
kan de volledige teksteenheid selecteren zonder precies te hoeven slepen.

CSS Highlights kleuren exacte ranges zonder tekstnodes te splitsen of links te
vervangen. Overlap gebruikt vaste kleurprioriteit, geen geneste mark-elementen.
De eigen passageannotaties blijven daarnaast individueel bereikbaar in een rustig
uitklapoverzicht. Bij ontbreken van CSS Highlights blijven deze ingangen beschikbaar.
Versannotaties gebruiken uitsluitend de bestaande verseId.

## Reads, mutaties en fouten

De bestaande `/api/annotations` krijgt additief `view=reader`:

- `chapterId`: maximaal 200 actieve annotaties per soort in één hoofdstukaanvraag.
- `lessonEditionId + revisionId`: dezelfde begrenzing voor de gepinde revisie.
- `targetKey`: actuele eigen targetgegevens inclusief tombstones, alleen bij openen.

De response bevat `{ annotations, complete }`; een extra 201e record per soort
detecteert truncatie. Een waarschuwing voorkomt dat een onvolledig overzicht als
volledig doorgaat. De exacte target-read blijft beschikbaar. Oude GET-contracten
blijven intact. Serverdata leveren direct de bestaande versindicatoren; er is geen
initiële HTTP-aanvraag per vers. Alle reads zijn privé/no-store en owner-scoped.

PUT/DELETE lopen via `jsonMutation` en `annotationsChanged`. Pas een bevestigde
response werkt de status bij. Een onzekere aanvraag bewaart exact dezelfde UUID,
payload, intentie en versie voor retry. Tijdens onzekerheid zijn nieuwe schrijfacties
geblokkeerd. Een definitieve 4xx-afwijzing wordt niet blind herhaald. HTTP 409 vraagt
om bewust herladen van de actuele servergegevens, met expliciete waarschuwing dat
dit het concept vervangt. Netwerkfouten behouden notitietekst; sluiten met onbewaarde
tekst vraagt om expliciet verlaten. De grens blijft 2.000 tekens.

Target-/revisiewissels remounten of sluiten de bediening; late responses worden na
unmount genegeerd. Een open referentiepreview en annotatiedialoog worden niet
tegelijk getoond. StudyReader/ReadingPosition, leesstatus, audio, oefenflow en
terugnavigatie houden hun bestaande verantwoordelijkheden. Preview-ReaderView
heeft geen annotatie-ingang of schrijfacties. Geen XP-, reeks- of voortgangsmutatie
wordt door annotaties toegevoegd. De 4A-noodstop en rechten blijven leidend.

## Technische verificatie

| Controle | Werkelijk resultaat |
| --- | --- |
| 4A-selector + nieuwe client/targetcontracten | 16 unittests geslaagd |
| Eigen PostgreSQL/API, privacy, concurrency, legacy en begrensde readerreads | 18 tests geslaagd, geen skips |
| DOM in Chromium | 11 exacte selector-/Unicode-/structuurcontroles geslaagd |
| Productie-browserflow | Note, highlightkleur, bookmark, verwijderen, twee toestellen/409, echte netwerkfout en verloren proxyresponse na commit, identieke retry-UUID, late targetread en revisiewissel geslaagd |
| Responsive browsermatrix | 28 combinaties: 320/390/768/1280px en 844×390; licht/donker; 100/200% tekst; aanvullend alle vijf talen op 320px bij 200% |
| Focus en live-data | 28 en 52 tests geslaagd |
| TypeScript, productiebuild, i18n | Geslaagd; alle nieuwe teksten in vijf talen |
| ESLint | Nul fouten; 160 bestaande waarschuwingen op deze main, geen in de nieuwe annotatiebestanden |

De eerste netwerkfoutassertie miste zijn interceptie door de serviceworker.
Conform de bestaande readerbrowser wordt die alleen in de test geblokkeerd.
Een echte Tab-wrapfout aan het einde van de native dialoog is vervolgens
hersteld en de oorspronkelijke focusassertie slaagt. Er zijn geen asserts
verwijderd om een resultaat groen te krijgen. De suite controleert ook
longpress zonder dubbele opening en bevestigde opslag zonder XP/hintwijziging.
De bestaande pg-client-deprecatiewaarschuwing in de geïsoleerde runner staat los
van deze wijziging. De migratieketen is ongewijzigd en de databehoudproef slaagt.

De bestaande CI-workflow voert de nieuwe browserrun tegen zijn eigen schone
productiebuild uit en bewaart screenshots/resultaten. De feitelijke CI-eindstatus
van de exacte gepushte head staat in de concept-PR.
Browserbewijs wordt als CI-artifact opgeslagen, niet in Git. Werkelijke iOS-/Android-
selectiehandvatten en het echte virtuele toetsenbord vragen acceptatie door de
eigenaar; Chromium-testviewports vervangen geen fysieke toestellen.

## Uitrol en terugval

Alleen applicatie-update na afzonderlijk review-/mergebesluit door de eigenaar;
geen nieuwe databasewijziging. Terugval naar een compatibele 4A-image behoudt
annotaties en tombstones. De eerdere 4A-beperking voor pre-4A-images blijft gelden.
Geen delete/backfill, bronreload of publicatiewijziging nodig. Fase 4C/4D blijven
buiten scope.
