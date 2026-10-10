# Fase 2 — oorzakenonderzoek vóór herstel

Baseline: `813d033` (actuele `main`, PR #75). Onderzoek op 10 oktober 2026.
Dit document is vastgelegd vóór de implementatiewijzigingen. Fase 3 is buiten scope.

## 1. Voltooiing en openstaande vraag

`applySoloAction` leest status/version buiten zijn schrijftransactie en schrijft
vervolgens onvoorwaardelijk. Twee requests met dezelfde verwachte versie kunnen
beide worden geaccepteerd. Een vertraagde move kan zo de laatste connect en zijn
COMPLETED-status/snapshot terugdraaien. `Puzzle.action` heeft evenmin een wachtrij
of busy-grens; een volgende drag/rotatie/toets kan tijdens move→snap beginnen.
Actiefouten worden niet opgevangen/toegankelijk getoond op het bord.

Een retry met dezelfde actionId wordt pas gecontroleerd ná de ACTIVE/version-
controle en geeft daardoor 409 na een succesvolle maar verloren response. Het
afvangen van alle create-fouten binnen een PostgreSQL-transactie is bovendien
geen bruikbare idempotentie: een unique-fout maakt die transactie ongeldig.

De engine zelf markeert de laatste geldige fusie al correct; er is geen reden
om geometrie, snapping of groepsverplaatsing opnieuw te ontwerpen. De volledige
afbeelding en Verder bestaan al; hun betrouwbaarheid hangt van deze sessieketen af.

## 2. Antwoord en historische registraties

V2 gebruikt al de goede claim-scope `jigsaw-answer:v2:<sessionId>`, niet de
vraagcontent-id. Historisch beantwoorde vraagcontent blokkeert dus op zichzelf
geen nieuwe poging. Het probleem zit in de niet-atomische afhandeling:
`completeJigsaw` commit de claim/reeks, daarna schrijft `answerSoloPuzzle` apart
ANSWERED en daarna apart het record. Fouten of gelijktijdige antwoorden kunnen
een geclaimde maar niet afgesloten sessie veroorzaken. Retries en hervatten
geven alleen `alreadyAnswered` zonder opgeslagen uitslag; de client kan dan de
correcte felicitatie/antwoordfeedback niet herstellen. Een verkeerde keuze in
een concurrent verzoek kan bovendien een ander record/resultaat veroorzaken.

Dit moet via dezelfde centrale completeJigsaw/finishActivity/reeksregels worden
hersteld, met één transactie en opgeslagen sessieantwoord. Geen nieuwe XP-regel.

## 3. Opnieuw openen/spelen en sessievervuiling

Start zoekt alleen ACTIVE voor een variant, niet COMPLETED met openstaande vraag.
Na teruggaan naar de kiezer of verloren browseropslag maakt start daarom opnieuw
een bord in plaats van de open vraag te hervatten. De globale localStorage-key
en automatische resume kunnen bij terugkeer een oude ANSWERED-poging openen.
Het resultaat heeft dan geen uitslag en biedt geen expliciete herstart van
dezelfde variant. De asynchrone resume kan een inmiddels geselecteerde nieuwe
puzzel overschrijven. `Puzzle` heeft geen session-id-key en initialiseert state,
refs, vraagkeuze en camera slechts eenmaal; bij zo'n wissel blijft oude state over.

Er is géén unieke user/variant-constraint op PuzzleSession; die vormt hier geen
blokkade. De unieke constraint op PuzzlePersonalRecord hoort bij het beste record,
niet bij speelrecht. Historische sessies moeten behouden blijven.

## 4. Contentselectie

De huidige manifestcatalogus bevat al 216 unieke afbeeldingen; er is geen
databasequery/LIMIT 20 in deze flow. De vorige correctie voegde een volledige
clientcatalogus met pagina's van 24 toe. De bestaande test controleert alleen
een synthetische lijst, geen daadwerkelijke start vanuit het zoekresultaat.

De selectie blijft echter een verborgen index (standaard 0) als zoeken/pagineren
de geselecteerde thumbnail verbergt. Start blijft actief, zelfs bij nul resultaten,
en kan zo een andere afbeelding starten dan de gebruiker in beeld heeft. Tevens
kan bovengenoemde late resume de geselecteerde puzzel weer vervangen. De API
hardcodeert 215 en koppelt aan arraypositie in plaats van de unieke content-URL.
Er is geen aanleiding contentrechten te verbreden: de bestaande jigsawEnabled-
en gameContentScope-controles blijven voor zowel route als API vereist.

## Validatieplan

Reproduceer races, retries, hervatten, antwoorden/replay en contentstarts met echte
service/API-integraties op een eigen PostgreSQL-database met alle migraties.
Verwijder de V2-testskip voor ontbrekende tabellen. Browsercontrole moet de
volledige afbeelding→Verder→vraag→resultaat en selectie/start daadwerkelijk
bedienen. De bestaande 25 engine/catalogus/legacy-tests zijn groen op baseline,
maar bewijzen bovenstaande gebruikersscenario's niet. De precieze live-events
zijn zonder productietrace niet bekend; dit rapport onderscheidt codefouten van
een niet-waargenomen productiegebeurtenis.
