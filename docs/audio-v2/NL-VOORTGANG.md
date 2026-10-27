# Nederlandse voortgang en normaal audiobeheer

Vervolg op #221, vanaf main `82a8e89aa8a950f1b70b12343b13a9029a781469`.
Geen productie-, NAS-, download-, import-, publicatie-, deployment- of mergehandeling uitgevoerd.

## Waarom de Nederlandse teller 34 kan blijven

De officiële Nederlandse Boek-van-Mormon-catalogus bevat 239 hoofdstukdoelen. Daarvan zijn 205 beschermd als bestaande legacy-audio. De overige 34 zijn aanvullende Audio V2-doelen. `34 geregistreerd` betekent dus niet dat slechts 34 van alle 239 hoofdstukken zijn verwerkt: deze teller telt uitsluitend V2-opnamen.

Het overzicht toont voortaan afzonderlijk:

- Het totale aantal hoofdstukken.
- Bestaande legacy-bronkoppelingen uit de actuele Chapter.audioUrl-gegevens.
- Legacy-bestanden die in de ingestelde audiomap als niet-leeg regulier bestand aanwezig zijn. Dit is een aanwezigheidscontrole, geen hash-/MP3-audit.
- Geregistreerde en gepubliceerde V2-opnamen, naast een samenvatting per uniek aanvullend hoofdstuk.
- Nog niet gepubliceerde aanvullende hoofdstukken en eventuele lopende taken.

Bij 205 legacy-bronkoppelingen, 34 aanvullende registraties en één gepubliceerde aanvulling zijn er geen 205 nieuwe V2-downloads nodig. Er kunnen nog 33 aanvullende hoofdstukken apart te publiceren zijn. Open de lijst, beluister de beheerpreview, selecteer de gewenste opnamen en bevestig de publicatie afzonderlijk. De 205 beschermde hoofdstukken worden niet opnieuw gedownload of vervangen.

De catalogus bewijst niet dat alle legacy-bestanden op een NAS aanwezig zijn. Daarom worden bronkoppelingen en aanwezige bestanden apart geteld. Een volledig geregistreerde collectie krijgt geen kunstmatige hervattaak. De interface zegt wanneer alleen publicatie resteert of wanneer alle geregistreerde aanvullende hoofdstukken al een publicatie hebben.

## Geen Ether 1-pilotpoort

De afzonderlijke Ether 1-kaart, pilotgoedkeuring en operationele pilotvoorwaarden in aanvraag, worker, registratie, publicatie en statusoverzicht zijn verwijderd. De oude `approvePilot`-API-actie wordt afgewezen. Ether 1 blijft een gewoon hoofdstuk, met behoud van zijn bestaande opname en publicatie.

Er is geen tweede sessie-, taak- of audiosysteem. De drie stappen blijven apart: downloaden/controleren → registreren → expliciet publiceren. De bestaande bron-/uitgave-/hash-/MP3-/tijdcodecontroles, huidige beheerrechten/sessionVersion, importlocks en bescherming tegen pointervervanging blijven verplicht.

Oude pilotgoedkeuringskolommen blijven ongewijzigd in de database als historie en voor schemacompatibiliteit. Ze verlenen of blokkeren geen toegang meer. Oude mislukte taken met foutcode `PILOT_REQUIRED` krijgen een begrijpelijke melding en kunnen na een expliciet hervatbesluit opnieuw de huidige controles doorlopen. Er worden geen historische migraties aangepast of auditgegevens gewist.

De oude code had bovendien een Nederlandse Ether 1-uitzondering: een aanwezige `Chapter.audioUrl` blokkeerde ook het herkennen van een bestaande, bijpassende V2-opname. Die bijzondere uitzondering is verwijderd. Een regressie controleert idempotente herkenning met behoud van URL, opname-ID, bestanden en publicatiepointers. De catalogusbescherming van de 205 bekende legacy-doelen blijft ongewijzigd.

## Hervatten zonder levende taken over te nemen

De oude handmatige selectie bood alleen `FAILED` aan. Verlopen `RUNNING`-taken waren niet handmatig hervatbaar; de automatische worker selecteerde bovendien geen `RUNNING` met NULL-lease. Dat is een reproduceerbaar codepad, niet een vastgestelde productieoorzaak zonder productielogs.

Veilig hervatten biedt nu aan:

- Mislukte taken.
- `RUNNING` met verlopen of ontbrekende lease.
- `QUEUED` die minstens twee minuten niet is bijgewerkt en geen toekomstige wachttijd heeft.

Een levende worker met een toekomstige lease of een lopende import-backoff wordt niet overgenomen. De server controleert dit opnieuw onder de bestaande User → audiobeleid → taak-lockvolgorde. Opnieuw inplannen maakt het oude worker-token ongeldig; bestaande receipt-/registratie-identiteiten blijven herhaalveilig. Een ontbrekend bestand kan apart worden opgehaald; een bestaande opname wordt niet verwijderd of overschreven.

De worker kan een achtergelaten NULL-lease ook zelfstandig herstellen. De beheerpagina heeft groepsknoppen en waar nodig een hervat-, herstel- of registratieknop bij het betreffende hoofdstuk. Openen en verversen van het overzicht schrijven niets.

## Verificatie en grenzen

De ontwikkelproeven gebruiken alleen eigen PostgreSQL/Redis, synthetische MP3's en HTTP-fixtures met de bestaande validators. Ze bewaken onder meer NULL-/verlopen leases, oude foutcodes, levende workers, backoff, geen dubbele download/registratie en ongewijzigde publicaties/gebruikersvoortgang. De volledige vijf taalcollecties, 205 legacy-bronnen, zes verborgen uitgaven en 19 reviewgevallen blijven onderdeel van de regressies.

De browserproeven vervangen de vervallen pilotbediening door normale download-, registratie- en publicatiehandelingen, toetsen de situatie 205 + 34, behouden bulk-/deelfout-/retrycontroles en controleren 320 px en Duits/donker/200% tekst. Ether 1 wordt alleen nog als representatief testhoofdstuk gebruikt.

Werkelijk uitgevoerde resultaten en GitHub-checks op de eindcommit staan in de PR-beschrijving. Er is geen NAS-status of fysieke speleracceptatie geclaimd. Geen schemawijziging, productiehandeling of automatische audiopublicatie.

## Uitgevoerde ontwikkelcontroles

- 16 unit-tests; 30 bestaande en 23 officiële-audio-integratietests, zonder fouten of skips.
- 34 bestaande en 41 nieuwe normale beheer-/browserassertions, zonder browser- of hydratie-excepties.
- Nederlandse bron-URL-herkenning, oude taakblokkade, NULL-/verlopen leases, levende worker en toekomstige backoff expliciet getest; publicaties en beschermde gegevens behouden.
- Alle 1.974 bron-/taakidentiteiten vergeleken met de oorspronkelijke main: ongewijzigd. Nog steeds 205 beschermde bronidentiteiten en 19 reviewgevallen.
- TypeScript, schone productiebuild, native inventaris/check/test, Prisma-validatie en vijf talen gecontroleerd. ESLint heeft geen fouten of waarschuwingen in gewijzigde bestanden; bestaande waarschuwingen elders staan in de PR.

Screenshots uit een synthetische ontwikkelomgeving, geen NAS-metingen of productiegegevens:

- [320 px Nederlands: 205 legacy + 34 geregistreerde aanvullingen](../screenshots/official-audio/nl-34-320.png)
- [390 px Duits, donker, 200% tekst](../screenshots/official-audio/nl-390-de-dark200.png)
