# Contentbeschikbaarheid — bronnen en activiteiten

Dit is de blijvende aanvulling op Contentarchitectuur V2. De harde ontwikkelregels
A–H staan in `CLAUDE.md`; `AGENTS.md` is een symlink naar datzelfde instructiebestand.
Er is geen nieuw CMS of alternatief contentbeheersysteem.

## Beheerder: Lofzangen beschikbaar stellen

1. Open **Adminbackend → Content → Content**.
2. Onder **Zichtbaar voor gebruikers** staat **Lofzangen**, met dezelfde
   `ToggleSwitch` als de collecties. De beginstand is uit.
3. Met de schakelaar uit kan een beheerder Lofzangen zelf via de gewone
   contentkiezer testen. Gewone gebruikers zien de kaart niet en krijgen geen
   toegang via een directe pagina of API.
4. Inschakelen maakt de activiteit beschikbaar voor ingelogde gewone gebruikers.
   Het verandert geen actieve bron, contenttaal, leskeuze, cursus of voortgang.
5. De instelling **Contentswitcher beschikbaar voor gebruikers** regelt apart de
   headeringang. De Lofzangen-schakelaar regelt het gebruik van de activiteit,
   ook bij een directe URL; de algemene schakelaar is geen toegangsschakelaar.

De kaart staat bij de bestaande tweede brongroep, net als andere niet-Schriftuur-
inhoud. Het servercontract onderscheidt de activiteit via `hymnsAvailable`; er
wordt geen ContentWork/ContentCollection/taaleditie voor het zangboek verzonnen.
Een gewone link opent `/dev/lofzangen` met de bestaande Focus-shell en terugbalk.

## Noodstop

`HYMNS_POC=0` is uitsluitend een technische noodstop. Hij heeft voorrang op
beheerderrechten en de opgeslagen publieke instelling, in elke runtimeomgeving.
De beheerinterface toont **Technisch uitgeschakeld via HYMNS_POC=0** en maakt de
schakelaar tijdelijk onbedienbaar. De opgeslagen keuze blijft behouden; bij
opheffen van de noodstop geldt die keuze opnieuw. Elke andere waarde verleent
op zichzelf geen publieke toegang. Er is geen tweede featureflag nodig.

## Bestaande infrastructuur en minimale uitbreiding

- `ContentSwitcherSettings.hymnsVisibleToUsers Boolean @default(false)`:
  één additieve kolom, geen nieuwe tabel of configuratiebestand.
- Migratie `20261102120000_hymns_content_visibility`: bestaande rijen krijgen
  false, bestaande `enabled`-waarden en alle collecties blijven gelijk. Geen
  import, seed of wijziging van gebruikersgegevens. GET schrijft niets.
- `src/lib/hymnAvailability.ts`: één server-side toegangsservice, actor uit
  bestaande sessieauthenticatie; geen rechten-cache. De pure regel staat in
  `src/lib/hymns/access.ts`; de lokale audio-/score-engine blijft gescheiden.
- `/api/admin/content-switcher`: dezelfde GET/PUT, expliciet
  `{ "activity": "hymns", "visibleToUsers": true|false }`. Adminsessie,
  strikte Zod-validatie, bestaande Origin-/CSRF-controle en private no-store.
  De bestaande collectie- en algemene enabled-payloads blijven werken.
- `AdminContentSwitcherClient`: bestaande AdminSection/ToggleSwitch, centrale
  `useLiveQuery` en `jsonMutation` met `contentChanged`-invalidatie.
- `getContentPickerContext`: additief `hymnsAvailable`, herladen via de bestaande
  live-data-hook. De header telt een beschikbare activiteit mee wanneer de
  algemene switcher aan staat; één collectie plus Lofzangen zijn twee keuzes.
- Pagina en alle vijf `/api/hymns/*`-routes gebruiken dezelfde guard vóór laden.
  Normale API’s geven zonder toegang 404. De bestaande report-API blijft bovendien
  admin-only voor kwaliteitsdiagnostiek. Geen wijzigingen aan herkenning,
  bladmuziek, karaoke, microfoontoestemming of muzikale/leespositie.

## Publicatie, cache en privacy

Collecties blijven onder `contentAccess.ts`: technisch aanwezig, inhoudelijk
vrijgegeven, enabled en zichtbaar zijn verschillende voorwaarden. Beheerders
inspecteren verborgen collecties via de bestaande expliciete beheeromgeving;
gewone readerrechten worden niet verruimd. DRAFT-studierevisies blijven in de
beveiligde beheerpreview. CFM-import, publicatiepointers en de 553 blokkades
worden niet gewijzigd.

Beschermde muziekresponses zijn `private, no-store` met Cookie-variatie; gzip
varieert tevens op Accept-Encoding. Gecomprimeerde bytes kunnen intern per
dataversie worden hergebruikt, maar uitsluitend ná een actuele toegangscontrole.
Een expliciete weigering bij de indexvraag gebruikt geen oude IndexedDB-index.
De pagina sluit aan op bestaande LiveRefresh/focusverversing, zonder extra
polling of globale listeners. Reeds geautoriseerd lokaal geladen muziekmateriaal
wordt niet op afstand gewist; een al geopende offline sessie is geen nieuwe
servertoegang. Nieuwe pagina- en API-verzoeken worden steeds opnieuw beveiligd.
Er gaan geen microfoongegevens naar server, database of analytics.

## Nieuwe content toevoegen

Onderzoek eerst het domein. Hergebruik ContentWork/ContentCollection en de centrale
contentAccess-service voor echte bron-/taaledities. Voor een activiteit zonder
editie-identiteit: gebruik dezelfde beheerinterface en toegangsprincipes met de
kleinst passende expliciete uitbreiding; bouw geen tweede generiek featureplatform.

Nieuwe gewone toegang is standaard uit. Adminvoorproeven en echte DRAFT-preview
blijven gescheiden. Een zichtbaarheidsschakelaar publiceert niets. Gebruik geen
NODE_ENV-voorwaarde, permanente admin-only proefgate, tijdelijke env-flag,
synthetische collectie, client-only controle of duplicaatinstelling als alternatief.
Wijzig geen gebruikerskeuze bij activiteitnavigatie. Werk labels en benodigde
uitleg bij in alle beschikbare UI-talen en test de volledige rechtenmatrix.

## Uitrol en rollback

Deze PR is geen productie-uitrol. De Synology-container voert bij een later,
afzonderlijk toegestaan starten automatisch Prisma-migraties uit. Controleer
voor merge/deploy de ene additieve kolom, de false-default en de CI-bewijzen.
Er is geen NAS-volume, contentimport of nieuwe noodstopconfiguratie nodig.

Na toegestane deployment blijft de publieke schakelaar uit tot een beheerder
bewust inschakelt. Bij rollback naar de vorige appimage blijft de kolom/data
bestaan; de oude image gebruikt zijn oude admin-only regel. Geen downmigratie,
verwijdering van content of reset van voorkeuren/beloningen uitvoeren.

De eigenaar beheert dagelijkse Hyper Backup. Een onafhankelijke restoreproef is
niet uitgevoerd; dat eerder geaccepteerde risico blijft ongewijzigd.

## Validatie

De bestaande runner `npm run test:hymns:availability` gebruikt alleen een eigen
PostgreSQL-container en een productiebuild. Hij test de additieve migratie met
hashes van bestaande tabellen, herhaalde migrate deploy, conflicterende DDL en
rollback. HTTP-tests controleren de rechtenmatrix, alle vijf endpoints, CSRF,
gewijzigde payloads, caches, een tweede serverproces en de noodstop. Browsercases
controleren 320px/200% tekst, 390px donker en desktop: bestaande backendbediening,
blijvende instelling, gewone kaart, toetsenbord, directe weigering en databehoud.

Lokaal gecontroleerd: Prisma validate/generate, TypeScript, productiebuild,
i18n (alle nieuwe sleutels in vijf talen), 74 gerichte content-/shell-/toegangstests,
52 live-data-tests, 163 geslaagde Lofzangen-tests en 35 proxy/coast/read-ahead-tests.
Twee bestaande tests met echte audio zijn overgeslagen: de opnamen zijn niet
beschikbaar. ESLint heeft geen fouten en 155 waarschuwingen in bestaande code.
De i18n-inventaris meldt bestaande onvolledige vertalingen (3761/4179 per niet-NL-taal).
De build gebruikt de bestaande brandingfallback omdat tijdens statische generatie
geen applicatiedatabase is aangesloten. De geïsoleerde HTTP-testfixture meldt
bovendien de bestaande pg-waarschuwing over parallel client.query-gebruik.

De geïsoleerde migratie behoudt de oude kolominhoud van alle 146 bestaande
tabellen; de nieuwe activiteit begint verborgen, enabled blijft behouden en zowel
herhaalde deploy als een afgebroken/conflicterende DDL zijn gecontroleerd.
De HTTP-rechtenmatrix slaagt inclusief tweede serverproces, noodstop, alle vijf
endpoints en ongewijzigde voorkeur-/voortgang-/publicatie-/economierijen.
De browsercontrole ontdekte bestaande krappe beheerregels bij 320px/200% tekst;
de regels in dezelfde component mogen daarom omvouwen in plaats van overstromen.

De definitieve Playwright-ronde slaagt op 320px licht met 200% tekst, 390px donker
en 1280px desktop, inclusief toetsenbordselectie, herladen en weer intrekken.
Er is geen horizontale overflow en de voorkeur-/voortgangscontroles blijven gelijk.
Niet getest op fysieke iOS-/Android-toestellen. Commit en screenshots staan bij de PR. De bestaande workflow `content-access.yml` bevat hiervoor de job
`hymns-availability`, inclusief de volledige bestaande muziektests. Screenshots
blijven in het CI-artifact `hymns-availability-browser`, niet als grote Git-bestanden.
