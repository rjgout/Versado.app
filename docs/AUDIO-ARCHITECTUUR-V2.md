# Audiobibliotheek V2 — fase 1 en 2

## Grenzen en besluit

Nieuwe branch vanaf main `7da9c704c36c4b19e7eeeb36d43623a3046d164e`.
PR #187 blijft apart en ongemerged. De eigenaar koos automatische validatie/registratie,
met **expliciete beheerpublicatie** van iedere nieuwe/vervangende opname. Er is geen automatische
activering, contentvrijgave, productie-import of NAS-handeling uitgevoerd.

Toegestaan: BOM, Leer en Verbonden, Parel van Grote Waarde, nl/en/de/fr/es.
De eigenaar gaf afzonderlijk toestemming voor zes ontbrekende tekstuitgaven van DC/PGP
(de/fr/es): officiële tekst, verborgen, uitgeschakeld, DRAFT, zonder cursussen/oefeningen.
`ensureHiddenAudioTextEditions` maakt uitsluitend ontbrekende uitgaven; bestaande uitgaven blijven intact.
Deze stap loopt via de expliciete officiële importopdracht, niet via een volledige seed.
Geen Bijbel (fase 3), geen CFM/FSY-audioactivering/generatie (fase 4), geen spraakcontainer.

## Identiteit en opslag

Bestaande ContentCollection → Book → Chapter → Verse blijft de enige schriftidentiteit.
`AudioRecording` bindt collectie, werk, uitgavefamilie, taal met een samengestelde FK.
Een opname heeft precies één hoofdstuk- of StudyRevision-anker (SQL CHECK). Het laatste
is voorbereid voor de bestaande onveranderlijke revisie/block-ID's; de ontvanger weigert
studie-audio in fase 1/2. `ContentMedia` blijft uitsluitend het bestaande beeldmodel.

Een hoofdstukversie is SHA-256 van `canonicalJson({heading, verses:[{number,text}]})`:
exacte Unicode-tekst, bestaande hoofdstukkop, geordende verzen. Geen verliesgevende normalisatie.
Elk segment bindt het bestaande Verse.id en SHA-256 van de exacte verstekst.
NL-BOM gebruikt de bestaande aparte `bomChapterHeadings.json`, zoals de contentseed.
Een andere taal wordt uitsluitend via dezelfde werk-/uitgavefamilie en bestaande toegangscontrole gekozen.

`AudioPackage` is het importbewijs (pakket-ID, manifestchecksum, pogingen, lease/token, foutcode).
`AudioRecording` is de onveranderlijke registratie met checksum, duur, omvang, bron, stem, kwaliteit en segmenten.
`AudioPublication` is één actuele pointer per `chapter:<Chapter.id>` met versienummer en beheer-auditanker.
Registreren is geen publiceren; audiopublicatie is geen contentpublicatie.

De bestaande NAS-map blijft `/volume1/docker/jehova-app/audio`, gemount als `/data/audio` (`AUDIO_DIR`).
Legacy MP3's op de root blijven staan. Nieuwe objecten staan in `objects/<sha256>.mp3`.
Zie [pakketcontract](audio-v2/IMPORTCONTRACT.md) en [beheer](audio-v2/BEHEER.md).

## Transactie, retries en fouten

De ontvanger accepteert alleen complete mappen in `incoming/<packageId>` met READY-marker.
Strikt JSON-contract, begrensde bestanden, geen symlinks/FIFO/devices/paden, SHA-256 van alle
bijlagen, exacte tekstbinding en voor publiceerbare opnamen alle verzen met eindige, oplopende
segmentgrenzen binnen de duur. Een geldig bestand zonder veilige verstijden wordt uitsluitend
met lege segmentlijst als NEEDS_REVIEW geregistreerd; nooit stilzwijgend een versindeling verzinnen.
MP3 wordt geprobed én volledig gedecodeerd met ffprobe/ffmpeg, zonder externe protocollen,
met harde subprocesslimieten. De bestaande runner krijgt ffmpeg; geen extra container.

Objecten worden eerst onder een willekeurige `.part` in de app-eigen objectmap geschreven,
gedecodeerd en gesynchroniseerd. Exclusieve hardlink-publicatie naar de inhoudshash voorkomt
overschrijven. Een al bestaand object moet zelf opnieuw dezelfde checksum hebben. De map wordt
ook gesynchroniseerd. Pas daarna schrijft één DB-transactie de registratie én READY-status.
Bij DB-rollback kan een ongebruikt object blijven staan; een actieve opname wordt nooit verwijderd.
Geen automatische garbagecollector of dataverwijdering in deze fase.

Lease 5 minuten, fencing-token en voorwaardelijke statusovergang voorkomen dubbele commits
op meerdere processen. Een gecrasht proces kan na leaseverloop worden hervat. Fouten krijgen
begrensde exponential backoff (60 seconden tot 1 uur); manifest/pakket-ID blijft onveranderlijk.
Een gewijzigd pakket gebruikt een nieuwe identiteit. Herimport van READY geeft dezelfde receipt.
Een scanner verwerkt maximaal 20 nieuwe/vervallen pakketten per tick en overlapt lokaal niet.
De bestaande minuut-scheduler is het detectieritme; geen Redis-lock of nieuwe daemon.

Publicatie controleert het object vóór de korte transactie. Lockvolgorde: beheer-User →
transactie-advisorylock voor target → Chapter → geordende Verse-rijen. Beheerdersrol en
sessieversie worden na de User-lock opnieuw gecontroleerd. Teksthash, collectie-identiteit en
segmentbinding worden opnieuw gecontroleerd; een verwacht publicatieversienummer voorkomt
het overschrijven van een gelijktijdige beheerbeslissing. Pointer en beheer-auditanker committen samen.
Een publicatiefout verandert de vorige pointer niet. Een response/broadcast is geen commitbewijs.

De speler/minispeler blijven hetzelfde. Nieuwe actieve audio wordt via de bestaande taal-API
opgelost; de teksttaal is ook zonder eerdere taalvoorkeur de standaard. Geen actieve V2-opname:
legacy blijft beschikbaar. Gewijzigde tekst of ontbrekend/corrupt V2-object: apparaat-TTS.
Bestaande NL-bestanden/tijdcodes worden niet herschreven. Een onvolledige legacy-import wist
geen audio meer; V2-import raakt Chapter.audioUrl/Verse.audioStart niet.

## Afspeelrechten en compatibiliteit

GET/HEAD/Range vereisen de bestaande geldige websessie én bestaande contenttoegang.
Een vervangen V2-ID is voor gewone gebruikers niet meer afspeelbaar. DRAFT/uitgeschakeld/
verborgen content blijft afgeschermd. Alleen beheerders hebben expliciete `?preview=1`-toegang
via het bestaande admin-previewrecht. Alle responses met audio gebruiken private/no-store;
strikte ranges, descriptorcontrole en NOFOLLOW voorkomen pad-/bestandstypeproblemen.
Legacy URLs behouden hun pad, maar vereisen nu ook toegang tot een bijbehorend hoofdstuk.

Geen nieuw sessiesysteem, token in URL of native-cookie-terugval. De bestaande lokale native
lezer heeft nog geen audiotransport/playerpariteit (zie NATIVE-FEATURE-PARITY.md); dit werk
claimt die niet. Native compilatie is een regressiecontrole, geen bewijs van achtergrondweergave,
headsetbediening of fysieke apparaattests. Dat bestaande tekort vraagt een afzonderlijk native
mediacontract en integratie van dezelfde speler/platformadapter.

PR #187 overlapt in `prisma/importAudio.ts`: behoud bij latere integratie zijn ChapterAudioCheck
bij tekstupdates én de niet-destructieve importregel van deze PR. Dat reviewmodel vervangt de
exacte opnamehash niet. Geen van zijn modellen/migraties is hier gekopieerd of gecherrypickt.

## Migratie en uitrolstrategie (eigenaar)

`20261204120000_audio_library_v2` is additief: drie lege tabellen, FKs, unieke constraints en checks.
De naam volgt bewust op de bestaande decembermigraties; bestaande migraties worden niet hernoemd.
Geen tekst, saldo, voortgang, bestaande audio of publicatie wordt verwijderd/verplaatst.
Oude clients behouden hun API; velden blijven compatibel. Oude servers kennen V2 niet en
blijven legacy spelen; laat tijdens een latere uitrol geen nieuwe audiopublicatie plaatsvinden
voordat alle servers de V2-resolver draaien. PostgreSQL migreren is geen toestemming tot publiceren.
Bij app-rollback blijven objecten/tabellen bestaan; legacy blijft bruikbaar. Geen destructieve down-migratie.
Uitrol en controle op de echte NAS blijven uitsluitend bij de eigenaar.

## Officiële broncontrole en tests

Zie [inventaris en werkelijk testbewijs](audio-v2/RESULTATEN.md).
Broncontrole betreft iedere hoofdstuk-taalcombinatie en iedere aangeboden stemvariant,
met daadwerkelijke download, checksum, duurmeting en volledige decodering. Een HTTP-link
alleen geldt nooit als beschikbaarheidsbewijs. Productiedatabase/NAS zijn niet geïnspecteerd;
seedregistratie, lokale ontwikkelbestanden en geïsoleerde testregistraties worden apart vermeld.

`VALIDATED` betekent de technische segment-/broncontroles zijn gehaald, geen onafhankelijke
linguïstische luisteraudit. `NEEDS_REVIEW` is niet publiceerbaar. Beoordeel een opname en lever
bij correcties een nieuw pakket met nieuwe identiteit aan; wijzig geen geregistreerde opname in SQL.
