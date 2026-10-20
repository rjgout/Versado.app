# Versado Dorp — fase 2C: auditcorrecties

Basis: main `4fc35027`, na #148 en #149. Tijdens CI is #150 gemerged;
de branch is daarna veilig met main `8caac0b1` gesynchroniseerd. Alleen
`docs/DATA-REFRESH.md` conflicteerde: beide aanvullende secties zijn behouden.
De CFM-stapvoortgang, leeswijze en vertalingen van #150 blijven intact. Audit:
[#149, commentaar eigenaar](https://github.com/rjgout/Versado.app/pull/149#issuecomment-6271571301).
Geen nieuwe assets, datamodel, migratie, contentimport of productiehandeling.

## Bevindingen en correcties

### XP-overdracht en divisie

Oorzaak: de gift boekte uitsluitend saldo en audit, terwijl bestaande aankopen
ook `applyWeeklyXp` gebruiken. De verzender betaalt nu via `awardXp(-5)` en
`applyWeeklyXp(-5, {enroll:false})`. Een bestaande weekscore daalt precies 5;
zonder bestaande deelname ontstaat geen WeeklyScore, divisiegroep of seizoen.
Andere aanroepers behouden hun bestaande inschrijvingsgedrag.

De ontvanger krijgt alleen saldo en `VILLAGE_GIFT_RECEIVED`, nooit een
CompetitionXpEvent, reeksactiviteit of voortgang. De bestaande gesorteerde
gebruikerslocks, vriendschapslock, UUID-idempotentie en rollende 24 uur blijven.
Hints/freezes namen vóór hun saldocontrole nog geen gebruikerslock. Die twee
winkeltransacties gebruiken nu dezelfde lock, zodat een gelijktijdige gift of
Genees-aankoop niet samen te veel kan uitgeven. Prijzen en beloningen veranderen
niet. Oude gifts en divisiescores worden niet achteraf herberekend.

Tests: bestaande deelname, ontvanger ongewijzigd, geen deelname door cadeau,
duplicaten, cooldown, onvoldoende saldo, gelijktijdige hints/freezes/Genees en
voldoende saldo voor twee uitgaven. Foutinjectie tijdens de ontvangersledger
controleert rollback van beide saldi, divisie, gift, ledger en notificatie.

### XP-geschiedenis

Oorzaak: de weekpill telde alle positieve boekingen, inclusief ontvangen gifts.
De bestaande API retourneert additief ontvangen/verstuurde week-XP en de echte
WeeklyScore; `xpThisWeek` bevat verdiende XP zonder ontvangen gifts.
Het saldo heet nu beschikbare XP. Ontvangen, verstuurd, verdiend en competitie
zijn afzonderlijk gelabeld in alle vijf talen. Geen nieuwe deelname door GET.
De privéresponse heeft `no-store` en `Vary: Cookie`.

Tests: echte API-bedragen vóór/na gift en gewone verdiende XP; productiepagina
in nl/en/de/fr/es, licht/donker, 320/390/1280px en 200% tekst op 320px.

### Privacy en cache

Oorzaak: serverchecks waren correct, maar de browser behield oude bezoekdata
bij invalidatie of een mislukte hercontrole. `discardOnRevalidate` is opt-in
voor bezoek/miniatuur: wis vóór hercontrole, bij invalidatie en unmount;
negeer responses van een oudere generatie. Gewone live-queries behouden hun
bestaande gedrag. Profiel-/bezoekkeys bevatten ook de ingelogde gebruiker.

Na een privacycommit krijgen uitsluitend eigenaar/geaccepteerde vrienden een
inhoudsloos signaal. Ontvrienden meldt beide accounts; de beheerschakelaar
gebruikt het bestaande geauthenticeerde topiccontract (`dorp-access`).
`friendsChanged`/`settingsChanged` raken ook Dorp. De bestaande centrale
focus-, visibility-, reconnect- en timerinfrastructuur blijft leidend. Offline
of socketverlies wist de beschermde cache. Periodieke hercontrole gebruikt
dezelfde centrale klok (15 seconden per zichtbaar bezoek), geen tweede klok.
Bij gemiste signalen is intrekking daarom afhankelijk van netwerk/volgende
controle; offline wordt oude beschermde inhoud niet als toegankelijk getoond.
Een technische stop bij containervervanging veroorzaakt disconnect/hercontrole.

Tests: twee gelijktijdige geauthenticeerde browsercontexten, echte Socket.io,
miniatuur en open read-only bezoek, privacy intrekken/herstellen, ontvrienden,
backend uit/aan, offline/online en een vertraagde oude toegestane response.
Geen geïmiteerd realtime-event of alleen handmatige refresh als bewijs.

### Groepsdorpen

De bestaande volgorde User (gesorteerd) → SocialGroup → DorpVillage blijft.
Groepsvertrek/removal neemt de groepslock en vraagt daarna geen gebruikerslock;
geen nieuwe groepsschrijver of verplaatsingslogica.

Tests houden een echte PostgreSQL-groepslock vast totdat bouwen,
vertrek/verwijdering én toetreding aantoonbaar tegelijk wachten. Na vrijgave
worden beide mogelijke geldige volgordes gecontroleerd. Verwijderde plaatsingen
keren niet terug door een oude retry na herintreden. Wereldkrimp bergt
buitenliggende objecten op; eigendom/globale levels blijven exact gelijk.
Bestaande tests voor twee plaatsende leden, UUID/versieconflicten, maximaal vijf
groepsdorpen en tien gewone groepslidmaatschappen blijven behouden.

### Proefrechten en groei

Alle bestaande `DorpOwnedObject`-rijen horen bij alpha-contract
`ALPHA_PILOT_V1`. Dat contract staat expliciet in de server-DTO en de bediening;
de bestaande inventarisuitleg blijft zichtbaar. Geen nieuwe objectenbron of
verdiende beloningsstatus. Toekomstige echte rechten vereisen een afzonderlijk
migratie-/overgangsplan; proefbezit mag nooit impliciet verdiend bezit worden.
Geen bestaande eigendom, levels of testdorpen verwijderd. De canonieke 239
BOM-hoofdstukken blijven de enige leesbijdragen, met bestaande groepsbonus.
Publieke beschikbaarheid/delen blijven standaard uit; technische flag leidend.

## Feitelijke verificatie

| Controle | Feitelijk resultaat |
|---|---|
| Dorp-/shelltests | 49 geslaagd |
| Live-data/cachetests | 54 geslaagd |
| CFM-persoonlijke studie na sync #150 | 20 geslaagd |
| Dorp DB-/HTTP, XP en concurrency | 16 geslaagd, inclusief rollback-foutinjectie |
| Sociale regressies | 33 geslaagd |
| Profielregressies | 13 geslaagd |
| Divisies, met geïsoleerde database | 5 geslaagd |
| Genees/economie-regressies | 58 geslaagd |
| Dorp-browsermatrix en hydratatie | 15 geslaagd |
| Nieuwe privacy/XP-browserflows | 11 geslaagd, inclusief offline/online |

Geen skips in de geïsoleerde regressierun. Een eerste rooktest zonder DB sloeg
twee DB-divisietests over; daarna zijn alle vijf mét eigen database uitgevoerd.
De laatste browserherhaling corrigeerde uitsluitend een selector: Next heeft
ook een lege `alert` voor routeaankondigingen. De test wacht nu specifiek op
de echte toegangsweigering én afwezigheid van het canvas; geen versoepeling.
Na synchronisatie met #150 is daarnaast een hydratatierace aangetoond:
de SSR-knop kon al worden aangeklikt vóór React de actie kon verwerken.
Met bewust geblokkeerde JavaScript-downloads faalde de nieuwe regressie eerst;
`useSyncExternalStore` houdt de knop nu uit tot hydratatie. Daarna is precies
één klik/POST en een geladen canvas gecontroleerd. Geen extra listener of retry.
De laatste gecombineerde run heeft alle hierboven genoemde DB-, browser- en
regressietests volledig opnieuw uitgevoerd, zonder skips. De definitieve
CI-status op de gepushte head wordt bijgehouden in PR #151.

Migratieproef: oorspronkelijke inhoud van 147 tabellen, 418 constraints en
403 indexdefinities behouden; foutrollback/herhaalde deploy geslaagd.
Actueel: 156 tabellen, 420 indexen, 449 constraints. Geen migratie gewijzigd.
TypeScript, Prisma-validatie, i18n en schone productiebuild geslaagd.
Volledige ESLint: 0 fouten, 169 bestaande waarschuwingen; gerichte lint schoon.
Vertaalachterstand blijft 418 sleutels per niet-Nederlandse taal; de nieuwe
teksten zijn in alle vijf talen aanwezig. Screenshots/resultaten staan in het
CI-artifact `versado-dorp-browser`, niet in Git.

## Grenzen, uitrol en rollback

Afgeschermde alpha; geen algemene vrijgave van de proefeconomie. Geen
500-ledengroep-belastingproef of fysieke iOS-/Android-acceptatie geclaimd.
Dat blijft een voorwaarde voor latere publieke vrijgave, naast een expliciet
ontwerp voor echte ontgrendelingen/kosten en bestaande proefbezittingen.

Eigenaar verzorgt na review merge en deployment. Deze correctie bevat geen
nieuwe migratie; normale containerstart voert uitsluitend bestaande nog niet
toegepaste migraties uit. Houd publiek uit, test als beheerder eerst gift en
intrekking. Bij problemen technische flag uit, vorige appimage terugzetten;
behoud alle rechten, plaatsingen, audits en saldo-overdrachten. Een approllback
herstelt geen saldi of historische divisiescores. Databaseherstel is een
aparte noodhandeling van de eigenaar, geen onderdeel van deze opdracht.
