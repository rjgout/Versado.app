# Native vlambranding

De eigenaar leverde `assets/native/versado-vlam-logo-bron.png` aan (1254 × 1254,
RGB, zonder transparantie). SHA-256 van het ongewijzigde origineel:
`d71499b1acb9ade60d44dcf56218f16339f3b497e9df0c7423fb65a8ae19d4c4`.

Afgeleide PNG's opnieuw maken: `node scripts/native/branding.mjs`.
Dit gebruikt de bestaande Sharp-dependency en alleen schalen en centreren;
geen gegenereerde illustratie, uitsnede of nieuwe interpretatie van het logo.

- iOS: één ondoorzichtig 1024 × 1024 app-icoon, zonder vooraf afgeronde hoeken.
  `AppIcon.appiconset/Contents.json` verwijst naar `versado-flame-1024.png`.
- iOS-launch: de bestaande `Splash`-imageset en witte, gecentreerde presentatie
  blijven behouden. De drie schalen delen één 2732 × 2732 bestand met het logo
  in het midden. `LaunchScreen.storyboard` verwijst al naar deze imageset en
  hoeft daarom niet te veranderen.
- Android: bestaande mdpi–xxxhdpi app-, ronde en adaptive-iconbestanden en
  portrait/landscape-splashbestanden zijn vervangen. Het volledige bronbeeld
  wordt voor ronde/adaptive maskers verkleind binnen de veilige zone. Android 12+
  krijgt expliciet hetzelfde beeldmerk via `windowSplashScreenAnimatedIcon`.
- Native header: `/icons/native/versado-flame.png` (132 × 132), weergegeven op de
  bestaande 44 × 44 ruimte. `scripts/native/build.ts` kopieert dit bestand naar
  de lokale bundel; Capacitor sync neemt het mee naar beide platformen.

De gedeelde web/PWA-iconen (`public/icons/icon-*.png`, maskable-iconen,
favicon en apple-touch-icon) blijven behouden. De native shell gebruikt nu een
afzonderlijke asset; inhoudelijke boekiconen zijn geen appbranding.
Authenticatie, routing, sessies, data en layout zijn niet gewijzigd.

## Controle en installatie

Voer TypeScript, gerichte ESLint en `npm run test:native` uit. Bouw de native
bundel met een expliciet bestaand buildprofiel en toegestane backend-origin,
voer `npx cap sync` uit met hetzelfde profiel en controleer beide platformen met
`scripts/native/verify-distribution.mjs`. Bestaande platform-CI compileert Android
en iOS; de Foundation-browserproef controleert ook dat het nieuwe headerbeeld
laadt, en bewaart branding-screenshots bij de bestaande viewports/tekstschaling.

Na een nieuwe Xcode-build én installatie op de iPhone horen app-icoon,
launchscreen en native header de vlam te tonen. Alleen een webdeploy vervangt
geen geïnstalleerd app-icoon of launchscreen. iOS kan icoon/launchsnapshot cachen:
sluit de app volledig en open opnieuw; gebruik zo nodig Clean Build Folder en
herinstalleer de testapp. Verwijderen van de app kan lokale sessie-/toesteltoegang
verwijderen en vereist opnieuw aanmelden/enrollment. Doe dit niet onnodig.

Een fysieke iPhone-/Android-controle blijft nodig voor de systeemmaskers,
launchsnapshot, iPad-landscape en de uiteindelijke installatie. CI-compilatie
en browserscreenshots bewijzen geen fysieke toestelacceptatie.

## Lokale verificatie van deze wijziging

- TypeScript en gerichte ESLint: geslaagd.
- Native unit-/dataregressies: 138 geslaagd; pariteitschecks: 6 geslaagd.
- Schone Next.js-productiebuild: geslaagd. Bestaande Tailwind-waarschuwing over
  gemengde eenheden in `screens` en Prisma-meldingen doordat lokaal geen
  databron is geconfigureerd voor prerendering; build eindigt succesvol.
- Native bundel, Capacitor sync en assetverificatie voor iOS en Android: geslaagd.
- Alle 29 afgeleide native PNG's volledig gedecodeerd en ondoorzichtig.
- Browsercontrole van de echte lokale bundel: headerbeeld laadt bij 390px en
  320px/200% tekst op 44 × 44, zonder JavaScript-crash. Geen toestelacceptatie.
- Platformcompilatie en volledige Foundation-browserregressies: zie de checks
  op de actuele PR-head; er is lokaal geen Xcode- of Android-SDK-compilatie gedaan.
