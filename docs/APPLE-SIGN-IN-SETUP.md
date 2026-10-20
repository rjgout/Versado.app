# Sign in with Apple — configuratie en vrijgave

Status: ontwikkelfundament. Er zijn geen echte Developer-credentials, provisioning
of Apple end-to-end-resultaten in deze PR. `APPLE_SIGN_IN_ENABLED` blijft standaard uit.
Geen waarden hieronder zijn productiecredentials.

## iOS/iPadOS — handmatig door eigenaar

1. Controleer in Apple Developer → Certificates, Identifiers & Profiles de bestaande
   expliciete App ID `app.versado.app`, de Team ID en het eigenaarschap. Maak geen
   tweede Versado-accountdomein of afwijkende bundle-identiteit.
2. Activeer Sign in with Apple voor deze App ID; kies bewust de primary/grouping
   bij bestaande apps. Subject-identiteiten zijn ontwikkelaarsscopegebonden.
   Een teamtransfer vereist Apple's identity-transferprocedure, geen e-mailmatching.
3. Open `ios/App/App.xcworkspace` (of het bestaande Xcode-project), selecteer de
   juiste Team/signing en voeg **Signing & Capabilities → Sign in with Apple** toe.
   `SignInWithApple.entitlements.example` toont de benodigde entitlement; wijs het
   echte bestand via CODE_SIGN_ENTITLEMENTS toe aan de betreffende buildconfiguratie.
   Vernieuw provisioning profiles. Voeg geen willekeurige Team ID aan Git toe.
4. Configureer op de eigen testbackend `NATIVE_API_ENABLED=1`, een afzonderlijk
   cryptografisch willekeurig `NATIVE_SESSION_SECRET` (minimaal 32 tekens),
   `APPLE_SIGN_IN_ENABLED=1`, `APPLE_TEAM_ID=<echte Team ID>` en
   `APPLE_IOS_CLIENT_ID=app.versado.app`. `APP_URL` blijft de canonieke backendorigin.
5. Bundel met `NATIVE_API_BASE_URL=<HTTPS-testbackendorigin>` en optioneel
   `NATIVE_TERMS_URL=<werkelijke HTTPS-voorwaardenpagina>`. Geen verzonnen URL.
   Voer local-development Capacitor-sync uit en bouw/sign met Xcode.
6. Test op een echt Apple-apparaat: nieuw account, hide-my-email, herhaalde login
   zonder naam/e-mail, bestaande e-mail zonder automatische koppeling, expliciet
   koppelen na wachtwoord/TOTP-herauthenticatie, ontkoppelen met alternatief,
   annuleren, netwerkfout, herstart, logout en verlopen/ingetrokken sessie.
7. Registreer waar nodig de echte uitgaande maildomeinen/adressen voor Apple Private
   Email Relay en controleer SPF/DKIM en aflevering. Naamgegevens zijn optioneel,
   eenmalig en niet cryptografisch bewezen; subject is de identiteit.

De backend verifieert uitsluitend Apple's vaste JWKS, RS256, issuer, exacte audience,
expiry/iat en een eenmalige serverchallenge met state en nonce. Geen callbacktoken
in een URL/log. De app vraagt geen Apple-wachtwoord. Er is geen productie-bypass.

## Web en Android — nog niet geactiveerd

Hiervoor is een Apple Services ID gekoppeld aan de primary App ID nodig, plus
geverifieerde webdomeinen en exacte HTTPS return URLs in Apple Developer. Maak een
Sign in with Apple-key, bewaar de `.p8` uitsluitend server-side en leg Key ID/Team ID
vast in veilige configuratie. De server genereert een kortlevend ES256 client-secret
voor de code-uitwisseling; dit hoort nooit in de appbundle.

Implementeer vóór activering een afzonderlijke HTTPS form_post-callback met eenmalige
state-/nonce-binding, bounded input, exacte Services-ID-audience, code-uitwisseling
bij Apple's vaste endpoint en gecontroleerde browser/app-terugkeer. Gebruik PKCE
alleen indien officieel ondersteund; vertrouw niet op een verzonnen Apple-parameter.
Een native terugkeer gebruikt een geverifieerde link en een kortlevende eenmalige
exchange-code, nooit access-/refreshtokens in de URL. Geen open redirects.
De huidige native API accepteert geen willekeurige Services ID of callbackorigin.
Android biedt nu e-mail/wachtwoord; de Apple-knop verschijnt uitsluitend op iOS.

## Blokkades vóór store-/publieke Apple-vrijgave

- Echte toolchain-, signing-, apparaat- en Apple end-to-end-validatie.
- Apple's server-side code-uitwisseling, token-revocation bij verwijderen/ontkoppelen
  en account-change/server-to-server-notificaties. De huidige identiteitstokenflow
  bewaart geen Apple refresh-token en claimt deze levenscyclus niet te ondersteunen.
- Officiële knop-/HIG-review, privacylabels, voorwaarden en store-accountverwijdering.
- Volledige onboarding en overige native schermen; geen marketingwebsite als fallback.
- Operationeel beheer van de native sessiesleutel (rotatie trekt native sessies in),
  vervallen challenge-/sessierecords en beveiligingsmonitoring zonder tokenlogging.

De backend-defaults en de Capacitor-releasegate blijven dicht zolang deze punten
niet zijn afgerond. Deze handleiding autoriseert geen productieconfiguratie of uitrol.
