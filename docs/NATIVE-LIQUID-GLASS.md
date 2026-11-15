# Liquid Glass Foundation — eerste stap

Basis: `develop` na profiel-PR #280 (`d99d679b`). Deze stap verandert de
presentatie van bestaande native schermen. Zij voegt geen fictieve Spelen-/Vriendenroute
of nieuwe functionele pariteit toe. De volledige bijgewerkte routeclassificatie
staat in [NATIVE-FEATURE-PARITY.md](NATIVE-FEATURE-PARITY.md).

## Eén componentensysteem

Dezelfde `AppShellHeader`, `SubpageBackBarView`, `BottomNav`, profielkaarten,
Today-/cursuskaarten en `ConfirmProvider` blijven web en native renderen.
`data-vs-surface="chrome|navigation|card|sheet"` en `vs-material-card` geven het
materiaal aan. De centrale CSS in `globals.css` gebruikt de bestaande VS-kleuren,
licht/donker, vormen, randen en één familie van materiaal-/schaduwtokens.

Alleen de lokale iOS-entry kiest `data-vs-material="glass"`. Web en Android
blijven de bestaande VS-materialen gebruiken. Dit is een materiaalvariant van
dezelfde interface, geen tweede navigator, gekopieerde kaarten of aparte screens.

- Bovenbalk en terugbalk: getinte, begrensde transparantie en een reflectierand.
- Onderbalk: hetzelfde route-/selectiemodel in een zwevend afgerond paneel.
  De bestaande buitenste nav behoudt alle safe-area-ruimte. `ShellMetrics` meet
  de gehele voet; er is geen tweede meting of eigen scrollcontainer.
- Kaarten: rustige tint, randen en schaduw; **geen backdrop-blur per kaart**.
- Echte bevestigingsdialogen: het native profiel gebruikt de bestaande HTML-dialogvariant
  met focusval, Escape en terugkeer van focus. iOS 15.0–15.3 behoudt de bestaande
  div-terugval, nu met focusbegrenzing, veilige hoogte en afbrekende knoppen.
  De focusgrens werkt ook zonder `Array.at`, dat op oudere WebKit ontbreekt;
  de browserproef controleert Tab en Shift+Tab expliciet zonder die API.
- Feedback: bestaande knop-/selectie-/focusregels, met begrensde schaduw-/druktransities. Paletwissels zijn atomisch om contrastflitsen te voorkomen.
  Geen nieuwe oneindige animatie, JS-scrollfilter of page-remount voor een overgang.

De visuele laag is een WKWebView/CSS-equivalent van glasmaterialen. HTML-inhoud krijgt
nooit `UIGlassEffect`. Op iOS 26+ vervangt de systeemtabbalk (zie "Stap 2") de CSS-onderbalk;
op iOS 15–25, Android en web blijft de CSS-variant de enige onderbalk.

## Echte iOS-toegankelijkheidsinstellingen

De bestaande `VersadoNative`-plugin levert uitsluitend lokaal versie 1 van
`interfacePreferences`: Reduce Transparency, Reduce Motion, Increase Contrast
en de relatieve UIKit-bodytekstgrootte. `UIFont.preferredFont` levert de Dynamic
Type-schaal; er is geen cap op een geldige iOS-tekstcategorie in de UI. Het
transport valideert alleen ongeldige/niet-eindige protocolwaarden.

UIKit-notificaties en hervatten melden wijzigingen. De JS-adapter luistert eerst,
leest daarna, negeert oudere antwoorden en verwijdert zijn luisteraar bij cleanup.
Geen accountdata, logging, webrequest of persistente opslag van deze voorkeuren.
De methode behoudt de bestaande `localOnly`-grens; netwerk- en sessiemethoden,
API-allowlists, credentials, signing en distributie zijn niet aangepast.

Tot de voorkeuren bevestigd zijn, of bij een ontbrekende/ongeldige bridge, blijft
het materiaal ondoorzichtig en beweging beperkt. Native voorkeuren én CSS-mediaqueries
kunnen transparantie/beweging uitschakelen. Contrastverhoging gebruikt ondoorzichtige
vlakken en sterkere randen/tekst. Normale chrometekst behoudt minimaal 4,5:1,
ook boven een volledig witte of zwarte achtergrond.

Dynamic Type schaalt rem-maten. De bestaande `ShellMetrics` ontvangt een resize-signaal;
zij houdt zelf de regels voor grote tekst, een te hoge header, toetsenbord en
veilige boven-/onderruimte bij. Instellingenrijen en themakeuzes lopen bij grote
tekst onder elkaar; waarden breken af in plaats van weg te vallen. Alleen
ruimte rondom tekst blijft compact. Dezelfde tabbestemmingen worden bij grote
tekst brede rijen met hele labels, in plaats van overmatig hoge icoonkolommen. De 310%-proef op 320px controleert ook
de zichtbare headerbediening. VoiceOver behoudt de echte koppen, labels,
`aria-current`, switches en dialogsemantiek. Fysieke VoiceOver-/IME-validatie is
nog niet uitgevoerd.

## Functiedekking en backend

Geen nieuwe backendroute/capability nodig voor deze stap. De gemergede
`profile-settings-v1` blijft nodig voor het volledige bestaande profiel; de
oude-backendterugval blijft intact. Liquid Glass verleent geen nieuwe rechten.
Spelen en Vrienden worden niet zichtbaar gemaakt via een lege tab.

De gegenereerde matrix classificeert iedere webpagina en ieder profiel-queryscherm
als technisch volledig, gedeeltelijk of ontbrekend. Volledig beschrijft de
geïmplementeerde routefuncties; fysieke acceptatie blijft apart. De nieuwe
classificatie verbetert de inventaris, zonder bestaande gaten stilzwijgend te sluiten.

## Verificatie

- `tests/native-appearance.test.ts`: protocol, toegankelijkheidsvoorkeuren,
  late antwoorden/cleanup, ongewijzigde web-/Android-activering en werkelijk CSS-contrast.
- De bestaande profiel- en Vandaag-browserproeven draaien binnen de standaard
  geïsoleerde native keten met deze iOS-materiaaladapter. Hun webkant blijft de
  echte Next-productieserver met dezelfde componenten en dezelfde synthetische accounts.
  Geen nieuwe CI-matrix of duplicatie van dezelfde suites.
- `node scripts/native/test-isolated.mjs --glass-only`: gerichte uitvoering van
  beide bestaande suites. Vijf talen, licht/donker, 320px/200%, tablet,
  sessies/accountwisseling en echte opslagen blijven getest. Extra checks voor
  ondoorzichtige terugval, Dynamic Type, focusval, Escape en toetsenbordgeometrie.
- De UIKit-voorkeurgrens en toetsenbordgeometrie zijn in Chromium gesimuleerd;
  het product gebruikt de echte bridge. Geen fysieke iPhone-/iPad-/Android-GO.
- Normale PR-controles leveren TypeScript/lint, backend-/securityregressies,
  ongetekende iOS-compilatie en Android-regressiecompilatie. Geen signingrun/upload.

Lokale uitslagen op de definitieve code:

- Schone `npm run build`, inclusief TypeScript: geslaagd.
- `NATIVE_API_BASE_URL=https://example.invalid npm run native:build`: geslaagd;
  uitsluitend een lokale compilebundel, geen signing of publicatie.
- `npm run test:native`: 215 native + 80 datalaagtests geslaagd, geen skips.
- Pariteitscontroles: 7 geslaagd en gegenereerde inventaris actueel.
- Bestaande iOS-release-/signingguards: 47 geslaagd; één bestaande macOS-only
  sleutelhangertest wordt op deze Linux-machine overgeslagen.
- Gerichte lint: nul fouten; twee bestaande React-waarschuwingen in
  ConfirmProvider en ThemePreference, zonder regeluitschakeling.
- Geïsoleerde profiel-/Vandaag-browserketen: geslaagd na de laatste CSS-wijziging.
  Inclusief 100 Vandaag-vergelijkingsbeelden, alle vijf talen en de extra
  dialoog-/310%-/keyboardproeven.
- GitHub iOS-/Android-compilatie en volledige Native Foundation: zie de controles
  op de laatste PR-commit; lokale resultaten vervangen deze niet.

Vergelijkbare screenshots: [browserbewijs](native-liquid-glass/README.md).

## Concrete vervolgstappen

1. **Spelen**: gedeelde echte Spelen-landingspagina en een volledige verticale
   solo-/hervat-/resultaatslice van Woord van de Dag, met de bestaande game-engine,
   serverbeloningen en domeinlockvolgorde. Tab pas vrijgeven met een echte bestemming.
2. **Vrienden**: bestaand overzicht, uitnodigingen en eigenaar-/blokkeerbeleid;
   daarna bestaande groepen/activiteiten en ticketgebonden realtime. Geen tweede socket-auth.
3. **Kernhiaten en overige routes**: CFM-studielezer/vragen, overige cursussen en
   resultaten, voortgangsdetails, studiemap, Dorp, Lofzangen, Kompas, winkel,
   notificatie-inbox en APNs. De routematrix blijft de volledige checklist.
4. Fysieke iPhone/iPad-acceptatie van materiaal, Dynamic Type, VoiceOver,
   toetsenbord, rotatie en scrollprestaties, na aparte eigenaarstoestemming
   voor integratie/DEV-uitrol en de volgende TestFlight-build.

## Stap 2 — echte systeemtabbalk op iOS 26+

Besluit eigenaar (november 2026): op iOS 26 en nieuwer is de onderbalk de echte UIKit-tabbalk,
die als Liquid Glass tekent. Dit herroept uitdrukkelijk de eerdere keuze "geen UIKit-tabbar" uit
stap 1, voor die ene balk. De navigatie zelf blijft de gedeelde React-router.

**Eén navigatiemodel.** `PRIMARY_NAV`, de vertaalde labels (`nav.*`), `activeDestination` en de
router blijven de enige bron. `NativeTabBarSync` (uitsluitend in de lokale iOS-app) stuurt
bestemmings-id, vertaalde titel en gekozen id naar de plugin; een tik meldt alleen het id terug en
JavaScript navigeert via dezelfde `push` als de React-link. De native balk kent geen routes,
accountgegevens of netwerk.

**Beschikbaarheid en terugval.** `tabBarSupport` meldt of de systeemtabbalk beschikbaar is
(iOS 26+, `NativeTabBarPolicy.available`). Alleen na een bevestigde `tabBarSync` zet de adapter
`data-vs-native-tabbar="true"` en `--vs-native-tabbar-height` op `<html>`; de React-onderbalk wordt
dan een onzichtbare ruimtehouder met precies die hoogte (`globals.css`), zodat `ShellMetrics`,
`--nav-height`, `<main>` en alle onderruimte-afspraken ongewijzigd blijven. Bij iOS 15–25,
Android, web, een fout, een ongeldig antwoord, uitloggen of opruimen verschijnt de React-balk
weer. De volgorde is altijd: eerst de ruimte vrijhouden (native balk nog onzichtbaar), daarna
tonen, zodat er nooit twee balken zichtbaar zijn.

**Zichtbaarheid.** De native balk volgt exact de React-balk: `ShellMetrics` meldt na elke meting
`vs-shell-metrics`; is `--nav-height` 0 (focus mode, immersive, open toetsenbord, uitgelogd, desktop)
dan wordt de native balk doorzichtig en niet bedienbaar. De ruimtehoogte blijft staan, de hoogte
komt uit UIKit (inclusief homeindicator) en wordt bij draaien of Dynamic Type via `tabBarLayout`
bijgewerkt.

**Materiaal.** Standaard `UITabBar`, zonder eigen blur of tekenwerk; gelinkt tegen de iOS 26 SDK
(CI gebruikt Xcode 26, `UIDesignRequiresCompatibility` staat niet in `Info.plist`) tekent het
systeem het Liquid Glass-materiaal. Icoon (SF Symbols) volgt uit het id in een vaste lijst, nooit uit
een door JavaScript meegestuurde naam. De accentkleur komt uit `AccentColor.colorset` (licht en
donker, gelijk aan `--vs-accent`); `overrideUserInterfaceStyle` volgt de gekozen app-thema's
(licht/donker) omdat die kunnen afwijken van de systeemmodus. Reduce Transparency, Increase
Contrast en Dynamic Type worden door UIKit zelf op deze balk toegepast.

**Beveiliging en privacy.** Alleen via de bestaande `localOnly`-poort (lokale `capacitor://localhost`).
De payload wordt in `NativeTabBarPolicy.parse` strikt gevalideerd (versie, vaste velden, ids uit
de vier primaire bestemmingen, uniek, 1–4 items, titel 1–32 tekens zonder stuurtekens, selectie
binnen de balk). Alleen id's en hoogtes gaan terug naar JavaScript. Geen opslag, logging of
netwerk, en geen nieuwe rechten of backendroute.

**Bekende beperkingen en vervolgacties.**
- Niet op een toestel of simulator beoordeeld: de balk is hier alleen op Linux ontwikkeld. De
  TypeScript-adapter, het contract en de Swift-beleidsproef (macOS-CI) zijn getest; het uiterlijk,
  de hoogte (inclusief homeindicator), touch en VoiceOver op iPhone en iPad zijn nog niet
  gevalideerd en vereisen een echte build.
- De Kompas-rondleiding richt zich nog op `data-kompas-target="nav-*"` van de React-balk; op iOS 26
  zijn die doelen onzichtbaar en ligt de native balk erover. Vervolg: de rondleiding laten
  accentueren via de native balk of die stap overslaan.
- Tablets: de balk staat onderaan (niet de zwevende bovenbalk van `UITabBarController`); een
  iPad-specifieke plaatsing is een aparte, bewuste keuze.
- iOS 15–25 behoudt de CSS-glasonderbalk uit stap 1.
