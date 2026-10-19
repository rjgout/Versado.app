# Versado Dorp — fase 2

## Deel A: interactie en wereldkaart

Basis: main `dfb611cf` (PR #147), Canvas2D en de bestaande Work Fix-01-assets.
Geen nieuwe engine of afbeeldingen. Eigendom/levels en plaatsingen blijven gescheiden.

- Paden: gratis penseel met tikken/slepen en aparte wisstand. Vierverbonden interpolatie voorkomt gaten bij snelle bewegingen. Alleen geldige cirkelcellen; geen inventarislimiet. Eén burenindex per render en één padindex per commit. Paden blijven onder objecten en blokkeren geen footprints.
- Direct verplaatsen: selectie, bewegingsdrempel en anker-offset; loslaten valideert de bestaande collisionregels. Cancel, verloren pointercapture, pinch of ongeldige bestemming behouden het oorspronkelijke object. De aparte plaatsingsknoppen blijven als alternatief.
- De vijf bestaande bewoners zijn echte inventarisobjecten met één cel. Ze beginnen opgeborgen: de oude vaste bewonerposities overlapten bestaande gebouwen. Geen willekeurige herplaatsing.
- Lokale opslag v3 leest v2 compatibel: oude object-ID's, levels, plaatsingen en paden blijven; uitsluitend de vijf nieuwe bewonerrechten worden toegevoegd. v1 blijft expliciet ongeschikt. Deze lokale proefrechten worden niet geïmporteerd in toekomstige serverinventaris.
- Pan verbergt secundaire bediening; de expliciete bedieningsknop brengt haar terug. Weergaven staan in een compacte uitklapper. De normale startzoom is 0,36. Het geselecteerde grondvlak wordt vóór de gevel getekend.
- Het overzicht gebruikt dezelfde cirkelcellen, paden, objecten en bosrand; geen fictieve plattegrond. De wereldgrensweergave tekent de werkelijke R62-contour rond het huidige dorp. De aparte R62-testfase toont de daadwerkelijke uitgebreide wereldstaat.

### Feitelijke verificatie deel A

- `npm run test:dorp`: 48 geslaagd, 0 overgeslagen.
- TypeScript en gerichte ESLint: geslaagd.
- i18n-controle: geslaagd; bestaande vertaalachterstand 3992/4410 in en/de/fr/es, geen nieuwe ontbrekende dorpteksten.
- Schone productiebuild geslaagd; gepushte CI wordt op de exacte head gecontroleerd.
- Echte Chromium-productiebuild op eigen PostgreSQL: 8 combinaties (320×844, 390×844, 844×390, 1280×900; licht/donker). Padstreek en bewonersplaatsing, geen horizontale overflow of browserexceptions.
- Browserbewijs in `/tmp/versado-dorp-browser`, tevens CI-artifact. Geen fysieke iPhone/Android-test geclaimd.

### Grenzen

Dit eerste deel behoudt de admin-only devroute en lokale prototypeopslag. Serverwerelden, groepsrechten en sociale economie volgen in de afhankelijke wijziging. Geen productie- of NAS-actie, merge of deployment. De wereldgroei in deze devroute blijft een testfixture, geen werkelijk verdiende voortgang.

## Deel B: serverwerelden en sociale functies

Afhankelijk van deel A (#148). De devroute bewaart uitsluitend lokale
prototypefixtures. `/dorp`, `/dorp/groups/[groupId]` en
`/dorp/visit/[userId]` gebruiken dezelfde renderer en serverauthenticatie.
Geen nieuwe hoofdmenu-ingang of tweede shell. Bij direct openen sluit het persoonlijke dorp naar Vandaag en een bezoek naar het vriendenprofiel; de admin-devroute behoudt zijn eigen terugvalroute.

### Opslag en rechten

Additieve migratie `20261120120000_dorp_worlds`:

- `DorpVillage`: uniek persoonlijk dorp of uniek groepsdorp; XOR, fase 0–16,
  oplopende wereldversie.
- `DorpOwnedObject`: eigendom, catalogusidentiteit, ordinal en globaal level.
  `DorpPlacement` bewaart alleen de positie per dorp. Opbergen of groepsvertrek
  verwijdert uitsluitend de plaatsing. Hetzelfde object heeft onafhankelijke
  posities en hetzelfde level in alle dorpen.
- `DorpPath`: één tegel per dorp/coördinaat, met eigenaar. Alleen die eigenaar
  kan wissen. Bestaande paden overnemen/overschrijven kan niet.
- `DorpMember`: expliciete deelname aan maximaal vijf groepsdorpen, ook door
  een DB-trigger beschermd. Bestaande tien gewone groepslidmaatschappen blijven
  toegestaan. Persoonlijk dorp telt niet mee. Eén groepsdorp per bestaande groep.
- `DorpAction`: duurzame actionId/hash voor veilige retries, inclusief na een
  nieuwere actie. Wereldversie voorkomt verloren updates. Eenzelfde actionId met
  andere inhoud wordt geweigerd.
- `DorpMoveRequest`: echte, eigenaar-beveiligde verzoeken. Andere leden kunnen
  verzoeken indienen, nooit andermans object verplaatsen. De eigenaar ziet een
  basisinbox en kan het object terugnemen of het verzoek sluiten.
- `DorpGift`: duurzame overdrachtsaudit, actie-ID en index voor de rollende
  24-uursgrens; precies 5 XP, nooit naar zichzelf.
- `User.shareVillageWithFriends` en
  `ContentSwitcherSettings.dorpVisibleToUsers` beginnen beide op false.
  Geen migratie van lokale testinventaris of automatische publicatie.

De eerste expliciete openactie verleent een herkenbare proefinventaris met
level 1. Dit is nog geen verdiende hoofdstukbeloningscatalogus. Visuele upgrades
zijn in deze proef gratis en begrensd door de echte assetcatalogus. Ze kosten
geen hints/XP en worden niet als leeractiviteit geregistreerd.

Alle mutaties gebruiken `/api/dorp`, strikte Zod-schema's, server-userId,
Origincontrole, begrensde requestbody (100 KB), foutlimiter en privé/no-store
responses. Lockvolgorde: gesorteerde User-rijen → bestaande SocialGroup → dorp.
Een gift vergrendelt beide gebruikers en de actuele vriendschap. Een oude
HTTP-response kan niet op een andere wereld terechtkomen; onzekere retries
houden dezelfde actionId. Een versieconflict vereist expliciet herladen. Globale upgrades controleren daarnaast `expectedLevel` onder de gebruikerslock: twee dorpen met een oud level kunnen geen dubbele upgrade uitvoeren. Dorpverlaten heeft eveneens een actionId en verwachte versie; een oude retry verwijdert geen plaatsingen na opnieuw deelnemen.

### Groei en groepsvertrek

Persoonlijk: tel `ContentProgress` met READ en een hoofdstukverwijzing.
Studieles-READ en oefeningen tellen niet mee. Groep: som die hoofdstukbijdragen
van alle actuele leden (`leftAt = null`), plus drie hoofdstukequivalenten per
extra lid. De bestaande zestien drempels bepalen R8–R62. De bonus is alleen
kaartgrootte, geen XP of nieuwe leesvoortgang.

Groepsdeelname aan het dorp (maximaal vijf) en gewoon groepslidmaatschap zijn
verschillend. Groei gebruikt alle actuele groepsleden. Openen/herladen
synchroniseert persoonlijke/groepsgroei; toetreden tot de bestaande groep
synchroniseert een al bestaand groepsdorp. Er wordt geen dorp vanuit een
scheduler/login/GET aangemaakt.

De bestaande vertrek/verwijdertransactie verwijdert eerst de plaatsingen en
paden van het vertrekkende lid en diens dorpdeelname. Daarna herberekent zij de
kaart en bergt buitenliggende objecten van anderen op. Geen willekeurige
herplaatsing, geen verwijdering van eigendom of levels. De bestaande groepslock
voorkomt een gelijktijdige nieuwe plaatsing van een vertrekkend lid.

### Vrienden, privacy en economie

De profielinstelling voor delen is onafhankelijk van andere prestatiesdeling.
Alleen een geaccepteerde vriend met actuele toegang tot Dorp krijgt de echte
miniatuur. De bezoek-DTO bevat uitsluitend geplaatste objecten/paden, geen
inventaris of verzoeken. Dezelfde renderer is read-only: geen bouwen,
upgraden, verplaatsen of inventory. Het intrekken van privacy/vriendschap wordt
bij iedere API-call opnieuw gecontroleerd; een mislukte hercontrole verbergt de
bezoekweergave.

De bezoeker bevestigt bewust de gift van 5 XP. Onder gebruikerslocks worden
vriendschap, privacy, saldo en de laatste gift aan deze specifieke vriend
opnieuw gecontroleerd. Saldo -5/+5, twee XPTransaction-regels en één ontvangen
melding worden atomair vastgelegd. Beide redenen zijn herkenbaar in
XP-geschiedenis. Ontvangen én verzonden gifts wijzigen geen
CompetitionXpEvent, WeeklyScore, reeks, ActivityFeed of voortgang: het is een
saldo-overdracht, geen verdiende competitieactiviteit. De bestaande landelijke ranglijst blijft op werkelijk XP-saldo gebaseerd; een gift kan die saldo-rangorde verplaatsen, maar creëert geen nieuwe competitie-/divisie-XP. Dit bestaande ranglijstbeleid is niet herschreven. Een identieke retry
boekt niets extra; verschillende gelijktijdige acties krijgen één succes en
één cooldown. Een serverklok bepaalt de rollende 24 uur, geen kalenderdag.

### Beschikbaarheid en uitrol

Adminbackend → Content → Content bevat naast Lofzangen de bestaande-stijl
Dorp-schakelaar. Deze regelt gewone gebruikers; admins kunnen vooraf testen.
`VERSADO_DORP_PROTOTYPE_ENABLED=true` is de technische voorwaarde voor beide
server- en devroutes. Iedere andere waarde stopt toegang, ook voor admins.
Nieuwe standaard: publieke beschikbaarheid en profielprivacy UIT.

De Synology-container voert migraties automatisch bij starten uit. Merge of
uitrol is niet in deze opdracht uitgevoerd/toegestaan. De eigenaar beoordeelt
voor uitrol de additieve migratie en legt de vorige appimage vast. Begin met
publieke beschikbaarheid uit en controleer een eigen persoonlijk dorp,
groepsdorp, vertrek en een toegestemd vriendenbezoek. Geen oude collectie-,
publicatie-, contentselectie- of beloningsvelden worden gewijzigd.

Bij terugrol: zet de technische noodstop aan, rol de appimage terug, behoud de
nieuwe tabellen en kolommen. De oude app negeert ze. Verwijder geen inventaris,
acties, gifts of migratiehistorie. Een approllback draait reeds uitgevoerde
saldo-overdrachten niet terug. Databaseherstel is een afzonderlijke,
eigenaar-gestuurde noodmaatregel. Na een periode op oude groepscode moeten
lidmaatschappen/plaatsingen worden herbeoordeeld voordat serverdorpen opnieuw
worden ingeschakeld; de oude code kent de nieuwe vertrekhook niet.

### Verificatie deel B

De geïsoleerde migratieproef vergelijkt de oorspronkelijke kolomwaarden van
alle 146 bestaande tabellen vóór/na foutinjectie, echte migratie en herhaalde
migrate deploy. Alle hashes gelijk, ook voor synthetische bestaande notities (inclusief updatedAt), kleuren, bladwijzers, schrifttekst, voortgang en XP-audit. Alle 412 oude constraints en 401 oude indexdefinities behouden. Actuele schemaobjecten geteld: 155 tabellen
(inclusief Prisma-audit), 418 indexen, 443 constraints. Geen oude telling als
assertie gebruikt.

De gezamenlijke eindrun op de schone productiebuild is geslaagd:

- 48 dorps-/focus-/shelltests, 11 DB-/HTTP-integratiecontroles, 33 bestaande
  sociale regressies, 13 profieltests en 52 live-data-tests; geen skips.
- TypeScript, Prisma validate/generate, i18n en schone productiebuild geslaagd.
  Gerichte lint van de nieuwe dorpcode en test-/runners: nul waarschuwingen.
  Volledige repo-lint slaagt met bestaande waarschuwingen; twee nieuwe
  browserfixture-waarschuwingen zijn opgelost.
- Chromium: 10 prototypecombinaties (320×844, 390×844, 844×390, 1280×900 in
  licht/donker, plus 320×844 op 200% in beide thema's) en vier volledige
  serverflows op dezelfde schermformaten. Echte touch-events voor een padstreek;
  direct slepen van gebouw en bewoner; ongeldige bestemming behoudt de positie.
- De serverflow controleert ook de bestaande adminbeschikbaarheid (uit/aan/uit), weigering van gewone gebruikers op de admin-API en behoud van andere collectie-/Lofzangeninstellingen. Daarnaast controleert zij persoonlijk bouwen, gedeelde objecten van twee
  eigenaren, echte profielminiatuur, navigatie naar read-only bezoek en de
  bevestigde gift/saldo-overdracht. De bezoekassertie wacht op de daadwerkelijke
  nieuwe URL, geladen canvasassets en onzichtbare shellbalken; geen miniatuur
  van de vorige pagina als bezoekbewijs.
- Een eerste 200%-proef ontdekte verticale tekstafbraak in de kop. De kop,
  camerabediening en het padpaneel zijn aangepast en de hele matrix herhaald.
- Screenshots: `personal-server-*`, `path-*`, `resident-*`, `drag-building`,
  `drag-resident`, `world-overview`, `world-r62`, `group-*`, `profile-preview-*`, `visit-*`,
  `gift-confirm`, `gift-received` en `results.json` in het CI-artifact
  **versado-dorp-browser**. Grote gegenereerde bestanden staan niet in Git.
- #148: 17 checks groen op `b92952b0`. De toepasselijke checks voor de finale
  #149-head worden in de PR bijgehouden; na retargeten naar main opnieuw de
  vereiste checks laten uitvoeren. Volgorde: eerst #148, daarna #149.

### Bewuste beperkingen

- Geen definitieve aankoopeconomie/hoofdstukbeloningscatalogus, animaties,
  pathfinding of publiek hoofdmenu.
- Verplaatsverzoeken zijn een eenvoudige veilige inbox (maximaal 100 recente verzoeken per weergave), geen volledig sociaal
  workflowcentrum. Paden van andere leden kunnen alleen door hun eigenaar weg.
- Een penseelstreek is begrensd op 1024 tegels per serveractie; het padennet zelf
  is alleen door de kaart begrensd (maximaal 12.061 tegels).
- Geen fysieke iOS/Android-acceptatie geclaimd. Browserbewijs is Chromium op
  geïsoleerde data. De eigenaar verzorgt live acceptatie.
