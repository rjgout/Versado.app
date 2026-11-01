# Versado Design Contract — Figma, motion en Rive (voorstel)

Status: **concept ter review** · 21 oktober 2026  
Scope: ontwerpafspraken, geen runtimewijzigingen of productierelease.

## 1. Bronnen en hiërarchie

GitHub blijft de technische bron van waarheid. Dit contract vult bestaande documenten aan en vervangt ze niet:
- `docs/VERSADO-DESIGN.md`: productvisie, tokens, shell, gebruikerservaring.
- `docs/LAYOUT.md`: vaste balken, offsets, safe areas, scroll en overlays.
- `docs/KAARTEN.md`: kaartgedrag en personalisatie in Leren en Spelen.
- `docs/VERSADO-CHARACTER-CANON.md`: identiteit, proporties, kleuren en semantische states van Novi, Varo, Vera.
- `docs/VISUAL-IDENTITY-AUDIT-V2.md` en `docs/VISUAL-IDENTITY-INTEGRATION-V2.md`: officiële illustraties, registers, visuele prioriteiten.
- `docs/PLATFORMEN.md`: gedeelde web/PWA/iOS/Android-architectuur.
- `public/mascots/rive/README.md`: gereserveerde Rive-structuur en renderercontract.

Bij een conflict gaat bestaand gedocumenteerd en getest gedrag vóór een los ontwerpbestand. Wijzigingen worden expliciet besproken en door code-audit bevestigd, niet stilzwijgend overgenomen.

## 2. Product- en ontwerpprincipes

1. **Mobile portrait first**, met volwaardige responsive tablet- en desktopversies.
2. Lezen/studeren is rustig; spellen en betekenisvolle beloningen mogen levendig zijn.
3. Visueel aantrekkelijk maar functioneel: informatie, navigatie en actie blijven duidelijk.
4. Eén betekenis, één component/assetregister; geen alternatieve pagina-specifieke interpretaties.
5. Ondersteun light/dark mode, vijf talen, lange vertalingen, 200% tekst en schermbreedte 320px.
6. Figma definieert het goedgekeurde visuele gedrag; GitHub behoudt routes, data, machtigingen en opslag.
7. Animatie is optioneel: informatie en gebruik blijven volledig beschikbaar zonder beweging.

## 3. Figma-structuur (aanbevolen, nog niet aangemaakt)

- **00 Foundations**: semantische `--vs-*`-kleurvariabelen, tekststijlen, spacing, schaduwen, rondingen, iconregels, light/dark.
- **01 Components**: primaire/secundaire knoppen, navigatie, badges, overlays, dialogs, ContentCard, CardPicker, voortgang, MediaArtwork, feedback, illustratie- en mascotteslot.
- **02 Shell**: Normal, Focus, Immersive; Celebration is overlay/flow, geen eigen navigatiemodus.
- **03 Vandaag**: actiegericht dashboard, lege/laden/fout/voltooid-staten.
- **04 Leren**: cursuskaarten, actieve cursus, leespaden, les/quiz, feedback en voortgang.
- **05 Spelen**: gamekaarten, actieve beurten, lobby, bord/immersive, uitslagen.
- **06 Sociaal & Profiel**: Vrienden, competitie, meldingen, avatar/gids, instellingen.
- **07 Versado Dorp**: portrait canvas, bediening, objectselectie en feedback (apart te toetsen).
- **08 Motion/Rive Lab**: storyboard, states, fallbacks, interacties, prestatietesten.
- **09 QA**: schermmatrix, toegankelijkheids- en ontwerpverschillen.

Begin met **bestaande schermen reconstrueren**; maak niet meteen een nieuwe huisstijl. Beschrijf wijzigingen expliciet als concept (niet geïmplementeerd).

## 4. Shell en mobiele acceptatiecriteria

- Houd vaste header/terugbalk en bottomnav volgens `ShellMetrics.tsx` en `docs/LAYOUT.md`.
- Geen nieuwe hardcoded offsets, eigen scrollmodel of z-index-laag buiten bestaande schaal.
- ContentSwitcher blijft in de headerrij; de keuze loopt via de `/content` Focus-route.
- Respecteer de safe-area-variabelen `--vs-safe-area-*` en het mobiele toetsenbord.
- Maak toetsenbordfocus, focusherstel, Escape, tastbare touch targets en lange labels zichtbaar in Figma.
- Toets minimaal 320px, compacte en grote portraittelefoons, tablet, desktop, 200% tekst, light/dark en lange vertalingen.
- Leespaden, quiz-actiegebieden en spelborden gebruiken bestaande Focus/Immersive-contexten.

## 5. Kaarten Vandaag/Leren/Spelen

- Gebruik `ContentCard`, `StatusChip`, `CardProgress`, `MediaArtwork`, `CardPicker` als bestaande gedeelde standaarden.
- Leren/Spelen: géén drag handle; verplaatsen/verbergen via het driepuntjesmenu volgens `docs/KAARTEN.md`.
- Afbeelding/titel openen; menubediening wijzigt positie/zichtbaarheid maar nooit geschiedenis of voortgang.
- Visualiseer actieve, inactieve, verborgen, lege, fout- en laadstatus zonder nieuwe datalogica.

## 6. Characters, naamgeving en auteurschap

- Het bestaande technische register benoemt **Novi, Varo, Vera**; elk heeft tien semantische states.
- De in de productbrainstorm gekozen familienaam **Tynoben** is een overkoepelende merk-/wereldnaam, **nog niet gevalideerd als canon in de repository**. Voorstel: behouden als narratieve familieaanduiding zonder technische slugs en opgeslagen identiteiten te hernoemen; formele goedkeuring volgt afzonderlijk.
- De officiële personagecanon, referentiebeelden en goedgekeurde `public/mascots/static/`-assets leiden.
- Geen nieuwe, door AI bedachte gedaantes, proporties of kleurinterpretaties als vervanging.
- Rive-rigs moeten de vaste contouren, vachtpatronen, kleuren en identiteit behouden. Technische onderdelen volgen de partslijst in `docs/VERSADO-CHARACTER-CANON.md`.

## 7. Motionprincipes en Rive-architectuur

De bestaande keten blijft: `feature → PersonalMascot/MascotSlot(character, state) → centrale renderer → Rive of static WebP`.
De renderer wisselt centraal; features kennen geen Rive-specifieke implementatie.

States: `idle`, `greeting`, `playing`, `success`, `encourage`, `thinking`, `discovery`, `reading`, `celebrate`, `sleep`.
- `success` = klein positief moment; `celebrate` = zeldzame grote mijlpaal.
- Foutfeedback blijft steunend, nooit bestraffend of afkeurend.
- Animatie alleen bij zichtbaarheid en relevante context; geen voortdurende drukte naast de leestekst.
- `prefers-reduced-motion`, load/error, browsersupport en performance: behoud statische WebP-fallback.
- Reserveer vaste afmetingen zodat de layout niet verspringt.
- Vermijd onnodige downloads, langdurige loops, zware meshes/effects en concurrerende full-screen vieringen.
- Nieuwe beloningsanimaties respecteren `celebrationGate`: primaire spel-/lesuitslag gaat voor.

### Eerste proef (geen productie-uitrol)

Bouw **één geïsoleerde prototype-flow** met een goedgekeurde Novi-rig:
1. `idle`: subtiel ademhalen/knipperen;
2. `greeting` of `playing`: reageren op aanraking;
3. `success`: korte vrolijke reactie, zonder automatische punten of datawijziging.
Gebruik hetzelfde WebP fallback als de bestaande renderer, en toon de werking met en zonder reduced motion.
**Pas starten nadat een bronrig/asset door eigenaar is goedgekeurd.**

## 8. Overdracht Figma → engineering

Voor elke goedgekeurde wijziging moet beschikbaar zijn:
- Figma-frame/componentnaam plus variant en screenbreedte;
- semantische tokens versus uitzonderingen;
- interactie-/focus-/toetsenbordgedrag;
- laad-/fout-/leeg-/success-toestanden;
- relevante responsive en reduced-motion-uitvoering;
- asset-ID, bron, exportformaten, registermapping en rechten;
- GitHub-issue/PR met tests, screenshots en regressiecheck.

Geen Figma-export vervangt gedeelde React-componenten, i18n, bestaande API's of autorisatielogica.

## 9. Fasering en gates

**Fase A — audit en baseline.** Reconstrueer de huidige schermen en componentinventaris uit code; maak 320px/portrait/tablet/desktop screenshots. Vergelijk ontwerpdocs met actuele componenten. Uitkomst: gecontroleerde baseline.

**Fase B — Figma Foundation.** Maak tokens, componentbibliotheek en de Normal/Focus/Immersive shellframes. Review op overeenkomst met bestaande code.

**Fase C — Vandaag, Leren, Spelen.** Maak klikbare flows inclusief states en lange tekst. Laat eigenaar eerst visueel en functioneel goedkeuren.

**Fase D — Motion Lab.** Storyboard + Novi proef volgens §7. Test op iOS Safari/WKWebView, Android WebView, desktop en reduced-motion. Controleer op performance, batterij, geheugen en accessibility; leg metingen vast.

**Fase E — gecontroleerde productintegratie.** Kleine geïsoleerde PR met statische terugval, unit-/browsertests, visuele verschillen en onafhankelijk uitgevoerde audit. Pas daarna eventuele uitrol.

## 10. Openstaande auditpunten vóór uitvoering

- De documenten beschrijven de architectuur, maar deze documentatie-audit is **geen bewezen pixel-/device-audit**. Screenshots en echte apparaatcontroles blijven nodig.
- Controleer of `docs/KAARTEN.md` na PR #164 volledig is opgenomen op `main` en of gedrag en CI op laatste SHA overeenkomen.
- Verifieer of alle drie mascottes hun afgesproken tien goedgekeurde staten hebben en of Figma-bronbestanden nog ontbreken.
- Toets licensing/assetrechten en Rive runtime-keuze voor native distributie voordat dependencies worden toegevoegd.
- Beslis formeel over de familieaanduiding **Tynoben**, zonder huidige persoons-slugs te wijzigen.
- Verifieer of de in `docs/VERSADO-DESIGN.md` genoemde herontwerpfases inmiddels verder zijn dan de omschrijving; de status kan achterlopen op code.

## 11. Reviewcriteria voor deze PR

Alleen een ontwerpdocument. Geen nieuwe packages, geen code, geen database-/authwijzigingen, geen assets, geen CI-claim en geen deployment. De eigenaar bepaalt welke fase hierna wordt gestart. ChatGPT doet afzonderlijk de onafhankelijke code- en ontwerp-audit; implementerende agents keuren niet hun eigen wijzigingen definitief goed.
