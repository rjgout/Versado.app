# Beheer van audio V2

Audio V2 (#194) en Contentbeheer V2 (#187, merge `419ba1e51ee9ac102ef82ee024b0affab974cfb9`) staan op main.
Dat zegt niets over de image, migraties of gegevens op een bestaande NAS. Codex heeft geen NAS-/Portainer-/productietoegang;
de eigenaar voert daar alle controles, downloads, back-ups, imports, deployments en publicaties zelf uit.

De uitvoerbare eigenaarshandleiding is [PRODUCTIE-ACCEPTATIE.md](PRODUCTIE-ACCEPTATIE.md). Zij bevat acht fasen, concrete
commando's en per handeling Waar/Wat/Waarom/Verwachte uitkomst/Bij fouten. Begin niet met een importcommando uit een oud verslag.
Dit document beschrijft het contract en afzonderlijke ontwikkeltools, geen verleende uitvoeringstoestemming.
Zie ook [toegang en huidige toestemming](PRODUCTIE-ACCEPTATIE.md#toegang-en-huidige-toestemming): momenteel geen NAS-toegang;
alleen-lezen inventarisatie, back-up, echte testrestore, deployment, download, registratie en publicatie zijn afzonderlijke stappen.

## Officiële bronnen bedienen zonder SSH

Na afzonderlijk goedgekeurde uitrol van deze versie staat de bediening onder **Adminbackend → Content → Audio**.
Kies de bron en taal, bevestig **Downloaden** en daarna apart **Registreren**. Selecteer vervolgens gecontroleerde registraties
voor een afzonderlijke publicatiebevestiging. De Ether 1-pilotkaart en goedkeuringspoort zijn verwijderd; het hoofdstuk blijft behouden.
Bij Nederlands zijn de 34 aanvullende V2-hoofdstukken geen vervanging van de 205 legacy-hoofdstukken. De samenvatting en
aparte bestandsteller maken duidelijk wat geregistreerd, gepubliceerd of nog te herstellen is.

Zie [bediening](ADMIN-OFFICIELE-AUDIO.md) en [Nederlandse voortgang/taakherstel](NL-VOORTGANG.md).
De CLI’s hieronder blijven ontwikkel-/geavanceerde hulpmiddelen; zij zijn niet nodig voor normale bediening.
De bestaande legacy-mirror en afspeelroutes blijven behouden.

## Drie verschillende beheerflows

| Flow | Gegevens en grenzen |
|---|---|
| Nieuwe content ophalen | Aanvullende content via `runSeed(..., {scriptures:false})`; geen Schriftteksten/-oefeningen/-cursussen, legacy-audio of audiospiegeling. Bestaande CFM-goedkeuringsregels blijven gelden. |
| Schriftbronnen bijwerken | Controleren → Voorbereiden → Publiceren met planHash. Controleren schrijft wel ContentUpdateRun; Voorbereiden kan OTB downloaden. Verouderd plan wordt geweigerd. Niet uitvoeren tijdens audioacceptatie. |
| Audiobibliotheek V2 | Ontvangen/registreren → beheerpreview → afzonderlijk, expliciet goedgekeurde publicatie. Geen seed of deployment nodig voor een volgend audiopakket. |

ChapterAudioCheck registreert tekstwijzigingen bij legacy-audio. NEEDS_REVIEW verwijdert geen audio of vers-tijdcodes.
Ongewijzigde audiogegevens lossen een controle niet op. Nieuwe geldige legacy-audio, gewijzigde tijden en controle delen één
hoofdstuktransactie; een fout draait alle drie terug. Een beheerbevestiging is geen V2-publicatie en omzeilt geen V2-bronhash.

ContentUpdateRun bewaart status/duur/fase/resultaat. Een eigen PG-lock beschermt een actieve run ook op een ander proces;
na procesuitval kan de Schriftkaart een achtergelaten RUNNING-rij markeren. Alleen die kaart openen is daarom niet puur SELECT.
Een Schriftpublicatie is per hoofdstuk atomair, niet over alle bronnen samen. Na een deelfout opnieuw inventariseren en voorbereiden;
geen oude planHash, status of lease met SQL forceren. RETIRED bewaart eerder gebruikte oefeningen/historie en open oefensets.

## Ontvangen en beoordelen

Het repo-voorbeeld gebruikt een blijvende audiomount en `AUDIO_DIR=/data/audio`; de eigenaar moet de effectieve mount/rechten
vaststellen. App-eigen mappen zijn `objects/` en `staging/`; aanlevering is `incoming/`. Geef een toekomstige generator uitsluitend
rechten op zijn afgesproken aanlevermap, niet op objects, bestaande legacy-bestanden of de database. Geen symlinkvolging.

Een complete `incoming/<pakket>/READY` kan door de scanner iedere minuut worden ontdekt, maximaal twintig kandidaten per tick.
Dat is **registratie** en vereist dus al akkoord, ook zonder handmatige CLI. Bij deployment/hervatten eerst onbekende backlog verklaren.
Geen publicatie door scanner of importer. PROCESSING heeft een lease van vijf minuten; FAILED kan langer backoff hebben (maximaal één uur).
Bewaar receipts en bestanden; een procesfout kan een duurzaam object vóór de DB-commit achterlaten. Dat is geen reden voor automatische cleanup.

In `/adminbackend/content/audio` staan bron/kwaliteit/importstatus, bestaande hoofdstukaudio, lokale aanwezigheid, objectomvang en
recente importfouten. Objectomvang telt een hash per collectie eenmaal; het is geen NAS-volume-/legacy-/snapshotmeting.
Lokale aanwezigheid is een bestandsmomentopname; oplossen/streamen verifieert de daadwerkelijke objecten.

Preview is alleen voor beheer. Publiceren vereist VALIDATED, passende tekst/uitgave, geldig object en segments, actuele beheeridentiteit
en de verwachte pointerversie. De pointerwissel is transactioneel. Een conflict vraagt opnieuw lezen en beslissen, geen blinde hogere versie.
Een audiopublicatie wijzigt geen tekstzichtbaarheid: verborgen/DRAFT DC/PGP blijft verborgen. De 19 oorspronkelijke reviewidentiteiten
blijven uitgesloten; technisch VALIDATED is geen luisterkundige vrijgave. In deze acceptatieronde ook geen V2-publicatie over de 205 NL-legacydoelen.

De officiële CLI kan de zes ontbrekende tekstuitgaven DC/PGP in de/fr/es per uitgave verborgen aanmaken, nog vóór het lezen van de
inventaris. Bestaande uitgaven worden overgeslagen. Geen cursussen/oefeningen; de globale cursussynchronisatie sluit deze zes uit.
Een foute of lege inventory.json is dus **geen dry-run**. De CLI heeft geen dry-run-/publish-vlag.

De pakketidentiteit omvat checkedAt. Exacte herhaling van een ongewijzigde batch is idempotent, maar een nieuwe downloadcontrole kan
ook bij gelijke MP3-bytes een nieuw Recording-ID opleveren. Selecteer bestaande identiteiten vóór een volgende import zoals in het runbook.
Bij SOURCE_MISMATCH stoppen en de werkelijke tekstuitgave beoordelen; nooit een hash, vers-ID of bestaande tekst in SQL passend maken.

## Ontwikkeltools — uitsluitend eigen omgeving

### Een nieuwe broninventaris onderzoeken — WIJZIGT ontwikkelcache

- **Waar:** eigen ontwikkelomgeving met Python 3.11+, curl, ffmpeg/ffprobe; geen productie-DB of NAS-volume.
- **Wat:** kies een nieuwe root buiten runtime/incoming en download met de bestaande tool:

```bash
LAB_ROOT=/VUL_NIEUWE_ONTWIKKELMAP_IN
case "$LAB_ROOT" in *VUL*) echo 'STOP: eigen ontwikkelmap kiezen'; exit 1;; esac
test ! -e "$LAB_ROOT"
python3 scripts/audio/official_inventory.py --root "$LAB_ROOT" --download --workers 1
```

- **Waarom:** een nieuwe broncontrole krijgt eigen receipts. Cachehergebruik is geen nieuwe netwerkcontrole.
- **Verwachte uitkomst:** alleen nieuwe broncache/inventaris, geen registratie of publicatie. Bron-MP3's blijven buiten git/image.
- **Bij fouten:** behouden en rapporteren; geen bronhash/tekstuitgave overschrijven om een afwijking te verbergen. Productie gebruikt het afzonderlijk goedgekeurde runbook.

Nieuwe/afwijkende opnamen zonder veilige grenzen vragen afzonderlijk bron-/uitlijningsonderzoek. De ontwikkeltool
`scripts/audio/align_official.py` gebruikt de bestaande `scripts/bom-audio`-dependencies numpy/av/vosk en vijf kleine modellen.
Dat onderzoek is geen NAS-acceptatiestap. Voor de gepinde set volstaan de bestaande alignments bij exacte audio- én bronhash;
er is geen ASR-/TTS-container nodig en er worden geen modellen in de runtime geïnstalleerd.

### Geïsoleerde audioverificatie — WIJZIGT uitsluitend testcontainers/-bestanden

- **Waar:** eigen ontwikkelomgeving met Docker/browserdependencies; nooit Portainer of de productiedatabase.
- **Wat:** bestaande tests uitvoeren; de volledige bronproef vereist vooraf onderzochte bronbestanden in `.audio-v2-work`:

```bash
npm run test:audio
npm run test:audio:browser
# Alleen met de volledige onderzochte lokale broncache:
node scripts/audio/test-isolated.mjs --official
```

- **Waarom:** de runner kiest eigen PostgreSQL/Redis, loopbackpoorten en tijdelijk AUDIO_DIR; geërfde DB-/Docker-endpoints worden niet gebruikt.
- **Verwachte uitkomst:** tests melden werkelijke resultaten; bronproef heeft nul officiële publicaties en zes verborgen uitgaven. Runner verwijdert eigen testdata.
- **Bij fouten:** fout/skip zichtbaar laten; geen productie-URL in de runner zetten. Zie [RESULTATEN.md](RESULTATEN.md) voor het eerdere ontwikkelbewijs;
  dat verslag is geen meting van de NAS of bewijs voor een andere commit.

Voor een toekomstige generator bestaat de alleen-lezen DB-export-CLI `scripts/audio/export-targets.ts`; zij schrijft een nieuw 0600-bestand,
geen accounts/credentials, uitsluitend bestaande tekstidentiteit van bofm/dc-testament/pgp. De eigenaar voert die export volgens het runbook uit.

## Back-up, fouten en terugval

Bewaar PostgreSQL en de **volledige** blijvende audiomap als afgestemde set onder stilgezette schrijvers, met externe versleutelde opslag
en een echte geïsoleerde herstelproef. Een gewone contentupdate reconstrueert recordings/pointers/objecten niet.
App-rollback behoudt mounts/tabellen; reeds toegepaste migraties worden niet teruggedraaid. Een oudere image moet RETIRED veilig behandelen.
De deployagent bewaart na een gezonde deploy de nieuwe image als last-good; noteer de echte vorige digest zelf.

Bij FAILED: foutcode lezen, oorzaak corrigeren, dezelfde ongewijzigde batch na lease/backoff opnieuw; gewijzigde manifestinhoud vraagt
nieuwe pakketidentiteit en bronbeoordeling. Geen status/lease/kwaliteit via SQL forceren. Bij pointerfout blijft de vorige publicatie staan.
Bij ontbrekend/corrupt actief V2-object of gewijzigde brontekst volgt TTS; dat is geen garantie op terugval naar oude legacy-audio.
Er is geen algemene unpublish-/terug-naar-legacy-CLI. Een eerdere broncompatibele VALIDATED opname kan alleen bewust opnieuw gepubliceerd worden.

De exacte eigenaarshandelingen en veilige herstelgrenzen staan in [het acceptatieplan](PRODUCTIE-ACCEPTATIE.md).

## Grote selecties en geregistreerde hoofdstukken

Zie [bulkherstel en afzonderlijke publicatie](BULK-HERSTEL.md). De beheerpagina verdeelt grote selecties in kleine batches, bewaart eerdere commits bij deelfouten en biedt een aparte hoofdstukselectie voor publicatie. Downloaden en registreren publiceren nooit automatisch. Bestaande publicaties worden door de nieuwe bulkactie niet vervangen.
