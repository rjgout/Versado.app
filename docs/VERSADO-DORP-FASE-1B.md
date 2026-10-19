# Versado Dorp — fase 1B technisch rapport

Branch: `codex/versado-dorp-fase-1a`

PR #145 is tijdens de uitvoering buiten deze opdracht om gemerged. De fase-1B-wijzigingen staan daarom in de
open, mergeable [draft-PR #147](https://github.com/rjgout/Versado.app/pull/147); deze wordt niet gemerged of
gedeployed.

## Uitgevoerde verbeteringen

Fase 1B bouwt gericht voort op het bestaande Canvas 2D-prototype. De afgeschermde route, echte Work-assets,
Focus/Immersive-integratie, plaatsingslogica, bewoners en bestaande bediening zijn behouden. De wijzigingen zitten
uitsluitend in het dorpsdomein, de bestaande dorptests, dit rapport en nieuwe screenshots.

- de 250ms-redrawtimer is verwijderd en vervangen door een samenvoegende `requestAnimationFrame`-planner;
- alle camera-input vraagt onmiddellijk een frame aan, zonder React-update per frame;
- pinch gebruikt het midden tussen beide vingers als vast wereldanker en kan na loslaten niet als tik eindigen;
- huidige-kaart-fit en maximale R62-fit zijn afzonderlijke opdrachten;
- de fit gebruikt de werkelijk geprojecteerde cirkeltegels plus concrete bosplaatsingen en kroonoverhang;
- de startkaart is definitief R8, met zestien productmatig gekozen stappen naar R62;
- geplaatste objecten zijn vervangen door blijvende exemplaarrechten met optionele positie;
- lokale opslag gebruikt een nieuw, strikt v2-contract;
- paden staan in een eigen logische laag met connectiviteitsmaskers voor eind-, recht-, bocht-, T- en kruispunten;
- bosassets zijn gegroepeerd per rol en voorbereid op deterministisch gekozen varianten.

## Camera en wereldfit

`src/lib/dorp/camera.ts` bevat de pure fit-, zoom- en planningsfuncties. Een cameramutatie wijzigt een ref en vraagt
één volgend animation frame aan; meerdere mutaties vóór dat frame worden samengevoegd. Er is geen permanente
renderlus en geen interval meer. Alleen aan het einde van een gesture wordt de kleine cameraweergave voor de
plaatsingshulp naar React teruggekoppeld.

Muiswielzoom behoudt het wereldpunt onder de cursor. Pinch bewaart het wereldpunt onder het oorspronkelijke midden
van de twee vingers en verwerkt zowel afstand als een bewegend midden. De gesture houdt expliciet bij of er ooit
meerdere pointers waren en gebruikt een bewegingsdrempel van 6 CSS-pixels. Daardoor kan het opheffen van een vinger
na pinch geen objectselectie activeren. Resize en oriëntatiewissel behouden een vrije camera; een actieve kaart- of
R62-fit wordt opnieuw berekend.

De fit rekent niet meer met een ruime bounding box. `projectedWorldBounds()` projecteert iedere geldige cirkeltegel
en neemt de deterministische bosplaatsingen met hun echte renderafmetingen en kroonoverhang mee. De beschikbare
viewport trekt de bestaande safe-area-variabelen en ruimte voor header/bediening af. De LOD gebruikt dezelfde
wereldstaat en dezelfde berekende grenzen. De knoppen **Kaart** en **R62** tonen respectievelijk de huidige kaart en
de maximale toekomstige wereld.

## Groei van R8 naar R62

De expliciete productbeslissing is verwerkt:

```text
radius(k) = 8 + 3k + floor(6k / 16), k = 0..16
```

Dat levert `8, 11, 14, 18, 21, 24, 28, 31, 35, 38, 41, 45, 48, 51, 55, 58, 62`: tien stappen van +3 en zes van
+4. R14 blijft als aparte ontwikkelfixture aanwezig. De maximale kaart blijft 125×125 met exact 12.061 bouwbare
tegels. De technische hoofdstukdrempels volgen `ceil(239k/16)` en lopen van 15 tot 239, maar zijn nergens aan echte
leesvoortgang of beloningen gekoppeld.

De aangepaste R8-testindeling is volledig geldig. Kleine huizen passen; de 12×12-tempel heeft geen geldige
ankerpositie. Uitbreiden verandert geen coördinaten. Verkleinen verwerkt exemplaren in vaste volgorde en bergt ieder
exemplaar dat niet volledig binnen de nieuwe radius past veilig op.

## Eigendom, inventaris en opslag

`DorpOwnedInstance` bewaart een stabiele `instanceId`, openbaar `objectId`, level en `position | null`. `null` betekent
opgeborgen. De Work-catalogus levert footprint, `maxInstances`, maximale niveaus en categorie. `maxInstances = 1`
maakt de pilotgebouwen en tempel uniek; props en natuur kunnen meerdere afzonderlijke rechten hebben. De expliciete
prototypefixtures geven één recht voor unieke objecten en twee testrechten voor herhaalbare objecten. Dit is geen
valuta, XP of echte vrijspeelstatus.

Terugnemen zet alleen de positie op `null`. Herplaatsen wijzigt alleen die positie: instance-ID en upgradeniveau
blijven gelijk. Een geplaatst uniek exemplaar is niet nogmaals beschikbaar in de inventaris. Kaartverkleining gebruikt
dezelfde opbergoperatie en verliest dus geen upgrades.

Opslag gebruikt `versado-dorp-prototype-v2`. V1 kan niet betrouwbaar worden gemigreerd, omdat die vorm opgeborgen
eigendom niet kende en de R14-posities niet noodzakelijk op R8 passen. V1 blijft daarom ongemoeid, wordt niet als v2
gelezen en leidt tot een zichtbare uitleg met resetmogelijkheid. V2 valideert versie, volledige fixture-rechten,
unieke instance-ID's, cataloguslimieten, levels, posities, collisions, kaartgrens en paden. Ongeldige of incomplete
data valt terug op de bekende testfixture. Dit contract raakt geen echte spelergegevens.

Een latere serverwereld kan hetzelfde onderscheid gebruiken: beloningen voegen server-side een exemplaarrecht toe;
plaatsing verandert uitsluitend de nullable wereldpositie. De server moet cataloguslimiet, level, footprint,
collision en radius transactioneel herhalen. Lokale v2-data is geen productiebezit.

## Terrein, paden, gebouwen en bos

Codegerelateerde verbetering: het Canvas gebruikt één op device-pixels uitgelijnd cameranulpunt, een begrensde DPR
en één consistente projectie. Daardoor ontstaat tijdens fractionele camerabeweging minder sampling-shimmer. Er is
geen overlap, CSS-masker of schaaltruc toegevoegd. De resterende brede lichte rasterkieren, niet-doorlopende
randkleuren en textuurherhaling zijn reproduceerbaar onderdeel van de huidige Work-afbeeldingen.

Paden zijn niet langer een hardcoded terreinkeuze. `world.paths` is een losse, gratis logische laag. De vier buren
vormen een bitmasker dat geïsoleerd, einde, recht, bocht, T of vierweg kiest. Alleen recht en bocht hebben nu een
geleverd beeld; eind-, T- en kruissprites worden daarom nog niet verzonnen of visueel gefaket. De logica en tests zijn
klaar voor de complete Work-familie; een gebruikerseditor blijft een latere stap.

Gebouwen blijven per level volledig door het veilige manifest geregistreerd. Footprint en wereldpositie veranderen
niet bij upgraden. De huidige runtimecorrecties blijven nodig doordat de oude beelden verschillende ankers en
schalen hebben. Nieuwe uniform geregistreerde exports kunnen via hetzelfde manifest worden vervangen zonder
collision- of eigendomswijziging.

De bosrand gebruikt deterministische plaatsingen en een catalogusstructuur met meerdere varianten per rol. De huidige
levering bevat nog één variant per rol; aanvullende varianten kunnen zonder wereldstaatwijziging worden toegevoegd.
Bos blijft systeemdecoratie buiten de bouwradius en blokkeert geen bouwtegels.

## Work-herstelset

De verwachte NAS-map `/shared/work-assets/inbox/versado-dorp-bom-v1-fix-01/` was tijdens deze uitvoering niet
aanwezig. Er zijn daarom geen nieuwe afbeeldingen, manifests of catalogusgegevens geïntegreerd en geen bestaande
assets vervangen. De renderer blijft de 36 oorspronkelijke openbare WebP-assets gebruiken. Integratie van
`replacement-manifest.json`, terrein-/padfamilie, gecorrigeerde gebouwen en bosvarianten blijft afhankelijk van Work.

## Tests en mobiele controle

- `npm run test:dorp`: 43/43 geslaagd, inclusief camera, fit, R8→R62, drempels, eigendom, opslag, paden, assets,
  routebeveiliging en bestaande Focus/shellchecks;
- `npm run test:character-assets`: 6/6 geslaagd;
- `npx tsc --noEmit`: geslaagd;
- volledige ESLint (`npm run lint -- --quiet`): geslaagd zonder fouten;
- productiebuild (`npm run build`): geslaagd. De lokale omgeving had geen PostgreSQL op `127.0.0.1:5432`; de
  bestaande brandingfallbacks meldden dit tijdens prerendering, maar de build rondde correct af met exitcode 0.

Browser-QA is uitgevoerd in Chromium op 320×568, 390×844, 844×390 en 1280×800. Panning, wielzoom, zoomknoppen,
pinch, kaartfit, R62-fit, inventaris, sluiten, selecteren, upgraden, terugnemen, herplaatsen en fasewissels zijn
doorlopen. Zowel 320 px als liggend hadden `scrollWidth === viewportWidth`. Een synthetische pinch liet geen selectie
achter en er traden geen clientexceptions op.

Tijdens 90 frames met daadwerkelijke muisdrag was het gemiddelde 16,34 ms, het maximum 16,8 ms en waren er geen
frames boven 20 ms in de lokale headless-meting. Dit is een ontwikkelmeting, geen hardwarebudget; een laatste test op
echte iOS-/Android-hardware blijft nodig voor vingergevoel en fysieke safe areas.

## Screenshots van de draaiende renderer

- [Begindorp R8 op 390 px](versado-dorp/screenshots/fase-1b-start-r8-390.png)
- [Begindorp R8 op 320 px](versado-dorp/screenshots/fase-1b-mobile-r8-320.png)
- [Bouwmodus: tempel fysiek ongeldig op R8](versado-dorp/screenshots/fase-1b-buildmode-r8-390.png)
- [Bouwinventaris met opgeborgen exemplaar](versado-dorp/screenshots/fase-1b-inventory-390.png)
- [Familiehuis niveau 3 op dezelfde footprint](versado-dorp/screenshots/fase-1b-upgrade-l3-390.png)
- [Uitgebreide R14-kaart](versado-dorp/screenshots/fase-1b-expanded-r14-390.png)
- [Volledige R62-wereld](versado-dorp/screenshots/fase-1b-world-r62-390.png)
- [Liggende telefoon](versado-dorp/screenshots/fase-1b-landscape-r8.png)
- [Desktop](versado-dorp/screenshots/fase-1b-desktop-r8.png)

De screenshots komen uit de daadwerkelijk draaiende Canvas-renderer. Alleen voor lokale opname is tijdelijk de
login/database-afhankelijkheid overgeslagen; die QA-bypass is niet aanwezig in de branch.

## Open punten

1. Work-herstelset `fix-01` integreren en technisch/visueel opnieuw valideren zodra de NAS-map bestaat.
2. Ontbrekende padbeelden voor einde, T-kruising, vierweg en eventuele geïsoleerde tegel leveren.
3. Gecorrigeerde gebouwankers en vaste broncanvassen voor alle drie niveaus opnieuw meten.
4. Extra varianten per bosrol toevoegen en de ritmische herhaling op R62 opnieuw beoordelen.
5. Pinch, safe areas en langdurige camerabeweging op echte iOS- en Android-hardware profileren.
