# CFM-afbeeldingen vernieuwen

De eigenaar heeft op 24 november 2026 besloten dat dynamisch geleverde officiële
CFM-afbeeldingen opnieuw mogen worden gedownload en vervangen. De eerdere zoektocht
naar zeven oorspronkelijke afbeeldingsbestanden en afzonderlijke kandidaatgoedkeuring
zijn hiervoor vervallen. Dit besluit geldt niet voor lesinhoud of OTB-teksten.

## Bediening

Open het bestaande Adminbackend → Systeem → content ophalen. Onder
**CFM-afbeeldingen vernieuwen**:

1. **Bestaande afbeeldingen controleren** leest uitsluitend bestaande koppelingen
   en bestanden. De teller toont hoeveel opgeslagen afbeeldingen geldig zijn.
2. **Afbeeldingen opnieuw downloaden** vraagt een expliciete bevestiging. Deze
   bestaande beheeractie vernieuwt uitsluitend afbeeldingen, zonder seed, lesimport,
   revisiewijziging, publicatie of wijziging van zichtbaarheid/voortgang.
3. Het bestaande beheerlog meldt aantallen per jaargang en fouten afzonderlijk.
   Een gedeeltelijk resultaat krijgt `PARTIAL` in de bestaande updateaudit. Een
   mislukte afbeelding behoudt haar bestaande bestand/koppeling. Handmatig opnieuw
   proberen mag; er is geen automatische schrijfretry.

De gewone actie **Nieuwe content ophalen** vernieuwt ook de bestaande afbeeldingen.
De al bestaande regels voor het toevoegen/publiceren van nieuwe lessen blijven
voor die actie gelden. Kies de aparte afbeeldingsactie als alleen media moeten
worden vernieuwd.

## Validatie en opslag

Alleen exacte bron-URL’s uit het bestaande CFM-register zijn toegestaan, via de
bestaande HTTPS-downloader met host-, DNS-/SSRF-, TLS-, redirect- en timeoutcontrole.
HTTP 200, begrensde grootte (10 MiB), MIME/magic bytes, volledige decodering,
en redelijke rastergrenzen blijven verplicht. Geen SVG/HTML of willekeurige hosts.

Een download gaat eerst naar quarantaine. Pas na validatie installeert de bestaande
hashgebaseerde opslag het bestand; daarna wisselt een database-transactie de
CFM-mediakoppeling. Oudere bestanden/mediaversies worden niet verwijderd. Een
bestaand beschadigd bestand kan atomair worden hersteld met een geldige download
van dezelfde huidige bestandsidentiteit. Netwerk-/validatie-/transactiefouten laten
bestaande geldige bestanden behouden.

De checksum van het werkelijk opgeslagen bestand blijft de controle op
opslagcorruptie. Zij is geen verplichte vergelijking met historische CDN-bytes.
`media-lock.json` blijft voor compatibiliteit bronregister en diagnostische historie;
het wordt niet automatisch herschreven. De leslayout en teksthash blijven gelijk,
ook wanneer een geldige officiële afbeelding anders gecomprimeerd of geschaald is.

## Database en uitrolgrens

Migratie `20261210140000_cfm_dynamic_image_bindings` is noodzakelijk omdat de oude
database iedere wijziging van een mediakoppeling verbood. Ze voegt geen tabellen,
kolommen of data toe. Alleen de geregistreerde CFM-2026/2027-koppelingen mogen binnen
 dezelfde officiële bron, rechten en opslagvolume naar een READY-versie wisselen.
Revisie-ID, mediaKey, teksten, audits en overige programma’s blijven beschermd.
Een begrensde, additieve checksumhistorie in bestaande bronmetadata bewijst de
herkomst van bestaande revisiekoppelingen zonder oude afbeeldingsbytes op te zoeken.

Nieuwe jaargangen vereisen ook een expliciete uitbreiding van deze database-allowlist.
Geen bron wordt bij migratie of deployment gedownload, geïmporteerd of gepubliceerd.

Uitrol gebeurt uitsluitend door de eigenaar na review/mergebesluit. Maak volgens de
bestaande procedure een database-/mediaback-up. Na echte vervanging is teruggaan
naar de oude applicatie met uitsluitend een code-rollback onvoldoende: die oude
versie verwacht historische mediapins en kent de nieuwe diagnosemetadata niet.
De oude bestanden blijven bewaard; beoordeel een rollback samen met de bestaande
koppelingen en back-up. Voer geen ad-hoc productie-SQL uit.

## Tests en grenzen

Normale CI genereert synthetische CFM-afbeeldingen; geen veranderlijke externe
beeldendienst. OTB-bronbestanden behouden hun exacte gepinde Git-blobcontrole.
De echte downloader, installatie en vervanging worden afzonderlijk getest met
gecontroleerde transportinputs en een geïsoleerde PostgreSQL-database. Zie de PR
voor exacte head, resultaten en Actions-status.

Deze Linux-cloudomgeving weigert directe HTTPS naar de officiële beeldhost met
`ECONNREFUSED`, terwijl DNS publieke adressen geeft. Dat is geen groene live
netwerkproef. Alle veertien eerder officieel gedownloade actuele JPEG-monsters zijn
wel door de nieuwe validatie verwerkt. Een echte backenddownload en toestelacceptatie
blijven controles van de eigenaar; er is geen NAS-verbinding of uitrol uitgevoerd.
