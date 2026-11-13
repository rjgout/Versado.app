# Gedeeld profiel en instellingen — eerste productstap bij #238

Delta vanaf `develop` `fea24e027e027f0b8d6b2a3cabe250937eec7cca`: de bestaande
B1/B2/B3-shell, reader, audio en distributieketen blijven het fundament.
De nieuwe capability `profile-settings-v1` vervangt het beperkte accountblok
door de bestaande webpresentatie. Geen nieuwe database, migratie of profielmodel.

## Aangesloten code en acties

Web en native gebruiken dezelfde `ProfileOverview`, profielkaarten, instellingen,
avatar-editor, taalkeuze, gidskeuze en tweestapsweergave. Web houdt zijn Next- en
cookie-adapters; de lokale app krijgt uitsluitend getypeerde Bearer-adapters.

| Onderdeel | Aangesloten gedrag |
| --- | --- |
| Overzicht | Eigen avatar, naam wijzigen, statistieken, thema, instellingen en juridische footer |
| Prestaties en competitie | Bestaande statistieken, verdiende/vergrendelde badges en uitgelichte selectie |
| Avatar | Bestaande personages, accessoires, ontgrendelrechten, concept en bewaar-/verlaatbediening |
| Talen en gids | Zelfde serverregels; contenttaal via de bestaande selectie/CAS-grens |
| Privacy en aanwezigheid | Eigen voorkeuren, e-mailvindbaarheid, deelrechten, online-status en incognito |
| Meldingen | E-mail-, categorie-, podcast-, herinnerings- en dagtekstvoorkeuren |
| Voorlezen | Nederlandse toestelstem en snelheid via de bestaande native audiolaag |
| Tweestapsverificatie | Instellen, bevestigen, herstelcode gebruiken en uitschakelen; beheerder mag niet uitschakelen |
| Lezen en nieuws | Dezelfde leesreset zonder XP-herbeloning en dezelfde changelog/gelezenstatus |
| Account | Bestaande wachtwoord-, Apple-koppel- en verwijderflows; Overal uitloggen trekt dezelfde web- en native sessies in |

De webroutehandlers en native API gebruiken dezelfde services. Persoonlijke
mutaties gebruiken de bestaande korte `commitAccountMutation` met sessiecontrole
voor en na de mutatie. Geen ruimere transactielimiet, automatische schrijfretry,
cookie-terugval of generieke native proxy. TS, Swift, Java en de bestaande
API-proxygenerator laten uitsluitend GET/POST `profile` en POST
`profile/two-factor` extra toe. Alleen bevestigde opslag wordt weergegeven;
oude accountacties en antwoorden worden met de bestaande sessie-epoch geweigerd.
TOTP-geheimen en herstelcodes blijven uitsluitend tijdelijk in componentgeheugen.

Overal uitloggen gebruikt dezelfde `logoutAccount`-service als de webroute:
één verhoging van de bestaande `User.sessionVersion` en dezelfde socketintrekking.
De native actor wordt onder de bestaande User-/sessielockvolgorde hercontroleerd.
Deze terminale mutatie controleert haar vervaltijd na de schrijfactie; haar eigen
verhoogde sessieversie is juist het bedoelde resultaat. De client houdt ook
voor deze actie de volledige render-epoch- en sessiestampcontrole. Een laat
antwoord van A mag nooit de nieuwe sessie van B sluiten, ook niet na A-B-A. De bestaande beschermde lokale
logout-/revocationopslag blijft ongewijzigd; geen automatische schrijfretry.


## Nog open, dus geen volledige profiel- of productpariteit

- Native push/APNs en een veilige toestelstem-preview zijn nog niet aangesloten.
  Push toont een expliciete apparaatstatus; de previewknop wordt niet aangeboden.
- De tijdzonerij toont de gedetecteerde toestelzone. Automatisch opslaan bij
  reizen/apphervatten is nog niet op de native transportadapter aangesloten;
  de bestaande servertijdzone bepaalt de daggrenzen. Dit blijft een expliciet
  profielhiaat.
- De bestemmingen XP/reeksdetails, winkel, Dorp, Kompas, feedback, puzzelrecords
  en beheer zijn nog afzonderlijke implementatieslices. Statistieken blijven
  zichtbaar; de app biedt geen dode links of websitefallback. Geen permanente
  web-only uitzondering is toegestaan.
- Spelen, Vrienden/Samen, overige CFM-/studiefuncties, Lofzangen en de andere
  hiaten uit de volledige pariteitsinventaris blijven open.
- Fysieke iPhone-, iPad- en Android-acceptatie van deze wijziging is **PENDING**.
  Browserproeven en compilatie bewijzen geen fysieke pariteit.

## Herhaalbare controle

- `npm run test:profile` en `tests/avatar-editor.test.ts` bewaken gedeelde web-UI.
- `tests/native-profile.test.tsx` controleert contracten, routes, éénmalige
  mutaties, account-epoch, socket-signalen en renderers in vijf talen.
- `node scripts/native/test-isolated.mjs --profile-only` gebruikt uitsluitend
  eigen tijdelijke PostgreSQL/Redis en de echte productie-Next-server. Het voert
  profiel-, account-/verwijdertests en de nieuwe browserproef uit. Een web- en
  nativebuild moeten vooraf gereed zijn; geen echte accounts of live stack.
- `tests/native-profile.browser.mjs` vergelijkt werkelijke web/nativeprofielen,
  vijf talen, licht/donker, tablet en 320px/200% tekst. Het test opslagfouten,
  avatar, globale logout en een laat antwoord na accountwisseling. Afbeeldingen komen
  uitsluitend uit `dist/native`; geen verborgen `public`-fallback. De synthetische
  stemcatalogus is alleen browserharnas en bewijst geen toestelspraak.
- De HTTP-proeven controleren ook een discriminatorbotsing, globale web/native
  sessie-intrekking, vreemde/inmiddels ingetrokken actors en behoud van nieuwere
  sessies na een oude logoutpoging.
- Screenshots: `/tmp/versado-native-browser/shared-profile`; geselecteerd bewijs
  komt na geslaagde uitvoering in `docs/native-profile/`.

Signing-, IPA- en uploadguards worden niet gewijzigd. Een volgende TestFlight-run
vereist inhoudelijke review, groene exacte-head CI en afzonderlijke toestemming.

Geselecteerde vergelijkingen en lokale resultaten: [browserbewijs](native-profile/README.md).
