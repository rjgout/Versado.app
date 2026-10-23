# Beheer van audio V2

Alle opdrachten op de echte NAS en alle uitrolhandelingen worden uitsluitend door de eigenaar gedaan.
Codex heeft alleen een geïsoleerde ontwikkel-/testomgeving gebruikt. Er is niets gepubliceerd of gedeployd.

## Ontvangen en beoordelen

De bestaande audio-mount blijft staan; voeg geen andere hoofdmap of nieuw volume toe.
App-eigen mappen: `objects/`, `staging/`; aanlevering: `incoming/`.
Geef een toekomstige generator alleen schrijfrechten op zijn staging/aanlevermap, niet op objects,
legacy-bestanden of de database. De app leest bestanden zonder symlinkvolging en weigert afwijkende bestandstypes.
Bewaar de mount bij app-rollback en back-up de bestaande PostgreSQL/audio-combinatie volgens het bestaande beheerproces.

Een complete map met READY wordt iedere minuut ontdekt. Maximaal 20 kandidaten per tick,
herstelbare lease en backoff. Geen contentherlaad/deploy nodig voor volgende pakketten.
In `/adminbackend/content/audio` staan registraties, bron/kwaliteit/importstatus, bestaande
hoofdstukaudio, lokaal aanwezige hoofdstukken, nieuwe objectomvang en recente importfouten.
De nieuwe objectomvang telt iedere inhoudshash per collectie eenmaal; dit is geen meting van
alle historische legacy-MP3's of filesystem-overhead. Lokale aanwezigheid is een momentopname
van bestandsnamen; tijdens oplossen/afspelen volgen daadwerkelijke objectcontroles.

Een beheerder kan een opname in een aparte tab beluisteren (bestaand admin-previewrecht).
Alleen technisch VALIDATED opnamen zijn publiceerbaar. Publiceer bewust na beoordeling;
de bevestiging vervangt uitsluitend de actieve audio. Verborgen/DRAFT tekst wordt daarmee niet vrijgegeven.
Bij een gelijktijdige wijziging: vernieuw en beoordeel de actuele pointer opnieuw. Geen automatisch
opnieuw verzenden met een hoger versienummer zonder nieuwe beheerbeslissing.

Bij FAILED: lees de foutcode, corrigeer de oorzaak. Inhoudelijke wijziging → nieuw pakket-ID.
Dezelfde bytes na een tijdelijke opslag-/DB-fout worden na backoff opnieuw geprobeerd. Bij procesuitval
vervalt de lease na maximaal 5 minuten. Opruimen van oude/inactieve objecten is handmatig buiten
scope van deze PR; verwijder geen bestand dat een bestaande of terug te zetten opname nodig heeft.

## Officiële inventaris opnieuw maken

In een eigen ontwikkelomgeving met Python, ffmpeg/ffprobe en voldoende schijfruimte:

```bash
python3 scripts/audio/official_inventory.py --download --workers 5
python3 scripts/audio/prepare_text_editions.py
```

Dit controleert alle 1.965 doelen en bewaart downloadreceipts met het echte oorspronkelijke
controlemoment. Cachehergebruik is geen nieuwe netwerkcontrole. Begin voor een geheel nieuwe
broncontrole met een andere `--root`; de uitlijn-/importopdrachten verwachten standaard `.audio-v2-work`.
Geen productiegegevens, audio of modellen in git. De inventaris zelf bevat geen gebruikersgegevens.

## Uitlijnen en registreren

Gebruik de bestaande `scripts/bom-audio`-dependencies (`numpy`, `av`, `vosk`) en de vijf in
`common.py` benoemde kleine Vosk-modellen onder `.audio-v2-work/models/`.

```bash
python3 scripts/audio/align_official.py
# Expliciete database-/volumeconfiguratie van de EIGEN omgeving vereist:
npm run audio:import-official -- .audio-v2-work
```

De importer gebruikt dezelfde ontvangende validator; geen alternatieve SQL-registroptie.
De meegeleverde `data/audio/official-alignments.json` kan uitsluitend worden hergebruikt bij
exact dezelfde audiochecksum én tekstversie. Daardoor hoeft de eigenaar bestaande berekende
uitlijningen niet opnieuw met Vosk te draaien. Een nieuwe/afwijkende bron zonder geldige
uitlijning wordt herkenbaar als NEEDS_REVIEW met lege segmentlijst geregistreerd, alleen
beluisterbaar in beheerpreview en niet publiceerbaar. Corrigeer tijdcodes in een nieuw pakket.
De ontvangende app-image bevat de Node-import-/export-CLI en de metadata, geen Python-ASR
of bron-MP3's. Broncontrole en eventuele heruitlijning worden buiten de runtime-image gedaan.
Hij maakt de zes goedgekeurde ontbrekende tekstuitgaven indien nodig verborgen aan, maar
overschrijft nooit een bestaande collectie/tekst. Een anders ingerichte tekstuitgave moet eerst
inhoudelijk worden beoordeeld: SOURCE_MISMATCH is geen reden om een hash in SQL aan te passen.
Geen cursussen, oefeningen, XP of voortgang. **De import publiceert nul opnamen.**
Downloads en tussentijden zijn lokaal; de bronbestanden worden vanwege omvang niet in de Docker-image
opgenomen. De ontvangende infrastructuur draait wel in de bestaande app. Er is geen ASR/TTS-container.
Voor nieuwe pakketten hoeft de app niet opnieuw gebouwd te worden.

## Testen

```bash
npm run test:audio
npm run test:audio:browser
# Volledige echte bronregistratie, uitsluitend in de eigen wegwerpdatabase:
node scripts/audio/test-isolated.mjs --official
```

De geïsoleerde runner kiest zelf PostgreSQL/Redis-containers, loopbackpoorten en tijdelijk
AUDIO_DIR; geërfde database-/Docker-endpoints worden niet gebruikt. Alle testdata wordt verwijderd.
De echte bronproef controleert ook de zes verborgen uitgaven en nul officiële publicaties.
Zie RESULTATEN.md voor werkelijk uitgevoerde controles en beperkingen; opdrachten zijn geen uitvoeringsbewijs.

Een tekstexport voor een toekomstige generator maakt de eigenaar met
`npx tsx scripts/audio/export-targets.ts /eigen/beveiligde/targets.json`. Het bestand wordt
alleen nieuw aangemaakt, met modus 0600; het bevat geen accounts of databasecredentials.
Er wordt uitsluitend bestaande tekst/identiteit van de drie toegestane werken geëxporteerd.
