# Versado App-First — architectuuradvies en voorstel voor een proef

Compact advies, geen implementatie. Basis: `develop` op `1539e4b5` en de Vrienden-audit
(`docs/NATIVE-VRIENDEN-AUDIT.md`, commit `2e50c6f8`, nu met een status-kop). Zekerheidslabels: **[B]** broncode/meting in deze repository,
**[W]** officiële documentatie, **[N]** schatting of niet geverifieerd, **[A]** aanbeveling.

## 1. Kern van het advies

1. **Neem nu geen architectuurbesluit; bewijs het.** De keuze tussen de bestaande Capacitor-route en React Native/Expo hangt van drie
   meetbare dingen af (hergebruik van TypeScript, kwaliteit van de interface op toestel, tijd tot paritetsscherm). Die zijn te meten met één
   dun verticaal plakje (§7), niet te beredeneren. Volledig SwiftUI + Jetpack Compose is hier de duurste route en komt alleen in beeld als beide
   andere falen (§3).
2. **De snelste verantwoorde route naar de stores loopt niet via een herbouw.** Mobile 1.0 op het bestaande fundament heeft negen
   openstaande, architectuuronafhankelijke blokkades (§8). Die moeten bij elke keuze worden opgelost. Houd dat spoor lopend en laat de proef
   parallel beslissen waar de interface van 1.x naartoe gaat.
3. **De backend is in alle varianten 100% hergebruik.** De echte keuze gaat alleen over de clientlaag.
4. **Er is geen vierde aanname nodig over "native is beter".** Als de proef laat zien dat de WebView-route voldoet, is die de kortste route.

## 2. Wat blijft en wat opnieuw moet (gemeten) [B]

| Onderdeel | Omvang | In alle varianten behouden? |
| --- | --- | --- |
| Backend: Next.js API, Prisma, services, Socket.IO, native API v1 | 244 API-routes, 145 pagina's, 25 `*.server.ts` | **Ja, ongewijzigd** |
| TypeScript-domeinlogica en contracten | `src/lib`: 605 bestanden / 91k regels; grof gemeten 352 van 580 client-bestanden zijn platformneutraal (geen `next/`, `window`, Capacitor, Prisma); `src/lib/native`: 45 van 55; `src/lib/data`: 12 van 14; `src/lib/i18n`: 14 van 14; 32 zod-contractbestanden | **Ja** (Capacitor: direct; RN: via pad-alias of pakket) |
| Vertalingen (nl, en, de, fr, es) | `nl.ts` 5.310 regels | **Ja** |
| Assets (mascottes, illustraties, audio-spiegel, iconen) | `public/`, audio via `/api/audio` | **Ja**, ander verpakkingspad |
| React-interface | 351 componenten / 47,9k regels, ~5,6k Tailwind-`className`s, 19 bestanden met DOM-audio/observers, 12 met canvas/SVG (o.a. legpuzzel, woordzoeker) | Capacitor: ja. RN/native: **opnieuw bouwen** |
| Native schil | Swift 1,5k regels, Java 1,3k regels (transport, audio, tabbalk, toegang) | Capacitor: ja. RN: vervangen door modules; SwiftUI/Compose: opnieuw |

De sociale services (`src/lib/social`) zijn serverlogica (11 van 13 bestanden raken Prisma) en blijven achter de API; clients praten er alleen via contracten mee.

## 3. Opties vergeleken

Schattingen zijn relatief en **[N]**; de proef levert de echte getallen.

| Criterium | A. Capacitor + gedeelde React + native chrome (nu) | B. Expo / React Native | C. SwiftUI + Jetpack Compose | D. RN-schil met WebView-eilanden voor het restant |
| --- | --- | --- | --- | --- |
| Hergebruik UI | ~95% (351 componenten) | 0% DOM-componenten; logica en contracten wel | 0% UI, logica deels via gegenereerde modellen | Alleen eilanden; schil nieuw |
| Dubbele code naast de website | Geen (één UI) | **Twee UI-codebases** (RN en DOM) tot de website verdwijnt | Drie (iOS, Android, web) | Twee, tijdelijk |
| Kwaliteit op toestel | Begrensd door WebView (scrollen, gebaren, tekstselectie); chrome kan native | Echte native views; goed | Hoogst | Gemengd; twee sessiemodellen |
| Liquid Glass | Reeds aangetoond met losse `UITabBar`; rest van de interface is webmateriaal | Native tabs: standaard UIKit-tabbalk met glas in Expo Router (iOS, Android, Web) [W] | Volledig | Idem B |
| Platformeigen Android | React-onderbalk (Material-uiterlijk, niet native) | Native tabs ondersteunen Android [W] | Volledig Material 3 | Idem B |
| Tijd tot pariteit [N] | kortst (weken tot maanden: vooral routes en contracten) | lang (maanden: 48k regels herbouwen, spellen en lezer het zwaarst) | langst | midden; migratie schermpatroon voor schermpatroon |
| Winkelrisico | 4.2-risico bij een te dunne WebView-app; mitigatie: lokale bundel, echte native functies | laag | laagst | laag |
| Teststack | bestaande browser-/CI-proeven werken | nieuwe stack (bv. Maestro/Detox), eigen simulatorwerk | XCTest/Espresso | beide |
| Teamfit (TypeScript/React) | sterk | sterk, nieuwe API-laag | zwak (Swift/Kotlin) | sterk |

Opmerkingen:
- Expo Router heeft native tabs met Liquid Glass; het importpad is `expo-router/unstable-native-tabs` in SDK 54–57 en `expo-router/native-tabs` vanaf SDK 58, en de API is in oudere versies "unstable" [W]. Een iOS 26-"bottom accessory" is beschikbaar via Router v55 [W].
- Optie D lost het eilandenprobleem niet vanzelf op: de bestaande lokale bundel (`NativeFoundation`) beheert zelf sessie, navigatie en schil, dus een eiland vraagt eerst een losgekoppelde "embed"-modus [B][N].
- Zonder bewijs van de tegenhanger is "RN is beter" een voorkeur, geen conclusie. De proef hieronder maakt het een meting.

## 4. Ringtools als referentie

Ik kan Ringtools niet inspecteren: webzoekopdrachten leveren er niets over op en de repository is niet bij mij bekend. Ik ga daarom uit van jouw omschrijving: een **overwegend gebundelde React-interface**, geen volledig native schermimplementatie. Wat dat wel en niet bewijst:
- Het bewijst dat een gebundelde React-UI in een native schil winkelwaardig kan zijn (dit is architectuurpad A).
- Het bewijst **niet** dat Versado's spelen (canvas/SVG, audio, realtime) en lezer (tekstselectie, annotaties) daar kwaliteitsmatig mee uit de voeten kunnen; dat is precies wat de proef moet meten.
Stuur de link of repository door als je een gerichte vergelijking wilt (navigatie, updates, WebView-gebruik, winkelgeschiedenis).

## 5. Een samenhangende app: Vandaag, Leren, Spelen, Vrienden

- **Eén schil, vier bestemmingen** (`PRIMARY_NAV`) blijft de bron voor beide richtingen; alleen de renderer verschilt. In A bestaat dit al (iOS-tabbalk, React-onderbalk elders). In B worden dit native tabs met dezelfde ids en labels uit de gedeelde i18n.
- **Eén sessie- en datalaag:** `NativeSessionClient`, de zod-contracten en de live-data-store zijn platformneutraal genoeg om in B ongewijzigd te draaien; `ApplicationRuntime` (`request`, `store`, `socket`) is al de bedoelde platformpoort [B].
- **Realtime blijft Socket.IO met eenmalige native tickets**; geen tweede kanaal.

## 6. Liquid Glass en Android

- iOS 26+: A houdt de losse `UITabBar` (bewezen, simulator [T]); B gebruikt de ingebouwde native tabs; beide leveren het systeemmateriaal. Eigen blur of CSS-imitatie blijft verboden.
- Android: A houdt de React-onderbalk (tokens volgen Material 3); B kan de platformeigen navigatiebalk gebruiken [W]. Of de React-onderbalk "platformeigen genoeg" voelt is een toetsbaar criterium in de proef.
- Beslis dit niet vooraf: de proef meet gevoel, Dynamic Type en TalkBack/VoiceOver op beide.

## 7. Voorstel voor de proef (beperkt, echte API's, één volledige handeling)

**Doel:** de drie meetbare vragen uit §1 beantwoorden met hetzelfde verticale plakje, in A en B, tegen echte Versado-API's.

**Plakje (alleen bestaande native endpoints, geen backendwijziging nodig na uitrol van #285 op de store-test-API):**
1. Inloggen met een synthetisch testaccount en Bearer-sessie (bestaande `login`/`refresh`/`logout`).
2. **Vandaag:** `today-overview` tonen (acties en vriendenverzoeken).
3. **Vrienden:** lijst en openstaande verzoeken uit `games/friends`.
4. **Volledige gebruikershandeling:** een vriendenverzoek **accepteren** (`games/friends/[id]/accept`), met server-effect, realtime verversing (`friends_changed` via een socketticket) op een tweede client, en correcte foutafhandeling bij verlopen sessie en dubbel tikken.
5. Uitloggen en accountwissel zonder restdata.
6. Native tabbalk met twee bestemmingen (Vandaag, Vrienden), Liquid Glass op iOS 26, Material op Android.

**Twee sporen, zelfde acceptatietest:**
- **Spoor A (basislijn):** bestaande `FriendsClient` achter een native route in de huidige app (route + contract + proxy), zonder nieuwe UI.
- **Spoor B:** nieuwe Expo-app in `apps/mobile-poc/` (apart, buiten de root-build; geen migratie van de repository), die `src/lib/native` (contracten, client, i18n) via een pad-alias hergebruikt en de twee schermen met native componenten bouwt.

**Meetpunten (verplicht in het besluitmemo):** nieuwe versus hergebruikte regels, tijd tot werkend plakje, koude start en scrolprestaties met een lijst van 500 vrienden, VoiceOver/TalkBack en Dynamic Type 200% op 320 pt, uiterlijk van de tabbalk (iOS 26 en Android), ontwikkelsnelheid (herladen), testbaarheid in CI, buildgrootte, en hoeveel van de 45 platformneutrale `src/lib/native`-bestanden zonder wijziging werken.

**Beslisregel vooraf vast te leggen (voorbeeld, jullie bepalen de drempels):** kies B alleen als het plakje ≥ 70% van de TypeScript-contracten ongewijzigd hergebruikt, de toestelkwaliteit aantoonbaar beter is dan A op de gemeten punten, en de geschatte extra tijd tot pariteit past in de planning; anders blijft A de basis met native chrome per scherm.

**Veiligheid en grenzen:** alleen dev-/store-test-API en synthetische accounts; geen productie, geen NAS-wijzigingen, geen TestFlight-upload, geen wijziging aan de bestaande app, signing of guards. Verificatie op een Linux-sandbox is beperkt: iOS-simulator, Liquid Glass en screenshots lopen via de bestaande macOS-CI-aanpak (`ios-glass-evidence`), Android via de bestaande KVM-runner. Echte toestelmetingen vragen jouw toestel en toestemming.

**Tijdsbox [N]:** ongeveer twee weken, uit te voeren door één ontwikkelaar met ondersteuning.

## 8. Snelste route naar de stores

1. **Nu, parallel aan de proef:** de negen openstaande blokkades uit `npm run native:store-readiness` — `ios-entitlements`, `ios-export-compliance`, `android-app-links`, `well-known-association`, `terms-of-use`, `apple-token-revocation` (alleen bij Apple-login), `min-version-policy`, `native-push` (alleen als het in 1.0 zit) en `device-test-report`. Ze hangen niet van de architectuur af (backend-endpoints en winkelgegevens) [B].
2. Interne TestFlight/Play-test (M1) bestaat al op het huidige fundament; de eerste externe test vraagt App Review.
3. Beslissingsmoment na de proef: óf Vrienden/Competitie/Groepen op het huidige fundament afbouwen (spoor A), óf schermpatroon voor schermpatroon naar RN. In beide gevallen blijft 1.0 niet wachten op een herbouw. [A]

## 9. Beveiligingsbevindingen die onafhankelijk van de architectuur moeten (uit de Vrienden-audit)

Prioriteit in volgorde; geen databasemigratie nodig tenzij vermeld.
1. **Rate limits** op `friends/request`, `users/search` en de publieke `GET /api/invite/[code]` (spam via notificatiemails, gebruikersenumeratie).
2. **Kruislingse Friendship-race** in `friends/request`: één transactie met advisory lock op het geordende id-paar.
3. **Testproxy-encoding:** `#` en `@` in `users/search` (en elke nieuwe zoekterm) toestaan via een encodingklasse per parameter; dit geldt voor elke client, ook RN.
4. **Ontbrekende tests:** `social/friendRequests`, `friendInvite`, `activityFeedVisibility`, `presence`, plus routetests voor verzoek sturen, verwijderen, uitnodigen en `group-links`.
5. **Productbesluit blokkeren:** het bestaat nu niet.
6. **Presence is in-memory per instantie** (`src/lib/presence.ts`): correct voor één app-instantie, een beperking bij horizontaal schalen.
7. **Uitnodigingslinks vóór inloggen** vragen een publiek, rate-limited native contract en de `apple-app-site-association`/`assetlinks.json` van de backend.
Bij RN verdwijnt de Swift/Java-allowlist van de native transportlaag of wordt die vervangen; de nginx-allowlist en de server-side autorisatie blijven de harde grens en moeten daarom altijd uit de expliciete routetabellen volgen.

## 10. Belangrijkste technische risico's

- **WebView-plafond (A):** scrollgevoel, gebaren, tekstselectie voor annotaties en audio-gedrag; mitigatie: meten in de proef, native chrome per scherm.
- **Herbouwkosten (B):** 48k regels, 12 canvas/SVG-bestanden, 19 bestanden met DOM-audio; de lezer (tekstselectie en annotaties) en de legpuzzel zijn de risicovolste, de lijstschermen de goedkoopste. Twee UI-codebases naast de website tot die verdwijnt.
- **Audio en toegang:** de huidige native audio- en toegangstransport (Range, Cloudflare Access voor interne builds) moet in RN opnieuw met modules worden bewezen.
- **Winkelbeoordeling:** een te dunne WebView-app (4.2) bij A; bij B nieuwe privacylabels/permissies.
- **Expo-API's:** native tabs zijn in oudere SDK's "unstable" [W]; versie vastpinnen en een uitwijkpad plannen.
- **Test- en releasepijplijn:** de bestaande browser- en macOS-CI dekt A; B vraagt een nieuwe teststack en eigen signing-/updatebeleid (store-regels voor OTA-updates).
- **Planning:** schattingen in dit document zijn bewust globaal; de proef moet ze vervangen door metingen vóór een besluit.

## 11. Te beslissen

1. Akkoord op de proef met twee sporen en de tijdsbox, of een andere variant (bijv. alleen spoor B)?
2. Welke drempels voor de beslisregel (hergebruik, kwaliteit, extra tijd)?
3. Mag de proefmap `apps/mobile-poc/` in de repository, of liever in een aparte repository?
4. Rate limits en race-fix (§9.1–9.2) los van de proef inplannen: ja/nee?
5. Stuur de Ringtools-link door als die vergelijking meetelt.

Bronnen (officiële documentatie, geraadpleegd voor de Expo-claims): Expo Router native tabs ([latest](https://docs.expo.dev/versions/latest/sdk/router/native-tabs.md), [guide](https://docs.expo.dev/router/advanced/native-tabs/)) en [Expo Router v55](https://expo.dev/blog/expo-router-v55-more-native-navigation-more-powerful-web).
