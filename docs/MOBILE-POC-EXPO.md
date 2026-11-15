# Mobiele proef: React Native + Expo (SDK 58)

Status: **proef, draft**. Geen merge, deployment of upload zonder aparte toestemming van de eigenaar.
Code: `apps/mobile-poc/` (eigen afhankelijkheden, eigen tsconfig, eigen CI-workflow `mobile-poc.yml`).
Het bestaande Capacitor-project, de iOS/Android-projecten, signing en distributie zijn niet aangeraakt.

## 1. Wat de proef is

Echte React Native-schermen (geen WebView, geen ingesloten webpagina's) met `expo-router/native-tabs`
(Vandaag, Vrienden). Eén gebruikersstroom, volledig tegen de bestaande backend:

1. inloggen met een synthetisch testaccount (Keychain/Keystore via `expo-secure-store`);
2. Vandaag met echte gegevens uit `today-overview`;
3. Vrienden met de bestaande lijst en inkomende verzoeken (`games/friends`);
4. een verzoek accepteren (`games/friends/{id}/accept`);
5. servereffect en `friends_changed` via de bestaande Socket.IO-ticketverbinding op een tweede client;
6. verlopen sessie (stille vernieuwing) en dubbel tikken (één verzoek);
7. uitloggen en accountwissel zonder achterblijvende gegevens.

Er is **geen** tweede database, account-, voortgangs-, spelregel- of autorisatielaag. De backend is niet gewijzigd.

## 2. Wat is bewezen en wat nog niet

Bewezen (lokaal gedraaid, isolatiebackend met wegwerp-Postgres/Redis, synthetische accounts):

| Controle | Resultaat |
|---|---|
| `npm run test:flow`: negen stappen hierboven tegen de echte `server.ts` | geslaagd |
| `jest` (jest-expo): `ActionGate`, schema, transport, uitloggen; Vrienden-scherm (dubbel tikken, realtime-herladen, foutmelding) | 8/8 |
| `tsc --noEmit` in de proef en in de root (root sluit `apps/` uit) | schoon |
| `expo export` iOS + Android (Metro + Hermes) | beide gebundeld, 3,4 MB `.hbc` per platform |
| Eén React (19.3.0) in het bundel; gedeelde contractmodules (`NativeSessionClient`, `NativeSocketConnection`, `gameApiRoute`, `nativeTodayOverviewSchema`) zitten erin | gecontroleerd |

**Niet bewezen** (de sandbox is Linux zonder iOS-simulator of Android-emulator):

- draaien op een iOS-simulator/-toestel en een Android-emulator/-toestel (`native-builds`-job in de workflow, handmatig te starten);
- dat `NativeTabs` correct rendert (Liquid Glass op iOS 26), scrolt en voor VoiceOver/TalkBack klopt;
- dat een React Native-`WebSocket` de `Origin`-header uit `extraHeaders` doorgeeft (in Node bewezen; op iOS/Android **te verifiëren**). Als dat niet werkt is een kleine, aparte servervoorziening nodig (zie risico R1).

Deze punten staan als open acceptatiecriteria; geen apparaatclaim zonder echte test.

## 3. Bevindingen tijdens de bouw

- **R1 – Origin.** De bestaande native API eist `Origin: capacitor://localhost` of `https://localhost` (ook voor de websocket). React Native stuurt die niet vanzelf; de proef zet hem in `nativeTransport` en via `extraHeaders`. Voor fetch is dit eenvoudig; voor de websocket moet het op een toestel worden bevestigd.
- **R2 – `crypto.randomUUID`.** `NativeSessionClient` gebruikt het; Hermes heeft het niet. Opgelost met een polyfill (`expo-crypto`, 5 regels).
- **R3 – Dubbele React/zod.** De hoofdapp heeft een andere React-versie dan RN 0.88. Metro en jest dwingen één kopie af (`metro.config.js`, `jest.config.js`). Zonder dit crasht de app met "invalid hook call". Dit is structureel onderhoud bij een gedeelde repository.
- **R4 – `@/`-alias en generated Prisma-enums.** De gedeelde contracten importeren via `@/…` (o.a. `leagueTiers` → generated Prisma-enums, `todayContract` → type-importen uit DOM-componenten). Het werkt via een Metro-resolver, maar trekt onnodige modules in het bundel en vereist `prisma generate` in CI. Vervolgstap: contracten naar een eigen pakket/map zonder app-afhankelijkheden (`shared/contracts`), zoals Ringtools doet met `shared/api-types.ts`.
- **R5 – `jest-expo` + RNTL 14.** `@react-native/jest-preset` moet apart worden geïnstalleerd; RNTL 14 is asynchroon (`await render`).
- **R6 – peer-dependencies.** `react-dom` 19.3.1 conflicteert met `react` 19.3.0 binnen SDK 58; de proef gebruikt `legacy-peer-deps` in `apps/mobile-poc/.npmrc`.

## 4. Meting en hergebruik

| Maat | Waarde |
|---|---|
| Eigen proefcode (src + tests + scripts) | 523 regels: schermen en layouts 141, kernlaag 177, tests 188 (waarvan 102 integratiestroom), Metro-config 17 |
| Direct hergebruikte modules uit `src/lib/native` | `client`, `gamesClient`, `socketClient`, `gamesRoutes`, `todayContract`, `contract`, `gamesAudioContract` (609 regels; `src/lib/native` totaal 4 863) |
| Vergelijkbare webclient `FriendsClient.tsx` | 499 regels (alleen dit scherm, zonder uitnodigingen, profielen) |
| Bundel (Hermes) | 3,4 MB per platform |
| Metro-export | ±31 s |
| `node_modules` van de proef | ±720 MB (alleen lokaal/CI, niet in de app) |

De cijfers zijn voor één stroom en zijn geen schaalbare extrapolatie. Er is geen percentage "hergebruik" als afwijsargument gebruikt.

## 5. Haalbaarheid van de moeilijke onderdelen (zonder herbouw)

- **Schriftlezer met selectie en annotaties.** De serverkant (`annotationsContract`, `readerContract`, verse-/offsetmodel) is hergebruikbaar. Lastig is *tekstselectie met bereik*: React Native `<Text selectable>` geeft geen selectiebereik terug. Opties: (a) een native tekstweergave via een kleine Expo-module (UITextView / `TextView` met selectiecallback), (b) `react-native-selectable-text`-achtige community-module (onderhoudsrisico), (c) eigen woord-voor-woordweergave met aantikken en slepen (voorspelbaar, maar eigen selectiegedrag). Aanbeveling: (a) of (c), na een afzonderlijke spike van 1–2 weken; dit is het grootste risico van een volledige RN-weg.
- **Interactieve puzzel.** Haalbaar met `react-native-gesture-handler` + `react-native-reanimated`; bij veel tekenwerk `@shopify/react-native-skia`. Spelregels en uitslag blijven server-authoritative; alleen de presentatie wordt herschreven.
- **Audio.** `expo-audio` (achtergrondaudio, vergrendelscherm via platformconfiguratie). De bestaande servercontracten (`audioContract`, bereikverzoeken, `renewReaderAudio`) blijven gelden; positie-, verloop- en herstelregels moeten opnieuw worden uitgevoerd. Risico: Android-mediasessiegedrag en iOS-routewissels; vergelijk met de bestaande `VersadoNative`-audioplugin.
- **Realtime spellen.** Bewezen voor `friends_changed`; dezelfde `NativeSocketConnection` draagt de spelgebeurtenissen. Resterend werk: UI per spel, herverbinding tijdens spelen, achtergrond/voorgrond.

## 6. Vergelijking met de bestaande Capacitor-weg

Capacitor is een **volwaardige kandidaat** (Ringtools staat er in de App Store mee), geen tijdelijke oplossing, en Expo is niet vanzelf beter.

| Aspect | Capacitor (huidig + Ringtools-model) | Expo/React Native (deze proef) |
|---|---|---|
| UI-codebase | één React-UI voor web/PWA/iOS/Android; `VersadoNative` voor native onderdelen | tweede UI (RN-componenten) naast de webapp; alleen contracten en domeinlogica gedeeld |
| Snelheid naar volledige functiepariteit | hoog: bestaande schermen draaien al | laag: elk scherm opnieuw; de proef kostte 523 regels inclusief tests voor twee schermen |
| Native uiterlijk/gedrag | beperkt tot wat plugins/eigen Swift-Kotlin geven; echte `UITabBar` bewezen (PR #284) | native tabs en navigatie van nature; scrollen, toetsenbord, gebaren platformeigen |
| Onderhoud | één UI, één testset | twee UI's; React-versie, Metro, Expo-SDK elk jaar mee |
| Offline/lokaal bundelen | bestaand | bundelen kan; webgebaseerde lezer/spellen moeten dan herschreven |
| Risico's | WebView-grenzen (selectie, scroll, geheugen), plugins onderhouden | reader-selectie, audio, dubbele React, extra build- en releaseketen |

Een concrete kwaliteits- of functiewinst voor Expo is in deze proef **nog niet aangetoond op een toestel**; ze moet op iOS/Android worden gemeten (schrolgedrag, tabbalk, toegankelijkheid, opstarttijd) vóór een besluit.

## 7. Resterend werk om alle Versado-functies native te maken (grove schatting)

Grove bandbreedte, uitsluitend gebaseerd op deze proef en de omvang van `src/components` en `src/lib/native`; geen toezegging.

- Fundament (navigatiestructuur, thema/tokens, i18n, foutafhandeling, offline-/netwerkstatus, toegankelijkheid): 4–6 weken.
- Vandaag/Leren/Spelen/Vrienden/Profiel (±15–25 schermen, bestaande contracten): 12–20 weken.
- Lezer met selectie en annotaties + audio: 8–12 weken (inclusief spike).
- Spellen (per spel 1–3 weken): afhankelijk van het aantal.
- Release, testen op toestellen, store-review: doorlopend, ±4–6 weken.

Totaal grofweg 8–14 maanden voor één kleine ploeg; dit is een bandbreedte, geen planning.

## 8. Advies

**Nog geen go/no-go voor een volledige RN-migratie.** Eerst deze drie dingen:

1. Draai de `native-builds`-job en test de stroom op een iOS-simulator en een Android-emulator (inclusief `Origin` op de websocket, native tabs, VoiceOver/TalkBack).
2. Doe een afzonderlijke spike voor lezer-selectie/annotaties (de grootste onzekerheid).
3. Vergelijk objectief met de Capacitor-weg volgens het Ringtools-model (één UI voor web+mobiel): meet scrollen, tabbalk, opstarttijd en onderhoudskosten.

Tot die metingen bestaan blijft Capacitor de snelste weg naar volledige functiepariteit; Expo wordt pas interessanter als de metingen een duidelijke kwaliteitswinst laten zien die de tweede UI-codebase rechtvaardigt.

## 9. Lokaal draaien

```bash
# backend (wegwerp-database; nooit productie)
DATABASE_URL=… REDIS_URL=… SESSION_SECRET=… NATIVE_SESSION_SECRET=<≥32 tekens> NATIVE_API_ENABLED=1 \
  ALLOW_INSECURE_COOKIES=true APP_URL=http://127.0.0.1:3100 PORT=3100 npx tsx server.ts
npx tsx apps/mobile-poc/scripts/seed-synthetic.ts      # alice/bob/carol@example.invalid

cd apps/mobile-poc && npm ci
npm run typecheck && npm test
POC_BASE_URL=http://127.0.0.1:3100 npm run test:flow
EXPO_PUBLIC_VERSADO_API_URL=http://<ip>:3100 npx expo start
```

`HTTP` naar een lokale backend is alleen voor de proef; productie blijft HTTPS-only.
