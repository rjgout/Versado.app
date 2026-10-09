# Versado — toekomstige integratieopdracht visuele identiteit 2.0

Dit document beschrijft de latere Codex-integratie. De integratie is in deze
audit niet uitgevoerd. Er zijn geen componenten, stylesheets, data,
databasewaarden of afbeeldingen gewijzigd.

## Integratiedoel en grenzen

Integreer alleen de definitief goedgekeurde V2-assets uit
`docs/VISUAL-IDENTITY-PRODUCTION-V2.md`. De bestaande
contentbronarchitectuur, routes, selectie, opslag, XP, reeksen, divisies,
spelresultaten en toegankelijkheidssemantiek blijven gelijk.

De profielavatar rechtsboven blijft volledig buiten scope. Wijzig daarvoor
geen component, register, fallback, afmeting of uitsnede.

## Bestandplaatsing en centrale registratie

Plaats alleen de geoptimaliseerde WebP-runtimebestanden in:

```text
public/icons/versado/kompas.webp
public/icons/versado/invite-friends.webp
public/icons/versado/tools.webp
public/icons/versado/podium/podium-gold.webp
public/icons/versado/podium/podium-silver.webp
public/icons/versado/podium/podium-bronze.webp
public/icons/versado/achievements/achievement-learning.webp
public/icons/versado/achievements/achievement-mastery.webp
public/icons/versado/achievements/achievement-social.webp
public/icons/versado/achievements/achievement-game.webp
public/icons/versado/empty/notifications-empty.webp
```

Maak één centrale visuele-identiteitsregistry voor deze nieuwe assets, bij
voorkeur `src/lib/visualIdentityAssets.ts`. Pagina's mogen geen van deze
paden zelf typen. De registry geeft per betekenis het specifieke pad en de
neutrale fallback terug.

Bestaande registers blijven eigenaar van hun eigen domein:

| Domein | Bestaande eigenaar | Integratieregel |
|---|---|---|
| Contentbronnen | `src/lib/contentMetadata.ts`, `ContentIcon.tsx` | Niet dupliceren. De acht broniconen en `source-generic.webp` blijven daar. |
| Streak, XP, freeze | `SystemIcon.tsx` | Niet verplaatsen; achievements mogen deze component hergebruiken. |
| Divisies | `leagueTiers.ts`, `DivisionEmblem.tsx` | Niet vervangen door podiumbadges. |
| Content- en spelbeelden | `artwork.ts`, `MediaArtwork.tsx` | Geen categoriebeelden in dit register dupliceren. |
| Mascottes | `mascots.ts`, `MascotSlot`, `PersonalMascot` | Alleen bestaande personages/states; niet gebruiken als generieke iconfallback. |
| Kompas | huidige `KompasIcon.tsx` plus nieuwe registry | Eén expliciet productbesluit: inline SVG behouden of overal vervangen door `kompas.webp`; nooit beide varianten willekeurig mengen. |
| V2-identiteit | nieuwe centrale registry | Alleen Kompas, uitnodiging, hulpmiddelen, podium, achievements en lege meldingen. |

De registry moet bij ontbrekende bestanden een neutrale sleutel opleveren,
niet een gedeeltelijke naamherkenning of een verkeerd inhoudsasset.

## Betrokken componenten

### Kompas

Controleer en pas alleen indien het V2-Kompas definitief is goedgekeurd aan:

- `src/components/kompas/KompasIcon.tsx`
- `src/components/kompas/KompasEntryCard.tsx`
- eventuele Kompas-topic- of empty-statecomponenten

Behoud de huidige Kompas-registers, uitlegkeuze, rondleidingen en
`data-kompas-target`-waarden. De illustratie is decoratief; de titel en uitleg
blijven tekst. `tests/kompas.test.ts` en de layouttests blijven leidend.

### Sociale uitnodiging en hulpmiddelen

Vervang uitsluitend de visuele emoji op:

- `src/components/FriendInviteCard.tsx`
- `src/app/uitnodiging/[code]/page.tsx`, alleen als de betekenis exact dezelfde
  persoonlijke vriendenuitnodiging is
- `src/components/CoursesClient.tsx` voor de ingang naar `/tools`

De share-, copy-, regenerate-, zoek- en navigatielogica blijft ongewijzigd.
De `/tools`-pagina behoudt zijn vier bestaande lijniconen; voeg geen tweede
toolboxbeeld toe zonder een afzonderlijke ontwerpbeslissing.

### Podium

Breid `src/components/versado/RankMedal.tsx` uit met de centrale podiumassets
of maak een kleine gedeelde afbeeldingsvariant binnen die component. Behoud:

- de bestaande `rank`-interface;
- de echte rangtekst 1, 2 en 3;
- de bestaande `aria-label`-waarden;
- de bestaande maatklasse waar die in de layout past.

Controleer daarna de aanroepen in:

- `src/components/LeaderboardClient.tsx`;
- `src/components/profile/ProfileContentViews.tsx`;
- `src/components/WordGameClient.tsx`;
- `src/components/GameRoom.tsx`;
- `src/components/FamilyGameRoom.tsx`;
- `src/components/ChapterGuessGameRoom.tsx`;
- `src/components/alleskenner/SoloClient.tsx`.

Gebruik één podiumset. Maak geen nieuwe set voor vrienden, divisie, algemene
ranglijst of een afzonderlijk spel. Controleer `GroupLeaderboardClient.tsx`
en `snelleZendeling/Leaderboard.tsx` als handmatige vervolgbeslissing; daar
worden nu niet overal dezelfde top-drie-markering gebruikt.

### Achievements en feed

Maak een sluggebaseerde mapping in de centrale registry. Gebruik bijvoorbeeld:

| Slugs | Assetbron |
|---|---|
| `streak-*` | `SystemIcon` `streak` |
| `xp-*` | `SystemIcon` `xp` |
| `first-freeze-earned` | `SystemIcon` `freeze` |
| `intro-*` | V2 Kompas, alleen als goedgekeurd |
| `podcast-*` | bestaand `ContentIcon` voor `podcasts` of de afgesproken bestaande podcastbron |
| `first-chapter`, `chapters-*`, `kids-*` | `achievement-learning.webp` |
| `perfect-*` | `achievement-mastery.webp` |
| `first-friend`, `friends-5`, `friend-streak-*`, eventueel gifted-freeze | `achievement-social.webp` |
| `first-duel-won`, `duels-10-won`, `family-game-*`, `word-game-*` | `achievement-game.webp` |

Betrokken code:

- `src/components/profile/ProfileContentViews.tsx` — alle achievementtegels,
  featured list en locked state;
- `src/lib/achievementDisplay.ts` — displayfallback voor bekende slugs;
- `src/lib/seed.ts` — alleen aanpassen als de persistente emoji-inhoud bewust
  en apart wordt gemigreerd; bestaande data niet stilzwijgend overschrijven;
- `src/lib/activityFeed.ts` en `ActivityFeedClient.tsx` — gebruik
  `achievementSlug` voor nieuwe weergave;
- `src/components/ActivityFeedClient.tsx` — oude `achievementIcon` alleen als
  tijdelijke legacyfallback.

De naam en beschrijving blijven vertaalde echte tekst. Het nieuwe beeld krijgt
`alt=""` wanneer de achievementnaam ernaast staat en mag niet dubbel door een
schermlezer worden aangekondigd.

### Meldingen

In `NotificationCenter.tsx`:

- behoud het kleine headerbelletje, de knopnaam, badge, focus en portal;
- vervang alleen de grote emoji in de lege staat door
  `notifications-empty.webp`;
- behoud de bestaande titel en uitleg als betekenis;
- voeg een `onError`-fallback toe naar het bestaande functionele belicoon of
  een eenvoudige lijnvariant zonder fallbacklus.

In `src/lib/notificationGroups.ts` moet een latere refactor emoji niet als
visuele waarheid blijven opslaan. Gebruik eerst een centrale semantische
sleutel en beslis per categorie of een bestaande Lucide-icon voldoende is.
Maak niet automatisch acht nieuwe afbeeldingen. De meldingsdata, filters,
sortering en notificatiebadge mogen niet veranderen.

## Afbeeldingsgedrag en fallbacks

Gebruik voor de nieuwe WebP's een passende bestaande afbeeldingscomponent of
een kleine gedeelde decoratieve component. Vereisten:

1. `alt=""` en `aria-hidden` als de naastgelegen tekst de betekenis draagt.
2. `object-contain`, vaste intrinsieke dimensies en geen CSS-filter.
3. Geen layout shift: de container krijgt vóór laden de juiste vierkante maat.
4. Bij een ontbrekend specifiek bestand: centrale neutrale fallback of
   bestaand functioneel Lucide-icoon.
5. Bij `onError`: maximaal één overgang per asset; geen oneindige fallbacklus.
6. Geen lege plek of broken-image-symbool bij een netwerk-/cachefout.
7. Caching via statische `public/`-bestanden; geen onnodige API-request.
8. Geen tekst of rangnummer in de bitmap.

Voor contentbroniconen blijft de bestaande volgorde gelden:

1. specifiek bronasset;
2. `source-generic.webp`;
3. bestaand functioneel Lucide-fallbackicoon.

De V2-assets mogen deze bronfallback niet beïnvloeden.

## Responsive en toegankelijkheid

Controleer met echte browserweergave, niet alleen met snapshots:

- 320, 360, 375 en 390 px portret;
- mobiel landscape;
- desktop;
- tekstschaal 100%, 150% en 200%;
- lichte en donkere modus;
- toetsenbordfocus en schermlezerlabels;
- iOS safe-area en de vaste header/onderbalk.

Specifiek controleren:

- `ContentSwitcher` blijft zichtbaar en gebruikt zijn bestaande body-portal;
- geen menu achter `SubpageBackBar` of `[data-sticky-header]`;
- `FriendInviteCard` breekt niet horizontaal door lange links;
- de nieuwe toolbox past binnen de Leren-kaart;
- podiumbeeld en nummer passen naast naam en XP op 320px;
- achievementgrid blijft leesbaar bij 200% tekst;
- lege meldingenstaat blijft gecentreerd zonder de sluitknop te overlappen;
- de headeravatar wordt alleen als bestaand element meegemeten en niet gewijzigd.

## Tests en validatie

Voeg, indien er geen bestaande dekking is, een gerichte test toe zoals
`tests/visual-identity-assets.test.ts` die controleert:

- alle elf registry-items bestaan;
- WebP-afmetingen en alpha-eigenschappen kloppen;
- podiumassets exact de keys gold/silver/bronze hebben;
- achievement-slugs geen emoji-naamherkenning gebruiken;
- onbekende assetkeys naar de afgesproken neutrale/functionele fallback gaan;
- oude achievement-feeddata niet crasht;
- de bestaande `ContentIcon`-fallback onaangetast blijft.

Voer daarna minimaal uit:

```text
npm run lint
npx tsc --noEmit
npm run test:artwork
npm run test:mascots
npm run test:leagues
npm run test:profile
npm run test:kompas
npm run test:focus
npm run build
```

Voer de gerichte test voor de nieuwe registry en de relevante sociale,
achievement- en activity-feedtests uit. Gebruik een echte browser voor de
responsive controles; zonder browser mogen ze niet als geslaagd worden
gerapporteerd.

## Wat absoluut niet mag veranderen

- Geen contentbron, contentvolgorde, bronselectie of routing.
- Geen `ContentCollection.icon`-waarden verwijderen.
- Geen databasegegevens, achievementhistorie, XP, streaks, divisies,
  competitie of spelresultaten wijzigen.
- Geen nieuwe adminfunctionaliteit of adminredesign.
- Geen wijzigingen aan de globale shell, safe areas, focus mode of
  navigatiearchitectuur.
- Geen verwijdering van `lucide-react`.
- Geen rechtstreekse paginapaden buiten de centrale register-/componentlaag.
- Geen nieuwe mascotte-identiteit of wijziging van de avatar rechtsboven.

## Integratie-eindpunt

De integratie is klaar wanneer de elf assets centraal geregistreerd zijn, alle
genoemde publieke toepassingen dezelfde bron gebruiken, de oude emoji alleen
blijven waar ze bewust content/status zijn, de fallbacktests slagen en de
browsercontrole op kleine schermen en grote tekst geen overlap of horizontale
scroll oplevert. De documentatie en testresultaten moeten in dezelfde PR als
de implementatie worden bijgewerkt.
