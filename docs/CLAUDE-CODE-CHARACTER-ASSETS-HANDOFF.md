# CLAUDE CODE IMPLEMENTATION HANDOFF

Deze levering bereidt uitsluitend beelden en documentatie voor. De PR mag niet automatisch gemerged worden. Er is geen nieuwe applicatiefunctionaliteit geactiveerd. Implementeer later bewust, met de bestaande code en datamodellen als uitgangspunt.

## Bronnen en stabiele identiteit

Lees `docs/character-assets.md` en het uitgebreide bestaande `docs/scripture/character-registry.json`. `uiLibrary` is beschrijvende metadata, geen runtime-schema. Dit register blijft de ene visuele canon. `docs/scripture/avatar-accessories.json` beschrijft de acht onafhankelijke lagen; `avatar-asset-quality-report.json` bevat dimensies/alpha/hash; `character-avatar-files.json` alle nieuwe productie-exportpaden. `avatar-previews/` is uitsluitend visuele documentatie.

Gebruik de canonieke ID, niet de weergavenaam als sleutel. Voorbeelden: `ammon-missionary` versus `ammon-expedition`; `captain-moroni` versus `moroni-son-mormon`; `nephi`, `nephi-son-helaman`, `nephi-son-nephi`; de twee Helamans en twee Alma's. Normaliseer het behouden legacy-ID `brother-jared` naar `brother-of-jared`. Maak geen tweede avataroptie voor die alias.

Voorgestelde toekomstige resolver levert per ID `avatarCompact`, `bustCompact`, `bustDetail`, `fullBody`, toegankelijk label en beschikbaarheidsstatus. Gebruik de documentatie om een klein typed runtime-register te maken; laad niet het hele historische document met generatiebeschrijvingen in iedere browser. Eén beeldbron voor drie portretgroottes, bestaande body/sheet hergebruiken. Runtime-paden beginnen met `/scripture/`, zonder `public/`.

## Hulpmiddelen: compacte buste en grotere detailweergave

Start in `src/app/tools/persons/page.tsx` en `src/app/tools/persons/persons-search.tsx`. Nu worden Prisma `Person`-records met slug/naam/beschrijving/familiebanden verzameld en als tekstlijst getoond. De pagina is collectie-afhankelijk (Boek van Mormon versus Leer en Verbonden).

Voeg later een expliciete mapping van `(collection, Person.slug)` naar canonieke character-ID toe. Kandidaten uit `prisma/introPersons.ts` staan per personage onder `uiLibrary.personSeedSlugCandidate`; ze zijn tegen de seed gelezen, maar de live database is niet gewijzigd of volledig gecontroleerd. Niet automatisch een naam of slug in een URL interpoleren. Voorbeelden: `ishmael` → `ismael`, `jakob` → `jacob-son-lehi`, `moroni` → `moroni-son-mormon`, `moroni-bevelhebber` → `captain-moroni`, `ammon` → `ammon-missionary`, `ammon-2` → `ammon-expedition`, `vrouw-van-nephi` → `nephi-wife`, `koningin-1` → `lamoni-wife`, `vrouw-van-ishmael` → `ismael-wife`, `koningin-2` → `lamoni-father-wife`.

Belangrijke onduidelijkheid: seed `alma` heeft een beschrijving die Alma de jongere lijkt te noemen, terwijl `alma-de-jongere` als zoon naar `alma` verwijst. Bevestig dit met de eigenaar/live record voordat je Alma de oudere afbeeldt. De kunst-PR repareert geen inhoud of database. Ook de naam “moeder van Lamoni” in de huidige seed voor `koningin-2` is geen bewijs dat de tekst haar biologische moederschap vaststelt; de canonieke beschrijvende naam blijft “Vrouw van Lamoni’s vader”.

Compacte lijst: 48–56 CSS-pixel buste, 256/512-export afhankelijk van pixeldichtheid. Tik/klik op een echte button opent een responsief detailvenster met 1024-export, naam/rol, hoofdstukverwijzing en reeds beschikbare informatie. Richtmaat detailbeeld 144–240 CSS-pixels afhankelijk van venster; laat het beeld niet de hele mobiele tekstkolom verdringen. Behoud zoekfilters, relaties, collectie en bestaande ankerlinks. Ontbrekende mapping krijgt een nette bestaande tekst/fallback, nooit een willekeurig ander persoon. Vier nieuwe vrouwen hebben tekstuele bronverwijzingen, maar het aanmaken/wijzigen van Person-records is apart implementatiewerk.

## Mysterie: buste selecteren, lichaam slepen

Relevante bestanden: `src/components/mysteries/MysteryPlayPage.tsx`, `src/components/mysteries/Mystery001aClient.tsx`, `src/lib/mysteries/types.ts`, `src/lib/mysteries/logic.ts` en de bestaande `src/lib/mysteries/mystery001a.ts` t/m `mystery006c.ts`-definities.

De huidige client toont in het palet een kleine afbeelding van `character.asset` (48px), gebruikt pointer-events voor de start en toont tijdens slepen en op het bord dezelfde asset. Vervang later uitsluitend het paletbeeld door de gekoppelde buste; laat geselecteerde ID, pointer capture, drag-offset, validatie en terugvalgedrag werken zoals nu. Zodra het slepen start toont het drag-preview weer **de oorspronkelijke `character.asset`**, ook als de buste groter is. Het bord blijft datzelfde lichaam renderen.

Negen huidige body-koppelingen, die exact moeten blijven bestaan:

| ID | Bestaand actief lichaam |
|---|---|
| lehi | `/mysterie-001a-ontdekker/lehi.png` |
| sariah | `/mysterie-001a-ontdekker/sariah.png` |
| laman | `/mysterie-001a-ontdekker/laman.png` |
| lemuel | `/mysterie-001a-ontdekker/lemuel.png` |
| sam | `/mysterie-001b-onderzoeker/sam.png` |
| nephi | `/mysterie-001c-schriftkenner/nephi.png` |
| laban | `/mysterie-002b-onderzoeker/laban.png` |
| zoram | `/mysterie-002c-schriftkenner/zoram.png` |
| ismael | `/mysterie-003b-onderzoeker/ismael.png` |

`cellFootAnchor` en `characterImageMetrics` in `logic.ts` gebruiken bestaande `footAnchorInCell`, `footAnchorPixels`, afbeeldingsdimensies en zichtbare lichaamslengte. Neem geen portret-bounding-box of schoudercoördinaat als voetenanker. De historische PNG-canvasmarges maken onderdeel uit van de werkende geometrie. De nieuwe full-body-masters voor andere personages zijn visueel bruikbaar, maar nog niet gekalibreerd/ingeschreven in een speldefinitie; doe dat alleen bij een toekomstig spel dat ze daadwerkelijk gebruikt. Test bij zo'n integratie een verschoven viewport, responsive speelveld, schaal, pointer cancellation en plaatsing op bestaande doelen. Verander in de huidige avatar-integratie geen manifest, bordcoördinaat of spelregel.

## Eén gebruikersavatar voor de hele app

`src/components/UserAvatar.tsx` is het bestaande gedeelde beeldcomponent: xs28, sm36, md44; emoji/initialen, decoratieve ID-kleur en batch-cache van avatar-data. `src/app/api/users/avatars/route.ts` retourneert momenteel alleen `avatarEmoji`. `src/components/ProfileClient.tsx` gebruikt voor het eigen profiel een afzonderlijke emoji-button/kiezer en slaat `avatarEmoji` op. Deze PR wijzigt niets daarvan.

Ontwerp later één centrale avatarresolver en renderer. Bepaal daarvoor met het huidige Prisma/account-model hoe optionele canonieke character-ID en optionele background/frame/overlay-ID's bewaard worden. Voorgestelde conceptvelden, geen reeds bestaande velden: `avatarCharacterId`, `avatarBackgroundId`, `avatarFrameId`, `avatarDecorationId`, eventueel `avatarLightAccentId`. Houd bestaande emoji-data als compatibele fallback tot migratie bewust is uitgevoerd. Server valideert toegestane IDs en eventueel al verdiende beschikbaarheid; nooit een vrije willekeurige asset-URL accepteren. Hergebruik bestaande account-save route en batch-API waar passend; behoud authenticatie/zichtbaarheid/caching. Invalideer centrale cache na wijziging zodat vrienden, reacties en profiel meteen dezelfde selectie tonen.

Laat eigen profiel en alle bestaande gedeelde componenten dezelfde renderer gebruiken. Controleer concreet: `FriendsClient.tsx`, `FriendProfileClient.tsx`, `LeaderboardClient.tsx`, `ActivityFeedClient.tsx` (actor én reactiegebruikers), `social/GroupDetailClient.tsx`, `shell/HeaderAvatar.tsx`. Zoek tijdens implementatie tevens alle `avatarEmoji`/`UserAvatar`-aanroepen in samen spelen, meldingen, reeksen en prestaties: sommige daarvan hebben mogelijk geen avatar of een andere inline-weergave. Voeg het beeld alleen toe waar een gebruiker wordt aangeduid; claim geen eerdere visuele dekking die niet bestaat. `HeaderAvatar` bepaalt geen eigen afwijkende identiteit.

Selectiekiezer: fase A standaard beschikbaar, fase B vroeg als pakket. Voor afgesloten keuzes toon naam en de werkelijk bestaande prestatie/activiteit waarop Claude ze bindt. Behoud duidelijke selectiefeedback, toetsenbordbediening en mobiel scrollgedrag. Geen winkel of valuta. Een gebruikersnaam naast het beeld blijft toegankelijk; gebruik lege alt als het portret redundant is, anders een korte beschrijvende naam. Vermijd dubbele schermlezerlabels.

## Grotere, rustige avatarmaten

Aanbevelingen: reacties32; compacte lijsten36–40; vrienden/groepen48; ranglijst48 mobiel en56–64 als er ruimte is; compacte profielbadge96 mobiel/112 desktop; detail144. De nieuwe aanvulling vervangt die badge als standaard hoofdbeeld: eigen en vriendprofiel tonen een volledig personage in een vaste header van240–300px. Header36 behouden in bruikbaar aanraakvlak. XS/SM/MD alleen globaal vergroten zonder de toepassingen na te lopen zou bijvoorbeeld de header onnodig verhogen: maak bewuste semantische varianten of expliciete contextgroottes.

Live read-only proef van het huidige profiel: viewport320, documentbreedte320, headerknop40, eigenavatar56. Nieuwe groottes zijn nog niet geïmplementeerd. Op320px profielbeeld boven naam/informatie als de horizontale combinatie te breed wordt; vriendenrijen tekst `min-width:0`, statusbadge zichtbaar, langste namen wrappen zonder knopoverlap. Test320/360/390px, grote tekst, light/dark, laden en fouten. Voor een96px-beeld volstaat de256-export voor veel mobiele schermen; gebruik512 bij hoge DPR/meer detail. 1024 hoort bij de grote buste, niet iedere reactie-download.

## Vier onafhankelijke lagen

Container is vierkant; app bepaalt achtergrondkleur en ronde maskering. Iedere afbeeldingslaag vult exact hetzelfde vierkant met behoud van haar transparante marges. Lees de werkelijke paden/maten/ankers in `docs/scripture/avatar-accessories.json`.

1. App-achtergrondkleur, plus eventueel `background-stars`.
2. Het karakterportret, zonder ingebakken achtergrond/kader/accessoire.
3. Optioneel subtiel `overlay-light`, dan hoogstens één van `overlay-compass`, `overlay-scroll`, `overlay-mystery`.
4. Hoogstens één `frame-bronze`, `frame-silver` of `frame-gold`.

Alle lagen delen1024×1024/256×256 en canvascentrum512,512. De decoratie is al op de bedoelde schouderpositie getekend binnen haar volledige transparante vierkant. Niet trimmen, niet de zichtbare icon-bounds los centreren, geen extra translate die een andere plaats introduceert. Frames hebben echte transparante binnenruimte; sterren en licht blijven perifeer. De gemeten alpha≥32-grenzen staan in het document; ze zijn informatief en niet bedoeld als nieuwe CSS-crop.

Respectvolle religieuze voorstelling: kleding/haar/identiteit blijven intact; accessoires zijn randdecoratie, geen verkleedlagen. Gebruik op32px minder tegelijk als details te druk worden. Voorbeeldcombinaties zijn alleen QA-documentatie; laad nooit een samengestelde voorbeeld-JPEG als de echte avatar.

## Bestaande voortgang en instellingen hergebruiken

`src/lib/achievements.ts` levert bestaande prestatie-ID's en criteria. Voorgestelde aansluiting: faseB aan één vroeg bestaand item (`first-chapter` of `kids-first-story`, na productkeuze); latere opties aan `chapters-5/10`, `intro-all-lessons`, `kids-10-stories`, `streak-7/30`. De `chapters-*`-criteria tellen afgeronde exercise sets, niet uitsluitend lezen. Geen nieuw criterium of voortgangsteller uit de visuele documentatie afleiden.

`src/lib/streak.ts`, `src/lib/leagues.ts` en `src/lib/leagueTiers.ts` blijven gezaghebbend. Bronze/silver/gold-kaders kunnen op huidige divisies aansluiten; bestaande divisie-emblemen onder `/icons/divisions/` blijven intact. Een Mysterie-accessoire alleen aan een reeds betrouwbare bestaande voltooiing binden nadat dat datamodel is gecontroleerd. Vrouwen staan niet achter een lange mannelijke unlockladder: eerste8 zijn4/4, eerste pakket daarna2/2, samen6/6.

`User.companion` blijft onafhankelijk: Novi/Varo/Vera en `PersonalMascot`, `CompanionProvider`, `MascotSlot`, `src/lib/companion.ts`/`mascots.ts` niet gebruiken als scripture-avatar opslag of renderer. Alle bestaande mascottestates en refs zijn ongewijzigd.

## Acceptatie voor een toekomstige implementatie

- Juiste persoon bij iedere mapped slug en alle gelijknamige personen; BOM/DC gescheiden; onbekende mapping nette fallback.
- Eén keuze zichtbaar op alle gebruikerssurfaces; legacy emoji blijft werken tot bewust vervangen; cachewijziging zichtbaar.
- Herkenbaar op32/48/96px en op320px zonder overflow; face/hair niet afgesneden; lichte/donkere achtergronden.
- Accessoires uit losse bestanden, vierkante canvasuitlijning, geen face-overlap en maximaal één schouderdecoratie.
- Mysterie-paletten buste, drag/bord oorspronkelijke body, identieke voetenankers en spelgedrag.
- Alleen bestaande verdiende voorwaarden na expliciete implementatie; eerste selectie4v/4m en vroeg pakket2v/2m.
- Passende bestaande checks volgens `CLAUDE.md`: typecheck en relevante build/tests; visuele QA voor de gewijzigde routes. Deze asset-PR zelf voegt geen applicatietests of code toe.


## Aanvulling: grote interactieve profielheader en toekomstige animatie

De gebruiker heeft tijdens de productie aanvullend gevraagd om standaard een **volledig personage** op het eigen en vriendprofiel, in een mobiele header van ongeveer240–300px hoog. De eerdere96/112px-aanbeveling is alleen nog voor compacte profielbadges; het is niet de nieuwe standaard hoofdweergave. Werk verder vanuit `ProfileClient.tsx` en `FriendProfileClient.tsx`, met dezelfde centrale identiteit als `UserAvatar` op alle kleine oppervlakken.

Reserveer één vaste responsieve headerhoogte (bijvoorbeeld280px mobiel, binnen240–300). Achtergrond blijft in deze container staan; de container, volgende tekst en pagina-scrollpositie veranderen niet bij tikken. Standaard pas het bestaande transparante volledige lichaam incl.voeten binnen deze header, met comfortabele boven- en ondermarge. Eerste tik vergroot vloeiend naar hoofd/schouders; tweede tik keert terug naar het hele lichaam. Gebruik een button met expliciet toegankelijke toestand/label en toetsenbordbediening; ondersteuning voor `prefers-reduced-motion` geeft een directe toestandsovergang.

**Aanbevolen overgang:** transformeer hetzelfde bestaande full-body-raster tussen twee camera-instellingen binnen een vaste geclipte beeldruimte. Hiermee zijn de twee toestanden letterlijk hetzelfde gezicht en dezelfde kleding, zonder sprong in pose, licht of accessoires. Een afzonderlijk nieuw portret kan in een detaildialoog worden gebruikt, maar is geen geometrisch identieke frame van het lichaam. Vervang het lichaamsbeeld dus niet abrupt door dat portret tijdens de zoom. Als hoge-resolutie portretwisseling later nodig blijkt, eerst pose/licht/pixeluitlijning visueel kalibreren; de huidige buste/body-paarvorming garandeert identiteit, niet een automatisch naadloze morf.

`docs/scripture/profile-character-framing.json` beschrijft per lichaam de bronafmetingen, gemeten zichtbare alpha-grenzen, een voeten-/canvasanker voor het profiel en een voorlopig hoofdanker. Dit is uitsluitend voor de profielcamera; het vervangt geen Mysterie-geometrie. Gebruik voor full-body schaal de zichtbare lengte, niet de totale canvasmarge. Zet de zichtbare voetenbasis rond headerhoogte−16px. Voor buste schaal rond2.3–2.8× de full-body-weergave en breng het gemeten/visueel gekalibreerde hoofdanker naar ongeveer84px vanaf de bovenkant (circa17px marge boven de zichtbare haartop in de280px-proef). De buste gebruikt dezelfde rasterbron, zodat hoge-resolutie bodies moeten worden geladen op profiel/detail, terwijl de kleine socialavatars hun256px-export houden. Definitieve hoofdankers en schaal per pose moeten in de werkende responsieve header worden gecontroleerd; de geleverde proefbeelden zijn documentatie, geen live implementatietest.

Lagen blijven onafhankelijk. Achtergrond/star-pattern staat vast. Alleen het lichaamsbeeld verandert camera/schaal. Kader en kompas/rol/schild zijn huidige **vierkante avatarlagen**, geen rekbare rechthoekige profielomlijsting en geen kleding op het lichaam. Houd ze desgewenst in een vaste vierkante decoratieruimte binnen de header of als losse badge in de hoek; stretch ze nooit over de hele rechthoek. Gebruik één decoratie, zo geplaatst dat zij in beide toestanden het gezicht niet bedekt. Een headerbreed patroon of rechthoekig kader zou later een apart bewust ontwerp vereisen; zulke extra afbeeldingen zijn nu niet onnodig gemaakt. De achtergrond wordt niet onderdeel van een body-export.

Er worden **nu geen animaties** gemaakt. De native PNG's, bestaande sheets, full-bodies, varianten en prompts blijven de bron. Een vlak PNG/WebP is geen rig en bevat geen afzonderlijke ogen, handen of torso. Voor later knipperen/ademhalen/hoofdbuigen/een zwaai zijn aanvullend nodig: goedgekeurde losse hoofd/torso/armen/handenlagen met verborgen aansluitingen, afzonderlijke oogwit/iris/pupil/oogleden en open/dicht-eye-poses, mond-/expressievormen waar nodig, kleding/haar/baardlagen, pivots/botpunten of een echt3D-model met textures/rig. Documenteer bron- en poseversies onder dezelfde ID; maak geen tweede canon. Een zwaai vereist andere arm/handbron en kan niet betrouwbaar uit alleen het huidige stilstaande raster worden afgeleid. Kader/achtergrond blijven losse systeemlagen; subtiele characterbeweging mag de vaste headerhoogte niet wijzigen. Voor een echte zoom vanuit3D is later een consistent gerigged model en camera nodig. De huidige rastervoorbereiding maakt hergebruik mogelijk maar claimt geen reeds aanwezige animatierijpheid.
