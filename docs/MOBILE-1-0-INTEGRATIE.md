# Mobile 1.0 — consolidatie en eerste toesteltest

Basis van het codeonderzoek: `origin/main` **096f66c9ebcb11577fbfbeaf1af1e7de34ac2a28** (inclusief #225 en #227), 28 oktober 2026.
Geen merge, NAS-actie, deployment, store-upload of fysieke toesteltest uitgevoerd.
Dit document onderscheidt technische voorbereiding, integratiebewijs en door de eigenaar uit te voeren acceptatie.

## Bestaande PR's en integratievolgorde

De actuele heads en werkelijk afgeronde Actions worden bij oplevering vastgelegd; een historisch groen resultaat geldt niet voor een nieuwe commit. #228 bevat ook de gereproduceerde scrollrace bij vertrek naar de contentkiezer (180→196 pixels), met eerst rode en daarna groene regressietest. De bestaande browserassertie is behouden.

| PR | Codebevinding tegen deze main | Afhankelijkheid / advies |
|---|---|---|
| #229 | Parallel door Claude gemaakte heapfix; alle commits zijn als voorouder in #228 behouden, dezelfde instellingen zijn éénmaal toegepast | Niet daarnaast los overnemen; voorstel sluiten na onafhankelijke beoordeling van #228 |
| #230 | Dezelfde querykern voor web en lokale native lezer, scope-invalidatie en cache-isolatie; nog geen volledige Vandaag/Leren/CFM-schermen | Na #205; gezamenlijke conflictresolutie beschikbaar op de tijdelijke testbranch |
| #228 | TypeScript op schone main overschrijdt 2 GiB Node-heap; gereproduceerde OOM. Met 4 GiB slaagt dezelfde controle. Verhoogt uitsluitend de begrensde bouw-/testheap, geen controles uitgeschakeld | Eerst beoordelen; #196/#197/#202 nemen dezelfde fixcommits over |
| #196 | Android-signingguards en beschermde handmatige Play-testworkflow ontbreken op main; gesynchroniseerd zonder oude dependencies terug te zetten | Na #228, onafhankelijk van #197 |
| #197 | iOS-privacymanifest en beschermde handmatige TestFlight-workflow ontbreken op main; vijf gedeelde conflicten met #196 zijn inhoudelijk opgelost met behoud van beide signingpoorten | Na #196 (dezelfde Android-commits als voorouder; geen dubbele implementatie) |
| #199 | Optie B, WP4-ontwerp en teststackplan ontbreken op main; bijgewerkt met dit integratie- en M0-protocol | Na releasevoorbereidingen, vóór #206 |
| #202 | Zelfwissen op main vroeg uitsluitend een cookie. Gedeeld herauthenticatiecontract toegevoegd; consolidatie brengt bewijs, groepsopvolging, herstelcode en cascade onder één commitgrens en hercontroleert native sessies | Vóór #205; Apple-only en tokenintrekking blijven releaseblokkades |
| #205 | Native verwijderingsscherm, openbare uitlegpagina, juridische tekstpoort en persoonsgegevensinventaris ontbreken op main | Na #202; doelbranch main voor echte PR-controles. Geen eigen juridische tekst of bewaartermijn verzonnen |
| #206 | Gescheiden teststackvoorbeeld en backendcontrolescript ontbreken op main | Na #199; doelbranch main voor CI. Uitrol, DNS en TLS uitsluitend eigenaar |
| #203 | `zod` 4.6.7 staat al in actuele package.json én lockfile. Oude branch zou bij overname andere nieuwere dependencyfixes verliezen | Voorstel sluiten als achterhaald; niet overnemen |
| #204 | Verwacht reeksbeloning voor bronloze oude spelrun. Main beschermt juist dat zulke runs géén reeks-/XP-actie veroorzaken | Voorstel sluiten als inhoudelijk achterhaald; main-tests en gedrag behouden |
| #207 | Eén destijds ontbrekende testnaam in gegenereerde inventaris; huidige main bevat hem. Inventarissen worden op iedere gewijzigde branch met bestaande generator gemaakt | Voorstel sluiten als achterhaald; geen handmatige inventariswijziging |
| #188 | Oude integratiebranch met 94 gewijzigde bestanden en conflicten; is geen actuele productbasis | Voorstel sluiten nadat de afzonderlijke pakketten zijn beoordeeld. Geen oude integratiediff terugnemen |

Aanbevolen volgorde: **#228 → #196 → #197 → #199 → #202 → #205 → #206 → #230**.
Dit is een review-/mergeadvies, geen toestemming of uitgevoerde merge. Dezelfde vooroudercommits worden niet opnieuw geïmplementeerd.
WP6 deel 1 staat in #230 vanaf actuele main plus de CI-correctie; samenloop met #205 en de overige pakketten wordt op tijdelijke branch `test/mobile-1-integratie` gecontroleerd. Deze branch is uitsluitend testbewijs, geen extra product-PR.
Na iedere echte merge moeten de resterende branches op de dan actuele main worden gecontroleerd en inventarissen zo nodig opnieuw gegenereerd.

## Werkelijke productstatus

| Werkpakket | Bewijs / ontbrekend werk |
|---|---|
| WP1 | Distributieprofielen op main; publieke release blijft dicht, allowlists nog leeg |
| WP2 / WP3 | Signing-/testdistributievoorbereiding in #197/#196; geen echt ondertekende app of store-upload bewezen zonder eigenaarcredentials |
| WP4 | Gedeelde wachtwoord-/TOTP-verwijdering en lokale bediening in #202/#205. Apple-only-verse identiteit, Apple-tokenintrekking en definitieve juridische tekst ontbreken |
| WP5 | Minimumversiebeleid nog niet geïmplementeerd; niet gelijkstellen aan distributiemetadata |
| WP6 | Bestaande gedeelde navigatiepoort blijft. Eerste kleine vervolg integreert dezelfde live-querykern voor de lokale lezer; volledige shell/contentkiezer en featurecontracten volgen |
| WP8 / WP9 | Echte Vandaag-kaarten, cursusoverzicht en leerpaden nog niet lokaal beschikbaar; `/today` biedt nu alleen de bestaande eerste-hoofdstukproef |
| WP10 / WP11 | Bestaande lokale hoofdstukleeslus met serverafronding; nog geen volledige oefen-/audio-ervaring |
| WP13 / WP14 | Profiel deels; CFM Stap voor stap en Vrije studie nog niet lokaal geïmplementeerd |
| WP15 / WP16 | Geen fysiek apparaatbewijs, geen storeacceptatie. Storemetadata, juridische teksten en credentials blijven eigenaarstaken |

Spellen, multiplayer, sociale functies, Dorp, Lofzangen, FSY en push zijn uitgesteld als planningsrichting. Het voorstel voor formele uitzonderingen staat in
[NATIVE-MOBILE-1-0-OPTIE-B.md](NATIVE-MOBILE-1-0-OPTIE-B.md#2-voorgestelde-tijdelijke-pariteitsuitzonderingen-ter-goedkeuring).
Geen globale Bearer-bypass, remote WebView of tweede voortgangs-/beloningslaag gebruiken om ontbrekende schermen te maskeren.

## M0: eigenaar bereidt de testbackend voor

**Ontbrekende invoer:** de werkelijke, bereikbare HTTPS-origin van een strikt afzonderlijke ontwikkel-/testbackend.
Er is geen standaardproductiedomein en `example.invalid` is uitsluitend compilebewijs.

1. Eigenaar richt na eigen uitrolbesluit de [teststack](NAS-TESTSTACK-PLAN.md) in met eigen PostgreSQL, Redis, volumes, secrets, netwerk, DNS en TLS.
   Geen productieback-up of gebruikers kopiëren. Alleen synthetische accounts en testcontent.
2. Laat de origin vastleggen in `scripts/native/distribution-origins.json`, sleutel `internal`, via reviewbare codewijziging.
   Een origin in `store-test` is pas nodig voor latere TestFlight-/Play-testdistributie.
3. Controleer vanaf de ontwikkelcomputer (alleen lezen, nadat #206 is geïntegreerd):
   ```bash
   npm run native:check-test-backend -- "$TEST_ORIGIN" --profile internal --expect-capability security-setup-v1 --expect-capability account-password-v1 --expect-capability account-deletion-v1
   ```
   `TEST_ORIGIN` moet vooraf bewust op de goedgekeurde HTTPS-origin staan. Geen placeholder invullen.
4. Maak op de testbackend een synthetisch account met bruikbaar wachtwoord en een synthetisch testbeheeraccount.
   Registreer met een testmailvoorziening of laat uitsluitend de testbeheerder het testaccount bevestigen; niet de mailbeveiliging omzeilen in de app.
   Gebruik voor herstel-/registratieproeven een aparte testmailvoorziening, geen productie-SMTP-configuratie kopiëren.

## M0: Android installeren zonder storecredentials

**Waar:** ontwikkelcomputer met Node 24, JDK 21, Android SDK 36 en Android Studio; aangesloten Android-telefoon met USB-debugging.
De volgende opdrachten wijzigen uitsluitend de lokale bouwmappen en installeren een debugapp op het bewust gekozen testtoestel.

```bash
npm ci
npm run db:generate
CAPACITOR_BUILD_PROFILE=local-internal NATIVE_DISTRIBUTION_CHANNEL=internal NATIVE_API_BASE_URL="$TEST_ORIGIN" npm run native:build
CAPACITOR_BUILD_PROFILE=local-internal NATIVE_DISTRIBUTION_CHANNEL=internal NATIVE_API_BASE_URL="$TEST_ORIGIN" npx cap sync android
node scripts/native/verify-distribution.mjs android
cd android
./gradlew :app:assembleDebug --no-daemon
adb devices
# Kies bewust het serienummer uit de vorige, alleen-lezen lijst:
adb -s "$ANDROID_TEST_DEVICE" install -r app/build/outputs/apk/debug/app-debug.apk
```

Verwacht: testbanner met intern kanaal, lokale schermen, `compileProbe:false` in `dist/native/build.json`, exact de goedgekeurde backendorigin.
Geen uploadkeystore of Play-account nodig. De bestaande app-ID is `app.versado.app`: installeer niet over een bestaande anders getekende app zonder bewust besluit.
Bij een handtekeningconflict stoppen; niet automatisch verwijderen, want dat wist lokale appgegevens. De eigenaar kiest zo nodig een schoon testtoestel.
Bewaar de APK samen met zijn **eigen** build.json en commit-SHA; de CI-compileproef is geen bruikbare M0-app.

## M0: iPhone installeren zonder store-upload

**Waar:** Mac met ondersteunde Xcode, Node 24 en een aangesloten iPhone; Developer Mode en vertrouwde ontwikkelcomputer.
Een iOS-toestelbuild vereist lokale Apple-ontwikkelondertekening, ook zonder App Store Connect-API-sleutels.

```bash
npm ci
npm run db:generate
CAPACITOR_BUILD_PROFILE=local-internal NATIVE_DISTRIBUTION_CHANNEL=internal NATIVE_API_BASE_URL="$TEST_ORIGIN" npm run native:build
CAPACITOR_BUILD_PROFILE=local-internal NATIVE_DISTRIBUTION_CHANNEL=internal NATIVE_API_BASE_URL="$TEST_ORIGIN" npx cap sync ios
node scripts/native/verify-distribution.mjs ios
npx cap open ios
```

Kies in Xcode **App → Signing & Capabilities → eigen Development Team**, het aangesloten fysieke toestel en **Run (Debug)**.
Bewaar geen teamcredentials, certificaten of provisioningprofielen in git. Controleer de lokale projectdiff; lokale teaminstellingen zijn geen onbedoelde repositorywijziging.
Een Personal Team kan beperkingen hebben; een korte lokale ontwikkelinstallatie is geen TestFlight-distributie of storegoedkeuring.
Zonder beschikbare Mac, ontwikkelondertekening en iPhone is dit apparaatbewijs geblokkeerd; een simulator telt daarvoor niet.

## M0-testprotocol (per fysiek toestel invullen)

Leg vast: exacte git-SHA, appversie/build, gecontroleerde backendorigin en backend-SHA, toestel/OS, installatiekanaal, datum en feitelijke uitkomst.
Maak pas een formeel apparaatrapport nadat de proeven werkelijk op het toestel zijn uitgevoerd; het bestaan van een leeg rapport is geen bewijs.

| Proef | Verwachte uitkomst |
|---|---|
| Installatie en eerste start | Lokale testbanner, juiste backend, geen lege pagina of remote website |
| Registratie, bevestiging, login | Synthetisch account; fouten duidelijk, verplichte beveiligingsstappen blijven verplicht |
| Veilige sessieopslag | Heropening werkt via Keychain/Keystore; geen sessietokens in browseropslag of logs |
| Logout en nieuwe login | Oude sessie/socket ongeldig, geen vorige accountgegevens, nieuwe login werkt |
| Sluiten/herstart, achtergrond/voorgrond | Leesroute en autorisatie veilig hersteld; zichtbare data opnieuw gecontroleerd |
| Netwerkverlies/herstel | Lokale fout/offlinemelding, herstel zonder lege pagina; geen offline beloning of automatische schrijfretry |
| Kleine telefoon, 200% tekst, lange vertaling | Geen horizontale overflow, controls bereikbaar, correcte safe areas en toetsenbord |
| Android-terug / iOS-terug | Bestaande lokale geschiedenis; geen lege route of onverwachte remote navigatie |
| Lezen en bewust afronden | Alleen server slaat voortgang op; herhaalde opening toont de opgeslagen leesstatus, geen extra XP |
| Accountverwijdering na #205 | Expliciet wachtwoord plus TOTP/herstelcode waar van toepassing; alleen synthetisch eigen account verwijderd |
| Fouten/crashes | Geen blanco scherm, secrets of onverwachte gesloten app; reproduceerbare stappen vastleggen |

M0 bewijst alleen het huidige lokale fundament. Vandaag, Leren, CFM en audio worden pas als Mobile 1.0 getest na hun eigen implementatie.
WP6 brengt hun gedeelde gegevens-/navigatiegrenzen eerst onder controle; ontbrekende bestemmingen worden niet als knoppen toegevoegd.

## Eigenaarstaken richting TestFlight en Play

- Nu nodig voor M0: testbackendorigin + bereikbaarheid, Android-testtoestel, iPhone/Mac en lokale ontwikkelondertekening.
- Voor echte testdistributie: beschermde omgevingen `ios-testflight`/`android-play-test` met vereiste goedkeurders en alleen daarin secrets;
  store-testallowlist/origin, Apple Team-/ASC-gegevens en Android-uploadsleutel volgens [releaseplan](NATIVE-STORE-RELEASE-PLAN.md).
- Voor publieke release: definitieve voorwaarden/bewaarbeleid aanleveren, Apple-inlogscope beslissen, tijdelijke pariteitsuitzonderingen expliciet beoordelen,
  volledige optie-B-functionaliteit en fysiek apparaatbewijs afronden. Geen generieke toestemmingsvraag nodig voor de reeds goedgekeurde ontwikkelrichting.
- De handmatige distributieworkflows bouwen/exporteren slechts; ze uploaden niet naar Apple of Google. Starten of uploaden vraagt afzonderlijk eigenaarbesluit.
