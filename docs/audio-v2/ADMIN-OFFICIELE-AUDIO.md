# Officiële audio vanuit de adminbackend

Ontwikkelwerk op basis van main `39f7fd57a168fea386495257731d347a5e4c3bc6`.
Dit document wordt vóór oplevering aangevuld met de werkelijk uitgevoerde tests en screenshots.
Geen productie-, NAS-, import-, publicatie-, deployment- of mergehandeling door Codex.

## Bediening voor de eigenaar

Open **Adminbackend → Content → Audio**. Het eerste blok behandelt uitsluitend Ether 1 in nl/en/de/fr/es,
met de Engelse mannelijke stem en de vier overige officiële audiostemmen.

1. **Ether 1 downloaden** bevestigen. De server controleert officiële pagina, taal, passage, tekst-/kopbronhash,
   stem/URL, maximale bytes, SHA-256, MP3-signatuur, ffprobe en volledige ffmpeg-decode. De gepinde 43 versgrenzen
   moeten bij dezelfde audio en tekst horen. Voortgang blijft bewaard; de pagina mag worden gesloten.
2. **Gecontroleerde pilots registreren** apart bevestigen. Alleen de werkelijk geselecteerde talen staan in het besluit.
   De bestaande Audio V2-importer krijgt een onveranderlijk pakket; deze actie publiceert niets.
3. Opnamen via de bestaande beveiligde beheerpreview beluisteren. **Pilots publiceren** toont de exacte hoofdstukken
   en talen. Iedere pointerwissel gebruikt de bestaande versiecontrole. Een deelfout betekent dat eerdere, bewust
   bevestigde hoofdstukken al gepubliceerd kunnen zijn; verversen en alleen de resterende kandidaten beoordelen.
4. Pas na beluisteren en echte vers-/spelercontrole **Pilot goedkeuren**. Dat ontsluit grotere selecties; de knop
   start zelf geen download, registratie of publicatie. Bij vervangen/verwijderen van een pilotpointer vervalt de gate.

Registraties en publicaties worden los geteld. Een bestand kan ontbreken terwijl een registratie nog bestaat.
De broncatalogus bewijst geen actuele netwerkbeschikbaarheid: **Gecontroleerd** telt daadwerkelijk opnieuw
gecontroleerde bronnen via deze bediening. Voorheen aangeleverde registraties blijven zichtbaar in het bestaande overzicht.

## Beveiligings- en opslaggrenzen

- De beheerpagina en GET-status lezen alleen. Geen herstel van ContentUpdateRun, seed, migratie, tekstimport of mirror-opdracht.
- De nieuwe bediening maakt geen ontbrekende tekstuitgaven aan. Ontbrekende/veranderde tekst blokkeert de actie;
  de zes verborgen DC/PGP-uitgaven, cursussen/oefeningen en alle gebruikersvoortgang worden ongemoeid gelaten.
- `official-cache/<bronidentiteit>/` bevat nieuwe gedownloade bestanden op de bestaande AUDIO_DIR-mount.
  MP3-validatie hergebruikt `storeAudio` en kan een nieuw onveranderlijk object aanmaken; er ontstaat nog geen AudioRecording.
- Een download legt niets in incoming. Pas het aparte registratiebesluit maakt via staging een compleet READY-pakket
  zichtbaar voor de bestaande scanner. Ook die scanner controleert de duurzame registratiegoedkeuring en actuele beheerrechten.
- Tijdelijke bestanden hebben een eigen poging-ID; bestaande cache-, object-, legacy- of pakketbestanden worden nooit overschreven.
  Een afgebroken netwerkdownload wordt veilig opnieuw geprobeerd; geen belofte van byte-exact netwerkhervatting na procesuitval.
- De 205 bekende NL-legacydoelen zijn beschermd tegen nieuwe V2-acties/publicatie. Hun bestaande afspeelroute/mirror blijft werken.
  De 19 bekende V2-reviewidentiteiten blijven uitgesloten. Een kwaliteitsvlag of zichtbaarheid wordt nooit automatisch gepromoveerd.
- Geen Python, SSH, Docker-socket, nieuw containerproces of TTS-generator in de webapp. De bestaande Node-runtime en ffmpeg volstaan.
  Geen Bijbel/CFM/FSY in deze bediening.

## Duurzame taken en meerdere appcontainers

Eén nieuw model **OfficialAudioTask** orkestreert bestaande AudioPackage → AudioRecording → AudioPublication.
Het is geen tweede audiosysteem of algemene jobengine. De taak-ID bindt werk, uitgave, taal, boek, hoofdstuk, stem,
bron-URL, teksthash en MP3-hash; checkedAt is geen nieuwe actie-identiteit. De manifestinhoud blijft na controle bevroren.

De bestaande scheduler en een korte enqueue-API starten een begrensde serie; één gedeelde PostgreSQL-advisory-lock
laat één worker tegelijk downloaden. Geen HTTP-/decodewerk in een langlopende database-transactie. Een lease/token,
heartbeat en stop bij verloren verbinding bewaken de voortgang. Na procesuitval wordt een verlopen taak hervat.
Een geldige cache wordt opnieuw gecontroleerd en hergebruikt. Eigen afgebroken tijdelijke bestanden kunnen achterblijven;
geen automatische brede opruiming. FAILED vraagt een expliciet bevestigd herstelbesluit; importlock/receipt-backoff wacht automatisch.

Mutaties gebruiken de bestaande beheeridentiteit, actuele rol/sessionVersion, origincontrole, begrensde JSON en uitsluitend
servergekozen bronnen. DNS-adressen en iedere redirect moeten publiek en op de vaste officiële allowlist blijven.
Afbreken en timeout gelden ook bij DNS- of responswachten. Geen URL, transport, pad of validator uit een clientpayload.

Lockvolgorde voor kritieke mutaties: User → officiële pilotpolicy → taak → canonieke bronclaim → AudioPackage/hoofdstuk.
De bestaande contentimportlock blijft om registratie heen staan. De importer autoriseert adminpakketten ook vlak voor commit;
het alleen bestaan van READY is daarvoor onvoldoende. Een al geldige commit blijft geldig bij een latere uitlog-/rolwijziging.

Canoniek gelijke officiële bronnen krijgen onder een transactionele advisory-lock maximaal één AudioRecording, ook als een
oud script een nieuw checkedAt/pakket-ID maakte. Een tweede receipt kan READY worden met verwijzing via de al bestaande
canonieke opname; een READY-receipt hoeft daarom geen nieuw opnamerecord te betekenen. De nieuwe taak bewaart het werkelijke recording-ID.

## Migratie en compatibiliteit

`20261206120000_official_audio_tasks` voegt uitsluitend een taak-/goedkeuringslog toe, na de bestaande Audio V2-migratie.
Oude migraties, teksten, audio, saldi en voortgang veranderen niet. De pilotgoedkeuring wordt op de vijf betrokken taken
met dezelfde goedkeuringssleutel, beheerder en tijd opgeslagen; ontbrekende/vervangen publicatie sluit de gate opnieuw.
Een oude app blijft bestaande opnamen afspelen. Tijdens een toekomstige uitrol geen oude schrijvende processen naast de
nieuwe adminpakketbewaking laten draaien: die oude importer kent de nieuwe goedkeuringsguard niet.
Geen schema-rollback of downmigratie; een toekomstige uitrol vereist afzonderlijk akkoord, consistente back-up en NAS-acceptatie.

## Verificatie — nog in uitvoering

Gerichte unit-, database-, multi-process-, herstart-/fout-, autorisatie- en mobiele browserregressies volgen op deze implementatie.
Een eerder groen Audio V2-rapport is geen bewijs voor deze nieuwe code. NAS- en fysieke apparaattests blijven werk van de eigenaar.
