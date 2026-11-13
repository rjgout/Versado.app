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
- Feedback: bestaande knop-/selectie-/focusregels, met begrensde schaduw-/druktransities. Paletwissels zijn atomisch om contrastflitsen te voorkomen.
  Geen nieuwe oneindige animatie, JS-scrollfilter of page-remount voor een overgang.

De visuele laag is een WKWebView/CSS-equivalent van glasmaterialen. De bestaande
React-bediening wordt niet bedekt door een tweede UIKit-tabbar. Dit claimt geen
gebruik van `UIGlassEffect` voor HTML of nieuw native navigatiemodel.

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
