# Audiobibliotheek V2 — acceptatie en uitrol op Synology

Voorbereidingsdocument, gecontroleerd op 24 oktober 2026. **Geen uitvoeringsbewijs of uitroltoestemming.**
Er is geen NAS benaderd, productiequery uitgevoerd, bestand op de NAS gedownload, import gestart of opname gepubliceerd.
De cloudomgeving heeft geen geconfigureerde NAS-/VPN-toegang. De onderstaande commando's zijn voor de eigenaar,
na het betreffende akkoord. Deel rapporten zonder credentials, cookies, tokens of persoonsgegevens.

## 1. Eerst de werkelijke ontwikkelstatus

Gecontroleerde `main`: `89b8e4a59c42daa218f9bb693f033c6e669a9ace` (#210). PR [#187](https://github.com/rjgout/Versado.app/pull/187):
**OPEN, draft, `merged=false`, geen mergecommit**, hoofdcommit `8c5e7626362a4eb99e8c76d0d9d1b11d9f027067`.
De 27 groene checks op die PR waren bewijs voor die commit met de toenmalige basis; geen bewijs van een merge
of van acceptatie op de NAS. Productie kan bovendien een andere image draaien dan `main`.
Een lokale, werkboomvrije `git merge-tree`-simulatie tegen deze main vindt vier conflicten:
`docs/NATIVE-FEATURE-PARITY.md`, `docs/native-feature-parity.inventory.json`,
`tests/quick-missionary-source.integration.test.ts` en `tests/quick-missionary-source.multi-instance.test.mjs`.
Dit is geen uitgevoerde merge of branchwijziging. GitHub meldde tijdens de statusaanvraag nog `mergeable=UNKNOWN`.

| Onderdeel | Werkelijke status op deze main | Actie tegen dubbele implementatie |
|---|---|---|
| Stabiele oefenidentiteit, behoud van pogingen/voortgang, importlock, OTB-beheerinstellingen | Al aanwezig via #184, `29252462` | Hergebruiken; niet opnieuw bouwen |
| AudioPackage/Recording/Publication, veilige ontvangst/Range/auth, beheerpreview/publicatie, zes verborgen tekstuitgaven, officiële importer en metadata | Al aanwezig via #194, `fffb41bf` | Audio-servermodules/importscripts/audio-DDL zijn sinds die merge inhoudelijk ongewijzigd |
| Native distributieprofielen | Al aanwezig via #195, `350d4683` | Niet opnieuw toevoegen of releasegates wijzigen |
| Twee Contentbeheer-kaarten; controleren/voorbereiden/publiceren met planHash; ContentUpdateRun; ChapterAudioCheck; RETIRED; transactionele legacy-audio + controleafhandeling | **Niet op main**; nog in #187 | Eerst onafhankelijke review en gerichte integratie; geen tweede systeem maken |
| Vier herstelde runtime-dependencyversies uit #187 | Inmiddels ook op main via #200 (`985c6738`) en #208 (`b28db54b`): Zod 4.6.7, Nodemailer 10.2.1, fast-uri 3.1.9, Undici 6.29.1 | Geen dubbele securitypatch of downgrade; main pint Nodemailer expliciet |
| Legacy-run zonder bewezen bron | Main #200 sluit die **zonder reeksactiviteit**; #208 versterkt de regressietest. De oude #187-test verwacht juist activiteit | Behoud de actuele main-regel; oude #187-testwijziging niet blind overnemen |
| CFM-runtimebestanden, winkel-/CFM-verbeteringen, wegveegbare reeksbanner | #201, #200, #208, #209, #210 zijn op main en deels nieuwer dan #187 | Behoud main; geen volledige oude branch/tree terugzetten |

Controlecommando's in een ontwikkelcheckout, niet op productie:

```bash
git fetch origin main feature/content-beheer-v2-beheerkaarten
gh api repos/rjgout/Versado.app/pulls/187 --jq '{state,draft,merged,head:.head.sha,merge_commit_sha}'
git log -10 --oneline origin/main
git diff origin/main...8c5e7626362a4eb99e8c76d0d9d1b11d9f027067 --stat
git diff origin/main 8c5e7626362a4eb99e8c76d0d9d1b11d9f027067 -- package.json package-lock.json tests/quick-missionary-source.integration.test.ts
```

Audio V2 kan afzonderlijk worden geaccepteerd op een beoordeelde main-image. Dan ontbreken de nieuwe #187-kaarten
en controlemarkeringen nog: **geen Schriftupdate, reseed, audiospiegeling of andere tekstschrijver tijdens de acceptatie**.
Voor gecombineerde acceptatie van Contentbeheer V2 is eerst een opnieuw beoordeelde integratie van #187 nodig,
met de actuele main-regels en nieuwe CI. Dit plan geeft geen toestemming om #187 te mergen.

## 2. Beslismomenten

1. **Inventarisatie:** alleen lezen, broncommit/image/mount/database/capaciteit vaststellen; afwijkingen verklaren.
2. **Onderhoud/back-up/deployment:** afzonderlijk akkoord op image-digest, eventuele migraties, onderhoudsvenster en bewezen herstelkopie.
3. **Download:** afzonderlijk akkoord voor de pilot, later voor de volledige gecontroleerde bronset.
4. **Registratie:** afzonderlijk akkoord op pilotmanifest en de eventuele aanmaak van de zes verborgen uitgaven.
   Dit is een database- en volumemutatie, ook al worden nul opnamen gepubliceerd.
5. **Pilotpublicatie:** expliciet akkoord op de vijf opname-ID's, checksums, bronhashes en huidige pointerversies.
   Pas daarna zijn gewone versnavigatie/minispeler met de nieuwe opname te testen.
6. **Vervolgpublicatie:** apart akkoord per beoordeelde batch. Nooit alle VALIDATED opnamen automatisch publiceren.

Zonder stap 5: uitsluitend beheerpreview van kandidaten; de gewone lezer blijft legacy-audio/TTS gebruiken.
Volledige speleracceptatie vóór productiepublicatie kan in een afzonderlijk goedgekeurde, geïsoleerde acceptatieomgeving
met eigen testaccounts, database en audiovolume. Geen productieback-up met persoonsgegevens in een onbeveiligde testapp starten.

## 3. Migratievolgorde en imagecontrole

| Migratie | Voorwaarde / gevolg |
|---|---|
| `20261020120000_content_work_publication` | Bestaande werk-/uitgave-identiteiten |
| `20261029120000_study_identity` | Onder andere StudyRevision |
| `20261030120000_study_import_publication` | Samengestelde collectie-index voor de AudioRecording-FK |
| `20261127120000_content_beheer_v2` | Alleen in #187: RETIRED, ChapterAudioCheck met legacy-backfill, ContentUpdateRun |
| `20261204120000_audio_library_v2` | Op main: AudioPackage, AudioRecording, AudioPublication en constraints |

Pas de **volledige normale migratieketen** van de beoordeelde image toe, nooit alleen deze tabelrijen handmatig.
Op een nieuwe database komt november vóór december. Op een database met Audio V2 kan de nog ontbrekende novembermigratie
later worden toegepast; dat scenario is geïsoleerd getest in #187 (`scripts/audio/test-isolated.mjs`). De audio-migratie
heeft geen afhankelijkheid van ChapterAudioCheck. Geen bestaande migratie hernoemen of wijzigen: toekomstige timestamps
in deze keten zijn geen reden om geschiedenis te herschrijven.

Referentiechecksums van de gelezen migratiebestanden:

- Audio V2: `0f53acb44a291c68369d7b68a0482bb23b919c1b98c5c5712685c8e3c640fa9b`.
- Contentbeheer V2 in #187: `09ff08e06449733ba78ae35319faf5355839921c496fb44dbaed512e26484d66`.

De Docker-startopdracht draait automatisch `recoverFailedMigrations.ts` en `prisma migrate deploy` vóór de app.
Een herstart met een nieuwe image is dus **geen alleen-lezen inspectie**. Eerst back-up/akkoord; nu geen migrate deploy,
reset, resolve, handmatige SQL-correctie of test tegen een blijvende database.
Controleer `_prisma_migrations` alleen lezend: naam, checksum, finished_at, rolled_back_at en onvoltooide runs.
Een afwijkende checksum of mislukte migratie is een stopcriterium, geen aanleiding voor automatisch herstel.

## 4. Alleen-lezen controles door de eigenaar

De repo-stack (`deploy/docker-compose.yml`) bevat de opgegeven mount
`/volume1/docker/jehova-app/audio:/data/audio`. Dat bewijst niet dat de bestaande Portainer-stack hetzelfde doet.
Vervang namen uitsluitend na controle in Portainer. Geen volledige `docker inspect`/omgeving dumpen vanwege geheimen.
De voorbeelden zijn voor één Bash-sessie op de NAS; bij een nieuwe sessie de gecontroleerde variabelen opnieuw instellen.
Fail-fast/noclobber voorkomt doorgaan na fouten en overschrijven van bestaande vóór-rapporten. Ook deze opdrachten zijn hier niet uitgevoerd.

```bash
set -euo pipefail
set -o noclobber
APP=jehova-app
DB=jehova-db
AUDIO=/volume1/docker/jehova-app/audio
docker inspect --format '{{.Config.Image}} {{.Image}}' "$APP"
docker image inspect "$(docker inspect --format '{{.Image}}' "$APP")" --format '{{json .RepoDigests}}'
docker inspect --format '{{range .Mounts}}{{println .Source "->" .Destination "rw=" .RW}}{{end}}' "$APP"
docker exec "$APP" printenv AUDIO_DIR
docker exec "$APP" printenv NEXT_PUBLIC_BUILD_SHA
docker exec "$APP" id
docker exec "$APP" stat -c '%d %u:%g %a %n' /data/audio
docker exec "$APP" test -f /app/scripts/audio/import-official.ts
docker exec "$APP" test -f /app/data/audio/official-alignments.json
df -Pk "$AUDIO"
df -Pi "$AUDIO"
du -sk "$AUDIO"
docker stats --no-stream "$APP" "$DB"
```

Vereist: exacte bindmount, `/data/audio`, bestaand persistent volume, correcte apprechten, geen onverwachte symlinks,
voldoende vrije bytes/inodes en back-updekking. Noteer image-digest/broncommit; inspecteer of de bestaande image de CLI
`/app/scripts/audio/import-official.ts` en de gepinde `data/audio`-metadata bevat. Geen `chown -R`, `chmod -R`, volumeprune
of verplaatsing van legacybestanden. Nieuwe werkmappen mogen later uitsluitend met passende rechten worden aangemaakt.

Bewaar rapporten buiten de audiomap, in een besloten map (onderstaande rapportmap is een voorbeeld, geen bronvolume):

```bash
umask 077
REPORT=/volume1/docker/jehova-app/audio-acceptatie-20261024
test ! -e "$REPORT" || { echo 'Kies een nieuwe rapportmap; bestaande baseline niet overschrijven.'; exit 1; }
mkdir "$REPORT"
cat > "$REPORT/inventaris.sql" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT jsonb_build_object('type','MIGRATION','name',migration_name,'checksum',checksum,'finished',finished_at,'rolledBack',rolled_back_at)
FROM "_prisma_migrations" ORDER BY started_at,migration_name;
SELECT jsonb_build_object('type','TABLE','name',name,'present',to_regclass(format('%I',name)) IS NOT NULL)
FROM (VALUES ('AudioPackage'),('AudioRecording'),('AudioPublication'),('ChapterAudioCheck'),('ContentUpdateRun')) t(name);
SELECT 'SELECT jsonb_build_object(''type'',''RECORDINGS'',''work'',work,''language'',language,''quality'',quality->>''status'',''count'',count(*),''bytes'',sum("byteSize")) FROM "AudioRecording" GROUP BY work,language,quality->>''status'' ORDER BY work,language,quality->>''status'';'
WHERE to_regclass('"AudioRecording"') IS NOT NULL \gexec
SELECT 'SELECT jsonb_build_object(''type'',''RECORDING'',''row'',(to_jsonb(r)-''segments''-''sourceMetadata''-''quality'') || jsonb_build_object(''qualityStatus'',r.quality->>''status'',''sourceUrl'',r."sourceMetadata"->>''url'',''bookKey'',b.key,''chapterNumber'',c.number,''packageStatus'',k.status)) FROM "AudioRecording" r LEFT JOIN "Chapter" c ON c.id=r."chapterId" LEFT JOIN "Book" b ON b.id=c."bookId" LEFT JOIN "AudioPackage" k ON k.id=r."packageId" ORDER BY r.id;'
WHERE to_regclass('"AudioRecording"') IS NOT NULL \gexec
SELECT 'SELECT jsonb_build_object(''type'',''PACKAGE'',''id'',id,''status'',status,''attempts'',attempts,''leaseUntil'',"leaseUntil",''errorCode'',"errorCode") FROM "AudioPackage" ORDER BY id;'
WHERE to_regclass('"AudioPackage"') IS NOT NULL \gexec
SELECT 'SELECT jsonb_build_object(''type'',''PUBLICATION'',''row'',to_jsonb(p)-''publishedBy'',''rowMD5'',md5(to_jsonb(p)::text)) FROM "AudioPublication" p ORDER BY "targetKey";'
WHERE to_regclass('"AudioPublication"') IS NOT NULL \gexec
SELECT jsonb_build_object('type','PILOT_EDITION','id',id,'language',language,'enabled',enabled,'visible',"visibleToUsers",'state',"publicationState")
FROM "ContentCollection" WHERE work='bofm' AND "editionKey"='bofm' AND language IN ('nl','en','de','fr','es') ORDER BY language;
SELECT jsonb_build_object('type','EDITION','id',i.id,'missing',c.id IS NULL,'work',c.work,'family',c."editionKey",'enabled',c.enabled,'visible',c."visibleToUsers",'state',c."publicationState",
 'courses',(SELECT count(*) FROM "Course" k WHERE k."contentCollectionId"=c.id),
 'exercises',(SELECT count(*) FROM "Exercise" e JOIN "Chapter" h ON h.id=e."chapterId" JOIN "Book" b ON b.id=h."bookId" WHERE b."contentCollectionId"=c.id))
FROM (VALUES ('content_dc_de'),('content_dc_fr'),('content_dc_es'),('content_pgp_de'),('content_pgp_fr'),('content_pgp_es')) i(id)
LEFT JOIN "ContentCollection" c ON c.id=i.id ORDER BY i.id;
COMMIT;
SQL
docker exec -i "$DB" sh -c 'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$REPORT/inventaris.sql" > "$REPORT/inventaris-voor.jsonl"
```

Sla deze afzonderlijke beschermingsquery op als `$REPORT/beschermd.sql` en voer haar vóór/na iedere import uit naar
verschillende rapportbestanden. Dit exporteert geen accounts. Neem de **na goedgekeurde migratie** bestaande
controlemarkeringen als importbaseline; een nieuwe #187-backfill is een aparte migratiestap.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT jsonb_build_object('type','NL_LEGACY','id',c.id,'book',b.key,'number',c.number,'url',c."audioUrl",'headingStart',c."audioHeadingStart",'headingEnd',c."audioHeadingEnd",
 'verses',(SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number,'start',v."audioStart",'textMD5',md5(v.text)) ORDER BY v.number) FROM "Verse" v WHERE v."chapterId"=c.id))
FROM "Chapter" c JOIN "Book" b ON b.id=c."bookId"
WHERE b."contentCollectionId"='content_bom' AND c."audioUrl" IS NOT NULL ORDER BY b.key,c.number;
SELECT 'SELECT jsonb_build_object(''type'',''AUDIO_CHECK'',''row'',to_jsonb(a)-''reviewedById'',''rowMD5'',md5(to_jsonb(a)::text)) FROM "ChapterAudioCheck" a ORDER BY "chapterId";'
WHERE to_regclass('"ChapterAudioCheck"') IS NOT NULL \gexec
COMMIT;
```

```bash
docker exec -i "$DB" sh -c 'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$REPORT/beschermd.sql" > "$REPORT/beschermd-voor.jsonl"
```

Verwacht 205 `NL_LEGACY`-rijen; bij een ander aantal **stoppen en verklaren**, niets wissen of naar een seed terugzetten.
Leg ook de bestaande zes uitgaven vast: identiteiten, tekst-/vers-ID's en teksthashes via de bestaande tekstexport
(`scripts/audio/export-targets.ts`, alleen-lezen DB maar maakt een nieuw exportbestand). Gebruik die export na akkoord
voor dezelfde vergelijking, niet voor herschrijven van productie. Bestaande uitgaven mogen niet worden overschreven.

Na akkoord op het maken van dit besloten exportbestand (de DB wordt alleen gelezen):

```bash
docker exec -w /app "$APP" npx tsx scripts/audio/export-targets.ts /tmp/audio-targets-voor-20261024.json
docker cp "$APP:/tmp/audio-targets-voor-20261024.json" "$REPORT/targets-voor.json"
```

Herhaal na registratie met een **nieuwe** bestandsnaam. Vergelijk alle vooraf bestaande target-/vers-ID's, bronhashes,
tekstsegmenten en de zes collectie-identiteiten; alleen vooraf ontbrekende verborgen uitgaven mogen erbij komen.
Het exportscript weigert een bestaand uitvoerbestand te overschrijven. Vergelijk bronhashes ook voor reeds geregistreerde
opnamen: een oude opname die niet meer bij de productietekst past blijft buiten publicatie.

Inventariseer bestanden met Python 3.11+ op de NAS (of de equivalente bestaande beheertool). Dit leest alleen;
legacy-MP3's op de hoofdmap krijgen een volledige hash, geneste bestanden alleen een stat om de eerste scan te beperken:

```bash
python3 -I - "$AUDIO" > "$REPORT/bestanden-voor.json" <<'PY'
import hashlib,json,os,pathlib,stat,sys
root=pathlib.Path(sys.argv[1]); rows=[]
for base,dirs,files in os.walk(root,followlinks=False):
    for name in dirs+files:
        p=pathlib.Path(base)/name; s=p.lstat()
        if stat.S_ISLNK(s.st_mode): raise SystemExit('STOP: symlink '+str(p))
        if not stat.S_ISREG(s.st_mode): continue
        row={'path':str(p.relative_to(root)),'bytes':s.st_size,'mtimeNs':s.st_mtime_ns}
        if p.parent==root and p.suffix.lower()=='.mp3':
            with p.open('rb') as f: row['sha256']=hashlib.file_digest(f,'sha256').hexdigest()
        rows.append(row)
print(json.dumps(sorted(rows,key=lambda r:r['path']),indent=2))
PY
```

Koppel de 205 URL's aan `mirrorFileName()` (`src/lib/audioMirror.ts`: toegestane HTTPS-host + MP3-basename).
Registreer ontbrekende lokale kopieën als ontbrekend; download of vervang ze niet tijdens inventarisatie.
Leg bij bestaande objecten ook ontbrekende/mismatchede `<sha256>.mp3` vast; de afspeelroute verifieert de bytes opnieuw.
Bewaar rapporten met datum, image-digest en broncommit. NAS-aanwezigheid en vrije ruimte zijn pas daarna bewezen.

## 5. Opslag en back-up

Gerekend uit de **onderzochte bronset** in `official-inventory.json`, geen NAS-meting:

| Omvang | Bytes | GiB |
|---|---:|---:|
| 1.974 downloadvarianten (D) | 7.168.283.880 | 6,676 |
| 1.973 unieke inhoudshashes / objecten (S) | 7.159.935.725 | 6,668 |
| Grootste bestand (M) | 25.009.564 | 0,0233 |
| D + S + één tijdelijk bestand | 14.353.229.169 | 13,367 |

De Franse Alma 30-URL's delen bytes; de broncache gebruikt URL-hashes, de objectopslag inhoudshashes.
Bij broncache **onder dezelfde audiomount** hardlinkt de importer naar staging/incoming, maar objects is een eigen kopie.
Andere filesystems veroorzaken een extra kopie (EXDEV); dan kan circa D extra nodig zijn.
Metadata, pagina's, filesystem-/snapshot-overhead, bestaande legacybestanden (L), andere productiegegevens en groei
komen erbovenop. Richtwaarde: **minimaal 30 GiB extra vrije ruimte** boven het bestaande gebruik voor deze bulkactie,
plus afzonderlijke back-upcapaciteit en het normale vrije-volumepercentage. Bereken opnieuw bij gewijzigde bronbytes.
Geen Vosk-modellen, woordtranscripten of ASR-cache nodig bij exact hergebruik van de gepinde uitlijningen.

Back-up **vóór** deployment/migratie of registratie: alle appinstanties en andere schrijvers onder goedgekeurd onderhoud
quiescent maken; DB laten draaien. Maak een consistente logische DB-dump plus de volledige audiomap (legacy, objects,
incoming, staging), stackconfiguratie/secrets in besloten opslag en de overige bestaande appvolumes volgens het beheerbeleid.
Een live kopie van de PostgreSQL-datamap of alleen `audio` is onvoldoende. Een snapshot op dezelfde NAS is geen externe back-up.
Bewaar de back-up versleuteld met afzonderlijk herstelbaar sleutelbeheer; een PostgreSQL custom dump is op zichzelf niet versleuteld.
Voorbeeld uitsluitend na onderhoudsakkoord; doel moet op een **andere beschermde opslag** liggen:

```bash
BACKUP=/pad/naar/andere/beschermde/opslag/audio-v2-voor
umask 077
mkdir -p "$BACKUP"
# Eerst alle expliciet geïdentificeerde app-/importschrijvers pauzeren; niet blind andere containers stoppen.
docker exec "$DB" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$BACKUP/database.dump"
tar -cpf "$BACKUP/audio.tar" -C "$AUDIO" .
sha256sum "$BACKUP/database.dump" "$BACKUP/audio.tar" > "$BACKUP/SHA256SUMS"
docker exec -i "$DB" pg_restore --list < "$BACKUP/database.dump" > "$BACKUP/dump-inhoud.txt"
```

Controleer exitcodes, archiefleesbaarheid, hashes, beschikbare back-upruimte en een daadwerkelijke restore in een
**eigen geïsoleerde DB/volumecombinatie**. Start geen herstelde productieapp met echte e-mail-/externe koppelingen.
Leg herstelduur vast en bewaar de oude image-digest. Pas daarna schrijvers gecontroleerd hervatten.

## 6. Pilotdownload en registratie — pas na afzonderlijk akkoord

Gebruik een checkout van de goedgekeurde imagebron op de NAS. Vereisten op de downloadhost: Python 3.11+,
`curl`, `ffmpeg`, `ffprobe`, veilige HTTPS-toegang en voldoende ruimte. De app-image heeft de Node-importer en ffmpeg,
**geen Python**. Ontbrekende hulpmiddelen zijn een stopcriterium; niet stilzwijgend op de NAS installeren.
Een vooraf goedgekeurde externe downloadhost met dezelfde geverifieerde bestanden is een alternatief, met expliciete overdracht
en ruimtecontrole; maak geen nieuwe permanente ASR-service.

Pilot: **Ether 1 in nl/en/de/fr/es**, Engels `male`, overige talen `audio`. Alle vijf zijn technisch VALIDATED in de
onderzochte metadata. NL Ether 1 staat niet bij de 205 legacy-hoofdstukken; bevestig dat ook in de productie-inventaris.
Als daar al beschermde NL-audio staat: niet publiceren, eerst een andere gevalideerde NL-pilot laten kiezen.
Dezelfde canonieke verwijzing maakt ook een veilige taalwissel tussen vijf uitgaven testbaar.
Controleer dat de vijf bestaande BOM-uitgaven al leesbaar zijn voor het testaccount. Verander geen tekstzichtbaarheid
om een audiotest mogelijk te maken; gebruik anders beheerpreview of de geïsoleerde acceptatieomgeving.

Onderstaande selectie gebruikt de bestaande officiële downloader/validator, geen nieuwe importer. De downloader inspecteert
alle stemmen op de vijf pagina's (dus zes bronbestanden door twee Engelse stemmen); de importinventaris bevat precies vijf.
Hij schrijft uitsluitend in een **nieuwe** werkmap, buiten incoming/objects en buiten de legacy-hoofdmap.

```bash
cd /pad/naar/goedgekeurde/broncheckout
for tool in python3 curl ffmpeg ffprobe; do command -v "$tool" || exit 1; done
WORK="$AUDIO/_official-pilot-20261024"
test ! -L "$WORK" || exit 1
python3 -I - "$WORK" <<'PY'
import argparse,importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('official','scripts/audio/official_inventory.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
root=pathlib.Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True); (root/'pages').mkdir(exist_ok=True)
pinned=json.loads(pathlib.Path('data/audio/official-inventory.json').read_text())
align=json.loads(pathlib.Path('data/audio/official-alignments.json').read_text())['recordings']
rows=[]
for task in m.tasks(['nl','en','de','fr','es']):
    if (task['bookKey'],task['chapterNumber'])!=('bofm/ether',1): continue
    old=next(c for c in pinned['chapters'] if (c['language'],c['bookKey'],c['chapterNumber'])==(task['language'],'bofm/ether',1))
    row=m.inspect(task,argparse.Namespace(root=root,download=True))
    assert row['textStatus']=='EXACT_TEXT_MATCH' and row['sourcePageHash']==old['sourceHash']
    voice='male' if task['language']=='en' else 'audio'
    selected=[r for r in row['recordings'] if r['voice']==voice]
    assert len(selected)==1
    r=selected[0]; original=next(x for x in old['recordings'] if x['voice']==voice)
    assert r['status']=='DOWNLOADED_VALIDATED' and (r['sha256'],r['bytes'])==(original['sha256'],original['bytes'])
    assert align[r['sha256']+'-'+row['sourceHash']]['quality']=='VALIDATED'
    row['recordings']=selected; rows.append(row)
assert len(rows)==5
(root/'inventory.json').write_text(json.dumps({'schemaVersion':1,'chapters':rows},ensure_ascii=False,indent=2))
print('Vijf gecontroleerde kandidaten; geen DB of publicatie gewijzigd.')
PY
```

Een checksum/tekstverschil stopt de pilot. Niet de gepinde hashes aanpassen of tijdcodes gokken.
Geen `prepare_text_editions.py`, seed, `audio:mirror` of Vosk-heruitlijning in deze procedure.
Controleer dat het broncommit en de gepinde metadata gelijk zijn aan die in de app-image.
Als ook maar één pilotidentiteit volgens de inventaris al exact geregistreerd is, **de onderstaande vijf-kandidaten-CLI niet uitvoeren**:
beoordeel de bestaande opname-ID's en stel ontbrekende doelen eerst als een afzonderlijke, expliciet gecontroleerde selectie samen.
Na downloadcontrole, back-up en **registratieakkoord**:

```bash
docker exec -w /app "$APP" npx tsx scripts/audio/import-official.ts /data/audio/_official-pilot-20261024
```

Er is **geen dry-run- of publish-optie** op deze CLI. Hij gebruikt de bestaande ontvangende service, maakt pakketten
en objecten aan, en kan bij de eerste aanroep alle zes ontbrekende tekstuitgaven aanmaken: DC/PGP in de/fr/es,
`enabled=false`, `visibleToUsers=false`, `DRAFT`. Dat maakt boeken/hoofdstukken/verzen, **geen cursussen of oefeningen**.
Bestaande uitgaven worden overgeslagen, niet herschreven. Stop bij afwijkende bestaande identiteiten/flags/teksten.
Elke ontbrekende uitgave wordt apart transactioneel aangemaakt; een fout kan eerdere, nog verborgen uitgaven laten staan.

Vereist importerresultaat: `imported:5`, `mismatched:0`, `failed:0`, `published:0`, geen nieuwe reviewafwijking.
Bij al aanwezige identieke pakketten zijn READY-receipts idempotent herbruikbaar; vergelijk de bestaande registratie-ID's.
De scanner kan complete incoming-pakketten ook registreren, maar publiceert nooit. Alleen READY klaarleggen is dus al
toestemming tot registratie nodig. Nooit downloadwerk rechtstreeks in incoming zetten.
Houd het importvenster exclusief: geen andere aanleveraars/importers en geen onbeoordeelde complete incoming-backlog.
Laat reeds lopende leases aflopen/afronden en inventariseer opnieuw voordat een volgende batch wordt samengesteld.

Na afloop opnieuw inventariseren. `AudioPublication` moet bytegelijk blijven aan de vóórregistratie-snapshot;
nieuwe registraties zijn nog geen publicaties. Herhaal `beschermd.sql` naar `beschermd-na.jsonl` en vergelijk:

```bash
docker exec -i "$DB" sh -c 'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$REPORT/beschermd.sql" > "$REPORT/beschermd-na.jsonl"
cmp "$REPORT/beschermd-voor.jsonl" "$REPORT/beschermd-na.jsonl"
```

Herhaal ook de bestandsinventaris naar een nieuw rapport: **elke bestaande legacy-hoofdmap-MP3** behoudt naam, bytes,
mtime en SHA-256; alle 205 NL-hoofdstukken behouden URL, kop-/verstijdcodes en aanwezige controlemarkeringen.
De zes verborgen uitgaven moeten bestaan zonder nieuwe Course-/Exercise-rijen; bestaande vers-ID's/teksthashes blijven gelijk.

## 7. Luister- en publicatieacceptatie

Leg per pilot vast: opname-ID, taal/stem, bronhash, SHA-256, kwaliteit, targetKey, bestaande pointer + versie, gebruikerrol,
browser/toestel en geconstateerde fouten. Eerst alle vijf via **expliciete beheerpreview** beluisteren.
Publicatie uitsluitend via `/adminbackend/content/audio` na schriftelijk akkoord op die vijf IDs; geen SQL-INSERTs,
automatische API-loop of globale publicatieknop. Een versieconflict vraagt opnieuw lezen en beoordelen.

| Proef na pilotpublicatie (of in goedgekeurde acceptatieomgeving) | Acceptatiecriterium |
|---|---|
| Eigen tekst-/audiotaal voor alle vijf pilots | Juiste uitgave en stem; geen stilzwijgende andere tekst/taal |
| Vers 1, midden, laatste vers; snel vooruit/achteruit zoeken | Begin/eindgrens klopt hoorbaar, geen verkeerde versselectie |
| NL Ether 1 lezen, audio naar en/de/fr/es en terug | Dezelfde canonieke passage en uitgavefamilie, voorkeur blijft correct |
| Minispeler: pauze/hervat, navigatie naar andere pagina, stop | Eén speler, correcte tekst/tijd, geen dubbele geluidsbron |
| iPhone/Safari en Android/Chrome; desktop; 320px/200% tekst | Bediening bereikbaar, geen overflow, herstel na netwerkonderbreking |
| Range/HEAD/seeken; logout en gewone gebruiker versus adminpreview | 206/HEAD correct; afgeschermde of ingetrokken audio niet leesbaar |
| NL Ether 2, mits vooraf geen legacy-audio/pointer is vastgesteld, of een ander al leesbaar hoofdstuk zonder audio | Apparaat-TTS volgens bestaande terugval, passende beschikbare stem; afwezigheid eerlijk melden |
| Bron-/objectfouten en tekstwijziging | Eerst geïsoleerd: TTS bij ongeldige actieve V2-opname, geen ongewenste oude V2-opname |
| Zes verborgen uitgaven en 19 reviewgevallen | Niet zichtbaar voor gewone gebruikers; geen reviewpublicatie |

Geen productieobject verwijderen/corrumperen, sessies van anderen intrekken of brontekst wijzigen als foutinjectietest.
Voor een hoofdstuk zonder V2-pointer blijft bestaande legacy-audio de eerste terugval; pas als die ontbreekt volgt TTS.
Lokale Capacitor-audiopariteit ontbreekt nog op de gecontroleerde basis: web/PWA-bewijs is geen bewijs van native audio,
achtergrondaudio, lockscreen-/headsetbediening of lifecycle-herstel. Registreer die apparaattests afzonderlijk als nog open.
Publicatie verandert nooit tekstzichtbaarheid: verborgen DC/PGP blijft verborgen, ook met een audiopointer.

## 8. Volledige bronset en de 19 reviewgevallen

Pas na pilotacceptatie en apart download-/registratieakkoord, in een **andere** nieuwe werkmap:

```bash
FULL="$AUDIO/_official-volledig-20261024"
python3 -I scripts/audio/official_inventory.py --root "$FULL" --languages nl en de fr es --download --workers 1
```

Start met één worker; bij aantoonbaar voldoende CPU/IO/netwerk eventueel twee (tool ondersteunt maximaal acht).
Een nieuwe werkmap geeft verse broncontroles; hervatten in dezelfde map hergebruikt receipts met hun oorspronkelijke datum.
Voer vóór registratie een offline vergelijking uit met de gepinde `data/audio/official-inventory.json`:
precies 1.965 hoofdstuk-taalidentiteiten, dezelfde bronhashes, per doel dezelfde URL/stem/SHA-256/bytes,
1.974 DOWNLOADED_VALIDATED opnamen, nul onbereikbare/mismatchede doelen. Leg het diff-rapport voor bij elke afwijking;
deze aantallen gelden alleen voor de onderzochte set. Nieuwe of vervangen officiële bestanden vragen herbeoordeling,
geen uitbreiding van de import om de telling alsnog groen te krijgen.

```bash
python3 -I - "$FULL" > "$REPORT/bronvergelijking.txt" <<'PY'
import json,pathlib,sys
old=json.loads(pathlib.Path('data/audio/official-inventory.json').read_text())
new=json.loads((pathlib.Path(sys.argv[1])/'inventory.json').read_text())
def index(doc):
    rows=doc['chapters']; keys=lambda c:(c['work'],c['editionKey'],c['language'],c['bookKey'],c['chapterNumber'])
    result={keys(c):c for c in rows}
    assert len(result)==len(rows)==1965
    return result
a,b=index(old),index(new); assert a.keys()==b.keys(); count=0
for key,c in b.items():
    p=a[key]
    assert c['textStatus']=='EXACT_TEXT_MATCH' and c['sourcePageHash']==c['sourceHash']==p['sourceHash'],key
    records=lambda row: sorted((r['voice'],r['url'],r['sha256'],r['bytes']) for r in row['recordings'])
    assert all(r['status']=='DOWNLOADED_VALIDATED' for r in c['recordings']),key
    assert records(c)==records(p),key
    count+=len(c['recordings'])
assert count==1974
print('1965 identiteiten, 1974 identieke gecontroleerde opnamen, geen bron-/bytediff.')
PY
```

Gebruik de gepinde alignments alleen bij exacte audio- én bronhash; ontbrekende/onzekere grenzen blijven NEEDS_REVIEW.
Een nieuwe controledatum zit in het manifest en daarmee in de pakketidentiteit: **gelijke MP3-bytes alleen zijn geen
garantie op hetzelfde Recording-ID**. Voorkom dubbele registraties van de pilot of eerdere imports door, in het exclusieve
importvenster, de actuele alleen-lezen inventaris opnieuw te nemen en bekende identiteiten uit de importselectie te halen.
Gebruik werk/familie/taal/boek/hoofdstuk/stem/bron-URL/audiohash/teksthash, niet alleen een bestandsnaam of inhoudshash.
De twee Franse Alma 30-URL's blijven zo correct als twee aangeboden varianten herkenbaar.

```bash
docker exec -i "$DB" sh -c 'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$REPORT/inventaris.sql" > "$REPORT/inventaris-voor-bulk.jsonl"
python3 -I - "$FULL" "$REPORT/inventaris-voor-bulk.jsonl" <<'PY'
import copy,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); original=root/'inventory.verified.json'
assert not original.exists(), 'Bewaar eerdere bewijsbestanden; kies een nieuwe gecontroleerde batch.'
data=json.loads((root/'inventory.json').read_text()); original.write_text(json.dumps(data,ensure_ascii=False,indent=2))
def key(c,r):
    return (c['work'],c['editionKey'],c['language'],c['bookKey'],c['chapterNumber'],r['voice'],r['url'],r['sha256'],c['sourceHash'])
known=set()
for line in pathlib.Path(sys.argv[2]).read_text().splitlines():
    row=json.loads(line)
    if row.get('type')!='RECORDING': continue
    r=row['row']
    if r['packageStatus']=='READY' and r.get('bookKey'):
        known.add((r['work'],r['editionKey'],r['language'],r['bookKey'],r['chapterNumber'],r['voice']['name'],r['sourceUrl'],r['sha256'],r['sourceHash']))
selected=copy.deepcopy(data); skipped=0; count=0
for c in selected['chapters']:
    remaining=[]
    for r in c['recordings']:
        if key(c,r) in known: skipped+=1
        else: remaining.append(r); count+=1
    c['recordings']=remaining
assert count+skipped==1974
(root/'inventory.json').write_text(json.dumps(selected,ensure_ascii=False,indent=2))
print({'nieuweKandidaten':count,'alGeregistreerd':skipped,'published':0})
PY
```

Deze stap wijzigt alleen de lokale importselectie; de geverifieerde broninventaris blijft bewaard. Hij schrijft geen database
en is geen alternatieve ontvanger. Voor vijf nieuwe pilots en verder een lege bibliotheek verwacht je 1.969 nieuwe kandidaten;
bij een reeds gevulde bibliotheek minder. Bij nul kandidaten geen nieuwe import/downloadronde starten.
De selectie en de onveranderde bronbestanden vormen samen de goed te keuren batch. Een downloaderhervatting kan `inventory.json`
weer vervangen: herhaal dan eerst bronvergelijking en selectie met een nieuwe actuele DB-inventaris; nooit blind importeren.

Registratie na akkoord gebruikt dezelfde CLI:

```bash
docker exec -w /app "$APP" npx tsx scripts/audio/import-official.ts /data/audio/_official-volledig-20261024
```
De bestaande pilot-ID's blijven behouden door de selectie; retries met dezelfde ongewijzigde batch zijn herhaalveilig.
Herhaal de volledige vóór/na-controles; 1.974 registraties zijn een bronsetverwachting, geen aanname over al aanwezige andere registraties.
Geen bulkpublicatie. Houd **ook de oorspronkelijke negentien identiteiten expliciet in quarantaine**:

| Taal | Werk / hoofdstuk | Stemmen | Aantal |
|---|---|---|---:|
| nl | bofm / 1-ne 1 | audio | 1 |
| de | bofm / morm 1; pgp / js-h 1 | audio | 2 |
| en | dc-testament / dc 44; dc 84; pgp / js-h 1 | 44 male; 84 female+male; js-h female+male | 5 |
| es | dc-testament / dc 84; pgp / js-h 1 | audio | 2 |
| fr | bofm / 1-ne 18; dc-testament / dc 2,12,14,17,32; pgp / js-h 1, moses 3, moses 4 | audio | 9 |

Samen 12 onzekere alignments en 7 zonder veilige volledige grenzen. De exacte hashes en uitkomsten staan in
`data/audio/official-alignments.json` en `docs/audio-v2/RESULTATEN.md`. Een nieuwe opname voor zo'n doel blijft buiten
deze publicatieronde totdat afzonderlijke review én expliciet publicatieakkoord bestaan. Geen kwaliteitsveld in SQL promoveren.
De overige 1.955 technisch VALIDATED registraties zijn **niet automatisch luisterkundig goedgekeurd**.
Er is maar één actieve publicatiepointer per hoofdstuk: verschillende stemmen zijn alternatieven, geen gelijktijdige publicaties.
Publiceer de 205 beschermde bestaande NL-hoofdstukken in deze acceptatieronde evenmin over met V2-opnamen.

## 9. Prestaties, fouten en herstel

De volledige set bevat circa 238,4 uur speelduur. Ideale netwerktijd voor 7,168 GB: circa 96 minuten bij 10 Mbit/s,
19 minuten bij 50 Mbit/s of 10 minuten bij 100 Mbit/s; exclusief TLS, bronlimieten, pagina's en volledige decodering.
Dit zijn berekeningen, **geen NAS-benchmarks**. De importer verifieert/hasht/decodeert opnieuw; meet de vijf pilots met
`time`, `docker stats`, `df`, fouttellingen en normale appresponstijden. Plan bulk buiten piekgebruik en pauzeer bij
ruimte onder de afgesproken grens, aanhoudende hoge IO/CPU, oplopende HTTP-fouten of merkbare verslechtering van de app.
Spreek vooraf concrete grenzen af; voorstel: minimaal 30 GiB vrij bij de start, nul nieuwe HTTP-5xx, en pauzeren als
de gemeten p95-responstijd vijf minuten boven tweemaal de vóór-baseline blijft. Meet daarvoor dezelfde lees-/seekacties
minstens tienmaal per pilottaal. Dit zijn voorgestelde acceptatiegrenzen, geen gemeten NAS-resultaten.
De downloader begrenst netwerkverzoeken en decodeertijd; trage bestanden mogen falen, niet met onvolledige bytes doorgaan.

- HTTP-/decode-/checksumfout: geen registratie van dat bestand; oorzaak vastleggen en gecontroleerd hervatten.
- SOURCE_MISMATCH: stoppen voor dat doel; echte productie-editie/tekst vergelijken. Nooit hashes, Verse-ID's of tekst passend maken.
- FAILED/backoff: zelfde ongewijzigde pakket kan opnieuw, lease maximaal vijf minuten; scanner maximaal twintig pogingen per minuut.
  Na een onderbreking kunnen complete pakketten later nog worden **geregistreerd**, nooit vanzelf gepubliceerd.
- PROCESSING door een andere worker: CLI kan een niet-READY resultaat melden terwijl de scanner afrondt. Wachten, uitsluitend
  lezend de receipt controleren en dezelfde batch herhalen; geen lease, manifestHash of status met SQL wijzigen.
- Gewijzigde manifestinhoud: nieuw pakket-ID; PACKAGE_ID_REUSED of LEASE_LOST niet met SQL omzeilen.
- DB-/procesfout: registratie en READY delen één transactie; een al duurzaam object kan achterblijven. Bewaren, niet automatisch wissen;
  idempotente retry kan dat object hergebruiken. CLI kan gedeeltelijk geslaagd zijn: inventariseren vóór herhalen.
- Zes-uitgaven-aanmaak faalt: per-uitgave rollback, andere al aangemaakte uitgaven blijven verborgen; geen automatische correctie
  van bestaande collecties. Nul nieuwe cursussen/oefeningen blijft een harde eis.
- Mislukte publicatie: pointertransactie rolt terug. Vorige publicatie blijft actief; geen geforceerde hogere CAS-versie proberen.

Herstelvolgorde na akkoord: stop nieuwe aanlevering/importers; behoud alle bestanden/receipts; vergelijk snapshots en foutcodes.
Bij een fout beluisterde publicatie: laat de eigenaar een eerder geregistreerde, nog broncompatibele VALIDATED opname bewust
terug publiceren met de actuele pointerversie. Er is **geen algemene unpublish-/terug-naar-legacy-CLI**; geen pointerrij wissen
om dat te simuleren. Bij ontbrekend/corrupt actief V2-object volgt TTS, niet gegarandeerd de oude legacy-opname.
Bij ernstig dataverlies: schrijvers pauzeren, afgestemde DB/audio-back-up en passende image onder apart herstelakkoord terugzetten,
eerst geïsoleerd verifiëren. Een DB-restore kan nieuwere gebruikersvoortgang terugdraaien: daarom niet gebruiken voor een enkele
afspeelfout. Geen schema-/enum-drop, reset, brede verwijderquery, `rsync --delete` of volumeprune als rollback.
Een oude appimage is na RETIRED-gebruik niet zonder compatibiliteitscontrole een veilige #187-rollback.

## 10. Aftekenlijst

- [ ] Werkelijke image/commit en PR-status gecontroleerd; gekozen Audio-only of gecombineerde route vastgelegd.
- [ ] Geen ontbrekende #187-functionaliteit als al gemerged aangenomen; geen huidige main-fixes teruggedraaid.
- [ ] Mount, eigenaar/rechten, symlinks, vrije ruimte/inodes, huidige databaserijen en migratiechecksums bewezen.
- [ ] 205 NL-hoofdstukken + legacybestanden beschermd met vóór-snapshots; afwijkingen vooraf verklaard.
- [ ] Consistente externe DB/audio-back-up en geïsoleerd herstel bewezen; onderhouds-/deployakkoord vastgelegd.
- [ ] Vijf pilotkandidaten exact bij de onderzochte bytes/tekst; download- en registratieakkoord vastgelegd.
- [ ] Registratie: nul publicaties; 205 NL en controles bytegelijk; zes uitgaven verborgen; geen Course/Exercise-toename.
- [ ] Eigenaar heeft de precieze vijf pilotpublicaties expliciet goedgekeurd vóór spelerproeven.
- [ ] Vijf talen, versspringen, minispeler, taalvoorkeur, TTS en rechten op echte doelbrowsers afgetekend.
- [ ] NAS-prestaties en fout-/retry-/herstelgedrag gemeten; native/apparaatachterstand afzonderlijk genoteerd.
- [ ] Volledige bronset apart goedgekeurd; oorspronkelijke 19 reviewgevallen en 205 beschermde NL-publicaties uitgesloten.
- [ ] Vervolgpublicaties uitsluitend na expliciet akkoord op de beoordeelde IDs/versies; geen automatische publicatie.

Alle nu nog onbewezen NAS-/productiewaarden blijven open punten voor de eigenaar. Dit document autoriseert geen uitvoering.
