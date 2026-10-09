# Productieopdracht visuele assets voor ChatGPT Work

Dit document bevat uitsluitend assets die nog nieuw gemaakt moeten worden. Het
is geen integratieopdracht en bevat geen toestemming om bestaande bestanden of
de interface te wijzigen.

## Productieregels

- Gebruik de bestaande repository-assets als stijlreferentie, maar overschrijf
  ze niet en maak geen varianten met dezelfde bestandsnaam.
- Gebruik voor mascottes uitsluitend de bestaande officiële Novi-, Varo- en
  Vera-referenties. Deze productieopdracht maakt geen nieuwe mascotestates,
  poses, personages of accessoires.
- Plaats geen tekst, letters, afkortingen, cijfers of logo’s in de acht
  broniconen. De naam wordt door de echte UI als tekst toegankelijk gemaakt.
- Maak geen denominatiespecifiek of auteursrechtelijk beschermd beeldmerk na.
  Een bronicoon moet een herkenbare semantische suggestie zijn, geen officieel
  kerkelijk logo.
- Genereer de acht broniconen als één samenhangende serie. Ze moeten op
  20–28 CSS-pixel nog als dezelfde familie herkenbaar zijn.
- Transparantie is verplicht voor broniconen. Er mag geen witte, gekleurde of
  patroonachtergrond in het bestand worden ingebakken.
- De twee branding-records onderaan mogen pas starten nadat de producteigenaar
  een goedgekeurde Versado-wordmark-/Figmareferentie heeft aangeleverd. Zonder
  die referentie mag Work geen logo verzinnen.

## Productieoverzicht

| Batch | Onderwerp | Nieuwe concrete assets | Status |
|---|---|---:|---|
| Batch 1 | Navigatie, categorieën en schriftbronnen | 8 broniconen + 2 voorwaardelijke branding-assets | Uitvoeren na referentiecheck; branding alleen conditioneel. |
| Batch 2 | Leren en Spelen | 0 | Geen opdracht: bestaand artworkregister, kinderverhalen, gamecovers, mystery-assets en Quick Missionary hergebruiken. |
| Batch 3 | Samen, profiel en voortgang | 0 | Geen opdracht: bestaande mascottes, scripture avatars, accessoires, system icons en divisie-emblemen hergebruiken. |
| Batch 4 | Beloningen, lege schermen en overige illustraties | 0 | Geen opdracht: functionele iconen, CSS-medaille en bestaande fallbacks behouden. |

De acht concrete assets zijn `VA-SRC-001` t/m `VA-SRC-008`. De twee
voorwaardelijke records tellen niet mee als startklare productie zolang de
brandreferentie ontbreekt.

## Batch 1 — Navigatie, categorieën en schriftbronnen

### Gemeenschappelijke specificatie voor `VA-SRC-001` t/m `VA-SRC-008`

1. **Doel:** klein semantisch icoon in de publieke content switcher en eventueel
   in een bronkop; de bestaande volledige contentnaam blijft echte UI-tekst.
2. **Beeldverhouding:** 1:1.
3. **Gewenste pixelafmetingen:** één master van 512×512 px; export daarnaast
   256×256 px voor gebruik in de app.
4. **Achtergrond:** volledig transparant RGBA; geen schaduwvlak dat de ronde
   avatar-/headerachtergrond vervangt.
5. **Bestandsformaat:** WebP met alpha voor runtime, met een PNG-RGBA master
   voor archief en verdere export.
6. **Bestandsgewicht:** streefwaarde maximaal 80 kB voor 256 px en maximaal
   180 kB voor 512 px.
7. **Stijl:** eenvoudige, warme Versado-vormtaal die aansluit bij de bestaande
   mascottes, system icons en illustraties: duidelijke contour, afgeronde
   geometrie, beperkte details, voldoende contrast, rustig op licht en donker.
8. **Kleur:** gebruik de bestaande Versado-tokenkleuren als uitgangspunt;
   laat het icoon niet uitsluitend door één kleur of dunne lijn herkenbaar zijn.
9. **Leesbaarheid:** test op 20 px, 24 px, 28 px en 44 px; geen detail dat
   alleen op 512 px werkt.
10. **Varianten:** geen dark-/lightvariant nodig; de alpha-asset moet op beide
    thema’s werken. Geen tekstvariant en geen mascottevariant.
11. **Referentiebeelden:** `public/icons/xp.webp`,
    `public/icons/divisions/legend.webp`, een bestaande statische mascotte zoals
    `public/mascots/static/novi/novi-idle.webp` en een bestaande kaart uit
    `public/images/courses/` of `public/images/games/`. Deze zijn alleen
    stijlreferentie; kopieer geen onderwerp of karakterhouding.
12. **Toegankelijkheid:** de asset zelf is decoratief; de integratie levert de
    gelokaliseerde bronnaam als tekst/label.
13. **Voorgestelde definitieve map:** `public/icons/content-sources/`.

Elke asset krijgt daarnaast de volgende eigen omschrijving.

### VA-SRC-001 — Boek van Mormon

- **Doel en toepassing:** huidige `work: bofm` in de publieke content switcher,
  header en contentkeuze.
- **Huidig element:** `BookOpen` uit `src/lib/contentMetadata.ts`.
- **Waarom nieuw:** het huidige lijnicoon communiceert alleen “boek” en is niet
  onderscheidend als meerdere schriftbronnen naast elkaar staan.
- **Gewenste voorstelling:** een open schrift met een subtiele reis-/verhaal-
  suggestie in de bladzijden, zonder lettertekens, naam of herkenbaar officieel
  embleem. De boekvorm moet ook zonder het secundaire detail werken.
- **Referenties:** gemeenschappelijke setreferenties; geen bestaande
  Boek-van-Mormon-cover overtrekken.
- **Bestandsnaam:** `bofm.webp`; master `bofm-master.png`.
- **Prioriteit:** P1.
- **Prompt:** “Maak voor een coherente set kleine Versado-broniconen een
  transparant vierkant icoon voor een schriftcollectie: een open boek met een
  rustige reis-/verhaallijn als subtiel secundair detail. Geen tekst, letters,
  cijfers, personen, merkbeeldmerk of achtergrond; sterk silhouet op 20 px;
  dezelfde warme, afgeronde vormtaal als de aangeleverde Versado-referenties.”

### VA-SRC-002 — Leer en Verbonden

- **Doel en toepassing:** huidige `work: dc-testament` in dezelfde contentkiezer.
- **Huidig element:** `ScrollText` uit `src/lib/contentMetadata.ts`.
- **Waarom nieuw:** een generieke rol-/scrollvorm onderscheidt deze bron niet
  betrouwbaar van andere schriftcollecties.
- **Gewenste voorstelling:** een opgerolde schriftrol of verbonden pagina’s met
  een subtiele verbinding/knop als vormaccent; geen tekst of historisch logo.
- **Referenties:** gemeenschappelijke setreferenties; controleer dat de vorm
  naast `VA-SRC-001` niet als dezelfde open boekvorm leest.
- **Bestandsnaam:** `dc-testament.webp`; master `dc-testament-master.png`.
- **Prioriteit:** P1.
- **Prompt:** “Maak een transparant vierkant Versado-bronicoon voor een
  collectie rond verbonden schriftrollen: compact opgerolde rol/pagina’s met
  één subtiel verbindend vormaccent. Geen tekst, letters, cijfers, personen,
  kerkelijk logo of achtergrond; duidelijk verschillend van een gewoon open
  boek, maar met dezelfde afgeronde, warme serie-esthetiek.”

### VA-SRC-003 — Parel van Grote Waarde

- **Doel en toepassing:** huidige `work: pgp` in de publieke content switcher.
- **Huidig element:** `Gem` uit `src/lib/contentMetadata.ts`.
- **Waarom nieuw:** de huidige edelsteen is semantisch te algemeen en maakt geen
  consistente bronfamilie.
- **Gewenste voorstelling:** een eenvoudige glanzende parel/edelsteen boven een
  rustige schriftvorm; geen kroon, sieradenlogo, tekst of religieus beeldmerk.
- **Referenties:** gemeenschappelijke setreferenties; behoud een kleine, heldere
  kern die op 20 px niet in ruis verandert.
- **Bestandsnaam:** `pgp.webp`; master `pgp-master.png`.
- **Prioriteit:** P1.
- **Prompt:** “Maak een transparant vierkant bronicoon met een kleine lichte
  parel als kern, ondersteund door een eenvoudige schriftvorm. Versado-stijl:
  vriendelijk, afgerond, weinig details, herkenbaar op 20 px. Geen tekst,
  letters, cijfers, personen, kroon, bestaand logo of achtergrond.”

### VA-SRC-004 — Oude Testament

- **Doel en toepassing:** toekomstige/aanwezige `work: old-testament`-collectie.
- **Huidig element:** `ScrollText` uit `src/lib/contentMetadata.ts`.
- **Waarom nieuw:** deze bron deelt nu een generiek scrollicoon met Leer en
  Verbonden.
- **Gewenste voorstelling:** een oude, stevige boekband met een enkel blad-/
  geschiedenisaccent; geen tekst, religieus symbool of specifieke editie.
- **Referenties:** gemeenschappelijke setreferenties; ontwerp moet algemeen
  genoeg blijven voor toekomstige lokalisatie en edities.
- **Bestandsnaam:** `old-testament.webp`; master `old-testament-master.png`.
- **Prioriteit:** P1.
- **Prompt:** “Maak een transparant vierkant bronicoon voor een oude
  schriftcollectie: stevige gesloten/open boekband met één rustig blad- of
  geschiedenisaccent. Niet dezelfde scrollsilhouet als het vorige icoon; geen
  tekst, letters, personen, denominatiespecifiek teken of achtergrond.”

### VA-SRC-005 — Nieuwe Testament

- **Doel en toepassing:** toekomstige/aanwezige `work: new-testament`-collectie.
- **Huidig element:** `BookOpen` uit `src/lib/contentMetadata.ts`.
- **Waarom nieuw:** het huidige open boek is niet onderscheidend ten opzichte
  van Boek van Mormon.
- **Gewenste voorstelling:** een open boek met een zacht licht-/hoopaccent dat
  als vorm, niet als los effect, in de pagina’s is opgenomen; geen kruis,
  tekst, persoon of bestaand merkbeeld.
- **Referenties:** gemeenschappelijke setreferenties; zorg dat het accent niet
  tot een generiek stericoon verwordt.
- **Bestandsnaam:** `new-testament.webp`; master `new-testament-master.png`.
- **Prioriteit:** P1.
- **Prompt:** “Maak een transparant vierkant Versado-bronicoon voor een nieuwe
  schriftcollectie: open boek met een zacht, ingebouwd licht-/hoopaccent in de
  bladzijden. Geen kruis, tekst, letters, cijfers, personen, kerkelijk logo of
  achtergrond; sterk, rustig en herkenbaar op 20 px.”

### VA-SRC-006 — Voor de kracht van de jeugd

- **Doel en toepassing:** huidige `work: fsy`-collectie.
- **Huidig element:** `BookMarked` uit `src/lib/contentMetadata.ts`.
- **Waarom nieuw:** het huidige bladwijzericoon is een generiek object en heeft
  geen eigen bronidentiteit.
- **Gewenste voorstelling:** een opwaarts, energiek leer-/groeiaccent rond een
  klein boek of kaart; geen tienerfiguur, tekst, leeftijdslabel of slogan.
- **Referenties:** gemeenschappelijke setreferenties; sluit aan op de
  toegankelijkheidsregel dat de naam niet in het beeld hoeft.
- **Bestandsnaam:** `fsy.webp`; master `fsy-master.png`.
- **Prioriteit:** P1.
- **Prompt:** “Maak een transparant vierkant bronicoon voor een jeugdige
  leercollectie: compact boek/kaart met een opwaarts groei- of energieaccent.
  Volwassen en inclusief, niet kinderachtig; geen personen, tekst, letters,
  cijfers, slogan, logo of achtergrond; eenvoudige contour en sterke leesbaarheid
  op 20 px.”

### VA-SRC-007 — Podcasts

- **Doel en toepassing:** huidige `work: podcasts`-collectie en podcastkeuze.
- **Huidig element:** `Mic2` uit `src/lib/contentMetadata.ts`; inhoudskaarten
  gebruiken daarnaast het bestaande `podcast/default.png`.
- **Waarom nieuw:** de microfoon is functioneel maar niet in dezelfde bronstijl
  als de andere nieuwe collectie-iconen.
- **Gewenste voorstelling:** compacte audio-/gespreksgolf rond een eenvoudige
  luistervorm; geen realistische studio, tekst of koptelefoonlogo.
- **Referenties:** gemeenschappelijke setreferenties plus bestaand
  `public/images/podcast/default.png` uitsluitend voor kleurfamilie/compositie.
- **Bestandsnaam:** `podcasts.webp`; master `podcasts-master.png`.
- **Prioriteit:** P1.
- **Prompt:** “Maak een transparant vierkant Versado-bronicoon voor podcasts:
  een compacte, afgeronde audio-/gespreksgolf met één duidelijke luisterkern.
  Geen tekst, letters, cijfers, personen, studio, merklogo of achtergrond; het
  moet naast kleine schrifticonen werken zonder dunne lijntjes.”

### VA-SRC-008 — Algemene toekomstige schriftbron

- **Doel en toepassing:** fallback wanneer een nieuwe contentcollectie nog geen
  eigen iconrecord heeft; noodzakelijk om nieuwe bronnen niet automatisch aan
  Boek van Mormon te koppelen.
- **Huidig element:** `LibraryBig` als fallback in `contentIcon()`.
- **Waarom nieuw:** een toekomstvaste, neutrale fallback hoort niet een huidige
  specifieke bron of uitsluitend een generieke Lucidebibliotheek te suggereren.
- **Gewenste voorstelling:** neutrale verzameling van twee of drie abstracte
  schriftbladen/boekvormen, zonder kleur- of symboolassociatie met één bron.
- **Referenties:** alle zeven nieuwe broniconen samen; dit icoon moet familie-
  herkenbaar maar niet duplicerend zijn.
- **Bestandsnaam:** `source-generic.webp`; master `source-generic-master.png`.
- **Prioriteit:** P1.
- **Prompt:** “Maak een transparant vierkant neutraal fallbackicoon voor een
  toekomstige schriftcollectie: twee of drie abstracte, overlappende
  schriftbladen met een rustige centrale vorm. Geen dominante kleur die één
  huidige bron claimt, geen tekst, letters, personen, kerkelijk logo of
  achtergrond; dezelfde afgeronde Versado-serie en leesbaarheid op 20 px.”

## Voorwaardelijke branding-assets

Deze twee records zijn niet startklaar. De repository bevat geen goedgekeurde
vaste Versado-wordmark om als referentie te gebruiken; de huidige PWA-iconen zijn
een generieke open-boekfallback. ChatGPT Work mag deze pas produceren nadat de
producteigenaar een Figma-export, SVG of andere expliciete merkbron heeft
bijgevoegd.

### VA-BRAND-001 — Versado-wordmark

- **Doel:** fallback voor header en branding wanneer geen admin-logo is ingesteld.
- **Huidig element:** tekst `Versado` in `src/app/layout.tsx` en optionele
  admin-logo-data-URL.
- **Waarom mogelijk nieuw:** er is geen vaste merkafbeelding in de repository;
  tekstfallback is functioneel maar geen officiële wordmark.
- **Referentie:** verplicht: goedgekeurde Versado-Figma/brandbron. Niet afleiden
  uit de PWA-open-boekafbeelding.
- **Verhouding/pixels:** horizontaal 4:1, transparante master 2048×512.
- **Formaat:** PNG met alpha als Work-output; eventuele SVG is een aparte
  handmatige/vectoriële export en geen reden om een willekeurig logo te tekenen.
- **Varianten:** licht/donker alleen als de brandbron dat voorschrijft; geen
  alternatieve sloganversie.
- **Prioriteit:** P1, conditioneel.
- **Voorgestelde locatie:** `public/branding/versado-wordmark.png`.
- **Prompt na goedkeuring:** “Reproduceer uitsluitend de aangeleverde officiële
  Versado-wordmark als transparante, scherpe PNG. Behoud exact lettervorm,
  verhoudingen, kleurwaarden en clear space; voeg niets toe en ontwerp geen
  nieuw symbool of slogan. Lever 2048×512 met alpha.”

### VA-BRAND-002 — Versado-appmark

- **Doel:** PWA-iconen, faviconvarianten, apple-touch-icon en compacte merkplek.
- **Huidig element:** `public/icons/icon-192.png`, `icon-512.png`, maskable
  varianten, `public/apple-touch-icon.png` en `public/favicon.ico`.
- **Waarom mogelijk nieuw:** de fallback is een generiek open boek, niet een in
  de repository vastgelegde definitieve Versado-mark.
- **Referentie:** dezelfde goedgekeurde Figma/brandbron als `VA-BRAND-001`.
- **Verhouding/pixels:** vierkant 1024×1024 transparante master; veilige
  maskable compositie met ruime clear space. Exports 512, 192 en 180 px worden
  later technisch uit de goedgekeurde master gemaakt.
- **Formaat:** PNG-RGBA master; maskable export volgens de PWA-eisen.
- **Varianten:** normaal, maskable en apple-touch; geen nieuwe inhoudelijke
  symbolen per platform.
- **Prioriteit:** P1, conditioneel.
- **Voorgestelde locatie:** `public/branding/versado-mark.png` plus later
  gecontroleerde PWA-exports; de huidige bestanden niet overschrijven tijdens
  de productiefase.
- **Prompt na goedkeuring:** “Maak uitsluitend op basis van de aangeleverde
  officiële Versado-appmark een vierkante transparante PNG-master van 1024×1024.
  Behoud het exacte symbool, de kleuren en de clear space; voeg geen boek,
  mascotte, tekst of extra decoratie toe. Lever daarnaast een veilige maskable
  compositie zonder het symbool bij de rand te plaatsen.”

## Batch 2 — Leren en Spelen: geen nieuwe assets

Er wordt geen productieopdracht gegeven. De bestaande bronnen dekken de huidige
schermen:

- `public/images/courses/*` en `src/lib/artwork.ts` voor cursussen;
- `public/images/book-of-mormon/*`, `doctrine-and-covenants/*` en
  `pearl-of-great-price/*` voor schriftboeken;
- `public/kids/images/*` en `prisma/kidsManifest.json` voor de kindercursus;
- de bestaande gamecovers en `MediaArtwork` voor Spelen;
- de mysteryborden en gekalibreerde personages voor Mysteries;
- de Snelle-Zendeling sprites en lagen voor gameplay.

Nieuwe “categorieafbeeldingen” zouden deze inhoudelijke assets dupliceren.

## Batch 3 — Samen, profiel en voortgang: geen nieuwe assets

Er wordt geen productieopdracht gegeven. Hergebruik de bestaande:

- `MascotSlot`/`PersonalMascot` met bestaande states;
- `ScriptureAvatar` met de 73 canonieke personage-ID’s en bestaande accessoires;
- `ProfileCharacterHero` en `profileCharacterFraming.ts`;
- SystemIcon-assets voor reeks, XP en freeze;
- de acht bestaande divisie-emblemen;
- de bestaande gebruikersfallback van emoji/initialen.

Een nieuwe sociale illustratie of aparte profielmascotte zou de centrale
identiteitsregels doorbreken.

## Batch 4 — Beloningen, lege schermen en overige illustraties: geen nieuwe assets

Er wordt geen productieopdracht gegeven. De huidige CSS-rankmedaille,
functionele Lucide-iconen, `StateMessage` en `MediaArtwork`-fallback zijn voor
deze functies geschikter dan nieuwe decoratieve plaatjes. Achievement- en
notificatie-emoji krijgen eerst een afzonderlijke semantische/toegankelijkheids-
review; die review is nog geen beeldgeneratieopdracht.
