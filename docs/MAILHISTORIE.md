# Mailhistorie en openingsdetectie

Onder **Beheer → Communicatie → Verzonden e-mails** staan verzendingen vanaf invoering van deze functie. Oude verzendingen kunnen niet worden gereconstrueerd. Filters: ontvanger/onderwerp, mailtype, verzendstatus en datumbereik (UTC-daggrenzen). Paginering toont 25 mails. De foutentelling geldt voor de huidige selectie. De centrale live-data-laag ververst bij terugkeer, na herverzenden en elke minuut zolang de pagina zichtbaar is.

## Betekenis van statussen

| Status | Betekenis |
|---|---|
| Wordt verstuurd | De poging is vastgelegd; er is nog geen definitieve SMTP-uitkomst. |
| Geaccepteerd door mailserver | SMTP heeft de ontvanger en het bericht geaccepteerd. Dit bewijst geen aflevering in de inbox. |
| Mislukt | De verzending/SMTP-acceptatie is mislukt of de ontvanger is geweigerd. |
| Aflevering onzeker | Bijvoorbeeld een verbroken verbinding/timeout of een onderbroken proces. De mail kan al zijn afgeleverd. |
| Overgeslagen | E-mail is niet geconfigureerd, de gebruiker was online of de mailvoorkeuren stonden verzending niet toe. |

`sendMail` is het centrale auditpunt voor authenticatiemails, aanmeldwaarschuwingen, notificaties, feedback en testmails. Per poging worden tijd, ontvanger, type, onderwerp, veilige tekstpreview, SMTP-bericht-id, serverantwoord en eventuele diagnose vastgelegd. Niet alle mails worden überhaupt opgebouwd: selectie door een scheduler of een uitgeschakelde notificatiecategorie blijft een bestaande keuze vóór verzending en is geen historische verzendpoging.

De bestaande SMTP-configuratie levert geen betrouwbare downstream-bezorg-, bounce- of spammapstatus. Deze worden daarom niet gesuggereerd. Een latere providerkoppeling moet ondertekende, herhaalbaar te verwerken afleverevents aan de SMTP-identiteit koppelen; er is nu geen onbeveiligde algemene webhook.

## Opnieuw verzenden

De knop vraagt bevestiging en waarschuwt voor mogelijke dubbele aflevering. Elke echte herverzending maakt een nieuwe logregel met de beheerder en het oorspronkelijke familie-id. Ook herverzendingen van herverzendingen verwijzen naar hetzelfde origineel. Een atomair bewaakte afkoeltijd van 60 seconden geldt voor de hele familie, ook over tabs/processen. Er zijn geen automatische SMTP-retries bij een onzekere uitkomst.

- Wachtwoordherstel en accountbevestiging worden opnieuw opgebouwd met een nieuw, bestaand eenmalig authenticatietoken. Ruwe tokens worden niet in de mailhistorie opgeslagen, ook niet versleuteld. Het bestaande tokengedrag en de bestaande vervaltermijnen blijven gelden. Een herverzending trekt geen sessies in en wijzigt geen wachtwoord.
- Een reeds bevestigd account krijgt geen nieuwe bevestigingsmail. Een gewijzigd e-mailadres wordt niet stilzwijgend gebruikt als andere bestemming. Wachtwoordherstel is niet beschikbaar voor accounts zonder wachtwoordinlog.
- Een open voorlopige aanmelding gebruikt de bestaande herverzendprocedure en mailgrens; de bestaande aanmeldlink wordt vervangen. Na bevestiging of verwijdering kan deze niet opnieuw worden verzonden.
- Notificatiemails lopen via de centrale notificatieherverzendfunctie. De huidige e-mail- en categorievoorkeuren gelden, en de bestaande uitschrijflinks blijven aanwezig. Deze expliciete beheeractie verstuurt alleen e-mail: geen nieuwe push, belmelding of beloning. Een online ontvanger blokkeert deze expliciete beheeractie niet.
- Gewone mails kunnen opnieuw worden verstuurd uit een versleutelde kopie (AES-256-GCM via de bestaande sleutel afgeleid van `SESSION_SECRET`). Alleen payloads tot 256 KB zonder bijlagen worden daarvoor bewaard. Bijlagen worden niet gekopieerd naar het log. Ontbrekende gegevens, sleutelrotatie of niet-herhaalbare mails maken de actie niet beschikbaar.

## Openingsdetectie

Bij de SMTP-instellingen staat een aparte schakelaar, **standaard uit**. Bij ingeschakelde detectie krijgt elke nieuwe HTML-mail een eigen transparante afbeelding:

`GET /api/mail/open/<willekeurige-code>`

De code heeft 256 bits willekeur en bevat geen ontvanger, gebruiker of voorspelbaar mail-id. Alleen de SHA-256-hash staat in de database. Iedere herverzending krijgt een nieuwe code. De oorspronkelijke HTML/text-herverzendkopie bevat de pixel niet. Een tekstmail kan geen openingsdetectie ondersteunen.

De app registreert alleen eerste/laatste detectie en het aantal GET-ophalingen. Geen IP-adres, user-agent of apparaatprofiel. HEAD telt niet. Updates zijn atomair, de teller is begrensd, oude codes verlopen na 90 dagen. Ongeldige en onbekende codes geven dezelfde transparante GIF en onthullen geen mailgegevens. Antwoorden hebben `no-store`/`no-cache` en geen verwijzende URL. Tracking uitschakelen stopt ook registratie bij eerder verzonden pixels.

**Opening gedetecteerd is geen leesbewijs.** Sommige mailprogramma's halen beelden vooraf op via privacyproxies; andere blokkeren ze. Ook aantallen kunnen daardoor afwijken. Aflevering, een pixelophaling en werkelijk lezen zijn verschillende dingen. Deze beperking staat in beheer en de privacyverklaring. Algemene infrastructuurlogs van de webserver vallen onder het bestaande beheer van die infrastructuur, niet onder de openingsregistratie.

## Privacy, bewaring en toegang

De beheerpreview is gewone tekst, door React ge-escaped, met links en lange bewijzen onbruikbaar gemaakt. Er wordt geen opgeslagen HTML uitgevoerd en er worden geen externe beelden, pixels of bijlagen geladen. Bekijken in beheer veroorzaakt dus geen openingsdetectie. SMTP-inloggegevens en ruwe authenticatiebewijzen staan niet in de preview of diagnose.

De lijst-API geeft geen versleutelde payload of trackinghash terug. Alleen ingelogde beheerders mogen lijst en herverzenden gebruiken. De publieke pixelroute geeft uitsluitend een vaste afbeelding. Herverzendacties hebben de bestaande same-origin/CSRF-bescherming.

Logregels, previews, gecodeerde herverzendinhoud en openingsgegevens worden maximaal 90 dagen bewaard. De bestaande uurlijkse opruimtick verwijdert verlopen rijen en markeert achtergebleven verzendpogingen na 10 minuten als onzeker. De lijst en pixelroute hanteren de bewaartermijn ook als de opruimtick tijdelijk niet draait. Verwijderen van een gekoppeld gebruikersaccount verwijdert zijn mailregels via een cascade; externe ontvangers en voorlopige aanmeldingen vallen onder de bewaartermijn.

De additieve migratie is `20261207120000_mail_history`. Oudere clients kunnen de SMTP-instellingen blijven opslaan zonder de nieuwe schakelaar te wijzigen. De eigenaar verzorgt productie-uitrol en functionele acceptatie. Er is geen historische backfill of verzending tijdens migratie.

## Technische controle

`npm run test:mail-history:integration` gebruikt een eigen lokale PostgreSQL-database, een eigen nep-SMTP-server op loopback en synthetische gebruikers. Er worden geen echte mails, externe SMTP-diensten of productiegegevens gebruikt. De proef controleert SMTP-statussen, afgeschermde beheer-API's, tracking/uitschakelen/HEAD, veilige previews, nieuwe beveiligingslinks, voorkeuren, gelijktijdige herverzendclaims, bewaring en behoud van gebruikersvoortgang. Browserbewijs wordt als CI-artifact bewaard.
