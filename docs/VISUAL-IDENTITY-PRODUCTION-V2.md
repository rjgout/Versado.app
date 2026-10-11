# Versado — productieopdracht visuele identiteit 2.0

Dit document is uitsluitend de productieopdracht voor ChatGPT Work. Er zijn
nog geen afbeeldingen gemaakt en er worden in deze fase geen bestanden aan de
repository toegevoegd.

## Productiedoel

Maak elf nieuwe, kleine en herbruikbare Versado-afbeeldingen voor de
prominente generieke elementen uit de tweede audit. De afbeeldingen vormen
geen nieuwe mascotte-identiteiten, bevatten geen tekst of cijfers en mogen de
bestaande officiële broniconen, systeemiconen, divisie-emblemen en artwork
niet dupliceren.

### Algemene technische specificatie

- Lever per asset een transparante PNG-master buiten `public/` aan voor
  controle en een geoptimaliseerd WebP-runtimebestand.
- Runtimeformaat: WebP met alpha, sRGB, 256×256 pixels voor alle iconen.
- Geen ingebakken woorden, letters, cijfers, UI-labels of rangnummers.
- Geen vaste achtergrondkleur; het asset moet op lichte en donkere
  Versado-oppervlakken werken.
- Houd de hoofdvorm ruim binnen het canvas met voldoende transparante marge.
- Ontwerp voor 20–28 CSS-pixels bij compacte iconen en maximaal 96–128 CSS-
  pixels bij de lege meldingenstaat.
- Behoud een warme, kleurrijke, licht driedimensionale Versado-vormtaal:
  diep navy, levendig blauw, helder oranje, warm goud, crème en gecontroleerde
  highlights. Geen generieke Apple-/Android-emoji-uitstraling.
- Maak de details ook op 20 CSS-pixels leesbaar. Geen fijne texturen die op
  mobiel dichtlopen.
- Definitieve bestandsnamen en mapvoorstel staan per item hieronder.

## Referentiebibliotheek

Gebruik uitsluitend deze bestaande bestanden als stijlreferentie; verander ze
niet en knip er geen nieuwe identiteit uit:

- `public/mascots/references/varo-character-sheet.png`
- `public/mascots/references/vera-character-sheet.png`
- `public/mascots/references/novi-character-sheet.png`
- `public/mascots/static/varo/varo-discovery.webp`
- `public/mascots/static/novi/novi-discovery.webp`
- `public/scripture/accessories/overlays/overlay-compass-256-v1.webp`
- `public/icons/streak-flame.webp`
- `public/icons/xp.webp`
- `public/icons/freeze.webp`
- `public/icons/divisions/gold.webp`, `silver.webp` en `bronze.webp`
- `public/icons/content-sources/bofm.webp` en `podcasts.webp`
- `public/images/courses/kinderen.png`
- `public/images/games/gezinsavond.png`

De personagereferenties zijn alleen bedoeld voor licht, kleur, materiaal en
expressie. Voeg geen personage toe aan een asset tenzij dat hieronder expliciet
staat; geen nieuwe Varo-, Vera- of Novi-pose maken.

## Definitieve productiebatches

Er zijn drie echte batches. Een vierde batch is niet gerechtvaardigd: de
overige gevonden emoji zijn kleine bediening, gamecontent, reacties, statusdata
of kunnen met bestaande officiële assets en lijniconen worden afgedekt.

### Batch 1 — Ontdekken, sociale uitnodiging en hulpmiddelen

#### VA2-001 — Versado Kompas

| Eigenschap | Specificatie |
|---|---|
| Onderwerp/doel | Eén illustratief Kompas-beeld voor de prominente Ontdek Versado-ingang en Kompas-uitlegstaten. |
| Huidige weergave | Inline vierpuntige SVG in `src/components/kompas/KompasIcon.tsx`, zichtbaar in `KompasEntryCard.tsx` op Vandaag en profiel. |
| Waarom | De huidige vorm is coherent, maar blijft een eenvoudig lijnsymbool naast rijkere mascotte- en systeemassets. Eén rijkere versie kan de Kompas-ingang merkmatiger maken. |
| Voorstelling | Compact, rond Versado-kompas met vierpuntige ster, subtiele metalen/navy basis, blauwe gloed en kleine oranje/gouden accentkleur. Geen mascotte, geen tekst. |
| Referenties | `KompasIcon.tsx`, `overlay-compass-256-v1.webp`, Varo-character-sheet en `varo-discovery.webp`. |
| Verhouding / maat | 1:1, 256×256 px runtime, transparant. |
| Zichtbare maat | 28–48 CSS-px in kaarten; eventueel 64 px in Kompas-uitleg. |
| Prioriteit | P2; eerst designbesluit omdat de bestaande SVG al functioneel goed is. |
| Bestandsnaam/map | `kompas.webp` in `public/icons/versado/`. |
| Hergebruik | `KompasEntryCard`, `/kompas`, eventuele lege/uitlegstaten en achievement-slugs `intro-*`. |
| Technische aandacht | Eén bronregistratie; geen tweede compass-variant. Alt blijft leeg als “Ontdek Versado” al als tekst naast het beeld staat. |

#### VA2-002 — Uitnodigen

| Eigenschap | Specificatie |
|---|---|
| Onderwerp/doel | Vervangt de envelop-met-hart-emoji voor vrienden uitnodigen. |
| Huidige weergave | `💌` in `src/components/FriendInviteCard.tsx:61-75`; de uitnodigingsflow staat daarnaast in `src/app/uitnodiging/[code]/page.tsx`. |
| Waarom | De emoji is groot genoeg om als illustratie te worden gelezen en heeft geen Versado-materiaal of kleurtaal. |
| Voorstelling | Eén warme, licht 3D envelop of uitnodigingskaart met een subtiel verbindings-/hartaccent, navy/blauw met oranje/goud. Geen leesbare brieftekst, geen logo en geen persoon. |
| Referenties | Varo/Vera/Novi-kleur- en lichtreferenties; bestaande sociale stijl in `MediaArtwork` en de friends-kaarten. |
| Verhouding / maat | 1:1, 256×256 px runtime, transparant. |
| Zichtbare maat | 24–40 CSS-px in de kaart; maximaal 56 px op een uitnodigingslanding. |
| Prioriteit | P1. |
| Bestandsnaam/map | `invite-friends.webp` in `public/icons/versado/`. |
| Hergebruik | `FriendInviteCard`, uitnodigingslanding en eventueel een centrale uitnodigingsactie. Niet gebruiken voor game-lobby-uitnodigingen zonder aparte betekeniscontrole. |
| Technische aandacht | Het asset is decoratief naast de vertaalde titel; `alt=""`. Delen, kopiëren, regenereren en linkfunctionaliteit blijven ongewijzigd. |

#### VA2-003 — Hulpmiddelen

| Eigenschap | Specificatie |
|---|---|
| Onderwerp/doel | Eén categoriebeeld voor de ingang Hulpmiddelen. |
| Huidige weergave | Rode `🧰` in `src/components/CoursesClient.tsx:279`, zichtbaar onderaan Leren. De onderliggende `/tools`-pagina gebruikt al BookText, Bookmark, XP en Users. |
| Waarom | De toolbox-emoji is een opvallende categorie-illustratie en vormt een stijlbreuk met de bestaande contentbeelden. |
| Voorstelling | Compacte open toolbox of studiekist met boek, bladwijzer en subtiele verrekijker-/personenreferentie; rijk materiaal, navy/blauw met oranje/goud. Geen tekst. |
| Referenties | `public/images/courses/kinderen.png`, `public/icons/content-sources/bofm.webp`, bestaande `MediaArtwork`-lichtval. |
| Verhouding / maat | 1:1, 256×256 px runtime, transparant. |
| Zichtbare maat | 24–40 CSS-px in de Leren-ingang; niet groter maken dan de kaart toelaat. |
| Prioriteit | P1. |
| Bestandsnaam/map | `tools.webp` in `public/icons/versado/`. |
| Hergebruik | Leren-ingang, eventueel PageIntro van `/tools` als later gewenst. Niet in presence-data als HTML-afbeelding stoppen. |
| Technische aandacht | `ActivityTracker` houdt een semantische activiteitstatus; de nieuwe afbeelding hoort alleen in de visuele componenten. |

### Batch 2 — Competitie en beloningen

#### VA2-004a/b/c — Podiumset goud, zilver en brons

Maak deze drie bestanden als één visueel samenhangende set:

| Eigenschap | Specificatie |
|---|---|
| Onderwerp/doel | Vervangt de vlakke CSS-munten in `RankMedal` en de emoji-medaillearrays in spelresultaten. |
| Huidige locaties | `src/components/versado/RankMedal.tsx`, `LeaderboardClient.tsx`, `ProfileContentViews.tsx`, `WordGameClient.tsx`, `GameRoom.tsx`, `FamilyGameRoom.tsx`, `ChapterGuessGameRoom.tsx`, `alleskenner/SoloClient.tsx`. |
| Voorstelling | Drie compacte, 3D metalen podiumbadges: warm goud, helder zilver en rijk brons, met een eenvoudige uitsparing/ster die de drie niveaus onderscheidt. Geen cijfer in het beeld. |
| Referenties | `public/icons/divisions/gold.webp`, `silver.webp`, `bronze.webp` voor materiaal, maar de vorm moet duidelijk kleiner en eenvoudiger zijn; bestaande `RankMedal` voor maat en semantiek. |
| Verhouding / maat | Elk 1:1, 256×256 px, transparant. |
| Zichtbare maat | 20–32 CSS-px in lijsten; 40 CSS-px in profielmedailles. |
| Prioriteit | P1 voor openbare klassementen, P2 voor spelresultaten. |
| Bestandsnamen/map | `podium-gold.webp`, `podium-silver.webp`, `podium-bronze.webp` in `public/icons/versado/podium/`. |
| Hergebruik | Vrienden-, divisie- en algemene ranglijst, profielmedailles en bestaande spelresultaten. |
| Technische aandacht | Rangnummer blijft echte tekst/DOM boven of naast het decoratieve beeld. Gebruik niet de bestaande divisie-emblemen en wijzig geen rangorde of scores. |

#### VA2-005a/b/c/d — Achievementbadgefamilie

Maak vier kleine, dezelfde-vormige assets. Dit is bewust geen asset per
achievement: de centrale slugmapping hergebruikt deze set in profiel en feed.

| ID / bestand | Betekenis en slugs | Voorstelling |
|---|---|---|
| VA2-005a `achievement-learning.webp` | `first-chapter`, `chapters-*`, `kids-*` | Open boek met bladmarkering en kleine leer-/lichtaccenten. |
| VA2-005b `achievement-mastery.webp` | `perfect-*` en vergelijkbare scoremijlpalen | Doel-/ster-/checkmotief met duidelijke kern, geen ingebakken 100 of nummer. |
| VA2-005c `achievement-social.webp` | `first-friend`, `friends-5`, `friend-streak-*`, eventueel `first-freeze-gifted` | Twee verbonden figuren of handen in een warme, eenvoudige badgevorm; geen generieke emoji-kopjes. |
| VA2-005d `achievement-game.webp` | `first-duel-won`, `duels-10-won`, `family-game-first-play`, `word-game-*` | Speel-/quizbadge met controller- of speelkaartaccent, zonder merklogo of spelnaam. |

| Eigenschap | Specificatie voor de hele set |
|---|---|
| Huidige weergave | `Achievement.icon` uit `prisma/seed.ts:55-88`, `achievementDisplay.ts`, `ProfileContentViews.tsx:96-237` en opgeslagen `ActivityFeedItem.achievementIcon`. |
| Waarom | 34 seed-items gebruiken emoji en dezelfde prestatie kan in profiel/feed een andere bron volgen. |
| Referenties | Bestaande `SystemIcon`-assets voor licht en transparantie, `content-sources/bofm.webp`, `games/gezinsavond.png`, Varo/Novi-discovery voor kleur en materiaal. |
| Verhouding / maat | Elk 1:1, 256×256 px, transparant, identieke canvasmarge. |
| Zichtbare maat | 24–36 CSS-px in achievementtegels; maximaal 48 px in featured achievements. |
| Prioriteit | P1 op profiel en in de activiteitenfeed. |
| Bestandsnamen/map | Bestanden in `public/icons/versado/achievements/`. |
| Hergebruik | Profile achievements, featured achievements, activity feed en toekomstige achievementnotificaties. |
| Technische aandacht | `streak-*`, `xp-*`, `first-freeze-earned`, `intro-*` en `podcast-*` hergebruiken bestaande officiële assets waar dat semantisch klopt; maak daarvoor geen duplicaat. Mapping op achievement-slug, nooit op emoji. |

### Batch 3 — Meldingen en lege statussen

#### VA2-006 — Geen meldingen

| Eigenschap | Specificatie |
|---|---|
| Onderwerp/doel | Vervangt de gele bel-emoji in de lege meldingenstaat. |
| Huidige weergave | `src/components/NotificationCenter.tsx:236-240`, screenshot `IMG_3247.png`. |
| Waarom | Dit is een groot centraal beeld op een veelgebruikte overlay; de emoji is niet onderdeel van de Versado-wereld. |
| Voorstelling | Vriendelijke, licht 3D Versado-bel met zachte blauwe/navy basis, goud/oranje belkern en enkele rustige glans-/rustlijnen. Geen tekst, geen badgegetal, geen achtergrondplaat. |
| Referenties | `public/icons/xp.webp` en `streak-flame.webp` voor materiaal en schaal; mascotte-referenties alleen voor licht en kleur. |
| Verhouding / maat | 1:1, 256×256 px runtime, transparant. |
| Zichtbare maat | 80–128 CSS-px in de lege overlay; compact genoeg voor 320px breed. |
| Prioriteit | P1. |
| Bestandsnaam/map | `notifications-empty.webp` in `public/icons/versado/empty/`. |
| Hergebruik | Lege NotificationCenter-staat en eventuele publieke meldingenpagina met exact dezelfde betekenis. |
| Technische aandacht | Decoratief met `alt=""`; de titel “Geen meldingen” en uitleg blijven de betekenis. Headerbel en notification badge blijven functioneel. |

## Generatieprompts voor ChatGPT Work

### Prompt A — Kompas, uitnodiging en hulpmiddelen

> Maak drie afzonderlijke 256×256 px vierkante Versado-icon assets met volledig
> transparante achtergrond: (1) een compact vierpuntig Versado-kompas, (2) een
> uitnodigingsenvelop voor vrienden, en (3) een kleine studiegereedschapskist.
> Gebruik de aangeleverde Versado-referenties voor navy, helder blauw, warm
> oranje, goud en crème, zachte 3D-materialen, duidelijke silhouetten en
> vriendelijke maar volwassen proporties. Het Kompas moet aansluiten op de
> bestaande vierpuntige SVG en het compass-overlayreferentiebeeld zonder een
> avatarlaag te worden. De uitnodiging mag een subtiel verbindings- of
> hartaccent hebben, maar geen leesbare brieftekst. De gereedschapskist mag
> boek/bladwijzer-studie suggereren, maar geen productlogo of tekst bevatten.
> Maak geen mascotte, geen nieuwe personage-identiteit, geen emoji-rendering,
> geen vierkante achtergrond, geen witte halo en geen ingebakken tekst. Lever
> drie losse transparante PNG-masters en drie overeenkomstige WebP-runtime-
> bestanden op, met dezelfde visuele detaillering en veilige canvasmarges.

### Prompt B — Podiumset

> Maak één samenhangende set van drie afzonderlijke transparante Versado-
> podiumbadges: goud, zilver en brons. Referentieer de materiaalkwaliteit en
> highlights van `public/icons/divisions/gold.webp`, `silver.webp` en
> `bronze.webp`, maar maak een duidelijk compact podium-medaillemotief dat
> niet op een divisie-embleem lijkt. Elk asset moet een helder silhouet en een
> eigen metaaltoon hebben, zonder cijfers, letters, linttekst, score of
> achtergrond. Ontwerp voor gebruik op 20–40 CSS-pixels: weinig fijne details,
> sterke rand, transparante alpha en dezelfde canvasmarge voor alle drie.
> Lever `podium-gold`, `podium-silver` en `podium-bronze` als afzonderlijke
> 256×256 PNG-masters en WebP-bestanden. Gebruik geen emoji-stijl en voeg geen
> mascotte toe.

### Prompt C — Achievementbadgefamilie

> Maak vier afzonderlijke, vierkante Versado-achievementbadges met transparante
> achtergrond: learning (boek/bladmarkering), mastery (doel/ster/check), social
> (verbonden vrienden) en game (quiz/spelaccent). Gebruik dezelfde navy,
> oranje, goud, blauw en crème 3D-vormtaal als de bestaande `SystemIcon`-
> assets en de officiële spel-/mascotte-referenties. De vier bestanden moeten
> als één familie voelen: gelijke schaal, rand, schaduwrichting en transparante
> marge. Geen cijfers zoals 100, geen achievementnaam, geen tekst, geen nieuwe
> personages, geen divisie-embleem en geen emoji-uitstraling. Details moeten
> op 24–36 CSS-pixels leesbaar blijven. Lever vier 256×256 PNG-masters plus
> `achievement-learning`, `achievement-mastery`, `achievement-social` en
> `achievement-game` als afzonderlijke WebP-runtimebestanden.

### Prompt D — Lege meldingenstaat

> Maak één transparant 256×256 Versado-illustratieasset voor de lege staat
> “Geen meldingen”: een vriendelijke, licht 3D bel met navy/blauwe basis,
> warme goud/oranje belkern en een rustige subtiele glans. De afbeelding moet
> ook op een donkere achtergrond werken, geen vaste achtergrondplaat hebben,
> geen badgegetal of tekst bevatten en niet de vorm van een platform-emoji
> kopiëren. Gebruik de bestaande Versado-systeemiconen als referentie voor
> materiaal, canvasmarge en licht. Lever een PNG-master en
> `notifications-empty.webp` op. Houd het silhouet duidelijk op 80–128 CSS-
> pixels en verwijder kleine details die op mobiel verdwijnen.

## Wat Work niet moet maken

- Geen nieuwe Varo-, Vera- of Novi-pose.
- Geen profielavatar of avatarfallback, ook niet voor de header rechtsboven.
- Geen acht nieuwe contentbroniconen; die bestaan al.
- Geen nieuwe divisie-emblemen.
- Geen afzonderlijke asset voor iedere achievement, ieder spel of iedere
  meldingencategorie.
- Geen cijfers in podiumbadges; nummer 1, 2 en 3 blijven echte interface-
  tekst.
- Geen achtergronden, kaartvlakken of volledige schermillustraties.
- Geen masters toevoegen aan `public/`.

## Acceptatiecriteria voor de productie

Work levert per item de bronmaster, WebP-runtimebestand en een korte
metadata-opgave op met exacte afmetingen, alpha-aanwezigheid en bestandsgrootte.
De acht eerder geïntegreerde broniconen en alle bestaande officiële assets
blijven onaangeraakt. Een asset is pas klaar voor Codex wanneer het zowel op
20 CSS-pixels als in de genoemde grotere kaartmaat herkenbaar is en geen
leesbare informatie uit de omliggende UI wegneemt.
