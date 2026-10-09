# Versado — centrale personagebibliotheek

Status: visuele voorbereiding, assets en documentatie. Geen applicatiecode, database, instellingen of Mysterie-manifests gewijzigd. Branch `assets/character-avatar-system`; de pull request blijft ongemerged.

## 1. Inventaris en resultaat

Bij aanvang: 63 uitgewerkte scripture-identiteiten, 7 oude placeholder-ID’s, 64 referentiebladen (inclusief één extra leeftijdsblad), expliciete leeftijdsvarianten en bestaande Mysterie-uitsneden. Geen losse transparante vierkante bustes/avatarportretten in deze scripture-bibliotheek; portretstudies waren onderdeel van de referentiebladen. Alle bestaande masters en sheets zijn daadwerkelijk bekeken. De 63 definitieve identiteiten zijn hergebruikt.

Nu: 73 unieke uitgewerkte identiteiten, plus de behouden alias `brother-jared`. 73 specifieke portretbronnen met detail-, buste- en avatar-export. Tien aanvullende full-body-masters en tien referentiebladen: vier tekstmatig aantoonbare vrouwen en zes al bestaande placeholder-personages. Acht losse accessoirelagen. Alle nieuwe productiebeelden hebben echte alpha; character sheets hebben bewust een studioachtergrond en zijn alleen referentie.

Het bestaande register `docs/scripture/character-registry.json` is uitgebreid met beschrijvende `uiLibrary`-velden. Het is de centrale identiteitencanon, geen nieuw runtime-manifest. Bestaande master-, variant- en referentievelden van de 63 uitgewerkte personages zijn behouden. De 216 verhaalillustraties worden niet aangepast.

## 2. Bronnen, identiteit en onderscheid

De referentiebeelden gaan vóór imperfecte beschrijvende tekst. Gezicht, artistieke leeftijd, huid, haar, baard, kleding en proporties blijven gelijk. Uiterlijk, leeftijd, kleding en kleuren zijn kunstcanon en geen vaststelling van historisch uiterlijk. Een buste is een nieuw transparant exporteerbaar portret van dezelfde identiteit, geen nieuwe persoon. Eén bron levert de compacte en grote buste én de specifieke avatar; geen duplicaatbestanden met andere namen voor exact dezelfde afbeelding.

Bij naam genoemd, naamloos maar tekstmatig aantoonbaar, representatieve rol en goddelijke/introductieve voorstelling zijn afzonderlijk gemarkeerd. De drie nieuw ontworpen naamloze vrouwen krijgen uitsluitend beschrijvende namen. De broer van Jared is al uitgewerkt onder `brother-of-jared`; `brother-jared` verwijst voortaan descriptief naar die identiteit en krijgt geen nieuw ontwerp.

De bronnen voor de vier aanvullingen:

- **Abish** — Lamanitische vrouw in dienst van Lamoni’s vrouw; brengt de mensen bijeen en helpt de koningin opstaan. [Alma 19:16–17, 29](https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/19?lang=eng).

- **Vrouw van koning Lamoni** — Naamloze koningin; spreekt met Ammon en deelt het getuigenis van haar man. [Alma 19:2–11, 29–30](https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/19?lang=eng).

- **Vrouw van Ismaël** — Naamloze vrouw van Ismaël; reist met haar gezin en Lehi’s familie. [1 Nephi 7:6](https://www.churchofjesuschrist.org/study/scriptures/bofm/1-ne/7?lang=eng).

- **Vrouw van Lamoni’s vader** — Naamloze koningin in het verhaal waarin Aäron Lamoni’s vader onderwijst. [Alma 22:19–23](https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/22?lang=eng).

De zes voltooide placeholders zijn Abinadi (Mosiah 11–17), Ether (Ether 12–15), Helam (Mosiah 18:12–14), Zeezrom (Alma 11 en 15), Coriantumr en Shiz (Ether 13–15). Hun bronlinks staan bij de individuele registratie. Andere personen in de veel grotere Hulpmiddelen-database krijgen geen willekeurig portret: deze levering dekt de bestaande beeldcanon en de tien gecontroleerde aanvullingen, niet automatisch elk database-record.

## 3. Bustes, avatars, volledig lichaam en Mysterie

Alle portretten zijn vierkant: 1024×1024 detail/grote buste, 512×512 compacte buste en 256×256 mobiele avatar. De oorspronkelijke PNG-bron is doorgaans 1254×1254 en wordt bewaard. De 256-export is ook bruikbaar voor 32/48/96 CSS-pixels, inclusief schermen met een hogere pixeldichtheid; detail gebruikt 1024. Geen permanente achtergrondcirkel, kader of accessoire in het karakterbestand.

De losse portretbron toont hoofd, geklede schouders en bovenborst. De grotere uitsnede behoudt de identiteit; de app kan later een ronde maskering toepassen. Afgeronde schouders zijn bij een avatar passend; full-body en voeten blijven intact in het afzonderlijke lichaamsbestand.

Er zijn **negen al gebruikte Mysterie-personages**: lehi, sariah, laman, lemuel, sam, nephi, laban, zoram en ismael. Hun bestaande PNG-paden, afmetingen en voetenankers blijven gezaghebbend. Alle overige paren zijn visueel voorbereid voor eventueel later gebruik; ze zijn daarmee nog niet geregistreerd als speelbaar. Voor een nieuw Mysterie moet Claude de bijbehorende geometrie expliciet bepalen en testen.

Aanraakbare selectiebuste kan later vervangen worden door `character.asset` zodra slepen begint. Bord en sleepvoorbeeld moeten hetzelfde huidige lichaam blijven gebruiken. `src/lib/mysteries/logic.ts` berekent voetpositie met `geometry.footAnchorPixels`, `imageWidth/imageHeight`, `visibleHeightPixels` en `footAnchorInCell`. De portretuitsnede mag die waarden nooit bepalen. Geen lichaamsassets overschreven en geen coördinaten gewijzigd.

## 4. Beschikbaarheid en man/vrouwverdeling

De kunstbibliotheek telt 6 vrouwelijke en 67 als mannelijk uitgebeelde identiteiten. Dit is geen demografische claim over naamloze, representatieve of goddelijke figuren. De aanbevolen menselijke/Boek van Mormon-avatarselectie bevat 66 opties, waarvan 6 vrouwen. De volledige historische verzameling is dus niet 50/50; de **eerste selectie en eerste ontgrendelingen zijn dat wel**.

| Fase | Voorstel | Verdeling | Bestaande activiteit als mogelijke aansluiting |
|---|---|---|---|
| A — direct gratis | Sariah, vrouw van Nephi, Abish, vrouw van Lamoni; Nephi, Lehi, Sam, Ammon (zendeling) | 4 vrouwen / 4 mannen | Geen voorwaarde |
| B — eenvoudig | Vrouw van Ismaël, vrouw van Lamoni’s vader; Alma de jongere, koning Benjamin | 2 vrouwen / 2 mannen; cumulatief 6/6 | Eén vroeg pakket, bijvoorbeeld bestaande `first-chapter` of `kids-first-story`; vrouwen tegelijk of eerst, niet na alle mannen |
| C — later | Overige afzonderlijk geïdentificeerde menselijke verhaalpersonages | Alle zes vrouwen zijn al beschikbaar in A/B | Bestaande `chapters-5`, `chapters-10`, `kids-10-stories`, `intro-all-lessons`, `streak-7` of `streak-30`; uitsluitend voorstellen |
| D — bijzonder | Optionele respectvolle selectie Jezus Christus; bijzondere decoraties/kaders | Geen vrouwelijke basisavatar achter deze fase | Bestaande hogere prestaties, bestaande divisies of een reeds geregistreerde bijzondere activiteit |

Dit is uitsluitend een visueel beschikbaarheidsvoorstel. Claude bepaalt later de koppeling aan bestaande verdiende prestaties. `first-chapter` en `chapters-*` tellen in de huidige code afgeronde oefeningen/exercise sets; ze betekenen niet automatisch dat iemand een hoofdstuk alleen heeft gelezen. Geen nieuwe spelregel, koopmechanisme, valuta of winkel ontworpen.

Hemelse Vader, Joseph Smith, de engel van Alma, Lehi’s droomgids en drie generieke rollen blijven beschikbaar als illustratie/buste voor passende verhaalcontext, maar zijn niet voorgesteld als gewone Boek van Mormon-gebruikersavatar. De naamloze Zoramitische aanbidder is wel een tekstmatig herkenbare verhaalrol; toon expliciet de beschrijvende naam en claim geen vaste individuele historische identiteit.

## 5. Individuele inventaris

Per item: naam/ID, rol, geslacht/identiteit, hoofdstukken, exacte buste/avatar/body/sheet-paden, varianten, toepassingen, fase en beperkingen. Alle paden hieronder zijn publieke URL’s; voeg `public` toe voor het repositorybestand. `fullBody` is dezelfde bestaande voorkeursuitsnede, geen gekopieerd lichaam. Bron- en bestandschecksums staan in het centrale register.

### Aäron — `aaron`

**Rol:** Zoon van Mosiah; zendeling die Lamoni’s vader onderwijst. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 18, 19, 23, 25, 30.

- Compacte buste: `/scripture/characters/aaron/portraits/aaron-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/aaron/portraits/aaron-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/aaron/portraits/aaron-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/aaron/master/aaron-master-v1.webp`
- Referentie: `/scripture/characters/aaron/references/aaron-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `aaron` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 18](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-18-alma-the-younger-repents?lang=eng), [hoofdstuk 19](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-19-the-sons-of-mosiah-become-missionaries?lang=eng), [hoofdstuk 23](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-23-ammon-a-great-servant?lang=eng), [hoofdstuk 25](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-25-aaron-teaches-king-lamonis-father?lang=eng), [hoofdstuk 30](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-30-alma-counsels-his-sons?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Abinadi — `abinadi`

**Rol:** Profeet die voor koning Noach getuigt. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 14.

- Compacte buste: `/scripture/characters/abinadi/portraits/abinadi-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/abinadi/portraits/abinadi-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/abinadi/portraits/abinadi-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/abinadi/master/abinadi-master-v1.webp`
- Referentie: `/scripture/characters/abinadi/references/abinadi-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `abinadi` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: nieuwe full-body + sheet + portret, bestaande placeholder voltooid.
- Schriftbron: [Mosiah11–17](https://www.churchofjesuschrist.org/study/scriptures/bofm/mosiah/11?lang=eng).
- Verhaalbron: [hoofdstuk 14](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-14-abinadi-and-king-noah?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Alma de oudere — `alma-elder`

**Rol:** Alma de oudere; leert het volk en doopt bij de wateren van Mormon. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 15, 17, 18, 30.

- Compacte buste: `/scripture/characters/alma-elder/portraits/alma-elder-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/alma-elder/portraits/alma-elder-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/alma-elder/portraits/alma-elder-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/alma-elder/master/alma-elder-master-v1.webp`
- Referentie: `/scripture/characters/alma-elder/references/alma-elder-character-sheet-v1.webp`
- Bestaande variant: {"id": "alma-elder-older-master-v1", "master": {"url": "/scripture/characters/alma-elder/master/alma-elder-older-master-v1.webp", "sha256": "b7ab90a57b15d2d7b74f2b7ae776924222499ba88869fd7b43807e9375c9200e", "sourcePngSha256": "f743ae200a40e9d2aab91c901d1a6480c17edf9baf71813187da84ca890d2dd7", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 272460}, "sha256": "f743ae200a40e9d2aab91c901d1a6480c17edf9baf71813187da84ca890d2dd7", "status": "visual-pass", "preservesIdentity": "alma-elder"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Beperking: Person seed slug alma has conflicting description and parent linkage. Confirm the live record before mapping; do not repair the database in this artwork PR.
- Verhaalbron: [hoofdstuk 15](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-15-alma-teaches-and-baptizes?lang=eng), [hoofdstuk 17](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-17-alma-and-his-people-escape?lang=eng), [hoofdstuk 18](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-18-alma-the-younger-repents?lang=eng), [hoofdstuk 30](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-30-alma-counsels-his-sons?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Alma de jonge — `alma-younger`

**Rol:** Zoon van Alma; komt tot bekering en onderwijst het volk. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 18, 19, 20, 22, 28, 29, 30.

- Compacte buste: `/scripture/characters/alma-younger/portraits/alma-younger-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/alma-younger/portraits/alma-younger-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/alma-younger/portraits/alma-younger-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/alma-younger/master/alma-younger-master-v1.webp`
- Referentie: `/scripture/characters/alma-younger/references/alma-younger-character-sheet-v1.webp`
- Bestaande variant: {"id": "alma-younger-older-master-v1", "master": {"url": "/scripture/characters/alma-younger/master/alma-younger-older-master-v1.webp", "sha256": "c4de53e669bbe9d3b6584a396e97b8d33e2bf283aed41a85ba7b4c5bcb1f94a5", "sourcePngSha256": "cd2e8676fcf6808507857321913e5d077dad07a2a440bf7c3abe1b23adad7a61", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 277782}, "sha256": "cd2e8676fcf6808507857321913e5d077dad07a2a440bf7c3abe1b23adad7a61", "status": "visual-pass", "preservesIdentity": "alma-younger"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `B`.
- Hulpmiddelen-slug: `alma-de-jongere` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 18](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-18-alma-the-younger-repents?lang=eng), [hoofdstuk 19](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-19-the-sons-of-mosiah-become-missionaries?lang=eng), [hoofdstuk 20](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-20-alma-and-nehor?lang=eng), [hoofdstuk 22](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-22-almas-mission-to-ammonihah?lang=eng), [hoofdstuk 28](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-28-the-zoramites-and-the-rameumptom?lang=eng), [hoofdstuk 29](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-29-alma-teaches-about-faith-and-the-word-of-god?lang=nld), [hoofdstuk 30](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-30-alma-counsels-his-sons?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Amalickiah — `amalickiah`

**Rol:** Amalickiah; tegenstander van Moroni en koning van de Lamanieten. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 32.

- Compacte buste: `/scripture/characters/amalickiah/portraits/amalickiah-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/amalickiah/portraits/amalickiah-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/amalickiah/portraits/amalickiah-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/amalickiah/master/amalickiah-master-v1.webp`
- Referentie: `/scripture/characters/amalickiah/references/amalickiah-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `amalickiah` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 32](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-32-captain-moroni-and-the-title-of-liberty?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Amlici — `amlici`

**Rol:** Amlici; wil koning worden en leidt een opstand. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 21.

- Compacte buste: `/scripture/characters/amlici/portraits/amlici-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/amlici/portraits/amlici-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/amlici/portraits/amlici-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/amlici/master/amlici-master-v1.webp`
- Referentie: `/scripture/characters/amlici/references/amlici-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `amlici` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 21](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-21-the-amlicites?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Ammaron — `ammaron`

**Rol:** Bewaarder van de kronieken die Mormon over de platen vertelt. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 49.

- Compacte buste: `/scripture/characters/ammaron/portraits/ammaron-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/ammaron/portraits/ammaron-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/ammaron/portraits/ammaron-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/ammaron/master/ammaron-master-v1.webp`
- Referentie: `/scripture/characters/ammaron/references/ammaron-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `ammaron` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 49](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-49-mormon-and-his-teachings?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Ammon, leider van de expeditie — `ammon-expedition`

**Rol:** Ammon die met een groep het volk van Limhi vindt; andere persoon dan de zoon van Mosiah. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 16.

- Compacte buste: `/scripture/characters/ammon-expedition/portraits/ammon-expedition-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/ammon-expedition/portraits/ammon-expedition-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/ammon-expedition/portraits/ammon-expedition-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/ammon-expedition/master/ammon-expedition-master-v1.webp`
- Referentie: `/scripture/characters/ammon-expedition/references/ammon-expedition-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `ammon-2` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 16](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-16-king-limhi-and-his-people-escape?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Ammon, zoon van Mosiah — `ammon-missionary`

**Rol:** Zoon van Mosiah; dient koning Lamoni en onderwijst hem. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 18, 19, 23, 24, 26, 28, 30.

- Compacte buste: `/scripture/characters/ammon-missionary/portraits/ammon-missionary-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/ammon-missionary/portraits/ammon-missionary-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/ammon-missionary/portraits/ammon-missionary-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/ammon-missionary/master/ammon-missionary-master-v1.webp`
- Referentie: `/scripture/characters/ammon-missionary/references/ammon-missionary-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `A`.
- Hulpmiddelen-slug: `ammon` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 18](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-18-alma-the-younger-repents?lang=eng), [hoofdstuk 19](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-19-the-sons-of-mosiah-become-missionaries?lang=eng), [hoofdstuk 23](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-23-ammon-a-great-servant?lang=eng), [hoofdstuk 24](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-24-ammon-meets-king-lamonis-father?lang=eng), [hoofdstuk 26](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-26-the-people-of-ammon?lang=eng), [hoofdstuk 28](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-28-the-zoramites-and-the-rameumptom?lang=eng), [hoofdstuk 30](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-30-alma-counsels-his-sons?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Amulek — `amulek`

**Rol:** Onderwijst samen met Alma in Ammonihah. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 22, 28.

- Compacte buste: `/scripture/characters/amulek/portraits/amulek-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/amulek/portraits/amulek-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/amulek/portraits/amulek-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/amulek/master/amulek-master-v1.webp`
- Referentie: `/scripture/characters/amulek/references/amulek-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `amulek` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 22](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-22-almas-mission-to-ammonihah?lang=eng), [hoofdstuk 28](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-28-the-zoramites-and-the-rameumptom?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### broer van Jared — `brother-jared`

Behouden legacy-alias van `brother-of-jared`. Gebruik diens bestaande assets en identiteit; geen apart avatar-keuze-item.

### Aanvoerder Moroni — `captain-moroni`

**Rol:** Opperbevelhebber Moroni; voert het vrijheidsvaandel. Andere persoon dan Mormons zoon. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 31, 32, 35.

- Compacte buste: `/scripture/characters/captain-moroni/portraits/captain-moroni-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/captain-moroni/portraits/captain-moroni-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/captain-moroni/portraits/captain-moroni-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/captain-moroni/master/captain-moroni-master-v1.webp`
- Referentie: `/scripture/characters/captain-moroni/references/captain-moroni-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `moroni-bevelhebber` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 31](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-31-captain-moroni-defeats-zerahemnah?lang=eng), [hoofdstuk 32](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-32-captain-moroni-and-the-title-of-liberty?lang=eng), [hoofdstuk 35](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-35-captain-moroni-and-pahoran?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Corianton — `corianton`

**Rol:** Zoon van Alma; ontvangt raad van zijn vader. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 30.

- Compacte buste: `/scripture/characters/corianton/portraits/corianton-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/corianton/portraits/corianton-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/corianton/portraits/corianton-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/corianton/master/corianton-master-v1.webp`
- Referentie: `/scripture/characters/corianton/references/corianton-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `corianton` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 30](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-30-alma-counsels-his-sons?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Coriantumr — `coriantumr`

**Rol:** Jareditische koning in het slot van Ether. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 52.

- Compacte buste: `/scripture/characters/coriantumr/portraits/coriantumr-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/coriantumr/portraits/coriantumr-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/coriantumr/portraits/coriantumr-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/coriantumr/master/coriantumr-master-v1.webp`
- Referentie: `/scripture/characters/coriantumr/references/coriantumr-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `coriantumr-2` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: nieuwe full-body + sheet + portret, bestaande placeholder voltooid.
- Schriftbron: [Ether13–15](https://www.churchofjesuschrist.org/study/scriptures/bofm/ether/15?lang=eng).
- Verhaalbron: [hoofdstuk 52](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-52-the-destruction-of-the-jaredites?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Enos — `enos`

**Rol:** Enos; bidt om vergeving en voor zijn volk. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 11.

- Compacte buste: `/scripture/characters/enos/portraits/enos-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/enos/portraits/enos-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/enos/portraits/enos-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/enos/master/enos-master-v1.webp`
- Referentie: `/scripture/characters/enos/references/enos-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 11](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-11-enos?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Ether — `ether`

**Rol:** Jareditische profeet en schrijver. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 52.

- Compacte buste: `/scripture/characters/ether/portraits/ether-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/ether/portraits/ether-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/ether/portraits/ether-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/ether/master/ether-master-v1.webp`
- Referentie: `/scripture/characters/ether/references/ether-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `ether` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: nieuwe full-body + sheet + portret, bestaande placeholder voltooid.
- Schriftbron: [Ether12–15](https://www.churchofjesuschrist.org/study/scriptures/bofm/ether/13?lang=eng).
- Verhaalbron: [hoofdstuk 52](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-52-the-destruction-of-the-jaredites?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Gideon — `gideon`

**Rol:** Gideon; verzet zich tegen Noach en helpt het volk van Limhi. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 20.

- Compacte buste: `/scripture/characters/gideon/portraits/gideon-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/gideon/portraits/gideon-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/gideon/portraits/gideon-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/gideon/master/gideon-master-v1.webp`
- Referentie: `/scripture/characters/gideon/references/gideon-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `gideon` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 20](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-20-alma-and-nehor?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Hagoth — `hagoth`

**Rol:** Hagoth; bouwt schepen. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 36.

- Compacte buste: `/scripture/characters/hagoth/portraits/hagoth-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/hagoth/portraits/hagoth-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/hagoth/portraits/hagoth-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/hagoth/master/hagoth-master-v1.webp`
- Referentie: `/scripture/characters/hagoth/references/hagoth-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `hagoth` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 36](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-36-hagoth?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Onze hemelse Vader — `heavenly-father`

**Rol:** Hemelse Vader in het inleidende verhaal over Joseph Smith; geen menselijke Boek van Mormon-avatar. **Geslacht/voorstelling:** mannelijk uitgebeeld; `divine`. Verhaalhoofdstukken: 1, 2.

- Compacte buste: `/scripture/characters/heavenly-father/portraits/heavenly-father-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/heavenly-father/portraits/heavenly-father-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/heavenly-father/portraits/heavenly-father-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/heavenly-father/master/heavenly-father-cutout-v1.webp`
- Referentie: `/scripture/characters/heavenly-father/references/heavenly-father-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: niet voorgesteld als gewone gebruikersavatar; fase `not-proposed`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Beperking: Introductory account, outside the Book of Mormon narrative timeline; not proposed as a Book of Mormon user avatar.
- Verhaalbron: [hoofdstuk 1](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-1-how-we-got-the-book-of-mormon?lang=nld), [hoofdstuk 2](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-2-lehi-warns-the-people?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Helam — `helam`

**Rol:** Wordt door Alma gedoopt in de wateren van Mormon. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 15.

- Compacte buste: `/scripture/characters/helam/portraits/helam-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/helam/portraits/helam-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/helam/portraits/helam-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/helam/master/helam-master-v1.webp`
- Referentie: `/scripture/characters/helam/references/helam-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `helam` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: nieuwe full-body + sheet + portret, bestaande placeholder voltooid.
- Schriftbron: [Mosiah18:12–14](https://www.churchofjesuschrist.org/study/scriptures/bofm/mosiah/18?lang=eng).
- Verhaalbron: [hoofdstuk 15](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-15-alma-teaches-and-baptizes?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Helaman, zoon van Alma — `helaman-son-alma`

**Rol:** Zoon van Alma; leidt de tweeduizend jonge strijders. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 30, 34.

- Compacte buste: `/scripture/characters/helaman-son-alma/portraits/helaman-son-alma-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/helaman-son-alma/portraits/helaman-son-alma-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/helaman-son-alma/portraits/helaman-son-alma-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/helaman-son-alma/master/helaman-son-alma-master-v1.webp`
- Referentie: `/scripture/characters/helaman-son-alma/references/helaman-son-alma-character-sheet-v1.webp`
- Bestaande variant: {"id": "helaman-son-alma-older-master-v1", "master": {"url": "/scripture/characters/helaman-son-alma/master/helaman-son-alma-older-master-v1.webp", "sha256": "5b7b529ca14287675d57a14b9488e68131b6d29acf5789307f95378491b965f5", "sourcePngSha256": "d025f4599fc8ff8308d66f2aec33de7576ae9530dbc1dfe89665e26650e949be", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 258828}, "sha256": "d025f4599fc8ff8308d66f2aec33de7576ae9530dbc1dfe89665e26650e949be", "status": "visual-pass", "preservesIdentity": "helaman-son-alma"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `helaman` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 30](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-30-alma-counsels-his-sons?lang=nld), [hoofdstuk 34](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-34-helaman-and-the-2000-young-warriors?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Helaman, zoon van Helaman — `helaman-son-helaman`

**Rol:** Helaman, zoon van Helaman; vader van Nephi en Lehi. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 37.

- Compacte buste: `/scripture/characters/helaman-son-helaman/portraits/helaman-son-helaman-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/helaman-son-helaman/portraits/helaman-son-helaman-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/helaman-son-helaman/portraits/helaman-son-helaman-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/helaman-son-helaman/master/helaman-son-helaman-master-v1.webp`
- Referentie: `/scripture/characters/helaman-son-helaman/references/helaman-son-helaman-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `helaman-3` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 37](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-37-nephi-and-lehi-in-prison?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Himni — `himni`

**Rol:** Zoon van Mosiah; zendeling. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 18, 19, 23, 25, 30.

- Compacte buste: `/scripture/characters/himni/portraits/himni-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/himni/portraits/himni-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/himni/portraits/himni-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/himni/master/himni-master-v1.webp`
- Referentie: `/scripture/characters/himni/references/himni-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `himni` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 18](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-18-alma-the-younger-repents?lang=eng), [hoofdstuk 19](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-19-the-sons-of-mosiah-become-missionaries?lang=eng), [hoofdstuk 23](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-23-ammon-a-great-servant?lang=eng), [hoofdstuk 25](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-25-aaron-teaches-king-lamonis-father?lang=eng), [hoofdstuk 30](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-30-alma-counsels-his-sons?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Ismaël — `ismael`

**Rol:** Ismaël; reist met zijn familie met Lehi’s gezin mee. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 5.

- Compacte buste: `/scripture/characters/ismael/portraits/ismael-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/ismael/portraits/ismael-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/ismael/portraits/ismael-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/mysterie-003b-onderzoeker/ismael.png`
- Referentie: `/scripture/characters/ismael/references/ismael-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; bestaand speelbaar model, huidige geometrie behouden. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `ishmael` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 5](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-5-traveling-in-the-wilderness?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Jakob, zoon van Lehi — `jacob-son-lehi`

**Rol:** Zoon van Lehi; profeet en schrijver van het boek Jakob. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 10, 11.

- Compacte buste: `/scripture/characters/jacob-son-lehi/portraits/jacob-son-lehi-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/jacob-son-lehi/portraits/jacob-son-lehi-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/jacob-son-lehi/portraits/jacob-son-lehi-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/jacob-son-lehi/master/jacob-master-v1.webp`
- Referentie: `/scripture/characters/jacob-son-lehi/references/jacob-son-lehi-character-sheet-v1.webp`
- Bestaande variant: {"id": "jacob-older-master-v1", "master": {"url": "/scripture/characters/jacob-son-lehi/master/jacob-older-master-v1.webp", "sha256": "f093cfebf6d9dd00fcd9cb2ae84e0420ef11396dd1c9d129b4c168823de0e670", "sourcePngSha256": "8cfb3f0ae69e2356c994d012031f3e8cde95008a077150ef186c8e356145112f", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 316392}, "sha256": "8cfb3f0ae69e2356c994d012031f3e8cde95008a077150ef186c8e356145112f", "status": "visual-pass", "preservesIdentity": "jacob-son-lehi"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `jakob` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 10](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-10-jacob-and-sherem?lang=eng), [hoofdstuk 11](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-11-enos?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Jared — `jared`

**Rol:** Jared; reist met zijn broer, familie en vrienden. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 50.

- Compacte buste: `/scripture/characters/jared/portraits/jared-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/jared/portraits/jared-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/jared/portraits/jared-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/jared/master/jared-master-v1.webp`
- Referentie: `/scripture/characters/jared/references/jared-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `jared-2` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 50](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-50-the-jaredites-leave-babel?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Jezus Christus — `jesus-christ`

**Rol:** Jezus Christus; bezoekt en onderwijst het volk in 3 Nephi. **Geslacht/voorstelling:** mannelijk uitgebeeld; `divine`. Verhaalhoofdstukken: 1, 44, 45, 46, 47.

- Compacte buste: `/scripture/characters/jesus-christ/portraits/jesus-christ-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/jesus-christ/portraits/jesus-christ-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/jesus-christ/portraits/jesus-christ-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/jesus-christ/master/jesus-christ-cutout-v1.webp`
- Referentie: `/scripture/characters/jesus-christ/references/jesus-christ-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `D`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Beperking: Respectful optional special selection; no costume changes. Decorative frames remain separate.
- Verhaalbron: [hoofdstuk 1](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-1-how-we-got-the-book-of-mormon?lang=nld), [hoofdstuk 44](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-44-jesus-christ-blesses-the-children?lang=nld), [hoofdstuk 45](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-45-jesus-christ-teaches-about-the-sacrament-and-prayer?lang=nld), [hoofdstuk 46](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-46-jesus-christ-teaches-and-prays-with-the-nephites?lang=nld), [hoofdstuk 47](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-47-jesus-christ-blesses-his-disciples?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Joseph Smith — `joseph-smith`

**Rol:** Joseph Smith in het inleidende verhaal over de komst van het Boek van Mormon; buiten het tijdvak van de Boek van Mormon-personages. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 1, 53.

- Compacte buste: `/scripture/characters/joseph-smith/portraits/joseph-smith-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/joseph-smith/portraits/joseph-smith-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/joseph-smith/portraits/joseph-smith-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/joseph-smith/master/joseph-smith-cutout-v1.webp`
- Referentie: `/scripture/characters/joseph-smith/references/joseph-smith-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: niet voorgesteld als gewone gebruikersavatar; fase `not-proposed`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Beperking: Introductory account, outside the Book of Mormon narrative timeline; not proposed as a Book of Mormon user avatar.
- Verhaalbron: [hoofdstuk 1](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-1-how-we-got-the-book-of-mormon?lang=nld), [hoofdstuk 53](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-53-moroni-and-his-teachings?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Koning Benjamin — `king-benjamin`

**Rol:** Koning Benjamin; spreekt zijn volk vanaf een toren toe. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 12.

- Compacte buste: `/scripture/characters/king-benjamin/portraits/king-benjamin-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/king-benjamin/portraits/king-benjamin-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/king-benjamin/portraits/king-benjamin-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/king-benjamin/master/king-benjamin-master-v1.webp`
- Referentie: `/scripture/characters/king-benjamin/references/king-benjamin-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `B`.
- Hulpmiddelen-slug: `benjamin` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 12](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-12-king-benjamin?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Koning Limhi — `king-limhi`

**Rol:** Koning Limhi; zoon van Noach, leider van het volk dat bevrijd wordt. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 16.

- Compacte buste: `/scripture/characters/king-limhi/portraits/king-limhi-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/king-limhi/portraits/king-limhi-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/king-limhi/portraits/king-limhi-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/king-limhi/master/king-limhi-master-v1.webp`
- Referentie: `/scripture/characters/king-limhi/references/king-limhi-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `limhi` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 16](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-16-king-limhi-and-his-people-escape?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Koning Noah — `king-noah`

**Rol:** Koning Noach; zoon van Zeniff, koning in het verhaal van Abinadi. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 14.

- Compacte buste: `/scripture/characters/king-noah/portraits/king-noah-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/king-noah/portraits/king-noah-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/king-noah/portraits/king-noah-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/king-noah/master/king-noah-adult-master-v1.webp`
- Referentie: `/scripture/characters/king-noah/references/king-noah-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `noah` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 14](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-14-abinadi-and-king-noah?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Korihor — `korihor`

**Rol:** Korihor; ondervraagt Alma en verzet zich tegen diens leer. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 27.

- Compacte buste: `/scripture/characters/korihor/portraits/korihor-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/korihor/portraits/korihor-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/korihor/portraits/korihor-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/korihor/master/korihor-master-v1.webp`
- Referentie: `/scripture/characters/korihor/references/korihor-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `korihor` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 27](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-27-korihor?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Laban — `laban`

**Rol:** Laban; bewaart de koperen platen in Jeruzalem. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: zie schriftbron.

- Compacte buste: `/scripture/characters/laban/portraits/laban-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/laban/portraits/laban-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/laban/portraits/laban-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/mysterie-002b-onderzoeker/laban.png`
- Referentie: `/scripture/characters/laban/references/laban-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; bestaand speelbaar model, huidige geometrie behouden. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `laban` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron:
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Laman — `laman`

**Rol:** Zoon van Lehi en Sariah; broer van Nephi. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 3, 4, 5, 6, 7, 8, 9.

- Compacte buste: `/scripture/characters/laman/portraits/laman-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/laman/portraits/laman-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/laman/portraits/laman-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/mysterie-001a-ontdekker/laman.png`
- Referentie: `/scripture/characters/laman/references/laman-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; bestaand speelbaar model, huidige geometrie behouden. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `laman` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 3](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-3-lehi-leaves-jerusalem?lang=nld), [hoofdstuk 4](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-4-the-brass-plates?lang=nld), [hoofdstuk 5](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-5-traveling-in-the-wilderness?lang=nld), [hoofdstuk 6](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-6-lehis-dream?lang=nld), [hoofdstuk 7](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-7-building-the-ship?lang=nld), [hoofdstuk 8](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-8-crossing-the-sea?lang=nld), [hoofdstuk 9](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-9-a-new-home-in-the-promised-land?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Lamoni — `lamoni`

**Rol:** Lamanitische koning die door Ammon wordt onderwezen. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 24.

- Compacte buste: `/scripture/characters/lamoni/portraits/lamoni-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/lamoni/portraits/lamoni-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/lamoni/portraits/lamoni-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/lamoni/master/lamoni-master-v1.webp`
- Referentie: `/scripture/characters/lamoni/references/lamoni-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `lamoni` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 24](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-24-ammon-meets-king-lamonis-father?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Lamoni’s vader — `lamoni-father`

**Rol:** Vader van Lamoni; koning die door Aäron wordt onderwezen. **Geslacht/voorstelling:** mannelijk uitgebeeld; `unnamed-text-attested`. Verhaalhoofdstukken: 24, 25.

- Compacte buste: `/scripture/characters/lamoni-father/portraits/lamoni-father-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/lamoni-father/portraits/lamoni-father-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/lamoni-father/portraits/lamoni-father-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/lamoni-father/master/lamoni-father-master-v1.webp`
- Referentie: `/scripture/characters/lamoni-father/references/lamoni-father-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `koning-der-lamanieten-2` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 24](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-24-ammon-meets-king-lamonis-father?lang=eng), [hoofdstuk 25](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-25-aaron-teaches-king-lamonis-father?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Lehi — `lehi`

**Rol:** Lehi; vader van Nephi, leidt zijn gezin uit Jeruzalem. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 2, 3, 4, 5, 6, 8, 9.

- Compacte buste: `/scripture/characters/lehi/portraits/lehi-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/lehi/portraits/lehi-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/lehi/portraits/lehi-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/mysterie-001a-ontdekker/lehi.png`
- Referentie: `/scripture/characters/lehi/references/lehi-character-sheet-v1.webp`
- Bestaande variant: {"id": "lehi-older-master-v1", "master": {"url": "/scripture/characters/lehi/master/lehi-older-master-v1.webp", "sha256": "ade456af9b8d7b0313fa3cb881f0b6b3adb54cfcda1da94d13de7041343a73ec", "sourcePngSha256": "967b99a986053bf1f3d6760ff01b283e87e2e296dfa3e67154bea3c616849b1a", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 285060}, "sha256": "967b99a986053bf1f3d6760ff01b283e87e2e296dfa3e67154bea3c616849b1a", "status": "visual-pass", "preservesIdentity": "lehi"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; bestaand speelbaar model, huidige geometrie behouden. Avatar: voorgesteld; fase `A`.
- Hulpmiddelen-slug: `lehi` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 2](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-2-lehi-warns-the-people?lang=nld), [hoofdstuk 3](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-3-lehi-leaves-jerusalem?lang=nld), [hoofdstuk 4](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-4-the-brass-plates?lang=nld), [hoofdstuk 5](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-5-traveling-in-the-wilderness?lang=nld), [hoofdstuk 6](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-6-lehis-dream?lang=nld), [hoofdstuk 8](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-8-crossing-the-sea?lang=nld), [hoofdstuk 9](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-9-a-new-home-in-the-promised-land?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Lehi, zoon van Helaman — `lehi-son-helaman`

**Rol:** Lehi, zoon van Helaman; onderwijst samen met zijn broer Nephi. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 37.

- Compacte buste: `/scripture/characters/lehi-son-helaman/portraits/lehi-son-helaman-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/lehi-son-helaman/portraits/lehi-son-helaman-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/lehi-son-helaman/portraits/lehi-son-helaman-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/lehi-son-helaman/master/lehi-son-helaman-master-v1.webp`
- Referentie: `/scripture/characters/lehi-son-helaman/references/lehi-son-helaman-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 37](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-37-nephi-and-lehi-in-prison?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Lemuël — `lemuel`

**Rol:** Zoon van Lehi en Sariah; broer van Nephi. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 3, 4, 5, 6, 7, 8, 9.

- Compacte buste: `/scripture/characters/lemuel/portraits/lemuel-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/lemuel/portraits/lemuel-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/lemuel/portraits/lemuel-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/mysterie-001a-ontdekker/lemuel.png`
- Referentie: `/scripture/characters/lemuel/references/lemuel-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; bestaand speelbaar model, huidige geometrie behouden. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `lemuel` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 3](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-3-lehi-leaves-jerusalem?lang=nld), [hoofdstuk 4](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-4-the-brass-plates?lang=nld), [hoofdstuk 5](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-5-traveling-in-the-wilderness?lang=nld), [hoofdstuk 6](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-6-lehis-dream?lang=nld), [hoofdstuk 7](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-7-building-the-ship?lang=nld), [hoofdstuk 8](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-8-crossing-the-sea?lang=nld), [hoofdstuk 9](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-9-a-new-home-in-the-promised-land?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Mormon — `mormon`

**Rol:** Mormon; legerleider en samensteller van de kronieken. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 49.

- Compacte buste: `/scripture/characters/mormon/portraits/mormon-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/mormon/portraits/mormon-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/mormon/portraits/mormon-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/mormon/master/mormon-master-v1.webp`
- Referentie: `/scripture/characters/mormon/references/mormon-character-sheet-v1.webp`
- Referentie: `/scripture/characters/mormon/references/mormon-child-character-sheet-v1.webp`
- Bestaande variant: {"id": "mormon-child-master-v1", "master": {"url": "/scripture/characters/mormon/master/mormon-child-master-v1.webp", "sha256": "f1bbb9807de3083e680c13f20ff03e735ef8b4583301b414155bd03740bf50dd", "sourcePngSha256": "32594f2de3a245e02ddd1defe9ccb696369f9400be7f13242831e0a6d151847f", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 216610}, "sha256": "32594f2de3a245e02ddd1defe9ccb696369f9400be7f13242831e0a6d151847f", "status": "visual-pass", "preservesIdentity": "mormon"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `mormon` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 49](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-49-mormon-and-his-teachings?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Moroni, zoon van Mormon — `moroni-son-mormon`

**Rol:** Zoon van Mormon; voltooit en bewaart de kronieken. Niet opperbevelhebber Moroni. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 53, 54.

- Compacte buste: `/scripture/characters/moroni-son-mormon/portraits/moroni-son-mormon-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/moroni-son-mormon/portraits/moroni-son-mormon-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/moroni-son-mormon/portraits/moroni-son-mormon-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/moroni-son-mormon/master/moroni-son-mormon-master-v1.webp`
- Referentie: `/scripture/characters/moroni-son-mormon/references/moroni-son-mormon-character-sheet-v1.webp`
- Bestaande variant: {"id": "moroni-son-mormon-older-master-v1", "master": {"url": "/scripture/characters/moroni-son-mormon/master/moroni-son-mormon-older-master-v1.webp", "sha256": "773a91764767bc2e0deb22fda27ced7be45a78c8329a8b6e753805384e736a81", "sourcePngSha256": "859300197f41ddbf91bf091ff496d86768552437ff52189297147789d5911b32", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 188186}, "sha256": "859300197f41ddbf91bf091ff496d86768552437ff52189297147789d5911b32", "status": "visual-pass", "preservesIdentity": "moroni-son-mormon"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `moroni` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 53](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-53-moroni-and-his-teachings?lang=eng), [hoofdstuk 54](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-54-the-promise-of-the-book-of-mormon?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Mosiah, zoon van Benjamin — `mosiah-son-benjamin`

**Rol:** Mosiah, zoon van Benjamin; koning en vader van de vier zendelingen. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 12, 19.

- Compacte buste: `/scripture/characters/mosiah-son-benjamin/portraits/mosiah-son-benjamin-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/mosiah-son-benjamin/portraits/mosiah-son-benjamin-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/mosiah-son-benjamin/portraits/mosiah-son-benjamin-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/mosiah-son-benjamin/master/mosiah-son-benjamin-master-v1.webp`
- Referentie: `/scripture/characters/mosiah-son-benjamin/references/mosiah-son-benjamin-character-sheet-v1.webp`
- Bestaande variant: {"id": "mosiah-son-benjamin-older-master-v1", "master": {"url": "/scripture/characters/mosiah-son-benjamin/master/mosiah-son-benjamin-older-master-v1.webp", "sha256": "d825d9f49ba01336b15f6c59b6905903b28fbf69cf67dc9e7a32975009f6822e", "sourcePngSha256": "91ed15257d62cff4988067c9d8c3ab59aa870c357ed50845fd868f169181d527", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 256136}, "sha256": "91ed15257d62cff4988067c9d8c3ab59aa870c357ed50845fd868f169181d527", "status": "visual-pass", "preservesIdentity": "mosiah-son-benjamin"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `mosiah-2` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 12](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-12-king-benjamin?lang=eng), [hoofdstuk 19](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-19-the-sons-of-mosiah-become-missionaries?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Nehor — `nehor`

**Rol:** Nehor; onderwijst een andere leer en doodt Gideon. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 20.

- Compacte buste: `/scripture/characters/nehor/portraits/nehor-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/nehor/portraits/nehor-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/nehor/portraits/nehor-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/nehor/master/nehor-master-v1.webp`
- Referentie: `/scripture/characters/nehor/references/nehor-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `nehor` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 20](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-20-alma-and-nehor?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Nephi — `nephi`

**Rol:** Nephi, zoon van Lehi; schrijver en leider van zijn familie. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 3, 4, 5, 6, 7, 8, 9, 10.

- Compacte buste: `/scripture/characters/nephi/portraits/nephi-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/nephi/portraits/nephi-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/nephi/portraits/nephi-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/mysterie-001c-schriftkenner/nephi.png`
- Referentie: `/scripture/characters/nephi/references/nephi-character-sheet-v1.webp`
- Bestaande variant: {"id": "nephi-older-master-v1", "master": {"url": "/scripture/characters/nephi/master/nephi-older-master-v1.webp", "sha256": "7912e09bfc85fad69ba3dc7a97c1b4447194551980dff15af330850c81d8b696", "sourcePngSha256": "da13cfb2399c6002eef2346e32dbbda592d2cd7d5b6cc857f39067745665918a", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 264120}, "sha256": "da13cfb2399c6002eef2346e32dbbda592d2cd7d5b6cc857f39067745665918a", "status": "visual-pass", "preservesIdentity": "nephi"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; bestaand speelbaar model, huidige geometrie behouden. Avatar: voorgesteld; fase `A`.
- Hulpmiddelen-slug: `nephi` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 3](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-3-lehi-leaves-jerusalem?lang=nld), [hoofdstuk 4](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-4-the-brass-plates?lang=nld), [hoofdstuk 5](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-5-traveling-in-the-wilderness?lang=nld), [hoofdstuk 6](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-6-lehis-dream?lang=nld), [hoofdstuk 7](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-7-building-the-ship?lang=nld), [hoofdstuk 8](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-8-crossing-the-sea?lang=nld), [hoofdstuk 9](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-9-a-new-home-in-the-promised-land?lang=nld), [hoofdstuk 10](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-10-jacob-and-sherem?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Nephi, zoon van Helaman — `nephi-son-helaman`

**Rol:** Nephi, zoon van Helaman; broer van Lehi en profeet. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 37, 38, 39, 41.

- Compacte buste: `/scripture/characters/nephi-son-helaman/portraits/nephi-son-helaman-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/nephi-son-helaman/portraits/nephi-son-helaman-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/nephi-son-helaman/portraits/nephi-son-helaman-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/nephi-son-helaman/master/nephi-son-helaman-master-v1.webp`
- Referentie: `/scripture/characters/nephi-son-helaman/references/nephi-son-helaman-character-sheet-v1.webp`
- Bestaande variant: {"id": "nephi-son-helaman-older-master-v1", "master": {"url": "/scripture/characters/nephi-son-helaman/master/nephi-son-helaman-older-master-v1.webp", "sha256": "b8f7a1a3ba3c86bd4c291d3907983caefafe3ba3fb672c3e227532df4c2a6d97", "sourcePngSha256": "e825aa9c53e43ab66731a86a452ffb4148357bf87f81f1e9f29cf4b05b226532", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 248732}, "sha256": "e825aa9c53e43ab66731a86a452ffb4148357bf87f81f1e9f29cf4b05b226532", "status": "visual-pass", "preservesIdentity": "nephi-son-helaman"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `nephi-2` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 37](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-37-nephi-and-lehi-in-prison?lang=eng), [hoofdstuk 38](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-38-the-murder-of-the-chief-judge?lang=eng), [hoofdstuk 39](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-39-nephi-receives-great-power?lang=nld), [hoofdstuk 41](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-41-the-signs-of-christs-birth?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Nephi, zoon van Nephi — `nephi-son-nephi`

**Rol:** Nephi, zoon van Nephi; profeet in het verhaal van Christus’ geboorte en komst. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 41, 45, 46, 47.

- Compacte buste: `/scripture/characters/nephi-son-nephi/portraits/nephi-son-nephi-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/nephi-son-nephi/portraits/nephi-son-nephi-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/nephi-son-nephi/portraits/nephi-son-nephi-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/nephi-son-nephi/master/nephi-son-nephi-master-v1.webp`
- Referentie: `/scripture/characters/nephi-son-nephi/references/nephi-son-nephi-character-sheet-v1.webp`
- Bestaande variant: {"id": "nephi-son-nephi-older-master-v1", "master": {"url": "/scripture/characters/nephi-son-nephi/master/nephi-son-nephi-older-master-v1.webp", "sha256": "a9f74a4da48c5eab517abb7eeb85bcb1e696328f54c838cad11bbd14c61a4e26", "sourcePngSha256": "6995f8a6d432da1fd2c7975d10e76c10338d44a6037daf3b8403757c209022f3", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 229518}, "sha256": "6995f8a6d432da1fd2c7975d10e76c10338d44a6037daf3b8403757c209022f3", "status": "visual-pass", "preservesIdentity": "nephi-son-nephi"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `nephi-3` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 41](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-41-the-signs-of-christs-birth?lang=nld), [hoofdstuk 45](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-45-jesus-christ-teaches-about-the-sacrament-and-prayer?lang=nld), [hoofdstuk 46](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-46-jesus-christ-teaches-and-prays-with-the-nephites?lang=nld), [hoofdstuk 47](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-47-jesus-christ-blesses-his-disciples?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Omner — `omner`

**Rol:** Zoon van Mosiah; zendeling. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 18, 19, 23, 25, 30.

- Compacte buste: `/scripture/characters/omner/portraits/omner-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/omner/portraits/omner-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/omner/portraits/omner-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/omner/master/omner-master-v1.webp`
- Referentie: `/scripture/characters/omner/references/omner-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `omner` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 18](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-18-alma-the-younger-repents?lang=eng), [hoofdstuk 19](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-19-the-sons-of-mosiah-become-missionaries?lang=eng), [hoofdstuk 23](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-23-ammon-a-great-servant?lang=eng), [hoofdstuk 25](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-25-aaron-teaches-king-lamonis-father?lang=eng), [hoofdstuk 30](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-30-alma-counsels-his-sons?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Pahoran — `pahoran`

**Rol:** Pahoran; opperrechter met wie Moroni correspondeert. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 33.

- Compacte buste: `/scripture/characters/pahoran/portraits/pahoran-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/pahoran/portraits/pahoran-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/pahoran/portraits/pahoran-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/pahoran/master/pahoran-master-v1.webp`
- Referentie: `/scripture/characters/pahoran/references/pahoran-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `pahoran-1` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 33](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-33-king-men-versus-freemen?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Sam — `sam`

**Rol:** Zoon van Lehi en Sariah; broer van Nephi. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 3, 4, 5, 6, 9.

- Compacte buste: `/scripture/characters/sam/portraits/sam-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/sam/portraits/sam-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/sam/portraits/sam-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/mysterie-001b-onderzoeker/sam.png`
- Referentie: `/scripture/characters/sam/references/sam-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; bestaand speelbaar model, huidige geometrie behouden. Avatar: voorgesteld; fase `A`.
- Hulpmiddelen-slug: `sam` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 3](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-3-lehi-leaves-jerusalem?lang=nld), [hoofdstuk 4](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-4-the-brass-plates?lang=nld), [hoofdstuk 5](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-5-traveling-in-the-wilderness?lang=nld), [hoofdstuk 6](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-6-lehis-dream?lang=nld), [hoofdstuk 9](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-9-a-new-home-in-the-promised-land?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Samuël de Lamaniet — `samuel-lamanite`

**Rol:** Samuel de Lamaniet; profeteert vanaf de stadsmuur. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 40.

- Compacte buste: `/scripture/characters/samuel-lamanite/portraits/samuel-lamanite-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/samuel-lamanite/portraits/samuel-lamanite-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/samuel-lamanite/portraits/samuel-lamanite-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/samuel-lamanite/master/samuel-lamanite-master-v1.webp`
- Referentie: `/scripture/characters/samuel-lamanite/references/samuel-lamanite-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `samuel-de-lamaniet` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 40](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-40-samuel-the-lamanite-tells-about-jesus-christ?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Sariah — `sariah`

**Rol:** Sariah; vrouw van Lehi en moeder in zijn gezin. **Geslacht/voorstelling:** vrouw; `named`. Verhaalhoofdstukken: 3, 6, 8, 9.

- Compacte buste: `/scripture/characters/sariah/portraits/sariah-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/sariah/portraits/sariah-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/sariah/portraits/sariah-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/mysterie-001a-ontdekker/sariah.png`
- Referentie: `/scripture/characters/sariah/references/sariah-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; bestaand speelbaar model, huidige geometrie behouden. Avatar: voorgesteld; fase `A`.
- Hulpmiddelen-slug: `sariah` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 3](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-3-lehi-leaves-jerusalem?lang=nld), [hoofdstuk 6](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-6-lehis-dream?lang=nld), [hoofdstuk 8](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-8-crossing-the-sea?lang=nld), [hoofdstuk 9](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-9-a-new-home-in-the-promised-land?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Sherem — `sherem`

**Rol:** Sherem; ondervraagt Jakob. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 10.

- Compacte buste: `/scripture/characters/sherem/portraits/sherem-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/sherem/portraits/sherem-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/sherem/portraits/sherem-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/sherem/master/sherem-master-v1.webp`
- Referentie: `/scripture/characters/sherem/references/sherem-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `sherem` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 10](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-10-jacob-and-sherem?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Shiblon — `shiblon`

**Rol:** Zoon van Alma; ontvangt raad en bewaart later de kronieken. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 30.

- Compacte buste: `/scripture/characters/shiblon/portraits/shiblon-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/shiblon/portraits/shiblon-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/shiblon/portraits/shiblon-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/shiblon/master/shiblon-master-v1.webp`
- Referentie: `/scripture/characters/shiblon/references/shiblon-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `shiblon` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 30](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-30-alma-counsels-his-sons?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Shiz — `shiz`

**Rol:** Jareditische legeraanvoerder tegenover Coriantumr. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 52.

- Compacte buste: `/scripture/characters/shiz/portraits/shiz-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/shiz/portraits/shiz-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/shiz/portraits/shiz-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/shiz/master/shiz-master-v1.webp`
- Referentie: `/scripture/characters/shiz/references/shiz-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `shiz` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: nieuwe full-body + sheet + portret, bestaande placeholder voltooid.
- Schriftbron: [Ether14–15](https://www.churchofjesuschrist.org/study/scriptures/bofm/ether/15?lang=eng).
- Verhaalbron: [hoofdstuk 52](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-52-the-destruction-of-the-jaredites?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Zeezrom — `zeezrom`

**Rol:** Ondervraagt Amulek; wordt later door Alma genezen en gedoopt. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 22.

- Compacte buste: `/scripture/characters/zeezrom/portraits/zeezrom-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/zeezrom/portraits/zeezrom-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/zeezrom/portraits/zeezrom-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/zeezrom/master/zeezrom-master-v1.webp`
- Referentie: `/scripture/characters/zeezrom/references/zeezrom-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `zeezrom` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: nieuwe full-body + sheet + portret, bestaande placeholder voltooid.
- Schriftbron: [Alma11;15:3–12](https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/15?lang=eng).
- Verhaalbron: [hoofdstuk 22](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-22-almas-mission-to-ammonihah?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Zeniff — `zeniff`

**Rol:** Zeniff; leidt een groep terug naar het land van hun voorouders; vader van Noach. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 13, 14.

- Compacte buste: `/scripture/characters/zeniff/portraits/zeniff-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/zeniff/portraits/zeniff-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/zeniff/portraits/zeniff-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/zeniff/master/zeniff-older-master-v1.webp`
- Referentie: `/scripture/characters/zeniff/references/zeniff-character-sheet-v1.webp`
- Bestaande variant: {"id": "zeniff-adult-master-v1", "master": {"url": "/scripture/characters/zeniff/master/zeniff-adult-master-v1.webp", "sha256": "bb5b5a2de2694958dae66bcf2041922f79a8ac5871ee0f896eff35a06f14fd88", "sourcePngSha256": "331dbb69352db6f0a215269d80dd594ba647e403fdace983cdf42bd4cab0ed97", "pixels": [1024, 1536], "transparentBackground": true, "bytes": 265302}, "sha256": "331dbb69352db6f0a215269d80dd594ba647e403fdace983cdf42bd4cab0ed97", "status": "visual-pass", "preservesIdentity": "zeniff"}
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `zeniff` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 13](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-13-zeniff?lang=eng), [hoofdstuk 14](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-14-abinadi-and-king-noah?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Zerahemnah — `zerahemnah`

**Rol:** Lamanitische legeraanvoerder tegenover Moroni. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 31.

- Compacte buste: `/scripture/characters/zerahemnah/portraits/zerahemnah-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/zerahemnah/portraits/zerahemnah-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/zerahemnah/portraits/zerahemnah-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/zerahemnah/master/zerahemnah-master-v1.webp`
- Referentie: `/scripture/characters/zerahemnah/references/zerahemnah-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `zerahemnah` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 31](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-31-captain-moroni-defeats-zerahemnah?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Zoram — `zoram`

**Rol:** Zoram; sluit zich aan bij Nephi en zijn familie. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 9.

- Compacte buste: `/scripture/characters/zoram/portraits/zoram-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/zoram/portraits/zoram-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/zoram/portraits/zoram-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/mysterie-002c-schriftkenner/zoram.png`
- Referentie: `/scripture/characters/zoram/references/zoram-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; bestaand speelbaar model, huidige geometrie behouden. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 9](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-9-a-new-home-in-the-promised-land?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### amulon — `amulon`

**Rol:** Priester van Noach; onderdrukt later het volk van Alma. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 17.

- Compacte buste: `/scripture/characters/amulon/portraits/amulon-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/amulon/portraits/amulon-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/amulon/portraits/amulon-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/amulon/master/amulon-master-v1.webp`
- Referentie: `/scripture/characters/amulon/references/amulon-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `amulon` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 17](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-17-alma-and-his-people-escape?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Engel die Alma bezocht, rolcanon — `angel-alma`

**Rol:** De engel die aan Alma en de zonen van Mosiah verschijnt; geen eigen naam in de tekst. **Geslacht/voorstelling:** mannelijk uitgebeeld; `unnamed-text-attested`. Verhaalhoofdstukken: 22, 30.

- Compacte buste: `/scripture/characters/angel-alma/portraits/angel-alma-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/angel-alma/portraits/angel-alma-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/angel-alma/portraits/angel-alma-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/angel-alma/master/angel-alma-master-v1.webp`
- Referentie: `/scripture/characters/angel-alma/references/angel-alma-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: niet voorgesteld als gewone gebruikersavatar; fase `not-proposed`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Beperking: Unnamed nonstandard identity; retained for story tools, not proposed as a user avatar.
- Verhaalbron: [hoofdstuk 22](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-22-almas-mission-to-ammonihah?lang=eng), [hoofdstuk 30](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-30-alma-counsels-his-sons?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### De broer van Jared — `brother-of-jared`

**Rol:** Broer van Jared; spreekt met de Heer en leidt samen met Jared zijn familie. **Geslacht/voorstelling:** mannelijk uitgebeeld; `unnamed-text-attested`. Verhaalhoofdstukken: 50, 51.

- Compacte buste: `/scripture/characters/brother-of-jared/portraits/brother-of-jared-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/brother-of-jared/portraits/brother-of-jared-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/brother-of-jared/portraits/brother-of-jared-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/brother-of-jared/master/brother-of-jared-master-v1.webp`
- Referentie: `/scripture/characters/brother-of-jared/references/brother-of-jared-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `brother-of-jared` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 50](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-50-the-jaredites-leave-babel?lang=nld), [hoofdstuk 51](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-51-the-jaredites-travel-to-the-promised-land?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Naamloze discipel, rolcanon — `church-disciple`

**Rol:** Representatieve leerling uit de verhaalillustraties; geen vastgestelde individuele identiteit. **Geslacht/voorstelling:** mannelijk uitgebeeld; `representative-role`. Verhaalhoofdstukken: 48.

- Compacte buste: `/scripture/characters/church-disciple/portraits/church-disciple-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/church-disciple/portraits/church-disciple-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/church-disciple/portraits/church-disciple-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/church-disciple/master/church-disciple-master-v1.webp`
- Referentie: `/scripture/characters/church-disciple/references/church-disciple-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: niet voorgesteld als gewone gebruikersavatar; fase `not-proposed`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Beperking: Representative design; exact individual identity is not established. Do not rename to a named historical person.
- Verhaalbron: [hoofdstuk 48](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-48-peace-in-america?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Naamloze vroege Jaredietische koning, rolcanon — `jaredite-king-role`

**Rol:** Representatieve Jareditische koning; niet zonder tekstbewijs aan Coriantumr of een andere naam koppelen. **Geslacht/voorstelling:** mannelijk uitgebeeld; `representative-role`. Verhaalhoofdstukken: 52.

- Compacte buste: `/scripture/characters/jaredite-king-role/portraits/jaredite-king-role-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/jaredite-king-role/portraits/jaredite-king-role-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/jaredite-king-role/portraits/jaredite-king-role-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/jaredite-king-role/master/jaredite-king-role-master-v1.webp`
- Referentie: `/scripture/characters/jaredite-king-role/references/jaredite-king-role-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: niet voorgesteld als gewone gebruikersavatar; fase `not-proposed`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Beperking: Representative design; exact individual identity is not established. Do not rename to a named historical person.
- Verhaalbron: [hoofdstuk 52](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-52-the-destruction-of-the-jaredites?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Naamloze Jaredietische profeet, rolcanon — `jaredite-prophet-role`

**Rol:** Representatieve Jareditische profeet; geen vastgestelde identiteit en niet hetzelfde ontwerp als Ether. **Geslacht/voorstelling:** mannelijk uitgebeeld; `representative-role`. Verhaalhoofdstukken: 52.

- Compacte buste: `/scripture/characters/jaredite-prophet-role/portraits/jaredite-prophet-role-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/jaredite-prophet-role/portraits/jaredite-prophet-role-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/jaredite-prophet-role/portraits/jaredite-prophet-role-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/jaredite-prophet-role/master/jaredite-prophet-role-master-v1.webp`
- Referentie: `/scripture/characters/jaredite-prophet-role/references/jaredite-prophet-role-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: niet voorgesteld als gewone gebruikersavatar; fase `not-proposed`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Beperking: Representative design; exact individual identity is not established. Do not rename to a named historical person.
- Verhaalbron: [hoofdstuk 52](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-52-the-destruction-of-the-jaredites?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Jozef, zoon van Lehi — `joseph-son-lehi`

**Rol:** Jozef, zoon van Lehi en Sariah; andere persoon dan Joseph Smith. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 10.

- Compacte buste: `/scripture/characters/joseph-son-lehi/portraits/joseph-son-lehi-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/joseph-son-lehi/portraits/joseph-son-lehi-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/joseph-son-lehi/portraits/joseph-son-lehi-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/joseph-son-lehi/master/joseph-son-lehi-master-v1.webp`
- Referentie: `/scripture/characters/joseph-son-lehi/references/joseph-son-lehi-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `jozef` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 10](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-10-jacob-and-sherem?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Koning Laman — `king-laman`

**Rol:** Koning Laman in het verhaal van Zeniff; andere persoon dan Lehi’s zoon Laman. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 13.

- Compacte buste: `/scripture/characters/king-laman/portraits/king-laman-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/king-laman/portraits/king-laman-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/king-laman/portraits/king-laman-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/king-laman/master/king-laman-master-v1.webp`
- Referentie: `/scripture/characters/king-laman/references/king-laman-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `laman-2` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 13](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-13-zeniff?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Man in wit gewaad uit Lehi’s droom — `lehi-dream-guide`

**Rol:** Naamloze man die Lehi in zijn droom begeleidt; niet Jezus Christus. **Geslacht/voorstelling:** mannelijk uitgebeeld; `unnamed-text-attested`. Verhaalhoofdstukken: 6.

- Compacte buste: `/scripture/characters/lehi-dream-guide/portraits/lehi-dream-guide-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/lehi-dream-guide/portraits/lehi-dream-guide-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/lehi-dream-guide/portraits/lehi-dream-guide-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/lehi-dream-guide/master/lehi-dream-guide-cutout-v1.webp`
- Referentie: `/scripture/characters/lehi-dream-guide/references/lehi-dream-guide-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: niet voorgesteld als gewone gebruikersavatar; fase `not-proposed`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Beperking: Unnamed nonstandard identity; retained for story tools, not proposed as a user avatar.
- Verhaalbron: [hoofdstuk 6](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-6-lehis-dream?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Nephi’s vrouw (naam niet vermeld) — `nephi-wife`

**Rol:** Naamloze vrouw van Nephi, een dochter van Ismaël; geen verzonnen eigennaam. **Geslacht/voorstelling:** vrouw; `unnamed-text-attested`. Verhaalhoofdstukken: 5, 9.

- Compacte buste: `/scripture/characters/nephi-wife/portraits/nephi-wife-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/nephi-wife/portraits/nephi-wife-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/nephi-wife/portraits/nephi-wife-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/nephi-wife/master/nephi-wife-cutout-v1.webp`
- Referentie: `/scripture/characters/nephi-wife/references/nephi-wife-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `A`.
- Hulpmiddelen-slug: `vrouw-van-nephi` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 5](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-5-traveling-in-the-wilderness?lang=nld), [hoofdstuk 9](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-9-a-new-home-in-the-promised-land?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Nephihah — `nephihah`

**Rol:** Nephihah; opperrechter na Alma. **Geslacht/voorstelling:** mannelijk uitgebeeld; `named`. Verhaalhoofdstukken: 22.

- Compacte buste: `/scripture/characters/nephihah/portraits/nephihah-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/nephihah/portraits/nephihah-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/nephihah/portraits/nephihah-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/nephihah/master/nephihah-master-v1.webp`
- Referentie: `/scripture/characters/nephihah/references/nephihah-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `nephihah` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Verhaalbron: [hoofdstuk 22](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-22-almas-mission-to-ammonihah?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Naamloze Zoramietische aanbidder, rolcanon — `zoramite-worshipper`

**Rol:** Naamloze Zoramitische aanbidder in het verhaal over de Rameumptom; de exacte individuele identiteit is niet vastgesteld. **Geslacht/voorstelling:** mannelijk uitgebeeld; `representative-role`. Verhaalhoofdstukken: 28.

- Compacte buste: `/scripture/characters/zoramite-worshipper/portraits/zoramite-worshipper-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/zoramite-worshipper/portraits/zoramite-worshipper-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/zoramite-worshipper/portraits/zoramite-worshipper-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/zoramite-worshipper/master/zoramite-worshipper-master-v1.webp`
- Referentie: `/scripture/characters/zoramite-worshipper/references/zoramite-worshipper-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `C`.
- Hulpmiddelen-slug: `None` (manual-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: bestaande definitieve full-body/sheet behouden; los portret toegevoegd.
- Beperking: Representative design; exact individual identity is not established. Do not rename to a named historical person.
- Verhaalbron: [hoofdstuk 28](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-28-the-zoramites-and-the-rameumptom?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Abish — `abish`

**Rol:** Lamanitische vrouw in dienst van Lamoni’s vrouw; brengt de mensen bijeen en helpt de koningin opstaan. **Geslacht/voorstelling:** vrouw; `named`. Verhaalhoofdstukken: 23.

- Compacte buste: `/scripture/characters/abish/portraits/abish-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/abish/portraits/abish-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/abish/portraits/abish-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/abish/master/abish-master-v1.webp`
- Referentie: `/scripture/characters/abish/references/abish-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `A`.
- Hulpmiddelen-slug: `abish` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: nieuwe full-body + sheet + portret, bestaande placeholder voltooid.
- Schriftbron: [Alma 19:16–17, 29](https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/19?lang=eng).
- Verhaalbron: [hoofdstuk 23](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-23-ammon-a-great-servant?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Vrouw van koning Lamoni — `lamoni-wife`

**Rol:** Naamloze koningin; spreekt met Ammon en deelt het getuigenis van haar man. **Geslacht/voorstelling:** vrouw; `unnamed-text-attested`. Verhaalhoofdstukken: 23.

- Compacte buste: `/scripture/characters/lamoni-wife/portraits/lamoni-wife-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/lamoni-wife/portraits/lamoni-wife-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/lamoni-wife/portraits/lamoni-wife-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/lamoni-wife/master/lamoni-wife-master-v1.webp`
- Referentie: `/scripture/characters/lamoni-wife/references/lamoni-wife-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `A`.
- Hulpmiddelen-slug: `koningin-1` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: nieuwe full-body + sheet + portret, bestaande placeholder voltooid.
- Schriftbron: [Alma 19:2–11, 29–30](https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/19?lang=eng).
- Verhaalbron: [hoofdstuk 23](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-23-ammon-a-great-servant?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Vrouw van Ismaël — `ismael-wife`

**Rol:** Naamloze vrouw van Ismaël; reist met haar gezin en Lehi’s familie. **Geslacht/voorstelling:** vrouw; `unnamed-text-attested`. Verhaalhoofdstukken: 5.

- Compacte buste: `/scripture/characters/ismael-wife/portraits/ismael-wife-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/ismael-wife/portraits/ismael-wife-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/ismael-wife/portraits/ismael-wife-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/ismael-wife/master/ismael-wife-master-v1.webp`
- Referentie: `/scripture/characters/ismael-wife/references/ismael-wife-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `B`.
- Hulpmiddelen-slug: `vrouw-van-ishmael` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: nieuwe full-body + sheet + portret, bestaande placeholder voltooid.
- Schriftbron: [1 Nephi 7:6](https://www.churchofjesuschrist.org/study/scriptures/bofm/1-ne/7?lang=eng).
- Verhaalbron: [hoofdstuk 5](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-5-traveling-in-the-wilderness?lang=nld)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

### Vrouw van Lamoni’s vader — `lamoni-father-wife`

**Rol:** Naamloze koningin in het verhaal waarin Aäron Lamoni’s vader onderwijst. **Geslacht/voorstelling:** vrouw; `unnamed-text-attested`. Verhaalhoofdstukken: 25.

- Compacte buste: `/scripture/characters/lamoni-father-wife/portraits/lamoni-father-wife-portrait-512-v1.webp`
- Grote buste: `/scripture/characters/lamoni-father-wife/portraits/lamoni-father-wife-portrait-1024-v1.webp`
- Specifieke avatar: `/scripture/characters/lamoni-father-wife/portraits/lamoni-father-wife-portrait-256-v1.webp`
- Volledig personage incl. voeten: `/scripture/characters/lamoni-father-wife/master/lamoni-father-wife-master-v1.webp`
- Referentie: `/scripture/characters/lamoni-father-wife/references/lamoni-father-wife-character-sheet-v1.webp`
- Hulpmiddelen: geschikt, met correcte rol/naam. Mysterie: visueel gekoppeld; nog niet speelbaar geregistreerd; toekomstig voetenanker apart vaststellen. Avatar: voorgesteld; fase `B`.
- Hulpmiddelen-slug: `koningin-2` (seed-verified-live-record-review-required); alleen BOM-collectie, live record vóór implementatie controleren.
- Ontbrekend na levering: geen voor dit buste/avatar/full-body-paar. Verbetering: nieuwe full-body + sheet + portret, bestaande placeholder voltooid.
- Schriftbron: [Alma 22:19–23](https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/22?lang=eng).
- Verhaalbron: [hoofdstuk 25](https://www.churchofjesuschrist.org/study/manual/book-of-mormon-stories/chapter-25-aaron-teaches-king-lamonis-father?lang=eng)
- Poses: Reuse existing full-body, explicit age variants and reference-sheet expressions; no new pose collection in this delivery.

## 6. Acht onafhankelijke accessoirelagen

Het ronde masker en de effen achtergrondkleur worden later door de app bepaald. De sterrenlaag is alleen een transparante decoratieve achtergrondlaag; geen gebakken achtergrondcirkel. De navy/oranje/crème stijl, compasster en warme metalen sluiten aan op de bestaande mascottes en divisiebeelden. De officiële divisie-emblemen worden niet vervangen.

| ID | Laag | 1024-bestand | Compact bestand | Zichtbare grens (alpha ≥32; pixels) | Anker midden zichtbare grens |
|---|---|---|---|---|---|
| `frame-bronze` | frame | `/scripture/accessories/frames/frame-bronze-1024-v1.webp` | `/scripture/accessories/frames/frame-bronze-256-v1.webp` | [23, 26, 1000, 974] | [512, 500] |
| `frame-silver` | frame | `/scripture/accessories/frames/frame-silver-1024-v1.webp` | `/scripture/accessories/frames/frame-silver-256-v1.webp` | [23, 23, 1000, 991] | [512, 507] |
| `frame-gold` | frame | `/scripture/accessories/frames/frame-gold-1024-v1.webp` | `/scripture/accessories/frames/frame-gold-256-v1.webp` | [34, 28, 989, 978] | [512, 503] |
| `background-stars` | background | `/scripture/accessories/backgrounds/background-stars-1024-v1.webp` | `/scripture/accessories/backgrounds/background-stars-256-v1.webp` | [50, 86, 973, 928] | [512, 507] |
| `overlay-compass` | decorative-overlay | `/scripture/accessories/overlays/overlay-compass-1024-v1.webp` | `/scripture/accessories/overlays/overlay-compass-256-v1.webp` | [544, 631, 836, 916] | [690, 774] |
| `overlay-light` | decorative-overlay | `/scripture/accessories/overlays/overlay-light-1024-v1.webp` | `/scripture/accessories/overlays/overlay-light-256-v1.webp` | [29, 373, 547, 963] | [288, 668] |
| `overlay-scroll` | decorative-overlay | `/scripture/accessories/overlays/overlay-scroll-1024-v1.webp` | `/scripture/accessories/overlays/overlay-scroll-256-v1.webp` | [507, 633, 957, 929] | [732, 781] |
| `overlay-mystery` | decorative-overlay | `/scripture/accessories/overlays/overlay-mystery-1024-v1.webp` | `/scripture/accessories/overlays/overlay-mystery-256-v1.webp` | [628, 647, 909, 956] | [768, 802] |

Alle lagen hebben canvas 1024×1024 en een compacte export 256×256. Gemeenschappelijk canvasanker `(512,512)`, ronde uitsnede diameter 1024. Het ontwerp houdt de innerlijke gezichtscirkel van ongeveer 860 pixels vrij. Bovenhaar blijft binnen het ronde masker; onderborst kan door de toekomstige cirkelmaskering verdwijnen. Kleine decoraties staan op de onderzijde/rechterschouder; lichtaccent links onder. De gemeten grenzen hierboven zijn de werkelijke export, niet een belofte dat de generatie exact elke promptcoördinaat volgt.

Volgorde: **app-achtergrond + sterren → personage → licht/decoratie → profielkader**. Alle lagen exact dezelfde buitenmaat en positie, `object-fit: contain` op het volledige vierkant. Geen transparante marge wegtrimmen en geen iconen opnieuw centreren op basis van hun zichtbare begrenzing. Daarmee blijven compas, rol en schild op de bedoelde schouderpositie.

Gebruik één van compass/scroll/mystery per keer; licht kan als subtiel extra accent. Bronze/silver/gold sluiten elkaar uit. Sterren zijn optioneel. Op 32px hebben een eenvoudig kader en hoogstens één accent de voorkeur. Referentiebladen bevatten combinaties bij 32/48/96 px op licht/donker; de losse lagen blijven de echte assets.

Mogelijke beloningen: bronze/silver/gold bij bestaande divisies BRONZE/SILVER/GOLD; sterren bij `streak-7`; kompas bij `intro-first-lesson`; licht bij `streak-3`; schriftrol bij `first-chapter`; Mysterie-schild bij een bestaande afgeronde Mysterie-activiteit, als Claude bevestigt dat die status al betrouwbaar beschikbaar is. Niets daarvan is nu geactiveerd. Bestaande divisienamen: Zaad, Licht, Strijder, Rots, Erfgenaam, Overvloed, Zion, Eeuwigheid; gebruik de huidige `leagueTiers.ts`-canon, geen nieuwe divisies.

## 7. Huidige avatargroottes en mobiel voorstel

| Toepassing | Nu, vastgesteld in broncode | Voorstel | Layout-aandacht |
|---|---|---|---|
| Reacties | `UserAvatar` xs 28px | 32px | compacte rij/gap behouden; namen blijven leesbaar |
| Compacte activiteit/lijst | sm 36px | 36–40px | geen extra rijhoogte zonder reden |
| Vrienden | zoekresultaat 36px, verzoeken/vrienden 44px | 48px | tekst min-width 0, naam afbreken; statusdot vrijhouden |
| Groepsleden | 36px | 48px | knoppen en roltekst blijven passen |
| Ranglijsten | default sm 36px | 48px mobiel, hoogstens 56–64px ruim desktop | plaats/rangkolom behouden, rijen iets hoger |
| Eigen profiel | aparte emoji-knop 56px | 96px mobiel, 112px desktop | bovenaan op 320px liever stacked; geen vaste te brede horizontale rij |
| Vriendprofiel | expliciete override 64px | 96px mobiel, 112px desktop | volg eigen profielritme |
| Uitgebreid profiel/dialog | geen gedeelde nieuwe detailvariant | 144px, binnen 128–160px | responsief detailvenster, sluitknop bereikbaar |
| Header | zichtbare sm 36px in aanraakvlak 40px | 36px behouden | compacte navigatie; aanraakvlak zo nodig 44px, zonder header te vergroten |

Read-only livecontrole op 320px: documentbreedte 320px, geen horizontale overflow in het huidige profiel; header-knop 40px en eigen avatar 56px. De voorgestelde grotere avatar is nog niet geïmplementeerd of live getest. Claude moet 320/360/390px, lange namen, grotere tekst, light/dark en laad/foutstatus opnieuw toetsen. Geen persoonlijke screenshot in de openbare documentatie.

Concrete locaties: `src/components/UserAvatar.tsx` (xs/sm/md, batch-cache van emoji-data), `ProfileClient.tsx` (eigen profiel/emoji-kiezer), `FriendProfileClient.tsx`, `FriendsClient.tsx`, `LeaderboardClient.tsx`, `ActivityFeedClient.tsx`, `social/GroupDetailClient.tsx`, `shell/HeaderAvatar.tsx` en `src/app/api/users/avatars/route.ts`. Huidige avatar-API retourneert `avatarEmoji`; centrale personage/accessoirevelden bestaan hier nog niet. Meldingen, samen spelen, reeksen en prestaties moeten later ook via dezelfde renderer/dataresolver lopen waar een gebruikersidentiteit wordt getoond; deze documentatie beweert niet dat elk scherm nu al `UserAvatar` gebruikt.

## 8. Mascottes behouden

Novi (jongetje/jonge speelse gids), Varo (volwassen mannelijke avontuurlijke gids), Vera (volwassen vrouwelijke warme gids) blijven aparte mascotte-identiteiten. Geen van hun goedgekeurde beelden is opnieuw gemaakt of gewijzigd.

Bestaande character sheets: `/mascots/references/novi-character-sheet.png`, `/mascots/references/varo-character-sheet.png`, `/mascots/references/vera-character-sheet.png` en `/mascots/references/versado-character-canon.png`. Productie: `/mascots/static/<novi|varo|vera>/<id>-<state>.webp`, elk tien states op 512×512: greeting, playing, success, encourage, thinking, discovery, reading, celebrate, sleep, idle. Family heeft tien eigen gezamenlijke composities; Figma heeft afgeleide ontwerpkopieën en is geen productiebron. Geen Rive-runtime toegevoegd.

`User.companion`, `src/lib/companion.ts`, `PersonalMascot`/`CompanionProvider`, `MascotSlot` en `src/lib/mascots.ts` blijven het persoonlijke gidssysteem. Een scripture-avatar is geen vervanging van een persoonlijke gids en mag `companion` niet overschrijven. De definitieve mascottecanon blijft `docs/VERSADO-CHARACTER-CANON.md` en `public/mascots/README.md`.

## 9. Optimalisatie en kwaliteitscontrole

WebP met alpha: detail 1024 kwaliteit95, buste512 kwaliteit93, avatar256 kwaliteit91; accessoires detail96/compact94. Native PNG behouden;56 opnieuw uitgegeven portretten en17 exacte rasteruitsneden. Rasteruitsneden zijn niet opnieuw geïnterpreteerd en hebben een lagere effectieve bronresolutie; grote profielzoom blijft het bestaande full-body-beeld gebruiken. 56 portretbronnen zijn native1254px;17 portretten zijn met toestemming exact uit bestaande transparante full-bodies gesneden. Hun1024px-export is vergroot zonder nieuw detail te verzinnen. De oorspronkelijke cropgrootte staat onder nativePng; gebruik voor grote profielzoom de oorspronkelijke full-body. Full-body en reference-sheet exports houden hun oorspronkelijke beeldverhouding. `avatar-asset-quality-report.json` bevat iedere export met dimensies, alpha-range, werkelijke zichtbare grenzen, bytes, SHA-256 en bronhash. Transparen­te pixel-RGB mag donker zijn; alpha bepaalt de zichtbaarheid. Alpha hoeft niet overal exact255 te zijn om echte transparantie te bevatten.

Ieder nieuw beeld wordt visueel tegen de bron en op licht/donker bekeken. Ronde avatars zijn gecontroleerd op 32,48,96px. Nieuwe full-bodies zijn gecontroleerd op handen, proporties en zichtbare voeten; nieuwe sheets op identiteitsconsistentie. Acht accessoires afzonderlijk gecontroleerd en in combinaties. Geen bestaande full-body/scène/mascotte-asset overschreven. De grote QA-bladen zijn uitsluitend documentatie, geen runtime-combinatieassets.

Bestandslijsten: `docs/scripture/character-avatar-files.json`; meetrapport: `docs/scripture/avatar-asset-quality-report.json`; accessoirecoördinaten: `docs/scripture/avatar-accessories.json`; generatie/ref-notities: `docs/scripture/character-avatar-generation-notes.json`. Dat zijn beschrijvende documenten; geen app-manifests of unlock-configuratie.

## 10. Grote profielheader en animatievoorbereiding

De lopende opdracht is uitgebreid: eigen en vriendprofiel tonen standaard het volledige personage in een vaste mobiele header van240–300px. Tik1 zoomt binnen dezelfde container naar een buste, tik2 terug. Achtergrond blijft staan en pagina verspringt niet. Hiervoor worden bestaande bodies hergebruikt; geen onnodige nieuwe poses of animaties. De eerdere96/112px-aanbeveling geldt nog voor compacte badges, niet voor het hoofdbeeld.

De aanbevolen zoom transformeert dezelfde full-body-rasterbron; het afzonderlijke portret blijft beschikbaar voor compacte avatars en buste/detail. Zo blijven identiteit en pose exact gelijk tijdens de beweging. `profile-character-framing.json` geeft gemeten bodygrenzen en voorgestelde profielankers; die zijn gescheiden van bestaande Mysterie-ankers. Een ander portret is niet automatisch pixel-perfect uitgelijnd voor een vloeiende morf.

Achtergrond, character, decoratie en kader blijven onafhankelijke lagen. De huidige ronde vierkante frames/decoraties zijn geschikt voor avatars; niet uitrekken tot rechthoekig headerkader. Gebruik een vaste vierkante decoratieruimte of een losse hoekbadge. Eventueel later headerbreed kader/patroon is niet in deze levering verzonnen.

Voor latere beweging zijn aparte ogen/oogleden, hoofd, haar/baard, torso, armen/handen met verborgen aansluitingen, pivots en rig of een3D-model nodig. Native PNG/sheets worden behouden, maar vlakke rasters bevatten die componenten niet. Er zijn geen animaties gemaakt. Zie de uitgebreide aanvulling in de Claude-overdracht.

## 11. GitHub en overdracht

Branch: `assets/character-avatar-system`. Pull request naar `main`, niet mergen. Gewijzigd: alleen nieuwe `public/scripture/characters/...`-beelden, nieuwe `public/scripture/accessories/...`-lagen en documentatie onder `docs/`. Het bestaande documentaire character-register is uitgebreid; geen TS/JS/React/CSS/Prisma/routes/auth/profielinstellingen/spelregels/Mysterie-manifests geraakt.

Afzonderlijke concrete overdracht: [CLAUDE CODE IMPLEMENTATION HANDOFF](CLAUDE-CODE-CHARACTER-ASSETS-HANDOFF.md). Volledig eindrapport en PR-link worden bij de levering toegevoegd.
