# Technische integratieopdracht visuele assets

Dit document beschrijft toekomstig Codex-werk. De integratie is in deze audit
niet uitgevoerd. De drie auditdocumenten zijn de enige bedoelde wijzigingen in
deze opdracht.

## Integratiescope

De concrete nieuwe productie uit docs/VISUAL-ASSET-PRODUCTION.md bestaat uit
acht broniconen:

~~~text
/icons/content-sources/bofm.webp
/icons/content-sources/dc-testament.webp
/icons/content-sources/pgp.webp
/icons/content-sources/old-testament.webp
/icons/content-sources/new-testament.webp
/icons/content-sources/fsy.webp
/icons/content-sources/podcasts.webp
/icons/content-sources/source-generic.webp
~~~

De twee voorwaardelijke branding-assets (VA-BRAND-001 en VA-BRAND-002) hebben
een afzonderlijke integratiegang. Ze mogen pas worden toegevoegd als de
brandreferentie is goedgekeurd. De huidige PWA- en admin-brandingfallbacks
blijven tot die tijd intact.

## Componenten en registers

### 1. Centrale contentmetadata uitbreiden

Pas uitsluitend de centrale mapping in
src/lib/contentMetadata.ts aan. De metadata bevat nu een Lucidecomponent en
optionele afkortingen. Voeg voor de nieuwe broniconen een expliciete asset-ID of
assetpad toe, zonder de bestaande work-/id-fallbacklogica te verwijderen.

De mapping moet deze zeven huidige bronkeys dekken:

| Work/id | Nieuw bestand |
|---|---|
| bofm | /icons/content-sources/bofm.webp |
| dc-testament | /icons/content-sources/dc-testament.webp |
| pgp | /icons/content-sources/pgp.webp |
| old-testament | /icons/content-sources/old-testament.webp |
| new-testament | /icons/content-sources/new-testament.webp |
| fsy | /icons/content-sources/fsy.webp |
| podcasts | /icons/content-sources/podcasts.webp |
| onbekend of nieuwe bron | /icons/content-sources/source-generic.webp |

De databasewaarde ContentCollection.icon blijft niet de bron voor het publieke
bronbeeld. De database kan wel als adminweergave of historische data blijven
bestaan.

### 2. Centrale renderer aanpassen

Pas src/components/versado/ContentIcon.tsx aan zodat hij:

- eerst het expliciete bronasset uit contentMetadata.ts kan tonen;
- bij een ontbrekend of ongeldig asset terugvalt op de huidige Lucidebron-
  fallback, zodat contentkeuze nooit zonder herkenbare UI komt te staan;
- aria-hidden behoudt wanneer de bijbehorende naam als echte tekst naast het
  beeld staat;
- geen vrije URL uit de database of uit props accepteert;
- een vaste intrinsieke maat en object-contain gebruikt, zodat een WebP geen
  layoutverschuiving of onbedoelde crop veroorzaakt;
- geen kleur uit een bestaand card-/buttonpatroon overschrijft zonder de
  bestaande Tailwind-specificiteitsregels te respecteren.

src/components/ContentSwitcher.tsx gebruikt al de centrale ContentIcon in zowel
de actieve knop als het geporteerde keuze-menu. Wijzig die component alleen als
type-informatie of maatvoering dat aantoonbaar nodig maakt. De portal,
positionering, safe areas, labelmodi, taalbadge en toetsenbordgedrag mogen niet
veranderen.

### 3. Admin-content switcher bewust apart houden

src/components/AdminContentSwitcherClient.tsx toont de databasewaarde
collection.icon als beheerinformatie. Deze integratie vervangt dat niet
automatisch door de publieke broniconen. Een adminredesign is een aparte keuze,
omdat beheerders mogelijk een nog niet in het publieke register opgenomen bron
beheren.

### 4. Artwork- en mascotteregisters niet dupliceren

Wijzig voor deze broniconen niet:

- src/lib/artwork.ts of src/components/versado/MediaArtwork.tsx;
- src/lib/mascots.ts, MascotSlot.tsx of PersonalMascot;
- src/lib/characterAssets.ts, ScriptureAvatar.tsx of avatarAccessories.ts;
- DivisionEmblem.tsx of src/lib/leagueTiers.ts;
- KompasIcon.tsx of NavIcon.tsx.

Een bronicoon is een nieuwe semantische contentbronlaag, geen cursuscover,
mascotestate, scripture-avatar, divisie-embleem, navigatieicoon of Kompasstate.

## Bestaande assets die expliciet hergebruikt blijven

| Gebruik | Bestaande bron | Integratieregel |
|---|---|---|
| Persoonlijke gids | public/mascots/static/* via MascotSlot/PersonalMascot | Gebruik uitsluitend geregistreerde states en charactercanon. Geen directe public-paden in schermen. |
| Gebruikers- en vriendavatars | public/scripture/characters/**/portraits/* en public/scripture/accessories/* via ScriptureAvatar | Respecteer optionele keuze, unlocks, cache en emoji/initialenfallback. Geen automatische migratie van bestaande gebruikers. |
| Profielheader | public/scripture/characters/**/master/* via ProfileCharacterHero | Behoud full-bodycamera, framing, reduced-motion en vierkante badge-lagen. |
| Reeks, XP, freeze | public/icons/streak-flame*.webp, xp.webp, freeze.webp via SystemIcon | Geen nieuwe reward-assets of emoji-fallback introduceren. |
| Divisies | public/icons/divisions/*.webp via DivisionEmblem | Alle acht paden en bestaande embleemlabels blijven exact gelijk. |
| Cursus-/spelkaarten | src/lib/artwork.ts en MediaArtwork | Geen source-icon als kaartcover gebruiken; kaartverhoudingen en fallbacks blijven centraal. |
| Kinderen, mysteries, Snelle Zendeling, Gezinsavond | Bestaande manifests en game-definities | Geen assetpad, canvasmaat, voetenanker, gameplaysprite of bordcoördinaat wijzigen. |
| Empty/error/loading | StateMessage en bestaande Lucideiconen | Geen nieuwe illustratie nodig; tekst en statussemantiek blijven voorop staan. |

## Voorwaardelijke brandingintegratie

Pas dit deel alleen toe na een expliciet goedgekeurde VA-BRAND-001 en/of
VA-BRAND-002.

### Wordmark

- Plaats de goedgekeurde bron op de in de productieopdracht vastgelegde locatie.
- Laat src/app/layout.tsx de huidige admin-geconfigureerde logoDataUrl voorrang
  geven.
- Gebruik de repository-wordmark alleen als veilige fallback wanneer er geen
  admin-logo is ingesteld.
- Behoud tekstfallback als laden of validatie faalt.
- Verander appnaam, tagline, databasebranding en vertalingen niet in deze stap.
- Controleer de header bij 320 px en grotere tekst voordat een woordmerk wordt
  geactiveerd.

### App-mark/PWA

- Vervang public/icons/icon-192.png, icon-512.png, maskablevarianten,
  public/apple-touch-icon.png en public/favicon.ico niet stilzwijgend.
- Bepaal eerst welke runtimepaden door src/app/layout.tsx en
  src/app/api/branding/{manifest,favicon,apple-touch-icon}/route.ts worden
  gebruikt.
- Laat een goedgekeurde mark als aparte gecontroleerde exports leveren.
- Behoud admin-upload en de data-URL-validatie in src/lib/branding.ts.
- Controleer safe-zone, maskable crop, browser-tab, iOS-home-screen en
  dark/light-achtergronden.

## Fallbacks

De fallbackketen voor de publieke contentbron moet na integratie zijn:

~~~text
bekende work/id
  -> eigen transparant bronicoon uit contentMetadata
  -> source-generic.webp voor onbekende/toekomstige bron
  -> huidige Lucide LibraryBig als bestand ontbreekt of afbeeldingsfout geeft
~~~

De contentnaam, afkorting, taal en aria-label komen uit de bestaande tekstlaag,
niet uit een afbeelding. Een bestand dat niet laadt mag de knop niet onbruikbaar
maken.

Voor overige onderdelen blijven de huidige fallbacks gelden:

- MediaArtwork: neutrale cursus-/spel-/podcast-/social-placeholder per soort;
- ScriptureAvatar: emoji of initialen wanneer geen toegestane character-ID is
  gekozen;
- mascottes: ontbrekende asset geeft de bestaande veilige lege uitkomst;
- branding: tekstnaam en huidige PWA-open-boekiconen zolang geen goedgekeurde
  merkasset is geactiveerd;
- prestaties en notificaties: bestaande emoji/data of Lucide blijven totdat een
  aparte semantische mapping is ontworpen.

## Tests en validatie bij latere integratie

### Automatische checks

Voer minimaal uit:

~~~text
npm run test:artwork
npm run test:mascots
npm run test:character-assets
npm run test:profile
npm run test:cards
npm run test:kompas
npm run lint
npx tsc --noEmit
npm run build
~~~

Voeg voor de broniconen een gerichte test toe, bijvoorbeeld
tests/content-metadata-assets.test.ts, die:

- alle acht geregistreerde paden controleert met existsSync;
- PNG/WebP-formaat, alpha en 512/256-afmetingen controleert;
- de zeven bekende keys en de onbekende fallback test;
- controleert dat geen twee huidige keys onbedoeld hetzelfde bestand gebruiken;
- controleert dat een ontbrekend asset terugvalt op de huidige functionele
  Lucidecomponent of de generic asset, afhankelijk van de gekozen renderer;
- geen database nodig heeft.

Voer bij een wijziging aan de optionele logo-integratie daarnaast de bestaande
branding/API-tests uit en controleer dat custom admin-data-URL’s voorrang houden.

### Browser- en visuele QA

Een latere integratie moet in een echte browser minstens controleren:

- 320, 360, 390 px en desktopbreedte;
- 200% tekst en lange vertalingen;
- licht en donker thema;
- toetsenbordfocus, schermlezernaam en aria-hidden-gedrag;
- contentwisselaar gesloten/open, portalpositie en safe areas;
- loading-, ontbrekend- en errorbeeld;
- browser back, app-resume en Android/iOS-container waar relevant;
- retina/DPR 1, 2 en 3 zonder wazig of uitgerekt pictogram;
- PWA maskable en apple-touch-output alleen wanneer branding is geactiveerd.

De nieuwe iconen mogen de koptekst niet vervangen, geen horizontale overflow
veroorzaken en geen layoutverschuiving geven wanneer een bronnaam lang is.

## Wat absoluut niet mag veranderen

- Geen bestaande afbeelding aanpassen, hercomprimeren, hernoemen of verwijderen.
- Geen nieuwe mascotte-identiteit, mascotestate, pose of accessoire maken.
- Geen directe mascottepaden buiten de centrale mascotteregistercomponenten.
- Geen scripture-personage aan een andere canonieke identiteit koppelen.
- Geen bestaande profielavatar automatisch omzetten van emoji/initialen naar een
  personage.
- Geen Mysterie-body, canvasmaat, voetenanker, bordcoördinaat, pointerflow of
  spelregel wijzigen.
- Geen artwork uit src/lib/artwork.ts dupliceren in de contentbroniconen.
- Geen achievement-, XP-, reeks-, divisie- of shop-economie wijzigen.
- Geen ContentCollection.icon-databasewaarden migreren of verwijderen.
- Geen navigatieroutes, shell-layout, safe-area-variabelen, Kompasregister,
  onboardingstappen of vertalingen veranderen buiten een expliciet afzonderlijk
  besluit.
- Geen brandlogo genereren wanneer de officiële referentie nog ontbreekt.

## Integratievolgorde

1. Controleer dat alle acht nieuwe bestanden onder de voorgestelde map bestaan,
   alpha hebben en niet dezelfde inhoud/naam delen.
2. Voeg de mapping centraal toe aan contentMetadata.ts.
3. Pas alleen ContentIcon.tsx aan voor het afbeeldingspad en de veilige fallback.
4. Controleer de bestaande publieke ContentSwitcher; pas die alleen aan bij
   bewezen type-/maatproblemen.
5. Laat admin-emoji en databasevelden ongemoeid.
6. Draai de automatische checks en de visuele matrix.
7. Overweeg branding pas in een afzonderlijke change nadat de logo-bron is
   goedgekeurd.
