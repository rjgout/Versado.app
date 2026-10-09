# Versado — visuele-identiteitsaudit 2.0

Status: onderzoeksdocument, 9 oktober 2026
Basis: `origin/main` op commit `ee9afa0`
Auditbranch: `codex/visual-identity-audit-v2`

## Samenvatting

Deze tweede audit beoordeelt niet alleen of er technisch een icoon bestaat,
maar ook of een opvallend element visueel thuishoort in Versado. De eerste
audit richtte zich vooral op de ontbrekende broniconen; die acht broniconen
zijn inmiddels geïntegreerd via `contentMetadata.ts` en `ContentIcon.tsx`.

In deze audit zijn 31 publieke kandidaatclusters onderzocht. Daarvan worden
11 nieuwe runtime-afbeeldingen aanbevolen. Ze zijn te produceren in drie
samenhangende batches:

1. Kompas, sociale uitnodiging en hulpmiddelen: 3 afbeeldingen.
2. Podium en prestaties: 7 afbeeldingen.
3. Meldingen en lege status: 1 afbeelding.

De overige opvallende elementen krijgen geen nieuwe bitmap. Ze zijn al
officieel, kunnen een bestaand Versado-asset hergebruiken, of zijn kleine
(functionele) iconen waarvoor een duidelijke lijnvorm beter werkt. De
belangrijkste P1-kandidaten zijn de toolbox-emoji, de envelop-met-hart,
de lege meldingenstaat, de huidige top-drie-medailles en de emoji-achievements.

De profielavatar rechtsboven is volledig buiten scope gehouden. Er worden
geen nieuwe avatarafbeeldingen, fallbacks, uitsnedes of maatadviezen voor
voorgesteld.

## Onderzochte basis en betrouwbaarheid

### Repositorystatus

- De audit is gestart vanaf de actuele `origin/main` (`ee9afa0`).
- De branch is `codex/visual-identity-audit-v2`.
- PR #61 (`codex/visual-asset-audit`) staat nog open; de drie v1-documenten
  zijn voor vergelijking rechtstreeks vanaf die branch gelezen en zijn niet
  opnieuw toegevoegd aan main.
- De broniconenintegratie uit de eerdere implementatie staat al in main:
  `public/icons/content-sources/`, `src/lib/contentMetadata.ts` en
  `src/components/versado/ContentIcon.tsx`.
- Er waren al niet-gecommitte wijzigingen van de gebruiker in
  `package.json`, `src/lib/courses.ts` en `tests/courses.test.ts`. Die zijn
  niet onderzocht als auditwijziging, niet aangepast en niet gecommit.

### Code en assets

Gelezen zijn `CLAUDE.md`, `docs/VERSADO-DESIGN.md`,
`docs/VISUAL-ASSET-AUDIT.md`, `docs/VISUAL-ASSET-PRODUCTION.md`,
`docs/VISUAL-ASSET-INTEGRATION.md`, `docs/VERSADO-CHARACTER-CANON.md`,
`docs/CHARACTER-AVATAR-SYSTEM.md` en `docs/character-assets.md`.

Doorzocht zijn de publieke componenten, App Router-pagina's en relevante
registers onder `src/components/`, `src/app/`, `src/lib/` en `public/`,
met extra aandacht voor Friends, Groups, Kompas, profiel, meldingen,
competitie, achievements, hulpmiddelen, leren, spelen, Vandaag en onboarding.

De repository bevat op dit moment 874 bestanden onder `public/`:

| Formaat | Aantal | Opmerking |
|---|---:|---|
| WebP | 517 | Runtime-assets en personages |
| JPG | 216 | Bestaande content-/karakterafbeeldingen |
| PNG | 99 | Artwork, referenties en PWA-assets |
| Overig | 42 | Registers, metadata en placeholderbestanden |

Er zijn 82 bronbestanden met een `lucide-react`-import. Dat aantal is geen
vervangingsdoel: de meeste iconen zijn bediening, navigatie of semantische
status en moeten juist eenvoudig herkenbaar blijven.

### Screenshots

De acht aangeleverde iPhone-screenshots zijn daadwerkelijk visueel bekeken:

| Bestand | Getoond scherm | Belangrijkste bevinding |
|---|---|---|
| `IMG_3243.png` | Vandaag | Bestaande content-artwork en Varo voelen officieel; de navigatie gebruikt bewuste lijniconen. |
| `IMG_3244.png` | Leren | Cursusbeelden zijn sterk; de rode `🧰` bij Hulpmiddelen is een duidelijke stijlbreuk. |
| `IMG_3245.png` | Vrienden — competitie | De CSS-medailles voor 1, 2 en 3 zijn herkenbaar maar vlak en generiek. |
| `IMG_3246.png` | Vrienden | `👥`, `🟢`, `➕` en de uitnodigingsillustratie zijn emoji in een verder gestileerde interface. |
| `IMG_3247.png` | Meldingen | De grote gele `🔔` in de lege staat is prominent en niet Versado-specifiek. |
| `IMG_3248.png` | Profiel — gids | De mascottes zijn officieel; het Kompas-icoon is coherent maar nog een lijnsymbool. |
| `IMG_3249.png` | Profiel — voorkeuren/voortgang | Trophy, boek, thema- en instellingeniconen zijn functionele lijniconen. |
| `IMG_3250.png` | Profiel — account/Kompas | Officiële systeemiconen en mascottes werken samen; de avatar rechtsboven is uitgesloten. |

Er is in deze audit geen browser- of device-run uitgevoerd. De screenshots
zijn referentiemateriaal, geen bewijs van alle responsive toestanden. Vooral
spelen, shop, onboarding, foutstaten en kleine tekstschalen moeten later met
een echte browser worden gecontroleerd.

## Officiële Versado-assets die behouden blijven

| Assetfamilie | Werkelijke locatie/register | Technische controle | Gebruik en besluit |
|---|---|---|---|
| Broniconen | `public/icons/content-sources/*.webp`, register in `src/lib/contentMetadata.ts` | 8 WebP-bestanden, 256×256, RGBA/transparant | A — behouden. Gebruikt in header/contentkiezer; onbekende bronnen gebruiken `source-generic.webp`. |
| Systeemiconen | `public/icons/streak-flame*.webp`, `xp.webp`, `freeze.webp`; `SystemIcon.tsx` | 128×128 WebP, RGBA/transparant | A — behouden. Hergebruik voor streak, XP en freeze-achievements. |
| Divisie-emblemen | `public/icons/divisions/*.webp`, `DivisionEmblem.tsx` | 8 WebP-bestanden, 384×384, RGBA/transparant | A — behouden. Niet verwarren met een podium-medailletje. |
| Cursus-, boek-, spel- en dag-artwork | `src/lib/artwork.ts`, `MediaArtwork.tsx`, `public/images/` | Bestaande originelen met centrale fallback | A/B — behouden en hergebruiken. Geen nieuwe categoriebeelden maken waar passende artwork bestaat. |
| Mascottes en familie | `src/lib/mascots.ts`, `MascotSlot`, `PersonalMascot`, `public/mascots/static/` | Persoonlijke states 512×512; familie-assets met geregistreerde verhouding | A — behouden. Geen nieuwe identiteit of willekeurige mascottepose ontwerpen. |
| Schriftpersonages en avatarlagen | `src/lib/scriptureCharacters.ts`, `src/lib/avatarAccessories.ts`, `public/scripture/` | Geregistreerde 256/512/1024-assets | B, maar alleen inhoudelijk. Niet als generiek vrienden-, achievement- of Kompasicoon gebruiken. |

De bestaande `overlay-compass` is een officiële avatarlaag, maar is geen
geschikt rechtstreeks vervangingsasset voor een algemeen Kompasicoon: de laag
is voor een samengesteld karakterportret ontworpen.

## Visuele uitgangspunten

De volgende beslisregels zijn bij ieder kandidaatcluster toegepast:

1. Een groot of herhaald element krijgt meer gewicht dan een klein bedieningselement.
2. Eén betekenis krijgt één centrale visuele bron; pagina's krijgen geen eigen varianten.
3. Tekst, cijfers en toegankelijke labels blijven echte UI, niet ingebakken in artwork.
4. Transparante assets moeten in licht en donker werken zonder CSS-filter.
5. De bestaande officiële stijl is warm, kleurrijk, licht driedimensionaal,
   navy/oranje/crème en expressief — maar niet ieder element hoeft een
   illustratie te worden.
6. Varo, Vera, Novi en de familie worden alleen gebruikt via het bestaande
   mascotteregister. Een nieuw icoon mag geen nieuwe mascotte-identiteit
   introduceren.

## Inventarisatie en classificatie

Classificatie: A = behouden, B = bestaand Versado-asset hergebruiken,
C = nieuw asset gewenst, D = functioneel standaardicoon behouden,
E = handmatige ontwerpbeslissing. De prioriteit gaat over de visuele
verbetering, niet over technische urgentie.

| # | Kandidaatcluster | Concrete locaties / schermen | Beoordeling | Classificatie | Prioriteit |
|---:|---|---|---|:---:|:---:|
| 1 | Contentbroniconen | `contentMetadata.ts`, `ContentIcon.tsx`, header, contentkiezer | De acht definitieve bronbeelden zijn nu herkenbaar en centraal geregistreerd. | A | — |
| 2 | Streak-, XP- en freeze-iconen | `SystemIcon.tsx), Vandaag, profiel, shop, groepen | Officiële illustraties; duidelijk sterker dan emoji en al breed hergebruikt. | A | — |
| 3 | Divisie-emblemen | `DivisionEmblem.tsx`, competitie, profiel, klassement | Officiële emblemen met eigen betekenis; niet vervangen door podium-assets. | A | — |
| 4 | Content- en spel-artwork | `artwork.ts`, `MediaArtwork.tsx), Vandaag, Leren, Spelen | De screenshots tonen dat dit de gewenste beeldtaal al draagt. | A/B | — |
| 5 | Mascottes en familie | `MascotSlot`, `PersonalMascot`, Vandaag, profiel | Officieel en onderscheidend; hergebruik is mogelijk, nieuwe poses zijn hier niet nodig. | A/B | — |
| 6 | Kompas-entry en Kompas-hoofdicoon | `KompasIcon.tsx`, `KompasEntryCard.tsx`, `/kompas`, Vandaag, profiel | Het huidige vierpuntige lijnsymbool is coherent en toegankelijk. De kaart is echter prominent genoeg voor één rijker transparant Versado-kompas, mits dit overal hetzelfde wordt. | E → C | P2 |
| 7 | Primaire onderbalk | `BottomNav.tsx`, `NavIcon.tsx`, Vandaag/Leren/Spelen/Vrienden | House, BookOpen, Gamepad2 en Users zijn kleine, direct begrijpelijke bediening. | D | P3 |
| 8 | Headerbediening | `NotificationCenter.tsx`, `ContentSwitcher.tsx`, terug/chevron/close | Bediening heeft vooral herkenbaarheid en focus nodig, niet illustratie. | D | P3 |
| 9 | Vrienden-kop en statistiektegels | `FriendsClient.tsx:301-318`, Vrienden | `👥` en `🟢` vallen op, maar een lijnicoon en CSS-statuspunt zijn hier functioneel sterker dan losse bitmap-assets. | D | P2 |
| 10 | Groepen en groepsnavigatie | `GroupsEntryCard.tsx`, `GroupsClient.tsx`, vrienden | `UsersRound` is duidelijk en herbruikbaar; geen nieuwe illustratie nodig. | D | P2 |
| 11 | Vriend toevoegen en verzoekstatus | `FriendsClient.tsx:326-414` | Plus, vinkje en zandloper zijn status/bediening. Ze mogen later naar centrale Lucide-iconen, maar verdienen geen Work-afbeelding. | D | P3 |
| 12 | Vrienden uitnodigen | `FriendInviteCard.tsx:61-75`, uitnodigingspagina | `💌` is een prominente merkuiting en past niet bij de officiële assets. Eén uitnodigingsasset kan kaart en uitnodigingsingang delen. | C | P1 |
| 13 | Online-status | `FriendsClient.tsx`, sociale kaarten | Het groene punt is een semantische status, geen illustratie. Behoud CSS plus tekstlabel. | D | P2 |
| 14 | Hulpmiddelen-ingang | `CoursesClient.tsx:279`, scherm Leren | De rode gereedschapskist-emoji is groot genoeg om als categoriebeeld te lezen en wijkt af van de eigen stijl. Eén toolbox-asset volstaat. | C | P1 |
| 15 | Hulpmiddelenpagina | `src/app/tools/page.tsx`, `/tools` | BookText, Bookmark, XP en Users zijn inhoudelijk duidelijke lijniconen; de pagina heeft geen tweede toolboxbeeld nodig. | D/B | P2 |
| 16 | Top-drie in vrienden/competitie | `RankMedal.tsx`, `LeaderboardClient.tsx`, screenshot IMG_3245 | De CSS-cirkels zijn leesbaar, maar voelen als standaardbadges. Een samenhangende goud/zilver/brons-set sluit beter aan. | C | P1 |
| 17 | Top-drie in spelresultaten | `WordGameClient.tsx`, `GameRoom.tsx`, `FamilyGameRoom.tsx`, `ChapterGuessGameRoom.tsx`, `alleskenner/SoloClient.tsx` | De emoji-medailles vormen geen eigen beeldtaal. Geen aparte set per spel: dezelfde drie podiumassets of dezelfde component gebruiken. | B/C | P2 |
| 18 | Klassement op profiel | `ProfileContentViews.tsx:31-63` | Dezelfde RankMedal wordt ook als voortgangsbeloning gebruikt; dit maakt de podiumset breed herbruikbaar. | B/C | P2 |
| 19 | Belletje in header | `NotificationCenter.tsx`, vaste header | Klein, herkenbaar en functioneel; badge en knopsemantiek zijn belangrijker dan een illustratie. | D | P3 |
| 20 | Lege meldingenstaat | `NotificationCenter.tsx:236-240`, screenshot IMG_3247 | De grote gele `🔔` is een zichtbare emoji-illustratie zonder Versado-karakter. Eén transparante lege-statusillustratie is gerechtvaardigd. | C | P1 |
| 21 | Meldingencategorieën | `notificationGroups.ts`, notification cards | Acht emoji in kleine tegels zijn inconsistent. Eerst één semantische centrale iconmapping met bestaande lijniconen bepalen; acht nieuwe bitmap-assets zouden te veel detail op 40px geven. | E | P2 |
| 22 | Achievement-tegels en feed | `seed.ts:55-88`, `ProfileContentViews.tsx:96-237`, `activityFeed.ts` | Ongeveer 34 achievements slaan hun beeld op als emoji; dezelfde betekenis kan op profiel en feed uiteenlopen. Bestaande SystemIcon/source-assets dekken een deel; voor de resterende semantische families is een kleine nieuwe set gerechtvaardigd. | B/C | P1 |
| 23 | Activiteitstatus van vrienden | `ActivityTracker.tsx`, `useActivity.ts`, Vrienden | Emoji worden als korte statusdata doorgegeven. Geen afbeeldingen in presence-data stoppen; centraliseer later semantische keys of houd de tekststatus eenvoudig. | E | P2 |
| 24 | XP-historie en hintsaldo | `XpHistoryClient.tsx`, `ShopClient.tsx` | `💡` en XP-gerelateerde emoji zijn klein; XP kan `SystemIcon` hergebruiken en bediening blijft lijnvormig. | B/D | P2 |
| 25 | Cursus- en spelkoppen | `WordGameClient.tsx`, `JigsawClient.tsx`, `FamilyGameSetupClient.tsx`, introflows | De kop-emoji zijn opvallender dan de rest, maar bij de meeste onderdelen bestaat al officiële cover-artwork. Hergebruik artwork of een centrale functionele iconmapping; geen nieuwe afbeelding per spel. | B/D | P2 |
| 26 | Spelstatus, keuzes en besturing | `familyGame.ts`, game rooms, podcast/read-aloud players | Dit zijn spelregels, media-controls of directe feedback. Emoji zijn niet automatisch merkillustraties; een apart redesign valt buiten deze auditproductie. | D/E | P3 |
| 27 | Onboarding en algemene uitleg | `OnboardingClient.tsx`, `IntroLessonView.tsx`, Kompas | Bestaande uitleg is inhoudelijk en gebruikt kleine symbolen. Mascotstates of het ene Kompas-asset kunnen worden hergebruikt waar beeld echt helpt. | B/D | P2 |
| 28 | Auth- en uitnodigingsstatussen | register, login, reset, `uitnodiging/[code]` | `✉️`, `📬`, `🔗` en `✅` zijn generieke statusillustraties, maar niet prominent in de bekeken hoofdflow. Geen P1-productie; later gezamenlijk beoordelen. | E | P3 |
| 29 | ContentCollection.icon als datafallback | `contentCollections.ts`, admin/contentdata | De databasewaarde `📖` is niet leidend voor de publieke bronweergave; `contentMetadata` bepaalt het actuele bronbeeld. Bestaande beheerwaarden niet verwijderen. | B | P3 |
| 30 | Neutrale artwork-placeholder | `MediaArtwork.tsx`, kaarten zonder artwork | De bestaande toonplaceholder voorkomt een lege plek zonder een verkeerd onderwerp te tonen. Geen generieke illustratie toevoegen. | A | P2 |
| 31 | Admin- en ontwikkeliconen | `AdminGameSettingsClient.tsx` en adminflows | Losse emoji zijn daar aanwezig, maar admin is buiten de publieke prioriteit. Alleen gedeelde registers later centraliseren. | E | P3 |
| 32 | Profielavatar rechtsboven | Header en profiel | Expliciet uitgesloten; niet beoordeeld als redesignkandidaat. | — | — |

## Productieadvies per aandachtsgebied

### Kompas

De huidige `KompasIcon` is geen fout of willekeurig Lucide-icoon: het is een
eigen inline SVG, afgeleid van het kompas op Varo en met dezelfde lijndikte als
de overige interface-iconen. Daarom is dit P2 en geen P1. Als er een asset
wordt gemaakt, moet dat één centrale, transparante illustratie worden voor de
kaart, de Kompas-ingang en relevante lege/uitlegstaten. Het avatar-overlay-
asset is alleen referentie en mag niet rechtstreeks worden hergebruikt.

### Vrienden, groepen en uitnodigen

Vrienden en groepen hebben veel bediening: UsersRound, plus, chevrons,
statuspunten en knopstatussen blijven eenvoudig. De uitzondering is de
uitnodigingskaart: de envelop-met-hart staat naast een hele kaart met eigen
call-to-action en leest als een inhoudelijke illustratie. Daar is één nieuw
asset verantwoord. Hetzelfde asset kan de publieke uitnodigingsingang
ondersteunen; geen aparte afbeelding per pagina.

### Hulpmiddelen

De rode toolbox in de Leren-kaart is de duidelijkste categorie-emoji in de
aangeleverde schermen. De onderliggende hulpmiddelenpagina gebruikt al
betere lijniconen. Productie moet dus alleen één kleine categorieafbeelding
opleveren, niet een nieuwe illustratie voor woordenboek, bladwijzers of
personen.

### Podium en medailles

De huidige `RankMedal` houdt de cijfers correct als echte tekst en heeft goede
ARIA-labels. Dat moet blijven. De nieuwe goud-, zilver- en bronsassets mogen
geen cijfers bevatten; de rang wordt als HTML over of naast de afbeelding
gezet. De assets mogen niet lijken op de acht divisie-emblemen. Dezelfde set
moet worden gebruikt in de publieke klassementen, het profiel en spelresultaten
waar nu de emoji-set `🥇🥈🥉` staat.

### Meldingen

Het kleine headerbelletje blijft een functioneel Lucide-icoon. Alleen de grote
lege staat heeft genoeg oppervlak en emotionele lading voor een eigen
Versado-illustratie. De acht kleine categorie-emoji worden niet automatisch
acht nieuwe afbeeldingen: eerst moet worden besloten of een centrale
Lucide-mapping op 40px beter en duidelijker is.

### Prestaties en beloningen

De seed bevat 34 achievementdefinities; profieltegels tonen `achievement.icon`
op 20–30px en de feed bewaart daarnaast `achievementSlug` en
`achievementIcon`. Een asset per achievement zou duplicatie en historische
inconsistentie veroorzaken. De aanbevolen oplossing is:

| Betekenis | Hergebruik / nieuw |
|---|---|
| Streak | bestaand `SystemIcon` `streak` |
| XP-mijlpaal | bestaand `SystemIcon` `xp` |
| Freeze | bestaand `SystemIcon` `freeze` |
| Introductie | het Kompas-asset, als dat wordt goedgekeurd |
| Podcast | bestaand bronicoon `podcasts` |
| Leer-/hoofdstuk-/kinderprestatie | één nieuw achievement-learning-asset |
| Perfecte score/mastery | één nieuw achievement-mastery-asset |
| Vrienden en vriendenreeks | één nieuw achievement-social-asset |
| Duel, spel en gezinsavond | één nieuw achievement-game-asset |

De mapping moet op slug gebeuren, niet op emoji of gedeeltelijke naam. Oude
feedregels mogen tijdelijk hun opgeslagen fallback houden.

## Hergebruik en uitgesloten productie

Er wordt geen nieuwe opdracht gemaakt voor:

- de acht content-source WebP's; die bestaan en zijn definitief;
- Varo, Vera, Novi, de familie of scripture-personages;
- streak, XP, freeze en divisie-emblemen;
- cursus-, boek-, podcast-, dag- en spel-artwork;
- de primaire onderbalk, headerchevrons, sluiten, zoeken, instellingen,
  plus, play/pause en andere directe bediening;
- online-statuspunten, tekstuele labels, reacties en spelkeuzes;
- de profielavatar rechtsboven.

## Verschil met de eerste audit

De eerste audit kwam uit op de acht broniconen, omdat generieke elementen
vooral technisch werden beoordeeld en achievements, podium en lege staten als
onzekere vervolgstappen werden geregistreerd. Deze audit voegt de werkelijke
schermprominentie toe. Daardoor worden elf concrete nieuwe runtime-assets
aanbevolen, terwijl voor sociale bediening, meldingencategorieën en de meeste
speliconen juist geen nieuwe afbeeldingen nodig zijn.

## Onzekerheden en handmatige beslissingen

1. De Kompas-lijnvorm is bewust ontworpen en niet aantoonbaar verkeerd. Een
   product-/designbesluit is nodig voordat de inline SVG door een illustratief
   asset wordt vervangen.
2. De achievementdata bevat nu emoji en historische feeditems bevatten een
   gekopieerd icoon. De toekomstige integratie moet bepalen hoe oude en nieuwe
   feeditems naast elkaar worden weergegeven.
3. Meldingencategorieën zijn klein. Zonder een echte 40px-browserproef is niet
   vast te stellen of een illustratieve set leesbaarder is dan Lucide.
4. De screenshots tonen geen volledige shop-, speel-, onboarding-, fout- of
   authflows. De codebevindingen daarvan zijn daarom lager geprioriteerd.
5. Geen browsercontrole is uitgevoerd; layout, focus, 200%-tekst en dark/light
   contrast moeten in de integratiefase daadwerkelijk worden getest.

## Conclusie

Versado hoeft niet elk symbool om te zetten in een afbeelding. De identiteit
wordt het meest versterkt door elf zorgvuldig herbruikbare assets: één Kompas,
één uitnodiging, één toolbox, drie podiummedailles, vier achievementbadges en
één lege-meldingenillustratie. De rest blijft officieel artwork, centrale
lijniconografie of inhoudelijke emoji die buiten deze productieplanning valt.
