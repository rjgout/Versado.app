# Visuele asset-audit

Status: onderzoeks- en documentatiefase. In deze audit zijn geen afbeeldingen,
componenten, functionaliteit of databasegegevens gewijzigd.

## Samenvatting

De audit is uitgevoerd op `origin/main` op commit `c8ce3896716dae4b65694ea2dc6eee1625f00996`.
Er zijn **825 raster-/icoonbestanden** onder `public/` gecontroleerd, naast de
visuele assets die de code zelf tekent of uit data opbouwt. De bestaande
definitieve assets blijven behouden. De opvallendste bevindingen:

- Varo, Vera en Novi hebben samen 30 individuele mascotestates en de familie
  heeft 10 bestaande states. Die set is compleet en wordt al centraal gebruikt.
- De actuele main bevat een bruikbaar schriftpersonage- en avatarstelsel:
  376 personagebestanden plus 16 accessoirebestanden. Dit is hergebruik, geen
  nieuwe productieopdracht.
- Contentkaarten hebben een centraal artworkregister met 44 bestaande beelden.
  De cursussen, spellen, podcast, dagelijkse tekst, mysteries, kinderverhalen,
  Snelle Zendeling en Gezinsavond hebben dus al veel inhoudelijk passend beeld.
- De contentkiezer gebruikt nog zeven semantische Lucide-broniconen plus een
  algemene fallback. Dat is de enige concrete nieuwe assetset die zonder
  bestaande assetduplicatie nodig lijkt: acht consistente broniconen.
- Navigatie-, actie-, status- en Kompasiconen zijn functionele iconen. Ze hoeven
  niet te worden vervangen door illustraties.
- Er is geen vaste, als zodanig herkenbare Versado-logo-bron in de repository
  aangetroffen. De PWA-fallback is een generiek groen open boek. Een logo-opdracht
  blijft daarom voorwaardelijk totdat een goedgekeurde Figma-/brandreferentie
  wordt aangeleverd; er is geen logo op goed geluk gespecificeerd.

### Eindtelling met expliciete telwijze

| Maatstaf | Aantal | Betekenis |
|---|---:|---|
| Gecontroleerde raster-/icoonbestanden | 825 | Extensies PNG, JPG/JPEG, WebP, GIF, AVIF en ICO onder `public/`. |
| Bestaande bestanden die behouden blijven | 825 | Ook referentie-, Figma- en nog niet gebruikte bestanden worden niet verwijderd of overschreven. |
| Direct runtime- of registergebonden bestanden | 681 | Na aftrek van docs-only mascottevarianten, character reference sheets en twee niet teruggevonden artworkreferenties. |
| Functionele Lucide-iconen | 97 verschillende geïmporteerde iconnamen | Codebreed gevonden; deze blijven behouden. |
| Nieuwe concrete beeldassets | 8 | Broniconen voor de contentkiezer plus één toekomstvaste bronfallback. Zie productie `VA-SRC-001` t/m `VA-SRC-008`. |
| Voorwaardelijke nieuwe branding-assets | 2 | Wordmark en app-mark, alleen na ontvangst van een goedgekeurde logo-/brandreferentie. |
| Nieuwe productiebatches | 4 | Alleen batch 1 bevat productie; batches 2–4 hebben bewust geen nieuwe beeldopdracht. |

De telling “825” telt bestanden, niet iedere emoji, CSS-vorm, inline SVG of
databasewaarde. Die codegegenereerde visuele elementen zijn afzonderlijk
geïnventariseerd.

## Onderzoeksbasis

### Repository- en Gitstatus

| Controle | Vaststelling |
|---|---|
| Repository | `rjgout/Versado.app`, werkmap `Jehova.app` |
| Auditbranch | `codex/visual-asset-audit` |
| Auditbranch/`origin/main` | Beide op `c8ce389` na een fast-forward van de auditbranch naar actuele main. |
| Lokale `main` | `171735b`; lokale main is niet aangepast. |
| Openstaande pull requests bij audit | Geen; `gh pr list --state open` gaf een lege lijst. |
| Niet-gecommitteerd bij aanvang | Bestaande gebruikerswijzigingen in `package.json`, `src/lib/courses.ts` en `tests/courses.test.ts`; deze zijn behouden. |
| Commit van deze audit | Wordt vastgelegd in de Gitgeschiedenis van `codex/visual-asset-audit`; de audit bevat zelf geen hardcoded commitnaam. |
| Browsercontrole | Niet mogelijk in deze omgeving: er is geen browser-/Playwright-runner beschikbaar. Er zijn daarom geen schermscreenshots gemaakt. Er is wel lokale afbeeldingsinspectie en statische codecontrole uitgevoerd. |

De audit is gebaseerd op de actuele code op `origin/main`, niet op de oudere
branch waarop de opdracht aanvankelijk werd gestart. Daardoor zijn de nieuwe
schriftavatars, accessoires en profielheader wel meegenomen. De beschrijving
van de oude visuele stand in delen van `docs/VERSADO-DESIGN.md` is op punten
achter de huidige implementatie; de code en aanwezige bestanden zijn voor deze
audit leidend.

### Gelezen documentatie en controles

- `CLAUDE.md` / `AGENTS.md`;
- `docs/VERSADO-DESIGN.md`, `docs/KOMPAS.md` en `docs/LAYOUT.md`;
- `docs/VERSADO-CHARACTER-CANON.md`;
- `public/mascots/README.md`, `public/mascots/references/README.md`,
  `public/mascots/figma/README.md` en `public/mascots/rive/README.md`;
- `docs/CHARACTER-AVATAR-SYSTEM.md`, `docs/CLAUDE-CODE-CHARACTER-ASSETS-HANDOFF.md`
  en de relevante documentatie onder `docs/scripture/`;
- `docs/SNELLE-ZENDELING.md`, `docs/KAARTEN.md` en bestaande assettests;
- `src/lib/artwork.ts`, `src/lib/contentMetadata.ts`, `src/lib/mascots.ts`,
  `src/lib/characterAssets.ts`, `src/lib/avatarAccessories.ts` en de centrale
  visuele renderers;
- alle afbeeldingsbestanden onder `public/` en codebrede zoekopdrachten naar
  `lucide-react`, SVG, emoji, avatar-, placeholder- en fallbackgebruik.

## Bestaande officiële of inhoudelijke assets

Alle onderstaande bestanden blijven ongewijzigd. “Definitief” betekent hier dat
het bestand door de huidige code, een centraal register of de bijbehorende
assetdocumentatie als geldige bron wordt gebruikt. Het zegt niets over een
latere visuele redesignbeslissing.

| Assetfamilie | Concrete locatie(s) | Omvang en technische kenmerken | Huidig gebruik | Status / hergebruik |
|---|---|---|---|---|
| Individuele Versado-mascottes | `public/mascots/static/novi`, `/varo`, `/vera` | 30 WebP-bestanden, elk 512×512, transparante alpha; 10 states per personage: `idle`, `greeting`, `thinking`, `discovery`, `reading`, `playing`, `success`, `encourage`, `celebrate`, `sleep`. | `MascotSlot`, `PersonalMascot`, Vandaag, leerflows, resultaten en persoonlijke momenten. | **A Behouden.** Compleet; niet opnieuw tekenen. |
| Mascottefamilie | `public/mascots/static/family` | 10 WebP-bestanden met alpha; canvasafmetingen verschillen per compositie, maximaal circa 1200 px. | Welkom/openbare start en onboarding, onder meer `family-welcome` en `family-huddle`. | **A Behouden.** Herbruikbaar voor sociale/onboardingmomenten waar de bestaande state past. |
| Mascotte-Figma-exporten | `public/mascots/figma` | 60 WebP-derivaten: 3 personages × 10 states × 2 formaten (512 en 256). | Niet door runtimecode gebruikt; ontwerp-/exportdocumentatie. | **A Behouden als bron/QA.** Niet als tweede runtime-register gebruiken. |
| Mascotte-referenties | `public/mascots/references` | 8 PNG-sheets/-canonbeelden; sheets circa 1536×1024, met zowel alpha als opaque referentiebeelden. | Niet door runtimecode gebruikt. | **A Behouden als canon.** Geen nieuwe identiteit, pose of accessoire afleiden zonder ontwerpbesluit. |
| Schriftpersonages | `public/scripture/characters` | 376 WebP-bestanden: 83 master/full-body-bestanden, 219 portrait-exporten (256/512/1024), 74 character sheets; transparantie bij runtimeportretten en bodies. | `characterAssets`, `ScriptureAvatar`, `ProfileCharacterHero`, personenzoeker, user-/vriendavatars en bestaande Mysterie-mapping. | **A Behouden / B Hergebruiken.** Bestaande canonieke personages mogen alleen via de centrale catalogus en toegestane mapping worden ingezet. |
| Avataraccessoires | `public/scripture/accessories` | 16 WebP-bestanden: 8 lagen, elk compact 256×256 en detail 1024×1024, transparant. Frames, sterrenachtergrond, kompas, licht, schriftrol en mysterie-embleem. | `ScriptureAvatar` als losse vierkante lagen. | **A Behouden / B Hergebruiken.** Niet uitrekken over een rechthoekige profielheader. |
| Schrift-/cursus-/game-artwork | `public/images` en register `src/lib/artwork.ts` | 44 PNG-bestanden. 21 schriftboeken, 7 cursusbeelden, 14 gamecovers, 1 podcastfallback en 1 dagelijkse tekst. Originelen rond 1672×940/941, RGB/opaque. | `MediaArtwork`, `ContentCard`, Vandaag, Leren, Spelen, lezen en quizkaarten. | **A Behouden / B Hergebruiken.** Eén register blijft bron van waarheid. |
| Kindercursusbeelden | `public/kids/images` plus `prisma/kidsManifest.json` | 216 JPEG’s, 54 verhalen × 4 scènes, 1200×800, opaque. | `KidsCourseView`, `KidsLessonFlow`, legpuzzel en Alleskenner waar de manifestdata dat bepaalt. | **A Behouden.** Bestaande URL’s en voortgang niet wijzigen. |
| Mysterie-borden en spelpersonages | `public/mysterie-*`, registers onder `src/lib/mysteries/` | 27 PNG’s: 18 vierkante borden en 9 bestaande full-body-personages; meestal 1254×1254. Borden en lichaamsassets hebben hun eigen alpha-/canvasgedrag. | Mysteriepalet, sleep-preview en speelbord met bestaande voetenankers. | **A Behouden.** Bestaande geometrie, assets en mappings niet vervangen. |
| Snelle Zendeling gameplay | `public/games/snelle-zendeling` | 15 PNG’s: Novi/Varo/Vera glide- en boostsprites, obstakelstukken, lange obstakels, lucht/landschap/grond. Sprite- en canvasformaten zijn bewust verschillend; alpha volgens asset. | Gameplay, niet als globale mascottestates. | **A Behouden.** Geen nieuwe globale mascotestates hieruit maken. |
| Gezinsavond-regio’s | `public/gezinsavond/regions` | 5 WebP’s, elk 1200×800, opaque: beloofde land, Jeruzalem, wildernis, Zarahemla en zee. | Gezinsavondregioselectie en spelcontext. | **A Behouden.** Inhoudelijke illustraties, geen algemene categorie-art. |
| Systeemiconen | `public/icons/{freeze,streak-flame,streak-flame-empty,xp}.webp`, `SystemIcon.tsx` | 4 WebP’s, 128×128, alpha. | Reeks, lege reeks, XP en reeksbevriezing door de hele app. | **A Behouden / B Hergebruiken.** Reeds officiële kleine illustraties; niet vervangen door emoji. |
| Divisie-emblemen | `public/icons/divisions/*.webp`, 8 tiers, `DivisionEmblem.tsx` | 8 WebP’s, 384×384, alpha: bronze t/m legend. | Divisiekaarten, profiel, klassement en voortgang. | **A Behouden.** Inclusief bestaande tests. |
| PWA-/favicon-assets | `public/icons/icon-192.png`, `icon-512.png`, maskablevarianten, `public/apple-touch-icon.png`, `public/favicon.ico` | PNG 192/512 en apple-touch-icon 180×180; favicon ICO. De fallback-afbeelding is een groen veld met wit open boek. | Manifest, install prompt, header-/brandingfallbacks en browsericonen. | **E Onzeker.** Behouden tot een goedgekeurde definitieve Versado-brandset bestaat; zie voorwaardelijke brandingrecords. |

### Visueel gecontroleerde voorbeelden

Met lokale afbeeldingsinspectie zijn representatieve bestanden bekeken:

- `public/mascots/static/novi/novi-greeting.webp` — transparante, donkerblauw/oranje/creme mascotafbeelding;
- `public/mascots/static/family/family-welcome.webp` — de drie mascottes samen;
- `public/images/games/het-mysterie.png` — inhoudelijke spelillustratie;
- `public/images/courses/ontdek-boek-van-mormon.png` — inhoudelijke cursusillustratie;
- `public/icons/streak-flame.webp` — bestaand klein systeembeeld;
- `public/icons/divisions/legend.webp` — bestaand divisie-embleem;
- `public/icons/icon-512.png` — huidige generieke open-boek-PWA-fallback;
- `public/games/snelle-zendeling/background-landscape.png` — gelaagde gameplayachtergrond.

Dit zijn lokale beeldinspecties, geen browserweergaven. Er worden geen claims
over responsive uitsnede of pixelprecisie gedaan zonder browsercontrole.

## Centrale implementaties en dynamische bronnen

| Onderdeel | Vastgestelde bron | Auditbesluit |
|---|---|---|
| Artworkregister | `src/lib/artwork.ts` | Behouden. `courseArtworkKeys`, `podcastArtworkKeys` en `gameArtworkKeys` geven eerst specifiek en daarna algemeen beeld. Geen pagina moet zelf een pad construeren. |
| Kaartweergave | `src/components/versado/MediaArtwork.tsx` en `ContentCard` | Behouden. De neutrale Lucide-placeholder is bewust een fallback voor ontbrekend of fout geladen beeld. |
| Contentbroniconen | `src/lib/contentMetadata.ts`, `src/components/versado/ContentIcon.tsx` | Huidig generiek: `BookOpen`, `ScrollText`, `Gem`, `BookMarked`, `Mic2` en `LibraryBig`. Dit is de concrete nieuwe productiekandidaat. |
| Mascottes | `src/lib/mascots.ts`, `MascotSlot.tsx`, `PersonalMascot` | Behouden. Geen directe paden naar `public/mascots` toevoegen. |
| Systeemiconen | `SystemIcon.tsx` | Behouden. `fill="none"` kiest bewust de bestaande lege reeksvlam. |
| Divisies | `src/lib/leagueTiers.ts`, `DivisionEmblem.tsx` | Behouden. Alle acht bestaande emblemen zijn aanwezig en door tests afgedekt. |
| Gebruikersavatars | `UserAvatar.tsx`, `ScriptureAvatar.tsx`, `characterAssets.ts`, `avatarAccessories.ts` | Bestaande schriftavatar is optioneel; emoji/initialen blijven compatibele fallback. Niet automatisch alle gebruikers een personage geven. |
| Profielheader | `ProfileCharacterHero.tsx`, `profileCharacterFraming.ts` | Bestaand full-body-raster met camera-zoom. Niet vervangen door nieuw mascotbeeld of rechthoekig accessoire. |
| Rankmedaille | `RankMedal.tsx` | CSS-cirkel met cijfer, expliciet geen emoji. Voor nu behouden. |
| Kompas | `KompasIcon.tsx`, `TopicIcon` | Inline SVG-kompas plus Lucide-topiciconen. Functioneel en semantisch; geen illustratieopdracht. |
| Databasewaarden | `ContentCollection.icon`, `Achievement.icon`, user-avatarvelden, admin brandingdata-URL | Runtime-afhankelijk. De audit heeft waarden statisch opgespoord, maar kan zonder live database niet bewijzen welke records actief zijn. |

## Generieke visuele assets en classificatie

Legenda: **A** behouden, **B** hergebruiken, **C** nieuw ontwerp nodig,
**D** functioneel standaardicoon, **E** onzeker/handmatig beoordelen.

| ID | Huidig generiek element | Concrete locaties | Classificatie | Prioriteit | Besluit |
|---|---|---|---|---|---|
| GEN-001 | Semantische contentbroniconen | `contentMetadata.ts`, `ContentIcon.tsx`, content switcher | **C** | P1 | Maak één nieuwe, consistente set van acht kleine broniconen. Gebruik geen boek-van-Mormonmotief als algemene fallback. |
| GEN-002 | Artworkplaceholder bij ontbrekend beeld of afbeeldingsfout | `MediaArtwork.tsx` | **D** | P1 | Behouden. De placeholder voorkomt dat een verkeerd beeld inhoudelijk wordt toegewezen. Een illustratie als foutmelding is niet nodig. |
| GEN-003 | Primaire navigatie | `NavIcon.tsx`, `PrimaryNav.tsx`, `BottomNav.tsx` | **D** | P3 | `House`, `BookOpen`, `Gamepad2` en `Users` zijn herkenbare functionele iconen. Behouden. |
| GEN-004 | Actie-, formulier-, status- en beheericonen | Codebreed `lucide-react`; 97 verschillende imports | **D** | P3 | Behouden. Vervanging door kleine afbeeldingen zou herkenbaarheid, themakleuring en toegankelijkheid verslechteren. |
| GEN-005 | Kompas en topiciconen | `KompasIcon.tsx` | **D** | P3 | Behouden. Het kompas is een bewust eenvoudige inline SVG in Lucide-lijndikte, geen ontbrekende illustratie. |
| GEN-006 | Klassementposities 1–3 | `RankMedal.tsx` | **E** | P2 | CSS-cirkel werkt functioneel en is geen emoji. Alleen wijzigen na een apart componentontwerp; geen productieasset nodig voor deze audit. |
| GEN-007 | Prestatie-iconen uit `Achievement.icon` | `src/lib/seed.ts`, `achievementDisplay.ts`, `FriendProfileClient.tsx`, `ActivityFeedClient.tsx` | **E** | P2 | Emoji zijn zichtbaar in prestaties/feed. Een centrale betekenis- en toegankelijkheidsreview is nodig voordat ze door illustraties worden vervangen. Hergebruik eerst SystemIcon/divisie-assets waar semantisch correct. |
| GEN-008 | Notificatiegroep-iconen | `src/lib/notificationGroups.ts`, `NotificationCenter.tsx` | **E** | P2 | Emoji zoals spel, letters, strijd, groep, podium en podcast komen uit data. Eerst naar bestaande Lucide-iconen mappen; geen nieuwe illustraties zonder uniforme set. |
| GEN-009 | UserAvatarfallback | `UserAvatar.tsx`, `ScriptureAvatar.tsx` | **B/E** | P2 | Bestaande geselecteerde schriftpersonages en accessoires kunnen worden hergebruikt. Emoji/initialen blijven nodig voor gebruikers zonder keuze, privacy en compatibiliteit. Niet automatisch vervangen. |
| GEN-010 | Admin-contentbron-emoji | Admin content switcher en `ContentCollection.icon` | **E** | P3 | Alleen beheeroppervlak; niet verwarren met de publieke `ContentIcon`. Handmatig beoordelen bij adminredesign. |
| GEN-011 | Loading-, lege- en foutstatus | `StateMessage.tsx` en verspreide `Loader2`/`AlertCircle`/`Info`-iconen | **D** | P2 | Behouden als tekst + functioneel icoon. Geen generieke decoratieve afbeelding nodig. |
| GEN-012 | PWA-logo-/faviconfallback | `public/icons/icon-*.png`, `apple-touch-icon.png`, `favicon.ico`, `layout.tsx` | **E/C** | P1 | Huidige open boek blijft werken. Een definitieve Versado-mark kan later worden gemaakt, maar alleen met een goedgekeurde logo-/Figmareferentie. |
| GEN-013 | Inline SVG voor QR, chevrons en spelgeometrie | `GroupLinkSettings`, `PublicLanguageSwitcher`, `JigsawClient` | **D** | P3 | Functionele techniek of spelweergave; behouden. Niet als merkasset behandelen. |
| GEN-014 | Emoji in tekstuele feedback en kleine hulpmiddelen | onder meer `ShopClient`, onboarding, oefenflows, XP-history en gamekamers | **E** | P2/P3 | Niet alle emoji zijn structurele iconen. Alleen vervangen wanneer ze als beeldmerk functioneren en de context een eenduidige, toegankelijke vervanger heeft. |

### Emoji en Unicode

Er is geen enkele bron die alle emoji runtime bundelt; de audit vond ze in
achievement-seeds, profielavataropties, notificatiegroepen, feed/history,
spelkamers, shop, onboarding en oefenflows. De belangrijkste onderscheidingen
zijn:

- `avatarEmoji` is gebruikersdata en heeft een noodzakelijke fallbackfunctie;
- `Achievement.icon` en notificatiegroep-iconen zijn structureel genoeg voor een
  vervolgonderzoek, maar hun semantiek moet centraal worden vastgelegd;
- emoji in toast-, e-mail- of begeleidende tekst zijn geen afbeeldingsassets en
  moeten niet blind worden vervangen;
- `RankMedal`, `SystemIcon` en `DivisionEmblem` zijn al emoji-vrije visuele
  oplossingen.

## Scherm- en featurecontrole

De onderstaande matrix is een codegebaseerde inventarisatie. Omdat een browser
ontbrak, is “zichtbaar” gebaseerd op imports, routes, componentrendering en
assetregisters, niet op een gemaakte screenshot.

| Scherm/gebied | Vastgesteld beeldmateriaal | Generiek of bestaand | Auditbesluit |
|---|---|---|---|
| Vandaag | `MediaArtwork` voor daily, cursus, podcast en spel; `PersonalMascot`/`MascotSlot`; `SystemIcon`; Lucide | Gemengd | **A/B/D.** Geen nieuwe grote illustratie nodig. Hergebruik bestaande cards en mascottestates. |
| Leren | Cursus- en boekartwork; kinderverhaalbeelden; schriftavatars in personenzoeker/profielcontext; oefenflows met tekst/icoon | Bestaand + functioneel | **A/B/D.** Niet vervangen door een algemene nieuwe leerillustratie. |
| Spelen | Centrale spelcovers; Quick Missionary sprites; mysteryborden; Gezinsavondregio’s; Lucide speliconen | Bestaand + functioneel | **A/B/D.** De huidige gamebeelden zijn inhoudelijk specifieker dan een nieuwe categorieplaat. |
| Mysteries | 18 borden en 9 bestaande spelpersonages; `getCharacterAsset` voor compact paletbeeld | Bestaand | **A.** Bestaande body-assets, ankers en speelgeometrie behouden. |
| Samen | UserAvatar/ScriptureAvatar, mascotte waar het moment dat vraagt, Lucide groep/actie | Gemengd | **B/D.** Hergebruik personageavatars optioneel; geen nieuwe sociale illustratie nodig. |
| Vrienden | UserAvatar, ScriptureAvatar, divisie-embleem, prestaties, Lucide acties | Bestaand + emoji-data | **B/E.** Avatarstelsel is al aanwezig; prestaties/notificaties vragen handmatige iconreview. |
| Groepen | UserAvatar/ScriptureAvatar, QR-SVG, Lucide instellingen/leden | Functioneel + bestaand | **B/D.** QR en beheericonen behouden; geen groepsmascotte maken. |
| Profiel | `ProfileCharacterHero` met full-body, vierkante avatarlagen, accessoires, divisie-embleem, prestaties | Bestaand; emoji fallback | **A/B/E.** Niet opnieuw tekenen. Emoji fallback blijft tot gebruiker kiest. |
| Prestaties | `Achievement.icon`, `RankMedal`, SystemIcon, divisie-assets | Gemengd | **A/D/E.** Geen losse productie per prestatie; eerst centrale semantische mapping. |
| Reeksen | `streak-flame`, `streak-flame-empty`, freeze, mascotte states | Officieel bestaand | **A/B.** Geen nieuwe vlam, badge of streakmascotte nodig. |
| Divisies | 8 WebP-emblemen en CSS rankmedailles | Officieel + CSS | **A/E.** Emblemen behouden; rankmedaille apart beoordelen. |
| Shop | XP/freeze-systemiconen, Lucide, hint-emoji in saldo/context | Gemengd | **A/D/E.** Gebruik bestaande systeemiconen; hint-emoji alleen later semantisch beoordelen. |
| Hulpmiddelen | Lucide, schriftpersonageportretten in personenzoeker, eventueel bestaand artwork | Bestaand + functioneel | **A/B/D.** Geen algemene toolboxillustratie maken. |
| Versado Kompas | Kompas-inline-SVG en Lucide TopicIcon | Functioneel standaard | **D.** Behouden; uitlegregister en rondleidingen zijn leidend. |
| Onboarding | `family-huddle`, system icons, Lucide, één tekstuele licht-/tip-emoji | Bestaand + functioneel | **A/D/E.** Bestaande family-state hergebruiken. |
| Content switcher | Publiek: `ContentIcon`; admin: DB-emoji; headerafkortingen | Generiek bronicoon | **C/E.** Acht nieuwe broniconen zijn de enige P1-productieopdracht. |
| Cursussen | `ContentCard` + `MediaArtwork`, cursus-/boek-/werkfallback | Bestaand artwork | **A/B.** Register uitbreiden alleen wanneer later echte nieuwe content wordt toegevoegd. |
| Spellenkaarten | `ContentCard` + `MediaArtwork`, persoonlijke Quick Missionary-covers | Bestaand artwork | **A/B.** Geen tweede set gamecategoriebeelden maken. |
| Instellingen | Lucide toggles, chevrons, status- en beheericonen | Functioneel | **D.** Behouden. |
| Lege schermen | `StateMessage`, tekst en Lucide | Fallback/functioneel | **D.** Geen illustratieopdracht; behoud duidelijke tekst en focusgedrag. |
| Foutmeldingen | Tekst, `AlertCircle`/vergelijkbare Lucide-iconen, soms netwerkstatus | Functioneel | **D.** Geen decoratieve beeldvervanging. |
| Inloggen en registreren | Publieke layout, tekst, taalwisselaar en formuliericonen; geen dedicated artworkregister | Functioneel/geen asset | **D/E.** Geen nieuwe authillustratie zonder productbesluit. |
| Beheer | Lucide adminiconen, DB-emoji, admin logo/favicon als data-URL | Dynamisch | **E.** Admin-upload kan buiten repository vallen; niet in een vaste assetproductie opnemen. |

## Ongebruikte, niet-runtime of alleen fallback

“Niet gevonden in broncode” is geen bewijs dat een bestand veilig verwijderd mag
worden. De bestanden blijven dus staan.

| Bestand/familie | Vastgesteld gebruik | Classificatie | Actie |
|---|---|---|---|
| `public/images/games/geheugenspel.png` | Geen referentie gevonden in `src/` of `src/lib/artwork.ts`. | **E** mogelijk verweesd of toekomstige gamecover | Niet verwijderen; later koppelen of expliciet archiveren. |
| `public/images/games/obstacle-wall-long.png` | Geen runtimeverwijzing gevonden. Snelle Zendeling gebruikt voor het lange obstakel het bestand onder `public/games/snelle-zendeling/`. | **E** duplicaat/oud pad | Niet verwijderen; producteigenaar moet herkomst bevestigen. |
| `public/images/courses/life-of-christ.png` | Staat in `src/lib/artwork.ts` met commentaar dat de cursus-slug nog niet bestaat. | **B/E** geregistreerde toekomstige fallback | Behouden als voorbereide content; niet als huidig scherm rapporteren. |
| `public/mascots/figma/*` | Geen runtimeverwijzingen; bedoeld als Figma-export/QA. | **A** bronmateriaal | Behouden, niet in `MascotSlot` importeren. |
| `public/mascots/references/*` | Geen runtimeverwijzingen; bedoeld als canonreferentie. | **A** bronmateriaal | Behouden, niet als appbeeld tonen. |
| `public/scripture/characters/**/references/*` | Sheets zijn documentatie; runtime gebruikt catalogus-paden naar portrait/master. | **A** documentatie | Behouden; niet als avatarlaag laden. |
| `MediaArtwork` zonder registermatch | Geen bestand; kiest per soort een Lucide-placeholder. | **D** fallback | Behouden tot een inhoudelijk passend asset bestaat. |
| Admin-logo/favicons als data-URL | Niet noodzakelijk een bestand uit deze repository; instantiestatus komt uit brandingdata. | **E** dynamisch | Niet in vaste productie- of bestandsinventaris als bestaand logo tellen. |

## Hergebruikmogelijkheden

1. **Persoonlijke begeleiding:** gebruik bestaande `PersonalMascot`-states voor
   Vandaag, onboarding en resultaten. Een nieuwe “welkomende” of “bemoedigende”
   mascot is niet nodig zolang een bestaande state semantisch past.
2. **Gebruikers en vrienden:** hergebruik `ScriptureAvatar` met de bestaande
   character catalogus en 16 losse accessoires wanneer de gebruiker een keuze
   heeft gemaakt. Emoji/initialen blijven de gecontroleerde fallback.
3. **Voortgang en competitie:** gebruik de vier SystemIcon-assets en acht
   divisie-emblemen. Maak geen aparte reeks-, XP- of divisie-illustraties.
4. **Cursussen en spellen:** gebruik `artworkFor()` en de bestaande
   `MediaArtwork`-ratio’s. Voeg geen tweede artworkregister of pagina-specifiek
   beeldpad toe.
5. **Mysteries en Snelle Zendeling:** behoud de gekalibreerde gameplay-assets;
   deze mogen niet als algemene mascotestates of kaartcovers worden hergebruikt.
6. **Lege/error states:** houd de functionele placeholder aan. Een ontbrekend
   beeld moet niet door een willekeurige mascot of illustratie worden verhuld.

## Schriftbronnen en toekomstfallback

De huidige semantische bronkeys zijn `bofm`, `dc-testament`, `pgp`,
`old-testament`, `new-testament`, `fsy` en `podcasts`. De publieke contentkiezer
haalt naam en afkorting uit de contentcollectie, maar haalt het beeld nog uit
Lucide. De nieuwe set moet daarom:

- de zeven huidige keys afzonderlijk herkennen zonder tekst in de afbeelding;
- geen uitsluitend Boek-van-Mormon-specifieke algemene fallback introduceren;
- een neutrale achtste fallback bieden voor toekomstige schriftbronnen;
- geen bestaand officieel beeldmerk of auteursrechtelijk beschermd symbool
  nabootsen zonder expliciete referentie en toestemming;
- op 20–28 CSS-pixel herkenbaar blijven en bij licht/donker niet van kleur
  afhankelijk zijn.

Dit is de reden dat precies acht iconen, en niet een nieuwe illustratie per
scherm of per huidige boekafbeelding, in productie worden gepland.

## Onzekerheden en grenzen

- Er kon geen browser worden gestart. Responsive uitsneden, dark-modecontrast,
  safe-area-effecten en werkelijke schermvolgorde zijn dus niet visueel
  geverifieerd.
- De live database is niet geraadpleegd. Welke `ContentCollection.icon`,
  `Achievement.icon`, user-avatarselecties en admin-brandingdata op een
  installatie actief zijn, kan per deployment verschillen.
- Het repository bevat geen vaste definitieve Versado-wordmark of expliciete
  bron-icoonbestanden. Daarom zijn logo-assets voorwaardelijk en is de broniconset
  wel concreet maar nog afhankelijk van brand-/contentreferenties.
- Bestandslicenties/auteursrechtelijke herkomst van bestaande contentbeelden is
  in deze code-audit niet opnieuw juridisch vastgesteld. Bestaande beelden zijn
  niet aangepast en nieuwe broniconen mogen geen beschermde beeldmerken kopiëren.
- De twee artworkbestanden zonder huidige bronreferentie zijn niet verwijderd;
  hun productstatus moet door de eigenaar worden bevestigd.
- De precieze visuele geschiktheid van alle 825 bestanden is niet door 825
  handmatige schermbeelden vastgesteld. De families zijn op metadata, registers,
  documentatie en representatieve lokale inspectie gecontroleerd.

## Aanbevelingen

1. Laat eerst een goedgekeurde bronreferentie voor de acht contentbroniconen
   vastleggen. Voer daarna alleen batch 1 uit.
2. Laat de logo-/PWA-fallback apart beslissen met een officiële Versado-brandset;
   maak geen mark op basis van het huidige open boek.
3. Houd `src/lib/artwork.ts`, `src/lib/mascots.ts`, `src/lib/characterAssets.ts`
   en `src/lib/avatarAccessories.ts` als enige registers voor respectievelijk
   content, mascottes, schriftpersonages en avatarlagen.
4. Plan een aparte semantische review van achievement- en notificatie-emoji.
   Dat is een iconografie-/toegankelijkheidsvraag, geen aanleiding om tientallen
   illustraties te produceren.
5. Maak bij latere integratie een browser-QA-matrix voor 320 px, 200% tekst,
   dark mode, reduced motion en ontbrekende afbeeldingen; deze audit kon die
   stap niet uitvoeren.
