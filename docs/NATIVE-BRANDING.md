# Native vlambranding

De eigenaar leverde `assets/native/versado-vlam-logo-bron.png` aan (1254 × 1254,
RGB, zonder transparantie). Het origineel blijft ongewijzigd. SHA-256:
`d71499b1acb9ade60d44dcf56218f16339f3b497e9df0c7423fb65a8ae19d4c4`.

Assets opnieuw maken: `node scripts/native/branding.mjs`.
Previews opnieuw maken: `node scripts/native/branding-previews.mjs`.
Beide gebruiken uitsluitend de bestaande Sharp-dependency en de eigenaarbron;
geen AI-hertekening, vervangend logo of nieuwe afhankelijkheid.

## Correctie na onafhankelijke review

De eerste afleiding zette de blauwe, vierkante bron op wit of effen blauw. Dat
maakte een zichtbare tegel. De herziene splash-/maskerafleiding trekt de blauwe
randpixels door en laat uitsluitend de achtergrond met een gladde, radiale
overgang aansluiten op `#051E7B` (de rechteronderhoek van de bron). De vlam in
de centrale broncirkel met straal 0,52 × bronzijde blijft pixel-identiek aan de
correct geschaalde bron. Er is geen uitsnede of vervaging van de vlam.

- **iOS AppIcon:** het goedgekeurde ondoorzichtige 1024px bestand en de
  catalogusverwijzing blijven byte-identiek aan de eerste PR-head.
- **iOS-launch:** bestaande 2732px `Splash`-imageset en `scaleAspectFill` blijven;
  het merkbeeld is groter en de achtergrond sluit nu zonder vierkante rand aan.
  De storyboard-achtergrond gebruikt dezelfde bronkleur, zonder witte flits.
  De volledige vlam past binnen iPhone SE en grotere iPhones, iPad portrait en
  landscape. De drie bestaande schaalverwijzingen delen hetzelfde PNG-bestand.
- **Android adaptive:** 108dp foreground, zichtbaar maskervenster 72dp. De
  ongewijzigde vlam past binnen de centrale veilige cirkel van 66dp. De achtergrond
  loopt vóór de ronde maskerrand uit naar dezelfde systeemkleur. Round-iconen
  gebruiken dezelfde aanpak, met een grotere vlam dan de eerste versie.
- **Android vóór 12:** één `drawable/splash.xml` met achtergrondkleur en een
  gecentreerde bitmap op intrinsieke dp-grootte, in vijf dichtheden. De oude
  portrait/landscape-rasterachtergronden zijn vervangen: andere schermverhoudingen
  rekken het logo daardoor niet uit. `android:windowBackground` verwijst expliciet
  naar deze compositie.
- **Android 12+:** bestaande `windowSplashScreenAnimatedIcon` gebruikt het
  aangepaste foreground; `windowSplashScreenBackground` gebruikt dezelfde blauwe
  bronkleur. Geen contrasterend icon-background toegevoegd.
- **Header/web:** headerasset, 44 × 44 ruimte, bundelverwijzing, gedeelde
  web/PWA-iconen, favicon en apple-touch-icon blijven ongewijzigd in deze correctie.
  Ook klassieke vierkante Android-launchericonen blijven byte-identiek.

Authenticatie, navigatie, sessies, gegevens, app-layout en API's veranderen niet.

## Beoordelingspreviews

- [Contactblad splashscreens](native-branding/previews/splash-contact-sheet.png):
  iPhone SE, iPhone, iPad portrait/landscape, Android vóór 12 en Android 12.
- [Contactblad Android-maskers](native-branding/previews/android-masks.png):
  adaptive rond, afgerond en squircle, legacy round en de normale launcher.
- Losse composities staan in dezelfde map op hun aangegeven schermverhouding.

De previews lezen de werkelijk verpakte PNG's. iOS gebruikt dezelfde aspect-fill
als het storyboard; Android vóór 12 dezelfde gecentreerde 256dp-bitmap. Android 12
simuleert het standaardgeval zonder aparte icon-background: 288dp iconbox met
centrale 192dp cirkel. Adaptive-previews snijden het centrale 72dp-venster uit de
108dp-laag voordat ze het masker toepassen. Het zijn geometrische composities,
geen screenshots van een draaiende simulator of fysieke launcher. OEM-maskers,
animatie/parallax en systeemcaches vragen nog afzonderlijke toestelacceptatie.

## Gerichte regressies

`npm run test:native` voert ook de drie brandingtests in
`tests/native-distribution.test.ts` uit:

1. Alle dichtheden: systeemkleur aan de buitenrand, geen rechthoekige kleursprong
   boven op het plaatselijke verloop, en pixelbehoud van de beschermde broncirkel.
   Randmetingen worden op dezelfde fysieke schaal vergeleken; mdpi heeft minder
   pixels per verloop dan xxxhdpi. Elk beschermd foregroundpunt past binnen de
   conservatieve Android-cirkel van 66dp.
2. Negatieve controles: de oude blauwe tegel op wit én een bronvierkant op dezelfde
   effen blauwe systeemkleur worden daadwerkelijk opgebouwd en afgekeurd.
3. De volledige vlam blijft binnen de iOS aspect-fill-vensters bij telefoon- en
   tabletverhoudingen, met extra marge tot de schermrand.

Bestaande platform-CI compileert iOS/Android en de distributieprofielen. Foundation
controleert daarnaast de bestaande header, account-/sessieflows en browserlayout.
Zie de checks op de actuele PR-head voor de werkelijk uitgevoerde CI-resultaten;
eerdere groene runs gelden niet als bewijs voor een nieuwe head.

## Installatie en fysieke acceptatie

Na een nieuwe Xcode-build/sync én installatie horen app-icoon, launchscreen en
header de vlam te tonen. Alleen een webdeploy vervangt geen geïnstalleerde
systeemassets. iOS kan icoon/launchsnapshot cachen: sluit volledig en open opnieuw;
gebruik zo nodig Clean Build Folder en herinstalleer de testapp. Appverwijdering
kan opnieuw aanmelden/enrollment vereisen; doe dit niet onnodig.

Controleer nog op iPhone, iPad portrait/landscape en Android vóór/na 12:
geen tegelrand, geen vervormde of afgesneden vlam, juiste systeemmaskers en
normale overgang naar de bestaande native header. Geen merge/deployment of
fysieke toestelacceptatie uitgevoerd door deze assetcorrectie.
