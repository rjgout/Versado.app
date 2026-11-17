> **Archief (17 november 2026).** Dit document hoort bij de Expo/React Native-architectuurproef (draft-PR #286, branch `poc/expo-mobile`, **niet gemerged**).
> De proef is afgerond; het besluit staat in [ARCHITECTUURBESLUIT-APP-FIRST.md](../ARCHITECTUURBESLUIT-APP-FIRST.md): **Capacitor volgens het Ringtools-model**.
> De proefcode (`apps/mobile-poc/`) blijft alleen op die branch; padverwijzingen naar `apps/mobile-poc/…` wijzen daarheen.

# Lezer-spike: schrift native lezen en selecteren met React Native (Expo)

Status: **spike, draft** (PR #286). Geen merge, deployment of upload zonder aparte toestemming van de eigenaar.
Code: uitsluitend `apps/mobile-poc/` (`src/reader/`, `src/app/(tabs)/lezen.tsx`, `e2e/06…11`, `tests/`). Geen backendwijziging,
geen WebView, geen nieuwe annotatiedatabase en geen gedupliceerde bedrijfsregels.

## 1. Vraag en antwoord in het kort

Kan Versado's schriftlezer met echte native React Native-componenten werken, met behoud van het bestaande vers-/offsetmodel,
annotaties en backendcontracten?

- **Hoofdstuk ophalen, tekst native tonen, markeren, notitie opslaan, herladen:** ja, volledig via de bestaande routes en
  contracten (`courses` → `path` → `read/chapters/{id}` → `annotations`), gevalideerd met de bestaande zod-schema's.
- **Echte platformselectie met bereik:** ja, met een kleine, eenvoudige oplossing: de hoofdstuktekst is één niet-bewerkbare,
  meerregelige `TextInput` (UITextView / EditText) met `onSelectionChange`. Geen eigen native module nodig voor schrift.
- **Belangrijke kanttekening, bevestigd in de code:** het bestaande contract voor **schrift** is **vers-granulair**. Een annotatie
  hangt aan een `verseId` (`annotationsContract.ts`: `target: { type: "verse", verseId }`). Sub-vers-offsets
  (`blockId`/`start`/`end`/`exact`/`prefix`/`suffix`) bestaan alleen voor **studielessen** (`target.type === "lesson"`). Een selectie van
  een woord of een deel van een vers kan dus nu alleen als **markering van het geraakte vers** worden bewaard. De spike levert wel
  exact de offsets in het bestaande offsetmodel (door het contract gevalideerd), maar bewaart ze niet: daarvoor is een
  contractuitbreiding nodig die buiten deze spike valt (zie besluit B1).

## 2. Wat is gebouwd

| Onderdeel | Bestand | Rol |
|---|---|---|
| Hoofdstuk en annotaties | `src/reader/api.ts` | Bestaande native routes en zod-contracten; `expectedVersion` uit de bestaande rij; geen eigen regels |
| Selectielogica (zuiver) | `src/reader/selectionModel.ts` | UTF-16-offsets van de native selectie → bereiken per vers in codepunten van de genormaliseerde tekst (zelfde semantiek als `domSelector.boundary`) |
| Native tekst | `src/reader/SelectableChapter.tsx` | Niet-bewerkbare `TextInput` + geneste `<Text>`-stijlen voor markeringen |
| Scherm | `src/app/(tabs)/lezen.tsx` | Derde native tab "Lezen": selectie-info, Markeren, Markering wissen, Notitie, lettergrootte |
| Proefinhoud | `fixtures/proefboek.json`, `scripts/seed-reader-content.ts` | Eigen, synthetische tekst (geen schrifttekst) via de echte importer (`importBooks` → `syncCourses`) |

Eigen code: 385 regels (`src/reader` + scherm) plus 298 regels tests. Ter vergelijking telt de huidige lezer-/annotatie-UI
(`NativeReaderView`, `ScriptureReaderView`, `useVerseAnnotationMenu`, `AnnotationActions*`, `AnnotationRecovery`, …) 1.185 regels; die bevat
dingen die de spike bewust níet nabouwt (conflict- en herstelstatussen, toegankelijk vers-menu, audio-koppeling, leespositie).

## 3. Onderzochte oplossingen voor selectie

| Optie | Beschrijving | Beoordeling |
|---|---|---|
| **A. `TextInput` niet-bewerkbaar met `onSelectionChange`** (gekozen) | Echte platformselectie (loupe, grepen, systeemmenu, woord/regel/alles), offsets via event | Eenvoudigst; werkt op beide platforms (zie §5). Beperkingen: zie §6 |
| B. Eigen native view (Expo-module met UITextView / TextView) | Volledige controle: markeren in de attributed text, context-menu-items, `UITextInteraction`, grepen | Alleen nodig als A tekortschiet (rijke tekst, eigen menu). Naar schatting 2–4 weken voor Swift + Kotlin, plus onderhoud. **Niet gebouwd**: A volstaat voor schrifttekst |
| C. `<Text selectable>` | Systeemselectie zonder bereik | Onbruikbaar: geeft geen offsets |
| D. Eigen selectie (woord voor woord, tikken/slepen) | Volledig voorspelbaar, eigen UX | Meer werk en geen platformgevoel; niet nodig |
| E. Community-module (bv. selecteerbare tekst) | Kant-en-klaar | Onderhoudsrisico; niet beoordeeld in code |

Platformverschil dat A vereist: iOS `editable={false}` laat de UITextView selecteerbaar; Android schakelt een niet-bewerkbare
`EditText` uit (geen selectie). Daarom is de tekst op Android bewerkbaar maar zonder toetsenbord (`showSoftInputOnFocus={false}`,
`caretHidden`); de tekst komt uit de kinderen en wordt bij elke render teruggezet.

## 4. Offsetmodel en de bestaande contracten

- De hoofdstuktekst is `"<nr> <tekst>\n"` per vers (`buildLayout`). De weergave bouwt exact deze string; een componenttest bewaakt dat,
  want alle offsets berusten erop.
- `selectionToVerseRanges` vertaalt een UTF-16-selectie naar bereiken per vers; nummers en alinea-einden tellen niet mee; een
  grens midden in een surrogaatpaar schuift naar buiten; witruimte wordt samengevouwen zoals `normalizeAnnotationText` doet.
- `rangesToSelector` maakt er een `PassageSelector` van, en **`validatePassageSelector` uit het bestaande contract keurt die goed**
  (eenheidstests, 9 gevallen: woord, deel van vers, over verzen, dubbele spatie/tab, surrogaatpaar). Een onjuiste selector wordt door
  het contract geweigerd; de spike heeft dus geen eigen validatieregels.
- Gedupliceerd (klein, gemarkeerd): `normalizedOffset` herhaalt de semantiek van `boundary` in `domSelector.ts`, omdat dat bestand
  aan het DOM gebonden is. Aanbeveling bij een vervolg: `boundary` verplaatsen naar een zuivere, gedeelde module.
- Vers-id's kunnen met een cijfer beginnen; het contract eist een letter vooraan voor ankers. De spike gebruikt `verse:<id>` als blok-id.

## 5. Resultaten

Alles hieronder is gemeten met de echte `server.ts` en wegwerp-Postgres/Redis, uitsluitend synthetische accounts en een synthetisch
proefhoofdstuk (12 verzen, eigen tekst). Een groene CI-run is geen apparaatvalidatie (zie §7).

### 5a. Zonder toestel (lokaal en in CI, elke run)

| Controle | Resultaat |
|---|---|
| Eenheidstests selectielogica (woord, deel van vers, over verzen, dubbele spatie/tab, surrogaatpaar, richting, ingeklapt) | 9/9; bereiken goedgekeurd door het bestaande `validatePassageSelector` |
| Componenttests scherm (exacte layout-string, selectie-info, markeren op 3 verzen, notitie op eerste vers, bestaande markeringen tonen/wissen, lettergrootte, foutmelding, safe area, platformprops) | 10/10 |
| Integratietest tegen de echte backend (`npm run test:reader`): hoofdstuk via cursusroutes, markering vers 5–7 + notitie vers 8, **herladen met een nieuwe sessie**, andere gebruiker ziet niets, versiecontrole door de server (verouderde `expectedVersion` → 409), wissen | geslaagd |
| `tsc --noEmit`, Metro-bundel iOS + Android (Hermes) | schoon; 3,4 MB per platform |

### 5b. Op een iOS-simulator en een Android-emulator (Maestro op de draaiende Release-app)

| Eis uit de opdracht | Android (API 34) | iOS (iPhone 17 Pro, iOS 26) |
|---|---|---|
| 1. Echt hoofdstuk via de bestaande contracten | ja | ja |
| 2. Schrifttekst native weergeven | ja | ja |
| 3a. Woord selecteren (echt lang indrukken) | ja | ja |
| 3b. Deel van een vers (woord = deel van een vers; bereik in offsets) | ja | ja |
| 3c. Tekst over meerdere verzen (`setSelection` op het native bereik; app toont `· vers 5–7`) | ja | ja (na correctie: iOS meldt een programmatische selectie niet als event) |
| 4. Markeren en annotatie (notitie) opslaan; server bevestigd door een tweede client | ja | ja |
| 5. Bestaande markeringen na een **volledige herstart** correct getoond (en notitie) | ja | ja |
| 6. Lettergroottes 14/18/24/32 en systeemtekstgrootte (Dynamic Type / lettergrootte) | ja bij 14–32; systeemtekst ja | ja bij 14–32; systeemtekst: layoutcorrectie gemaakt en op Android bewezen, op iOS **niet opnieuw bevestigd** (zie hieronder) |
| Markering wissen (server bevestigd) | ja | ja |

Visueel gecontroleerd op screenshots: systeemselectie met grepen en menu (iOS: Copy / Look Up / Translate; Android: Select all),
gele markeringen die na herstart op de juiste verzen terugkomen, en de notitiesamenvatting.

**Eerlijke stand iOS.** De volledige iOS-reeks (flows 01–09 en 11 groen, echte lange-druk-selectie, meerdere verzen, herladen) is
bewezen in run 51 (commit b4056376). De laatste run met de eindcode (run 65, commit 446c6384) faalde al in flow 01 (inloggen →
Vandaag) en de overige flows vielen daarna door de volgorde uit; alleen 06 en 09 slaagden nog. De backend-probe in die run toont
10 van 284 metingen boven 5 s en pieken tot 19,9 s (de clientlimiet is 15 s) op de gedeelde CI-runner: omgevingsbelasting, geen
leesfout. Daarom is flow 10 (iOS-systeemtekstgrootte) met de gecorrigeerde layout nog niet groen op iOS bevestigd. Wie dit hard
nodig heeft, draait de iOS-job opnieuw of test het op een lokale Mac/fysiek toestel.

### 5c. Gevonden en opgelost tijdens de spike (belangrijk voor een echte lezer)

| Bevinding | Oorzaak | Aanpak |
|---|---|---|
| iOS meldt een programmatische selectie niet via `onSelectionChange` (een gebruikersselectie wel) | RN-gedrag op iOS | Alleen testhook: staat zelf zetten. Gebruikersselectie ongewijzigd |
| Android: lang indrukken op witruimte (bv. de dubbele spatie) selecteert niets | OS-gedrag | Verwacht; flows proberen drie punten |
| Kop overlapte de statusbalk / Dynamic Island | Geen top-safe-area in de eigen kop | `useSafeAreaInsets`; getest |
| iOS met accessibility-tekstgrootte: de vaste kop vulde het hele scherm, de tekst viel buiten beeld, de `A+`-knop liep buiten het scherm (horizontale overflow) | Vaste, niet-scrollende kop met een rij zonder omslag | Bediening hoogstens 45% van het scherm en zelf scrollbaar, rij met `flexWrap`; `flexShrink: 0` (anders kapt flex de knoppen af) |
| Programmatische selectie viel samen met het sluiten van de systeemselectiebalk (Android) | Race | Testhook wacht kort |
| Knoppen in de bediening reageerden niet op de eerste tik zodra het notitieveld (toetsenbord) open was (Android én iOS) | Een knop in een `ScrollView` krijgt de eerste tik niet bij een open toetsenbord | `keyboardShouldPersistTaps="handled"`; getest |
| Bediening van 45% kapte statusregel, samenvattingen en notitieveld af; de bediening kromp mee met de enorme hoofdstuk-`ScrollView` | Flexbox-krimp (`flexShrink`) | 65% van het inhoudsgebied, `flexShrink: 0`, hoofdstuk `flex: 1`; getest |
| **Opstartgedrag van de proef:** een tijdelijke netwerkfout bij het herstellen van de sessie leidde naar het inlogscherm, hoewel de sessie geldig was | Proefcode behandelde élke fout als uitlog | Alleen 401/ontbrekende sessie is uitgelogd; anders "Geen verbinding" met automatisch opnieuw proberen. Getest (5 tests). Dit is een algemeen punt voor elke native schermlaag |
## 6. Gerichte vergelijking met de huidige Capacitor-schriftlezer

| Aspect | Huidige lezer (web/Capacitor, WebView) | Spike (React Native, native tekst) |
|---|---|---|
| Annotatiegranulariteit schrift | Per vers: tik op een vers opent het menu (bladwijzer/markering/notitie); een bestaande tekstselectie onderdrukt het menu (`useVerseAnnotationMenu`) | Per vers via dezelfde contracten; selectie kiest de geraakte verzen (woord → dat vers) |
| Sub-vers-selectie | Alleen voor studielessen (DOM-`Range` → `PassageSelector`, `domSelector.ts`) | Offsets in hetzelfde model, door het contract gevalideerd, maar voor schrift niet bewaarbaar zonder contractuitbreiding |
| Selectie-UI | Selectie van de WebView (WKWebView/Android WebView) | Echte `UITextView`/`EditText`-selectie (loupe, grepen, systeemmenu) |
| Aanpassing systeemmenu | Beperkt (browser/WebView) | Beperkt zonder eigen native module; acties staan nu in een RN-balk |
| Tekstweergave | CSS, links, verwijzingen, figuren, citaten, tabellen, video (studielessen: `RichContentBlocks`, 336 regels + `StudyReader`, 667 regels) | Alleen platte tekst met inline stijl. **Rijke inhoud past niet in één `TextInput`** |
| Scrollen, gebaren, toetsenbord | WebView-grenzen (scrollgedrag, geheugen) | Platformeigen scrollgedrag; ingebouwde safe-area-afhandeling |
| Lettergrootte / systeemtekst | CSS | Werkt op beide platforms (14–32 én systeemtekst); eerst een ontwerpfout gevonden en opgelost (§5c) |
| Omvang | Lezer + annotatie-UI ±1.185 regels (incl. conflict-/herstelstatussen, toegankelijk menu, audio, leespositie) | 385 regels + 298 regels tests, **zonder** die extra's |
| Hergebruik | n.v.t. | Alle contracten en routes; serverbeslissingen (versies, toegang, privacy) ongewijzigd |
| Toegankelijkheid | Bestaand en deels gevalideerd | Niet gemeten (VoiceOver/TalkBack), en een bewerkbare `EditText` op Android is een aandachtspunt |

Kernverschil: de spike wint op platformgevoel en een eenvoudige, contracttrouwe schriftlezer; de huidige lezer wint op rijke
inhoud, bestaande toegankelijkheid en reeds gebouwde annotatiestatussen.

## 7. Wat is niet bewezen

- **Geen fysiek toestel.** Alleen simulator/emulator; echte aanraking, loupe-gedrag, handgrepen slepen, haptiek, prestaties op
  zwakke toestellen, geheugen en batterij zijn niet gemeten.
- **Selectie door slepen van de grepen** (echte gebruikersgebaar voor een bereik over verzen) is niet geautomatiseerd getest; een
  bereik over verzen is met `setSelection` op het native bereik gezet. De native `onSelectionChange` bij gebruikersselectie is wel
  bewezen (woordselectie op beide platforms).
- **VoiceOver / TalkBack**, schermlezergedrag bij selectie, Switch Control, hardwaretoetsenbord, plakken/knippen op Android.
- **Lange hoofdstukken** (tot 500 verzen / 512 KB volgens het contract): prestaties van één `TextInput` met veel geneste spans zijn niet gemeten.
- **Rijke studie-inhoud** (links, verwijzingen, figuren, video, tabellen): niet getest en met deze techniek niet mogelijk (zie R2).
- **Landscape/tablet**, RTL-talen, offline gedrag, conflicten (409) in de UI (alleen in de integratietest), audio-koppeling, leespositie.

## 8. Resterende risico's (gerangschikt)

1. **R1 – Contractgranulariteit (besluit eigenaar).** Schrift bewaart per vers. Willen we markeringen op woord-/deelniveau, dan is een
   backendcontract voor sub-vers-selectoren nodig (bijvoorbeeld het bestaande selectormodel ook voor `verse`-doelen), met migratie-,
   anker- en herstelregels. De spike levert de clientkant (offsets, door het contract gevalideerd) maar bewaart niets nieuws.
2. **R2 – Rijke inhoud.** Studielessen hebben links, verwijzingen, figuren, citaten, lijsten, tabellen en video. Die kunnen niet in één
   selecteerbare `TextInput`. Voor lessen is een eigen native tekstweergave (optie B, Expo-module) of een blok-voor-blokopzet met
   selectie per blok nodig. **Dit is het grootste resterende risico** en vraagt een eigen spike vóór een besluit over lessen.
3. **R3 – Toegankelijkheid.** Een bewerkbare `EditText` zonder toetsenbord (Android) meldt zich als tekstveld; VoiceOver/TalkBack-gedrag bij
   selectie en markeren is onbekend. Valideren op toestellen is een voorwaarde.
4. **R4 – Android-hack.** Bewerkbaar maar zonder toetsenbord werkt, maar plakken/knippen via hardwaretoetsenbord of menu kan de weergegeven tekst
   tijdelijk wijzigen (de render zet hem terug). Alternatief: eigen `TextView` via optie B.
5. **R5 – iOS 26 tabbalk.** De zwevende tabbalk bedekt de onderkant van de inhoud en het selectiemenu; bottom-padding en menupositie moeten
   ontworpen worden (de spike houdt 120 pt onder de tekst vrij).
6. **R6 – Eigen actiebalk i.p.v. systeemmenu.** Markeren/notitie staan in een RN-balk; in het systeemmenu zelf is dat alleen met een
   eigen native module mogelijk.
7. **R7 – Gedupliceerde logica (klein).** `normalizedOffset` herhaalt `domSelector.boundary`; verplaats `boundary` naar een zuivere gedeelde module vóór een vervolg.
8. **R8 – Schaal van de rest.** De bestaande lezer-UI telt ±1.185 regels met conflict-/herstelstatussen en een toegankelijk menu; die
   zijn niet nagebouwd en vormen het merendeel van de echte inspanning.
9. **R9 – CI-bewijs ≠ apparaatbewijs.** De iOS-runs waren alleen stabiel na het verplaatsen van de backend, het blokkeren van externe
   synchronisatiehosts en een Apple-Silicon-runner (zie `MOBILE-POC-EXPO.md`). Dat zijn testomgevingsmaatregelen, geen appwijzigingen.

## 9. Backend-aandachtspunt (afzonderlijk)

De eerder gevonden Prisma-transactietimeout bij het accepteren van een vriendenverzoek (5 s, ±60 sequentiële prestatiecontroles
in één transactie) staat apart vastgelegd in
[`BACKEND-AANDACHTSPUNT-PRISMA-TRANSACTIE-TIMEOUT.md`](BACKEND-AANDACHTSPUNT-PRISMA-TRANSACTIE-TIMEOUT.md). Het is niet opgelost; de
spike-CI warmt de route vooraf op. De annotatieroute is hetzelfde type risico (gedeelde `commitAccountMutation`) en is hier bij een
warme backend snel gebleven; onder belasting niet gemeten.

## 10. Go/no-go-advies native schriftlezer

**Voorwaardelijke GO voor een native schriftlezer van platte schrifttekst; NO-GO (nog) voor rijke studielessen.**

- **GO**, omdat de gekozen techniek (native niet-bewerkbare tekstweergave met selectiecallbacks) op beide platforms werkt voor
  hoofdstuk, selectie, markeren, notitie, herladen en lettergrootte, volledig binnen de bestaande contracten, zonder WebView en zonder
  nieuwe annotatieopslag. Het eerder als grootste onzekerheid benoemde punt (selectie met bereik) is voor schrift opgelost met een eenvoudige oplossing.
- **Voorwaarden voor een vervolg:**
  1. de eigenaar besluit over R1 (blijft verslag per vers, of komt er sub-vers-opslag);
  2. validatie van VoiceOver/TalkBack en op fysieke toestellen (R3, R4, §7) vóór een beslissing over productie;
  3. de scope blijft platte schrifttekst; voor lessen komt eerst een afzonderlijke spike voor rijke inhoud (R2), waarschijnlijk optie B;
  4. de bestaande annotatiestatussen en het toegankelijke menu worden als echt werk geraamd (R8), niet als restpost.
- **Effect op het eerdere advies** (`MOBILE-POC-EXPO.md` §8): de lezerselectie is niet langer de grootste onzekerheid voor schrift, maar
  het risico verschuift naar rijke lesinhoud (R2) en toegankelijkheid (R3). Een besluit over volledige migratie blijft uitgesteld tot die twee zijn onderzocht.
- Dit is een technisch advies; er is niets gemerged, gedeployed of geüpload. PR #286 blijft draft.
