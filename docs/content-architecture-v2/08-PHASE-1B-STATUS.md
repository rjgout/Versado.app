# Fase 1B — persistente actieve studiecontext

Reviewbare implementatie op `codex/content-architecture-v2-1b`, vanaf
`origin/main` `c8cb645` (merge PR #85). De eigenaar meldt dat fase 1A succesvol
is uitgerold en gecontroleerd. Deze opdracht heeft geen nieuwe productiequery,
productiemigratie, deploy, import, seed of backupactie uitgevoerd.
Fase 1C/1D en verdere contentfasen zijn niet gestart.

## Model en compatibiliteit

`UserStudyContext` heeft `userId`, `workKey`, nullable `activeLessonKey`,
`version` (vanaf 1), `lastActionId` en `updatedAt`. De samengestelde primary key
`(userId,workKey)` is ook de vereiste unieke combinatie. De index op workKey
ondersteunt de FK naar ContentWork. User-verwijdering verwijdert zijn eigen
voorkeuren; verwijderen of hernoemen van een gerefereerd werk is RESTRICT.
Bestaande User-/ContentCollection-/Course-/Progress-identiteiten blijven gelijk.

Migratie `20261021120000_user_study_context` maakt uitsluitend deze tabel,
constraints en index aan. Eén DO-statement is atomisch, met vijf seconden
lock-timeout. Een botsende tabelstructuur stopt gecontroleerd. Herhaling van
hetzelfde SQL en Prisma deploy is getest. Geen backfill, loginregistratie of
contextschrijfopdracht bij GET. Geen nieuwe globale activeLesson op User.
De bestaande activeContentCollectionId/contentLanguage/activeCourseId behouden
hun verantwoordelijkheid en worden niet door contextmutaties gewijzigd.

Een ontbrekende context is versie 0 met een null leskeuze. Een null-keuze bij
ontbrekende context maakt geen rij. Expliciet wissen van een bestaande keuze
zet de key op null en behoudt de rij/versiehistorie. Een kalender-, bron- of
taalwissel wijzigt de context niet.

## Service, FSY en toegang

`src/lib/studyContext.ts` verzorgt reads, beschikbaarheid en gewenste toestand.
Alleen een bestaand ContentWork met kind STUDY_PROGRAM is toegestaan.
SCRIPTURE/OTHER, waaronder podcasts, krijgen geen lescontext.

De beperkte legacyadapter accepteert uitsluitend `fsy:<bestaande FsyLesson-ID>`:

- Het werk moet fsy zijn en de collectie moet bij hetzelfde werk horen.
- De centrale `readingAccessWhere` controleert werkrelatie,
  LEGACY/PUBLISHED, enabled én visibleToUsers, ook bij beheerders.
- De les moet PUBLISHED zijn en een niet-lege, geldig gestructureerde
  publishedContent hebben. Geen concepttekst wordt gebruikt of teruggegeven.
- Ook DRAFT met een oudere gepubliceerde kopie wordt voor **nieuwe normale
  contextselecties** geweigerd. De bestaande FSY-reader/publicatieworkflow wordt
  in 1B niet geconverteerd of gewijzigd.

FSY is in de geverifieerde productiemomentopname verborgen. Deze fase maakt het
niet zichtbaar en geeft admins geen impliciete previewrechten bij selectie.
Normale selectie blijft geweigerd zolang toegang niet expliciet beschikbaar is.

Een ingetrokken/ongeldige opgeslagen keuze blijft bestaan. De eigen API-view
behoudt de key en versie, met `available:false` en `lessonHref:null`; er komt
geen verborgen tekst of bestemming mee. Bewust wissen blijft mogelijk.
Andere programma's hebben dezelfde onafhankelijke opslagstructuur, maar nog
geen gevalideerde lesadapter. CFM-lessen of fictieve keys worden niet aangemaakt
of geaccepteerd. De isolatietest gebruikt uitsluitend een synthetische tweede
programmarij met een niet-beschikbare oude key, geen CFM-catalogus.
De legacy-ID is geen bewijs van equivalentie tussen vertalingen: een toekomstige
adapter/migratie moet echte lesidentiteiten mappen, niet titels of offsets raden.

## API- en versiecontract

`GET /api/study-context?workKey=fsy` retourneert `{context}`.
Zonder workKey retourneert GET `{contexts}` met alleen bestaande eigen keuzes.
`PUT /api/study-context` accepteert uitsluitend:

```json
{
  "workKey": "fsy",
  "activeLessonKey": "fsy:<echte-id-of-null>",
  "expectedVersion": 0,
  "actionId": "<uuid>"
}
```

Gebruik JSON null voor leegmaken, geen tekst `"null"`.
Antwoord: `{changed,context}`; view bevat workKey, activeLessonKey, version,
updatedAt, available en lessonHref. Geen userId, actionId, lesinhoud of profiel.

| Situatie | Gedrag |
| --- | --- |
| Geen geldige sessie | 401 |
| Onveilige/ontbrekende Origin bij PUT | 403, geen mutatie |
| Onbekende payload-/GET-queryvelden, ongeldige versie/UUID | 400 |
| Werk/les/publicatie/toegang ongeldig | 404, geen mutatie |
| Laatst opgeslagen actionId + hetzelfde doel | Actuele view, changed=false, geen tweede versie/event |
| Zelfde laatst opgeslagen actionId + ander doel | 400 |
| Verouderde expectedVersion | 409 + actuele eigen view, zonder onbevoegde bestemming |
| Actueel verzoek naar dezelfde toestand | changed=false, geen versie/timestamp/event |
| Geldige wijziging | Versie precies +1; nieuwe eerste rij versie 1 |
| Database-/transactiefout | Herstelbaar 503; geen persoonlijke foutdetails |

De gebruiker komt altijd uit bestaande serverauthenticatie; ook beheerders
kunnen uitsluitend hun eigen context bedienen. Zod is strict; userId en preview
in de payload worden geweigerd. De bestaande strikte Origincontrole uit de
admininventarisatie wordt hergebruikt, inclusief publieke HTTPS-host achter
interne HTTP-proxy. Responses hebben Cache-Control: no-store.

Per account+werk wordt een transactionele PostgreSQL advisory lock genomen,
ook vóór de eerste rij bestaat. Daarna worden de huidige versie en les gevalideerd
en wordt atomisch geschreven. Dit raakt geen User-/economie-locks en sluit
concurrente eerste creaties af vóór de unieke PK. Hashbotsingen zouden alleen
onnodige serialisatie veroorzaken, geen toegangsverruiming. De transactie heeft
maxWait 5 seconden en timeout 10 seconden.

Alleen de **laatste daadwerkelijk gewijzigde** actionId wordt onthouden. Geen
generiek eventlog. Een retry behoudt zijn oorspronkelijke expectedVersion en
payload. Na een nieuwere wijziging krijgt een oude retry 409; de client mag niet
automatisch een actuele versie invullen om die oude actie alsnog uit te voeren.

## Contentwissel en live data

`getContentContext` voegt backwards compatible `studyContexts` toe. Alle oude
velden/PUT-varianten en route-equivalentie blijven bestaan. Nieuwe GET's schrijven
geen studiecontext. `setActiveContentCollection`, `setContentLanguage`,
`applyContentSwitch` en `resolveContentSwitch` wissen of overschrijven geen keuzes.

Na een geslaagde commit stuurt de service uitsluitend naar `user:<eigen-id>`
het bestaande generieke `data_event` met `studyContextChanged`. Geen leskey in
de socket. Alleen nieuwe scopes `studyContext`/`studyContent` worden verouderd;
bestaande pagina's worden niet geremount of onnodig herladen.
`useStudyContext`/`saveStudyContext` hergebruiken useLiveQuery/liveMutation.
HTTP 409 is beschikbaar als StudyContextConflict met de actuele view.

`studyContextIdentity` levert workKey, leskey en versie voor toekomstige
lesgebonden querykeys, naast concrete collectie/taal. Een laat antwoord kan
uitsluitend zijn oude entry vullen. Geen nieuwe globale focus-/resume-/polling-
listener, layoutkey, header, kiezer of navigatie.
Een contextwijziging maakt geen XP, reeks, ActivityFeed, cursus-/inhoudsvoortgang,
ReadingSession, oefening, spel of podcastmutatie.

## Uitgevoerde validatie

De bestaande veilige 1A-runner is uitgebreid, geen tweede inventarisatieservice.
Hij past alle historische migraties toe (ongeacht niet-chronologische namen),
bouwt de synthetische productiearchitectuurfixture, test 1A, en past daarna
**uitsluitend de nieuwe 1B-migratie** toe via Prisma. Geen productiegegevens.

| Controle | Resultaat |
| --- | --- |
| Migratiebehoud | Alle 127 bestaande tabellen: gelijke aantallen en volledige rij-fingerprints; geen backfill |
| Fixtures | 21 collecties/7 werken, 6 zichtbaar/15 verborgen, 28 synthetische users, 37 FSY-lessen (16/21), bestaande progressie, annotaties, podcast, XP/reeks en speldata |
| Migratieretry/fout | SQL tweemaal, Prisma opnieuw, botsende tabel, afbreken vóór commit en work-FK RESTRICT geslaagd |
| Gecombineerde runner | 59 toegang/inventaris/contentwissel + 10 cursus + 22 context/unit: **91 geslaagd, 0 skipped** |
| Context-API | Anoniem/cross-user/admin/CSRF/strict payload; FSY/publicatie/hidden; concurrente eerste creaties en updates; dup/oude retry; ingetrokken keuze; geen oude datamutaties; foutrollback en event-na-commit |
| Live data | 51 geslaagd; late-response-isolatie en gerichte scopes apart getest |
| Editie/wissel/leer/reeks/studie/OTB unit | 45 geslaagd |
| Focus/shell | 23 geslaagd |
| Puzzelintegration + Kompas DB-subset | 40 geslaagd, 0 skipped, eigen PostgreSQL |
| Woord-van-de-Dag tijd/hintsintegratie | 14 + 29 geslaagd, 0 skipped, eigen PostgreSQL |
| Puzzel / woordhint unit | 41 / 5 geslaagd |
| Browser + kaarten | 28 viewport/thema/tekstcombinaties + 7 kaarttests; vijf UI-talen; bestaande contentkiezer, terug/scroll, Vandaag/Leren/Spelen en drie echte Woordzoeker-spellen |
| Prisma validate/generate, TypeScript | Geslaagd |
| ESLint | 0 fouten, 132 bestaande waarschuwingen; gerichte nieuwe code 0 waarschuwingen |
| i18n | Geslaagd; bestaande 3303/3726 in en/de/fr/es, geen nieuwe UI-teksten |
| Schone lokale productiebuild | Geslaagd met onbruikbare dummy-DB-URL, geen productiebinding |

Browser: Chromium, 320/375/390/430/768/1280 px en 844×390 landscape,
licht/donker, 100/200% tekst. Screenshots en results.json blijven buiten Git;
GitHub Actions bewaart de bestaande browserartefacten. Geen fysieke
Safari/iOS/Android/Capacitor of productie-smoketest. Geen tests skipped in de
hier genoemde runs. Gecontroleerde P0001-fouten zijn rollbacktests, geen
resterende fout. De bestaande cursusfixture krijgt expliciet een ContentWork
en een gesynchroniseerd vertrekpunt, zodat de suite geen algemene seed vereist.

De content-access-workflow voert deze migratie-/context-/API-suite automatisch
uit bij de nieuwe paden, met Prisma/types/build/lint/i18n/live-data en bestaande
regressies. De Actions-build van de **exact gepushte SHA** wordt bij de
chatoplevering afzonderlijk vermeld; lokale build is geen CI-bewijs.

## Uitrol en rollback — afzonderlijke toestemming vereist

1. Review model, SQL, normale FSY-toegang, versie-/actiecontract en tests. Fase 1A
   moet aanwezig blijven. Geen zichtbaarheid of publicatie aanpassen als onderdeel
   van deze deploy; de bestaande productie-FSY-configuratie blijft behouden.
2. Eigenaar controleert eigen Synology Hyper Backup-recentheid en taakdekking.
   De extra geïsoleerde productiebackup-herstelproef is bewust overgeslagen als
   geaccepteerd risico. Database/WAL-consistentie, media-dekking en daadwerkelijke
   herstelbaarheid zijn hier niet onafhankelijk bewezen. Geen nieuwe restoreclaim.
3. Leg goedgekeurde SHA/image-digest en een fase-1A-publicatiebewuste rollbackimage
   vast. Merge/deploy vragen afzonderlijke toestemming: appstart voert automatisch
   `prisma migrate deploy` uit vóór de nieuwe container beschikbaar wordt.
4. Deploy uitsluitend via de bestaande beheerprocedure na dat besluit. Deze ene
   additieve migratie raakt oude rijen niet. Zorg voor ruimte en een kort gepland
   venster voor FK/DDL-locks; geen parallel schemaonderhoud of handmatige backfill.
5. Bij lock-/structuurfout: stop uitrol, behoud oude app en gegevens. De DO-transactie
   rolt terug. Een mislukte Prisma-registratie vereist beoordeling; geen automatische
   recovery-allowlist of ongecontroleerde `migrate resolve` toevoegen.
6. Na geslaagde deploy: beheerder controleert migratiestatus, bestaande content/
   podcast/lezen en verboden bronblokkade. GET voor oude gebruikers geeft versie 0
   zonder contextregistratie. Validatie van verborgen FSY blijft geweigerd, ook als
   admin; maak het niet zichtbaar alleen voor een productie-smoketest.
7. Approllback: gebruik de vastgelegde fase-1A-image, **behoud** UserStudyContext
   en nieuwe keuzes. Oudere code negeert deze tabel; geen DROP, massale verwijdering
   of backuprestore die nieuwere voortgang wist. Terugrollen van deze voorkeur-
   infrastructuur wijzigt geen gebruikers-, collectie- of voortgangssleutels.

Fase 1C kan het API-/hook-/querykeycontract aansluiten op de expliciet goedgekeurde
fullscreen kiezer. Geen nieuwe CFM-keuzes aanbieden voordat er een gevalideerde,
gepubliceerde catalogus en adapter bestaan.
