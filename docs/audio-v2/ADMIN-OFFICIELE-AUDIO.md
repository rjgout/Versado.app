# Officiële audio vanuit de adminbackend

Ontwikkelwerk op basis van main `55ef86e65def1d3094138a0846dedfe2f6ed7440`.
Deze functionaliteit is ontwikkelwerk voor een draft-PR; beschikbaarheid op de NAS vereist later afzonderlijk uitrolakkoord.
Geen productie-, NAS-, import-, publicatie-, deployment- of mergehandeling door Codex.

## Bediening voor de eigenaar

Open **Adminbackend → Content → Audio**. Het eerste blok behandelt uitsluitend Ether 1 in nl/en/de/fr/es,
met de Engelse mannelijke stem en de vier overige officiële audiostemmen.

1. **Ether 1 downloaden** bevestigen. De server controleert officiële pagina, taal, passage, tekst-/kopbronhash,
   stem/URL, maximale bytes, SHA-256, MP3-signatuur, ffprobe en volledige ffmpeg-decode. De gepinde 43 versgrenzen
   moeten bij dezelfde audio en tekst horen. Voortgang blijft bewaard; de pagina mag worden gesloten. Bestaande geldige opnamen worden gecontroleerd en gekoppeld, zonder ze opnieuw te downloaden of te publiceren. Als alleen koppelen nodig is, maakt dit uitsluitend taakmetadata aan.
2. **Gecontroleerde pilots registreren** apart bevestigen. Alleen de werkelijk geselecteerde talen staan in het besluit.
   De bestaande Audio V2-importer krijgt een onveranderlijk pakket; deze actie publiceert niets.
3. Opnamen via de bestaande beveiligde beheerpreview beluisteren. **Pilots publiceren** toont de exacte hoofdstukken
   en talen. Iedere pointerwissel gebruikt de bestaande versiecontrole. Een deelfout betekent dat eerdere, bewust
   bevestigde hoofdstukken al gepubliceerd kunnen zijn; verversen en alleen de resterende kandidaten beoordelen.
4. Pas na beluisteren en echte vers-/spelercontrole **Pilot goedkeuren**. Dat ontsluit grotere selecties; de knop
   start zelf geen download, registratie of publicatie. Bij vervangen/verwijderen van een pilotpointer vervalt de gate.

De interface toont apart bekende bronhoofdstukken, ontbrekende lokale teksthoofdstukken, registraties en publicaties. Een bestand kan ontbreken terwijl een registratie nog bestaat. Vrije ruimte is een actuele meting van de app-opslagmap, geen bewijs van een blijvende Docker-bindmount; die blijft een uitrolcontrole van de eigenaar.
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

Alle appcontainers moeten dezelfde fysieke blijvende audiomount delen; dezelfde padnaam alleen bewijst dat niet.

Eén nieuw model **OfficialAudioTask** orkestreert bestaande AudioPackage → AudioRecording → AudioPublication.
Het is geen tweede audiosysteem of algemene jobengine. De taak-ID bindt werk, uitgave, taal, boek, hoofdstuk, stem,
bron-URL, teksthash, MP3-hash en de versie van kwaliteit/tijdcodes; checkedAt is geen nieuwe actie-identiteit. De manifestinhoud blijft na controle bevroren.

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

Canoniek gelijke officiële bronnen met dezelfde kwaliteitsstatus en versgrenzen krijgen onder een transactionele advisory-lock maximaal één AudioRecording, ook als een
oud script een nieuw checkedAt/pakket-ID maakte. Een tweede receipt kan READY worden met verwijzing via de al bestaande
canonieke opname; een READY-receipt hoeft daarom geen nieuw opnamerecord te betekenen. Een legitiem gewijzigde tijdcode-/kwaliteitsversie blijft een afzonderlijke onveranderlijke opname; de oude versie wordt niet gewijzigd. De nieuwe taak bewaart het werkelijke recording-ID.

## Migratie en compatibiliteit

`20261206120000_official_audio_tasks` voegt uitsluitend een taak-/goedkeuringslog toe, na de bestaande Audio V2-migratie.
Oude migraties, teksten, audio, saldi en voortgang veranderen niet. De pilotgoedkeuring wordt op de vijf betrokken taken
met dezelfde goedkeuringssleutel, beheerder en tijd opgeslagen; ontbrekende/vervangen publicatie sluit de gate opnieuw.
Een oude app blijft bestaande opnamen afspelen. Tijdens een toekomstige uitrol geen oude schrijvende processen naast de
nieuwe adminpakketbewaking laten draaien: die oude importer kent de nieuwe goedkeuringsguard niet.
Geen schema-rollback of downmigratie; een toekomstige uitrol vereist afzonderlijk akkoord, consistente back-up en NAS-acceptatie.

## Verificatie en beperkingen

De nieuwe tests gebruiken synthetische MP3’s met exact dezelfde validatieketen, echte tekstuitgaven uit de repository,
gesimuleerde HTTPS-responses en eigen tijdelijke PostgreSQL/Redis. Interne dependency-injectie levert de testreferentie;
er is geen testvlag, URL-/pad-/transportinvoer of validatorbypass in de API. De browsertest gebruikt toestandvolle HTTP-fixtures
voor de knopvolgorde; daadwerkelijke workers, registratie, publicatie en commitraces worden apart tegen dezelfde geïsoleerde DB getest.

De regressies omvatten twee echte Node-workers, twee verschillende pakketten voor één canonieke opname, behoud van nieuwe
onveranderlijke tijdcode-/kwaliteitsversies, rollback/fouttrigger, verloren antwoord, echte procesuitval, bron-/bytefouten,
rolintrekking tijdens een trage actie, een echte tekst-/commitlockrace, ontbrekende tekst/opslag en hergebruik van bestaande opnamen.
De 205 legacyhoofdstukken plus historische fixture, verborgen uitgaven, controlemarkeringen, cursussen/oefeningen en hintsaldi
blijven in de gegevenssnapshots gelijk. Nieuw aangemaakte testuitgaven en testpublicaties bestaan uitsluitend in wegwerpdatabases.

Werkelijk uitgevoerde eindcontroles:

| Controle | Resultaat |
|---|---|
| Audio-units | 14 geslaagd, 0 fouten/skips |
| Bestaande Audio V2-integraties | 30 geslaagd, 0 fouten/skips |
| Nieuwe officiële-audioketen | 15 geslaagd, 0 fouten/skips |
| Bestaande browser-/stream-/beheercontroles | 34 geslaagde assertions |
| Nieuwe pilotbediening | 46 geslaagde assertions; 320 px, 390 px donker/Duits/200%, 1280 px en tijdzone Amsterdam tegenover UTC-server |
| Gedeelde studiepublicatie/downloadhelpers | 33 unit-tests geslaagd |
| Prisma validate/generate, TypeScript, schone productiebuild | Geslaagd |
| Native inventaris genereren/checken en bijbehorende unit-test | Geslaagd; bestaande distributieprofielen/releasegrenzen behouden |
| Vijf talen | Alle nieuwe officialAudio-teksten aanwezig; globale bestaande dekking en/de/fr/es ieder 4304/4722 |
| ESLint | 0 fouten, 170 bestaande waarschuwingen buiten de nieuwe bediening |
| Productie-dependencyaudit | 0 kwetsbaarheden; geen dependency-/lockfilewijziging |

De opzettelijke databasefouttrigger verschijnt als Prisma-error in de testlog; de bijbehorende rollbacktest is groen.
De normale migratieketen en Audio V2 → Contentbeheer → nieuwe taaktabel zijn tegen uitsluitend wegwerpdatabases uitgevoerd.
Beide oude Audio-/Contentbeheer-migratiebestanden zijn bytegelijk aan main.

## Screenshots van de gesimuleerde bediening

Dit zijn beelden van de eigen geïsoleerde ontwikkelomgeving, met synthetische HTTP-/audiobronnen en testaccounts.
Het opslagcijfer in de beelden is **geen NAS-meting**. Bij 200% tekst wordt verticaal gescrold; de normale shell blijft aanwezig.

- [320 px: starten en voortgang](../screenshots/official-audio/pilot-320-nl.png)
- [390 px: fout/herstel in Duits, donker en 200% tekst](../screenshots/official-audio/pilot-390-de-dark200.png)
- [1280 px: afzonderlijk gepubliceerde pilots en pilotgoedkeuring](../screenshots/official-audio/pilot-1280-nl.png)

De definitieve aantallen en CI-status staan in de PR-beschrijving en moeten op de gepushte eindcommit worden gecontroleerd.
ESLint heeft bestaande waarschuwingen buiten de nieuwe bediening; ontbrekende oudere vertalingen buiten officialAudio blijven apart zichtbaar.
Geen volledige/native audiopariteit, echte NAS-prestaties of fysieke iOS-/Android-speleracceptatie geclaimd.

Nieuwe of gewijzigde officiële bronnen worden bij afwijkende identiteit, bytes of tekst geblokkeerd; er is geen automatische
kwaliteitsvrijgave of heruitlijning. Een beschadigd bestaand bestand wordt niet overschreven. De beheerder laat die afwijking
beoordelen; normale netwerkonderbrekingen en ontbrekende bestanden hebben veilige hervat-/ophaalacties in de interface.
Een oude groene Audio V2-run of een geslaagde healthcheck vervangt deze controles niet.
