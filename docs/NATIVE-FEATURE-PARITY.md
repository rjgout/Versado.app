# Native functiepariteit — Versado

Gecontroleerde ontwikkelbasis: `origin/main` op `e76bc9f7c04b7b9e6faffb97c255184e0c5fb018`. Inventarisatie op 21 oktober 2026. Roadmap: [issue #163](https://github.com/rjgout/Versado.app/issues/163). Dit is implementatievoorbereiding en technische verificatie, geen onafhankelijke acceptatie-audit.

## Doel, bewijs en grens

Iedere bestaande functie moet bruikbaar zijn op web/PWA, lokaal gebundeld iOS/iPadOS en Android. Er zijn **geen goedgekeurde web-only uitzonderingen**. Remote-preview, een link naar de website, een lege route of een route in deze inventaris is geen native equivalent. `CAPACITOR_BUILD_PROFILE=release` blijft geblokkeerd.

De bestaande lokale entry is `src/components/native/entry.tsx`; `NativeFoundation.tsx` bevat schermtoestanden, nog geen volledige URL-router. De beperkte proef ondersteunt login/registratie/resetaanvraag, een Vandaag-leeskaart, tekst van een hoofdstuk, bewust afronden en Apple-koppeling. Zij levert geen volledige pariteit van de bijbehorende webpagina's. Er is geen native gereedstatus op basis van alleen deze inventaris of Chromium toegekend.

De actuele broninventaris staat hieronder; de bijlage [native-feature-parity.inventory.json](native-feature-parity.inventory.json) bevat alle gevonden bestanden met inhoudshashes, importafhankelijkheden, requestpaden en bestaande testbestanden. De historische aantallen in PLATFORMEN beschrijven een oudere uitgangssituatie en gelden niet als actuele dekking.

## Gedeelde voorwaarden per functie

Elke paginarij hieronder erft het bijbehorende domeinbeleid uit de functiematrix, inclusief opslag, fouten, beide native platformen, testvereisten en blokkades. De pagina- en API-tabellen voegen de exacte route, bron, rendergrens en aangetroffen contract-/authinformatie toe. Een lege native contractdekking betekent **ontbreekt**, niet toegestaan via een algemene bearer-bypass.

- **P — platformvoorwaarden:** iPhone en Android-telefoon portrait; iPad en Android-tablet beide oriëntaties. De bestaande `vs`-tokens, safe areas en centrale shell blijven leidend. Test 320 px, 200% tekst, lange vertalingen, light/dark, touch, toegankelijkheid, keyboard en Android-back. Externe links via de platformadapter; Universal/App Links vereisen nog eigenaarconfiguratie.
- **A — autorisatie:** één User-identiteit, centrale contentbeschikbaarheid en servervalidatie. Cookie-auth blijft uitsluitend webauth; native gebruikt afzonderlijke NativeSession Bearer-auth. Elke serverloader en mutatie moet hetzelfde actor-/bron-/eigenaarsbeleid behouden. Statische authsignalen in de inventaris zijn geen bewijs dat alle uitvoerpaden zijn afgedekt.
- **S — opslag/synchronisatie:** PostgreSQL blijft de bron van waarheid voor account, gelezen/studievoortgang, XP, reeks, ranglijst en spelstaat. Refreshstatus uitsluitend Keychain/Keystore; access-token alleen in geheugen. Geen gevoelige gegevens in localStorage, URL, logs of PWA-cache. Geen tweede voortgangs- of beloningssysteem.
- **O — offline/fouten:** lokale shell moet starten zonder backend. Toon echte netwerk-, sessie-, lege en foutstatussen. Alleen expliciet toegestane niet-gevoelige gegevens mogen worden gecachet. Mutaties worden niet automatisch herhaald of offline beloond zonder idempotent servercontract. Bewaar bestaande servervoortgang; herstel via geautoriseerde re-fetch/reconnect.
- **T — bewijs:** bestaande webtests staan in de JSON-testindex; hun aanwezigheid is geen geslaagde uitvoering en geen native bewijs. Iedere geïmplementeerde native functie vereist contract-/rechten-/replaytests, lokale navigatie-/fout-/layouttests en uiteindelijk echte iOS- en Android-apparaatresultaten. Er zijn hier geen Xcode, Android SDK of fysieke apparaten aangetroffen (`java` wel); echte native builds, Keychain/Keystore, APNs/FCM en apparaatacceptatie zijn niet geclaimd.

## Functiematrix

Alle tien gevraagde aspecten zijn opgenomen: webfunctie/route, backend, native bestemming, rechten, opslag/sync, offline/foutgedrag, iOS/iPadOS/Android, technische dekking, status en blokkade. Elke concrete URL staat bovendien in de volledige paginatabel; geen route valt buiten de inventaris omdat haar domein hieronder groter is.

Functie en webroutes | Backend / gedeeld domein | Native bestemming | Authenticatie/autorisatie | Opslag/sync | Offline/fouten | Platformen | Testdekking | Status | Blokkade
--- | --- | --- | --- | --- | --- | --- | --- | --- | ---
Vandaag, acties, dagelijkse doelen, beloningen, CFM, kaartvoorkeuren (`/dashboard`, `/acties`, `/xp`, `/streak`, `/shop`) | `today.ts`, courseSummaries, activeGames, dailyTargets, list-order; bestaande actor-/beloningsservices | Dezelfde routes en bestaande kaarten | A; eigen account, bronrechten, serverbepaalde beloning | S; voorkeuren en voortgang server-side | O; geen offline XP/reeks | P | Foundation-tests bewijzen uitsluitend één leeskaart; Today-/CFM-/kaarttests zijn webbewijs | Gedeeltelijke leesproef; volledige Vandaag ontbreekt | Volledige Today-contracten, gedeelde shell/data-adapters en apparaattests
Contentkiezer, bron en taal (`/content`) | contentCollections/contentSwitch/contentRouting; `/api/content-context` | `/content` met dezelfde veilige wissel | A; beschikbare editie/collectie, geen UI-only beveiliging | S; activeContentCollectionId/contentLanguage, bestaande koers behouden | O; onbeschikbare wissel slaat niets op | P | content-switch, content-picker browser, availability/socket | Ontbreekt | Native contextcontract, gecentraliseerde invalidatie en alle route-equivalenten
Cursusbeheer en leerpaden (`/courses/**`) | courses, courseProgress, readingCourses, cfmCourses; subscribe/unsubscribe en list-order | Zelfde cursus-/pad-URL's met gedeelde kaarten | A; ingeschreven/zichtbare cursus, geen implicitiete activatie bij toevoegen | S; bestaande UserCourseProgress, geen duplicaten; CFM-identiteit per collectie | O; schrijfuitval zichtbaar; geen automatische dubbele inschrijving | P | cards, course-sync/identity, reading-path, CFM-integratie | Ontbreekt | Native catalogus-/cursuscontracten en platformonafhankelijke componentimports
Lezen en oefenen (`/lesson/**`, `/scripture/**`, `/reading-lesson/**`, `/practice`) | contentProgress, learning, oefeningen/antwoordvalidatie, referenties; hoofdstuk/audio-API's | Zelfde lees-/lesroutes met gedeelde lezer en completion-flow | A; contentAccess, eigen voortgang, servercorrectheid | S; bestaande leesposities/markeringen/XP; replaybescherming | O; tekstproef start lokaal maar haalt tekst online; geen offline beloningen | P; audio lifecycle, grote tekst | Foundation hoofdstuk/complete; learning-, reader-, exercise-, audio-/referentietests op web | Alleen beperkte hoofdstuktekst en gelezen-actie gedeeltelijk | Volledige lezer, audio, oefeningen, annotaties, hervatten en native contracten
CFM, FSY en studiemap (`/study-lesson/**`, `/fsy/**`, `/study-folder`, `/bookmarks`) | studiecatalogus/publicaties/revisies, StudyAnnotations, StudyStepProgress, studyOrigin | Zelfde routes, herkomst en zes stappen | A; publicatie-/collectiegrens, eigendom van annotaties | S; gedeelde annotaties, geen tweede systeem; stappen geven geen XP/READ | O; geen schrijfwachtrij zonder conflictcontract | P; selecteren/annoteren, keyboard en terug | study-/annotation-/CFM-tests en browserflows | Ontbreekt | Versiecontracten voor revisies/annotaties/lezen en gedeelde route-/data-laag
Introductie, kinderverhalen en podcasts (`/intro/**`, `/kids/**`, `/podcast/**`) | bestaande intro/kids/episode-/cursusservices, eigen audio-/afbeeldingsrechten | Zelfde routes en modes | A; cursus-/bronrechten | S; bestaande voltooiings- en oefenrecords | O; grote media niet impliciet meebundelen; fout/herstart zichtbaar | P; beeld, audio, lifecycle | lesson-flow, kids, podcast/audio-/cursustests | Ontbreekt | Native les-/media-/oefencontracten; toegestane mediatoken-/streamstrategie
Woordzoeker en Woord van de Dag (`/word-search/**`, `/word-game`) | bestaande create/find/give-up/answer/hints, serverprijzen en scores | Zelfde spel- en hervatroutes | A; gameAvailability + eigen game; beloningen uitsluitend server | S; één spelstaat en betaalde hints | O; geen offline hints/score; gecontroleerde replay | P; touch, letterselectie, focus | word-search, word-game-hints en browser-/integratietests | Ontbreekt | Native spelcontracten en gedeelde geautoriseerde transportlaag
Scrabble en Raad het hoofdstuk (`/scrabble/**`, `/chapter-guess/**`) | bestaande wedstrijden/beurten/uitnodigingen, Socket.io-notificaties | Zelfde wedstrijd-URL's en solo-flow | A; deelnemers, beurt, bronrechten | S; serverversie/beurt, geen dubbele actie | O; hervatten/re-fetch na reconnect | P; toetsenbord, bord, Android-back | scrabble, chapter-guess en rechten-/sockettests | Ontbreekt | Native realtimehandshake en expliciete mutationcontracten
De Slimste Heilige (`/alleskenner/**`) | bestaande solo-/seizoen-/matchservices | Zelfde lobby/solo/seizoen/resultaat | A; deelnemer en serverregels | S; bestaande scores, seizoenen en prijzen | O; serververloop en reconnect, geen offline winst | P; timers en lifecycle | alleskenner-unit-/integratie-/browsertests | Ontbreekt | Native lobby-/match-/seizoencontracten en realtime
Live quiz en gezinsavond (`/live/**`, `/gezinsavond`) | gameServer, gasten, vragen, dobbel-/event-/hint-/antwoordacties | Zelfde lobby, code, beurt en resultaat | A; host/deelnemer/gastbeleid blijft per event server-side | S; één live room en gevalideerde XP | O; reconnect en snapshot, geen blinde replay | P; voorgrond/achtergrond en touch | game-availability socket en live-game tests | Ontbreekt | Native sessieauth bij handshake én lopende packets; hervatcontract
Legpuzzel (`/jigsaw/**`) | bestaande sessie-/match-/variant-/recordservices en servervraag | Zelfde catalogus/bord/samen/wedstrijd/record/afronding | A; spelers, bron, gedeelde toegang en recordprivacy | S; bestaande voortgang, locks, antwoord en prijs | O; idempotente afronding, reconnect/beeldfouten | P; Focus/Immersive, multitouch, achtergrond | puzzle engine, flow, multiplayer, privacy en echte browsers | Ontbreekt | Native API-/socket-/assetcontracten en gedeelde shellmodi
Vliegende gids (`/snelle-zendeling/**`) | quickMissionary seed/serverklok/match/run/Genees | Zelfde lobby/run/samen/ranglijst | A; eigen run, deelnemers, server fair-play | S; serverbepaalde prijs/revive en één run | O; geen offline uitslagen, serverhervatten | P; immersive, lifecycle en touch | quick-missionary source-/run-/matchtests | Ontbreekt | Native reconnect-/actiecontract en lokale assets
Mysteries / Het Verborgen Woord (`/mysteries/**`) | bestaande mystery catalogus, sessies, hints en voltooiing | Alle bestaande afleveringen en play-routes uit de paginatabel | A; beschikbaarheid en eigen sessie | S; bestaande hints en voltooiing, geen nieuwe verhaaldata | O; hervatten, geen offline prijs | P; lange tekst, keyboard en terug | mystery persistence en speltests | Ontbreekt | Volledige lokale routecatalogus en servercontracten
Versado Dorp (`/dorp/**`, `/dev/versado-dorp`) | bestaande dorpwereld, inventaris, bouw-/pad-/groeps-/giftservices | Zelfde dorp-, bezoek- en groepsroutes; dev-route volgens bestaande gate | A; eigenaar/groepsrol/vriendprivacy; geen nieuwe rechten | S; bestaande mutationId/wereldversie en locking | O; conflicten expliciet, geen offline XP-/voorraadbron | P; sprites, multitouch, oriëntatie en performance | dorp/privacy/registration-/browser-/iPhone-simulaties (geen echt toestelbewijs) | Ontbreekt | Native wereld-/actiecontract, assets en reconnect
Vrienden, groepen, activiteit, uitnodigingen (`/friends/**`, `/groups/**`, `/activity`, `/uitnodiging/**`) | social services, friendship/streak/group memberships, notifications en aanwezigheid | Zelfde profielen, groep, instellingen en uitnodigingslinks | A; privacy, vriendrelatie, MEMBER/ADMIN en eigenaarcontrole per actie | S; serverlidmaatschap, seintjes en intrekkingen | O; actuele snapshot na resume, geen dubbele uitnodiging/actie | P; deelblad, links en Android-back | social, social-links, group/privacy en sockettests | Ontbreekt | Geautoriseerde native contracten, pending deeplink na login en realtime
Competitie, uitdagingen en ranglijsten (`/competition`, `/challenges`, `/groups/leaderboard`) | league/challenge/ranking services, één gezamenlijke competitie | Zelfde route/tab en uitnodigingen | A; deelnemer, zichtbaarheids-/scorebeleid | S; één serverranglijst en uitslag | O; recente weergave geen vervangende offline score | P | league/challenge/social tests | Ontbreekt | Native status-/actiecontracten en verversing
Profiel, avatar, gids, prestaties, taal en meldingsvoorkeuren (`/profile/**`, alle `?view=`-schermen hieronder) | account/profile/featured-achievements, companion/avatar/languages | Zelfde profiel- en queryschermen; Foundation heeft alleen beperkte Apple-accounttoestand | A; eigen account, ontgrendelingen en privacy | S; bestaande User-/achievementvoorkeuren | O; geen stil verlies van wijziging; server herladen na fout | P; avatarassets, grote tekst, formulierkeyboard | profile, guide, avatar, privacy, cards en native me-schema | Volledige profielroutes ontbreken | Native profielcontracten en gedeelde bestaande UI
Registratie, onboarding, login, wachtwoord en TOTP (`/login`, `/register`, `/onboarding`, `/forgot-password`, `/reset-password`, `/change-password`, `/verify-email`) | registration, authTokens, TOTP/recovery, nativePasswordLogin/sessions | Zelfde lokale accountflows; bestaande Foundation-login/register/resetaanvraag als uitgangspunt | A; bevestiging, mustChangePassword, admin-2FA; geen bypass | S; Keychain/Keystore, duurzame refresh/revocation; geen token in URL | O; pending logout nooit hervatten, auth-races afvangen | P; Apple AuthenticationServices, veilige input en lifecycle | native-foundation, registration, security-hardening en 2FA-tests | Gedeeltelijk; onboarding/reset/wijziging/TOTP-beheer ontbreken | Sessiewisselingen/duurzame intenties corrigeren; volledige accountcontracten; echte veilige opslag bewijzen
Account wissen en Apple-identiteit | accountDeletion, ExternalIdentity, Apple-challenges; geen nieuw User-systeem | Lokale accountbeveiliging en wisbevestiging | A; expliciete reauth, TOTP, laatste inlogmethode, alle sessies/socket intrekken | S; bestaande complete wisprocedure incl. PendingRegistration; geen secrets loggen | O; gevoelige actie online, geen blinde retry | P; echte Apple capability/signing vereist | native identity-/security- en accountdeletiontests | Apple-fundament gedeeltelijk; native wissen ontbreekt | Native wis-/reauthcontract en Apple-accountlevenscyclus op apparaten
Audio, podcast, zoeken en tools (`/tools/**`, `/dev/lofzangen`, audio-API's) | dictionary/persons, media/Range, hymn/search services, bronmetadata | Zelfde tools/zoek-/audiofuncties, inclusief bestaande dev-gate | A; bron-/bestandsrechten vóór stream; geen publieke privé-audio-URL | S; afspeelpositie waar bestaand; media alleen toegestaan cachen | O; expliciet download-/streambeleid; storingen en resume | P; WebView/OS-audio, externe URL's en lifecycle | audio, reference, hymns, dictionary en contentrechten | Ontbreekt | Veilige native mediatransportkeuze; streamheaders/Range en apparaten
Notificatie-inbox en push | notifications, bestaande webpush/VAPID; nog geen APNs/FCM-model | Lokale inbox en bestaande voorkeuren; eigen native kanaal | A; eigen meldingen en device-token-eigendom | S; native device tokens apart van Web Push; dezelfde voorkeuren | O; inbox herladen; intrekking/rotatie op logout en reinstall | P; APNs/FCM-permissie/configuratie nog niet aanwezig | web push-/social tests; geen APNs/FCM devicebewijs | Ontbreekt | Apart device-model/providercontract en eigenaarcredentials; geen fictieve configuratie
Kompas, feedback en juridisch (`/kompas/**`, `/feedback/**`, `/privacy`, `/cookies`, `/uitschrijven/**`) | bestaande Kompas-uitleg, feedbackselectie/ontvanger, tokenbeheerde acties | Lokale uitleg/formulieren/juridische tekst; geen website-doorverwijsplaceholder | A; feedbackeigenaar/admin-capability en ondertekend uitschrijven | S; geen secrets in feedback; bestaande veilige selectie | O; lokale juridische/shelltekst, formulier online met foutstatus | P; share/externe bewijsl links via adapter | kompas, feedback, security en browserlayout | Ontbreekt; privacy opent nu alleen extern | Gedeelde lokale documentweergave, feedbackcontracten en goedgekeurde voorwaarden-URL
Beheer (`/adminbackend/**`, alle beheer-API's hieronder) | bestaande gebruikers/content/publicatie/game/communicatie/systeemservices | Dezelfde beheerfuncties uitsluitend voor bevoegde gebruiker | A; isAdmin + bestaande 2FA/mustChangePassword en actiebevoegdheid; beheer-API/sleutelroutes behouden eigen beleid | S; één backend; geen contentupload/deploy op productie in deze opdracht | O; gevoelige beheeracties online, geen onveilige herhaling | P; grote lijsten/paginering, uploads en keyboard | admin/content-inventory/publication/security tests | Ontbreekt | Expliciete native admincontracten, nooit onbedoeld algemene native beheerrechten
Overige routes en metadata | Alle aanvullende API's/pagina's hieronder, robots/sitemap/branding/health/unsubscribe | Verplichte beoordeling; metadata is geen appscherm | A; iedere route behoudt haar eigen publieke/sessie/token/admin/service-beleid | S en O volgens echte route; geen impliciete uitzondering | O; geen generiek offline muteren | P waar gebruikersinteractie bestaat | Zie bron- en testindex, geen native gereedclaim | Ontbreekt of backendfunctie zonder lokaal scherm | Elke niet-geclassificeerde route beoordelen vóór release; geen stilzwijgende uitsluiting

## Bestaande native backendgrens

Alleen `src/app/api/v1/native/[...path]/route.ts` exporteert de fysieke native handler. `src/lib/native/api.ts` implementeert onderstaande logische versie-1-contracten. Exacte toegestane origins zijn `capacitor://localhost` en `https://localhost`, met `X-Versado-Client: native-v1`. Geen cookies/credential-CORS. De API staat standaard uit. De inhoudsschema's staan in `src/lib/native/contract.ts`; niet iedere response is al een volledig functiecontract.

Methode / native pad | Huidig contract / rechten | Volledige pariteit
--- | --- | ---
GET capabilities | API-versie, werkelijk geconfigureerde Apple-functie, registratie | Geen volledige capability-/compatibiliteitsmatrix
POST login | Wachtwoord + optionele TOTP; bestaande accountgates | Sessiewissel-/durabiliteitscorrecties en apparaatbewijs nodig
POST register | Bestaande registratieflow, begrensde invoer | Geen volledige onboarding/invite-/verificatie-UI
POST forgot-password | Bestaande generieke mailaanvraag | Resetlink en voltooien ontbreken lokaal
POST refresh | Rijlock, roterend geheim, duurzame actionId en replaycontrole | Client-races/duurzame opslag verder testen en corrigeren
POST logout | Eigen NativeSession intrekken; offline intentie lokaal | Alle-device accountflow ontbreekt als native contract
POST apple/challenge | Sign-in of gebonden link met bestaande herauth | Eigenaarconfiguratie en echte Apple-flow ontbreken
POST apple/complete | Geverifieerde identity/challenge, bestaande User-identiteit | Herkomst van client-authgeneratie en volledige lifecycle bewijzen
DELETE apple | Actuele sessie + wachtwoord/TOTP, laatste methode behouden | Apple-only alternatief en echte devices nog te bewijzen
GET me | Minimale identiteit, taal, onboardingvlag en Apple-status | Geen volledige profiel-/privacy-/accountinstellingen
GET today | Eén toegankelijke hoofdstukleeskaart | Geen volledige Vandaag-pagina
GET chapters/:id | Tekstverzen + leesstatus, bronrechten; begrensde hoofdstukgrootte | Geen volledige lezer, audio, annotaties of oefeningen
POST chapters/:id/complete | Bestaande completeChapterReading-service | Geen volledige cursus-/leer-/spelcompletion
OPTIONS catch-all | Exacte native CORS-preflight | Geen uitbreiding naar willekeurige origins

## Rollen, sessies en externe voorwaarden

- Publiek/uitgelogd, bevestigd/niet-bevestigd account, `mustChangePassword`, gewone gebruiker en `User.isAdmin` zijn onderscheiden. Admin-TOTP en recovery blijven serverbeleid. De client mag geblokkeerde stappen niet overslaan.
- Groepsrol is `GroupRole.MEMBER` of `GroupRole.ADMIN`; vrienden-/groep-/dorp-/matchrechten hangen ook aan relatie, deelname, eigenaar en beschikbaarheid. Dit zijn geen algemene adminrechten. De API-tabel noemt statische bewijssignalen, geen zelfstandig goedgekeurde rechtenmatrix.
- Feedbackbeheer en uitschrijven hebben eigen capability-/ondertekende tokens. Admin-service-/automatiseringsroutes zijn geen algemene gebruikersroutes. Native migratie mag die geheimen niet in appcode opnemen.
- Huidige Socket.io-client gebruikt webcookies; hij is nog niet native-geauthenticeerd. Handshake, packetvalidatie, sessie-intrekking, reconnect, snapshots en dubbele events vereisen expliciete native aansluiting, met dezelfde bestaande spel-/privacycontroles.
- APNs/FCM-configuratie, Apple Team/Sign in with Apple, Android signing fingerprint, Universal/App Links, TestFlight/Play Console, juridische/storeteksten en reviewaccounts worden niet verzonnen. Signing en publicatie blijven eigenaarhandelingen. Geen apparaatbewijs betekent dat de releasegate gesloten blijft.
- De onafhankelijke acceptatie-audit uit issue #163 is niet door Codex uitgevoerd of als geslaagd gemarkeerd.

## Migratiebesluit en volgorde

De bestaande hybride architectuur uit [PLATFORMEN.md](PLATFORMEN.md) blijft staan. Er komt geen remote-websiteproductieprofiel, algemene cookie/bearer-bypass, tweede frontendproduct of nieuwe offline beloningsbron.

De eigenaar heeft op 21 oktober 2026 gekozen voor **gedeelde navigatie- en datalaag per functie**: bestaande schermcomponenten worden stapsgewijs bruikbaar voor Next.js én de lokale app, met expliciete native API-contracten. `CoursesClient`, `ProfileClient`, `LiveLobbyForm` en spelcomponenten gebruiken nu nog Next-imports en relatieve cookie-API's. Die afhankelijkheden worden per functie vervangen door gedeelde poorten met afzonderlijke web/native adapters; er komen geen build-time Next.js-compatibiliteitsshims.

Vervolg-PR's blijven afhankelijk van deze eerste matrix, het router/data-besluit en geteste authcorrecties. Daarna: shell/context/account → bestaande lees-/leer-/spelroutes → sociaal/realtime → media/push → release-/storevoorbereiding. Geen fase wordt technisch voltooid verklaard zolang een bestaande functie ontbreekt of apparaat-/onafhankelijk bewijs ontbreekt.

## Verificatie sessiewisselingen

De client serialiseert beveiligde read/wijzig/write-transacties en bindt authenticatie, refresh en API-antwoorden aan één sessiegeneratie. Een laat antwoord van account A levert geen data of mutatie onder account B op. Ook de Apple-challenge begint binnen die generatie. Oude refreshgeheimen blijven als intrekkingsintentie in dezelfde Keychain/Keystore-status, naast een later ingelogd account, totdat de backend intrekking bevestigt. Een late logout wist alleen zijn eigen intentie. De 4096-byte bridgegrens blijft gelden; er worden geen intenties weggegooid om een nieuwe login passend te maken.

`tests/native-foundation.test.ts` reproduceerde eerst drie oude races en bevat nu zeven extra regressies, waaronder offline heropening en een generatiewissel tijdens de native opslagwrite. Dit is technische clientverificatie met een opslagadapter; echte Keychain/Keystore- en Apple-apparaatacceptatie blijft open.

## Permanente controle

`npm run native:parity:update` actualiseert alleen bronfeiten; de reviewer moet de functionele statussen, rechten, contracten, uitzonderingen en tests afzonderlijk beoordelen. `npm run native:parity:check` controleert dat routes, modules en inventaris niet uit elkaar lopen. Deze controle bewijst registratie, niet werkende native schermen, en heft geen releaseblokkade op. Nieuwe of gewijzigde features zijn pas functioneel afgerond op web/PWA én iOS/Android, of met een expliciet goedgekeurde en gedocumenteerde platformuitzondering.

<!-- BEGIN NATIVE PARITY INVENTORY -->
## Volledige broninventaris (gegenereerd)

Gevonden: **138 pagina's**, **233 fysieke routehandlers**, **399 JSX-modules**, **12 profiel-queryschermen**. Een catch-all route kan meerdere logische endpoints bevatten.

De JSON-bijlage bevat per route alle transitief bereikbare lokale modules, clientgrenzen en statische requestpaden. Dat is een afhankelijkheidsinventaris, geen autorisatiebewijs; voorwaarden per HTTP-methode blijven apart te controleren. Een Client Component kan via een gedeelde helper nog een serverafhankelijkheid hebben. Een module zonder eigen `use client` is contextafhankelijk, niet automatisch browsergeschikt.

### Iedere webpagina

Route | Bron / rendergrens | Domeinbeleid | Native scherm / status | Data- en authbewijs in bron | Testbewijs
--- | --- | --- | --- | --- | ---
`/` | [src/app/page.tsx](../src/app/page.tsx); Server Component-entry | overig-vandaag | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/brand.ts; src/lib/branding.ts; src/lib/gameSettings.ts; src/lib/i18n/index.ts; src/lib/requestLanguage.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/acties` | [src/app/acties/page.tsx](../src/app/acties/page.tsx); Server Component-entry | overig-vandaag | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/activity` | [src/app/activity/page.tsx](../src/app/activity/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/adminbackend` | [src/app/adminbackend/page.tsx](../src/app/adminbackend/page.tsx); Server Component-entry | beheer | Zelfde doel-URL; ontbreekt in lokale router | requireAdminPage; src/lib/adminGuard.ts; src/lib/contentCollections.ts; src/lib/db.ts; src/lib/deployAgent.ts; src/lib/email.ts; src/lib/i18n/index.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/adminbackend/communicatie` | [src/app/adminbackend/communicatie/page.tsx](../src/app/adminbackend/communicatie/page.tsx); Server Component-entry | beheer | Zelfde doel-URL; ontbreekt in lokale router | requireAdminPage; src/lib/adminGuard.ts; src/lib/email.ts; src/lib/i18n/index.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/adminbackend/content` | [src/app/adminbackend/content/page.tsx](../src/app/adminbackend/content/page.tsx); Server Component-entry | beheer | Zelfde doel-URL; ontbreekt in lokale router | requireAdminPage; src/lib/adminGuard.ts; src/lib/i18n/index.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/adminbackend/content-preview` | [src/app/adminbackend/content-preview/page.tsx](../src/app/adminbackend/content-preview/page.tsx); Server Component-entry | beheer | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/chapterTerm.ts; src/lib/contentAccess.ts; src/lib/db.ts; src/lib/i18n/index.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/adminbackend/content/inspect` | [src/app/adminbackend/content/inspect/page.tsx](../src/app/adminbackend/content/inspect/page.tsx); Server Component-entry | beheer | Zelfde doel-URL; ontbreekt in lokale router | requireAdminPage; src/lib/adminContentInspection.ts; src/lib/adminGuard.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/adminbackend/content/study-publications` | [src/app/adminbackend/content/study-publications/page.tsx](../src/app/adminbackend/content/study-publications/page.tsx); Server Component-entry | beheer | Zelfde doel-URL; ontbreekt in lokale router | requireAdminPage; src/lib/adminGuard.ts; src/lib/studyContent/admin.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/adminbackend/gebruikers` | [src/app/adminbackend/gebruikers/page.tsx](../src/app/adminbackend/gebruikers/page.tsx); Server Component-entry | beheer | Zelfde doel-URL; ontbreekt in lokale router | requireAdminPage; src/lib/adminGuard.ts; src/lib/dates.ts; src/lib/db.ts; src/lib/i18n/index.ts; src/lib/i18n/serverTexts.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/adminbackend/spellen` | [src/app/adminbackend/spellen/page.tsx](../src/app/adminbackend/spellen/page.tsx); Server Component-entry | beheer | Zelfde doel-URL; ontbreekt in lokale router | requireAdminPage; src/lib/adminGuard.ts; src/lib/db.ts; src/lib/i18n/index.ts; src/lib/leagues.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/adminbackend/systeem` | [src/app/adminbackend/systeem/page.tsx](../src/app/adminbackend/systeem/page.tsx); Server Component-entry | beheer | Zelfde doel-URL; ontbreekt in lokale router | requireAdminPage; src/lib/adminGuard.ts; src/lib/db.ts; src/lib/deployAgent.ts; src/lib/i18n/index.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/alleskenner` | [src/app/alleskenner/page.tsx](../src/app/alleskenner/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canStartGame; getCurrentUser; src/lib/gameAvailability.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/alleskenner/alleen` | [src/app/alleskenner/alleen/page.tsx](../src/app/alleskenner/alleen/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canResumeGameContent; canStartGame; getCurrentUser; src/lib/db.ts; src/lib/gameAvailability.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/alleskenner/alleen/[id]` | [src/app/alleskenner/alleen/[id]/page.tsx](../src/app/alleskenner/alleen/[id]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/alleskenner/seizoen` | [src/app/alleskenner/seizoen/page.tsx](../src/app/alleskenner/seizoen/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canStartGame; getCurrentUser; src/lib/gameAvailability.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/alleskenner/seizoen/[id]` | [src/app/alleskenner/seizoen/[id]/page.tsx](../src/app/alleskenner/seizoen/[id]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/gameSettings.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/bookmarks` | [src/app/bookmarks/page.tsx](../src/app/bookmarks/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/challenges` | [src/app/challenges/page.tsx](../src/app/challenges/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/i18n/index.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/change-password` | [src/app/change-password/page.tsx](../src/app/change-password/page.tsx); Server Component-entry | account | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/chapter-guess` | [src/app/chapter-guess/page.tsx](../src/app/chapter-guess/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canStartGame; getCurrentUser; src/lib/gameAvailability.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/chapter-guess/solo/[gameId]` | [src/app/chapter-guess/solo/[gameId]/page.tsx](../src/app/chapter-guess/solo/[gameId]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/competition` | [src/app/competition/page.tsx](../src/app/competition/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/content` | [src/app/content/page.tsx](../src/app/content/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/contentCollections.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/cookies` | [src/app/cookies/page.tsx](../src/app/cookies/page.tsx); Server Component-entry | hulp-juridisch | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/i18n/index.ts; src/lib/i18n/rich.tsx; src/lib/requestLanguage.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/courses` | [src/app/courses/page.tsx](../src/app/courses/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/i18n/index.ts; src/lib/session.ts; src/lib/studyContent/catalogue.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/courses/[courseId]` | [src/app/courses/[courseId]/page.tsx](../src/app/courses/[courseId]/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | canStartStudy; getCurrentUser; src/lib/contentCollections.ts; src/lib/courseText.ts; src/lib/db.ts; src/lib/email.ts; src/lib/podcastChapters.ts; src/lib/readingCourses.ts; src/lib/session.ts; src/lib/study/startAvailability.ts; src/lib/studyContent/revisions.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/courses/[courseId]/chapter/[chapterId]` | [src/app/courses/[courseId]/chapter/[chapterId]/page.tsx](../src/app/courses/[courseId]/chapter/[chapterId]/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/chapterTerm.ts; src/lib/contentAccess.ts; src/lib/db.ts; src/lib/i18n/index.ts; src/lib/learning/contentProgress.ts; src/lib/readingLessons.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/courses/[courseId]/pad` | [src/app/courses/[courseId]/pad/page.tsx](../src/app/courses/[courseId]/pad/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | canStartStudy; getCurrentUser; src/lib/chapterPathData.ts; src/lib/chapterTerm.ts; src/lib/contentCollections.ts; src/lib/courseText.ts; src/lib/db.ts; src/lib/email.ts; src/lib/i18n/index.ts; src/lib/readingCourses.ts; src/lib/readingPathData.ts; src/lib/session.ts; src/lib/study/startAvailability.ts; src/lib/studyContent/catalogue.ts; src/lib/studyContent/weekSelection.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/dashboard` | [src/app/dashboard/page.tsx](../src/app/dashboard/page.tsx); Server Component-entry | overig-vandaag | Foundation-toestand, gedeeltelijk; geen volledige routepariteit | getCurrentUser; src/lib/email.ts; src/lib/generalConference.ts; src/lib/hymns/sunday.ts; src/lib/session.ts; src/lib/timeZone.ts; src/lib/today.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/dev/lofzangen` | [src/app/dev/lofzangen/page.tsx](../src/app/dev/lofzangen/page.tsx); Server Component-entry | media-hulpmiddelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; getHymnsAccess; src/lib/hymnAvailability.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/dev/versado-dorp` | [src/app/dev/versado-dorp/page.tsx](../src/app/dev/versado-dorp/page.tsx); Server Component-entry | dorp | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/dorp/access.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/dorp` | [src/app/dorp/page.tsx](../src/app/dorp/page.tsx); Server Component-entry | dorp | Zelfde doel-URL; ontbreekt in lokale router | src/lib/dorp/pageAccess.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/dorp/groups/[groupId]` | [src/app/dorp/groups/[groupId]/page.tsx](../src/app/dorp/groups/[groupId]/page.tsx); Server Component-entry | dorp | Zelfde doel-URL; ontbreekt in lokale router | src/lib/db.ts; src/lib/dorp/pageAccess.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/dorp/visit/[userId]` | [src/app/dorp/visit/[userId]/page.tsx](../src/app/dorp/visit/[userId]/page.tsx); Server Component-entry | dorp | Zelfde doel-URL; ontbreekt in lokale router | src/lib/dorp/pageAccess.ts; src/lib/dorp/service.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/feedback` | [src/app/feedback/page.tsx](../src/app/feedback/page.tsx); Server Component-entry | hulp-juridisch | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/feedback.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/feedback/respond/[token]` | [src/app/feedback/respond/[token]/page.tsx](../src/app/feedback/respond/[token]/page.tsx); Server Component-entry | hulp-juridisch | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/db.ts; src/lib/i18n/index.ts; src/lib/requestLanguage.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/forgot-password` | [src/app/forgot-password/page.tsx](../src/app/forgot-password/page.tsx); Server Component-entry | account | Foundation-toestand, gedeeltelijk; geen volledige routepariteit | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/friends` | [src/app/friends/page.tsx](../src/app/friends/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/brand.ts; src/lib/branding.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/friends/[userId]` | [src/app/friends/[userId]/page.tsx](../src/app/friends/[userId]/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/fsy/[lessonId]` | [src/app/fsy/[lessonId]/page.tsx](../src/app/fsy/[lessonId]/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/contentCollections.ts; src/lib/courses.ts; src/lib/db.ts; src/lib/fsyContent.ts; src/lib/i18n/index.ts; src/lib/session.ts; src/lib/studyContent/reader.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/gezinsavond` | [src/app/gezinsavond/page.tsx](../src/app/gezinsavond/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canStartGame; getCurrentUser; src/lib/gameAvailability.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/groups` | [src/app/groups/page.tsx](../src/app/groups/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/groups/[groupId]` | [src/app/groups/[groupId]/page.tsx](../src/app/groups/[groupId]/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/groups/[groupId]/settings` | [src/app/groups/[groupId]/settings/page.tsx](../src/app/groups/[groupId]/settings/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/groups/leaderboard` | [src/app/groups/leaderboard/page.tsx](../src/app/groups/leaderboard/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/groups/new` | [src/app/groups/new/page.tsx](../src/app/groups/new/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/intro/[lessonId]` | [src/app/intro/[lessonId]/page.tsx](../src/app/intro/[lessonId]/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/courses.ts; src/lib/db.ts; src/lib/email.ts; src/lib/exerciseGen.ts; src/lib/i18n/index.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/jigsaw` | [src/app/jigsaw/page.tsx](../src/app/jigsaw/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canResumeGameContent; canStartGame; getCurrentUser; src/lib/db.ts; src/lib/gameAvailability.ts; src/lib/jigsawGame.ts; src/lib/puzzle/coop.ts; src/lib/puzzle/match.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/jigsaw/afgerond` | [src/app/jigsaw/afgerond/page.tsx](../src/app/jigsaw/afgerond/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/contentCollections.ts; src/lib/gameSettings.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/jigsaw/records` | [src/app/jigsaw/records/page.tsx](../src/app/jigsaw/records/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/contentCollections.ts; src/lib/gameSettings.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/jigsaw/records/[variantId]` | [src/app/jigsaw/records/[variantId]/page.tsx](../src/app/jigsaw/records/[variantId]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/contentCollections.ts; src/lib/gameSettings.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/jigsaw/samen/[id]` | [src/app/jigsaw/samen/[id]/page.tsx](../src/app/jigsaw/samen/[id]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canResumeGameContent; getCurrentUser; src/lib/gameAvailability.ts; src/lib/puzzle/coop.ts; src/lib/puzzle/errors.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/jigsaw/wedstrijd/[id]` | [src/app/jigsaw/wedstrijd/[id]/page.tsx](../src/app/jigsaw/wedstrijd/[id]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canResumeGameContent; getCurrentUser; src/lib/gameAvailability.ts; src/lib/puzzle/errors.ts; src/lib/puzzle/match.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/kids/[storyId]` | [src/app/kids/[storyId]/page.tsx](../src/app/kids/[storyId]/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/courses.ts; src/lib/db.ts; src/lib/email.ts; src/lib/exerciseGen.ts; src/lib/i18n/index.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/kompas` | [src/app/kompas/page.tsx](../src/app/kompas/page.tsx); Server Component-entry | hulp-juridisch | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/kompas/mascot.ts; src/lib/kompas/pageData.ts; src/lib/kompas/registry.ts; src/lib/kompas/resolve.ts; src/lib/kompas/state.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/kompas/[topicId]` | [src/app/kompas/[topicId]/page.tsx](../src/app/kompas/[topicId]/page.tsx); Server Component-entry | hulp-juridisch | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/gameCatalog.ts; src/lib/kompas/pageData.ts; src/lib/kompas/registry.ts; src/lib/kompas/resolve.ts; src/lib/kompas/state.ts; src/lib/kompas/tours.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/lesson/[chapterId]` | [src/app/lesson/[chapterId]/page.tsx](../src/app/lesson/[chapterId]/page.tsx); Server Component-entry | leren | Foundation-toestand, gedeeltelijk; geen volledige routepariteit | getCurrentUser; src/lib/annotations/studyFocus.ts; src/lib/audioMirror.ts; src/lib/chapterTerm.ts; src/lib/contentAccess.ts; src/lib/courses.ts; src/lib/db.ts; src/lib/i18n/index.ts; src/lib/learning/contentProgress.ts; src/lib/learning/readingTime.ts; src/lib/learning/routes.ts; src/lib/returnTo.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/live` | [src/app/live/page.tsx](../src/app/live/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/contentCollections.ts; src/lib/gameSettings.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/live/[code]` | [src/app/live/[code]/page.tsx](../src/app/live/[code]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canResumeLiveGame; getCurrentUser; src/lib/courseText.ts; src/lib/db.ts; src/lib/gameAvailability.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/login` | [src/app/login/page.tsx](../src/app/login/page.tsx); expliciete clientgrens | account | Foundation-toestand, gedeeltelijk; geen volledige routepariteit | src/lib/returnTo.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries` | [src/app/mysteries/page.tsx](../src/app/mysteries/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canUseMystery; getCurrentUser; src/lib/i18n/index.ts; src/lib/mysteries/attempts.ts; src/lib/mysteries/game.ts; src/lib/mysteries/progress.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/001` | [src/app/mysteries/001/page.tsx](../src/app/mysteries/001/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery001a.ts; src/lib/mysteries/mystery001b.ts; src/lib/mysteries/mystery001c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/001a` | [src/app/mysteries/001a/page.tsx](../src/app/mysteries/001a/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery001a.ts; src/lib/mysteries/mystery001b.ts; src/lib/mysteries/mystery001c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/001a/play` | [src/app/mysteries/001a/play/page.tsx](../src/app/mysteries/001a/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery001a.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/001b` | [src/app/mysteries/001b/page.tsx](../src/app/mysteries/001b/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/001b/play` | [src/app/mysteries/001b/play/page.tsx](../src/app/mysteries/001b/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery001b.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/001c` | [src/app/mysteries/001c/page.tsx](../src/app/mysteries/001c/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/001c/play` | [src/app/mysteries/001c/play/page.tsx](../src/app/mysteries/001c/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery001c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/002` | [src/app/mysteries/002/page.tsx](../src/app/mysteries/002/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery002a.ts; src/lib/mysteries/mystery002b.ts; src/lib/mysteries/mystery002c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/002a` | [src/app/mysteries/002a/page.tsx](../src/app/mysteries/002a/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/002a/play` | [src/app/mysteries/002a/play/page.tsx](../src/app/mysteries/002a/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery002a.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/002b` | [src/app/mysteries/002b/page.tsx](../src/app/mysteries/002b/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/002b/play` | [src/app/mysteries/002b/play/page.tsx](../src/app/mysteries/002b/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery002b.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/002c` | [src/app/mysteries/002c/page.tsx](../src/app/mysteries/002c/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/002c/play` | [src/app/mysteries/002c/play/page.tsx](../src/app/mysteries/002c/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery002c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/003` | [src/app/mysteries/003/page.tsx](../src/app/mysteries/003/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery003a.ts; src/lib/mysteries/mystery003b.ts; src/lib/mysteries/mystery003c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/003a` | [src/app/mysteries/003a/page.tsx](../src/app/mysteries/003a/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/003a/play` | [src/app/mysteries/003a/play/page.tsx](../src/app/mysteries/003a/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery003a.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/003b` | [src/app/mysteries/003b/page.tsx](../src/app/mysteries/003b/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/003b/play` | [src/app/mysteries/003b/play/page.tsx](../src/app/mysteries/003b/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery003b.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/003c` | [src/app/mysteries/003c/page.tsx](../src/app/mysteries/003c/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/003c/play` | [src/app/mysteries/003c/play/page.tsx](../src/app/mysteries/003c/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery003c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/004` | [src/app/mysteries/004/page.tsx](../src/app/mysteries/004/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery004a.ts; src/lib/mysteries/mystery004b.ts; src/lib/mysteries/mystery004c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/004a` | [src/app/mysteries/004a/page.tsx](../src/app/mysteries/004a/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/004a/play` | [src/app/mysteries/004a/play/page.tsx](../src/app/mysteries/004a/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery004a.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/004b` | [src/app/mysteries/004b/page.tsx](../src/app/mysteries/004b/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/004b/play` | [src/app/mysteries/004b/play/page.tsx](../src/app/mysteries/004b/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery004b.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/004c` | [src/app/mysteries/004c/page.tsx](../src/app/mysteries/004c/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/004c/play` | [src/app/mysteries/004c/play/page.tsx](../src/app/mysteries/004c/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery004c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/005` | [src/app/mysteries/005/page.tsx](../src/app/mysteries/005/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery005a.ts; src/lib/mysteries/mystery005b.ts; src/lib/mysteries/mystery005c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/005a` | [src/app/mysteries/005a/page.tsx](../src/app/mysteries/005a/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/005a/play` | [src/app/mysteries/005a/play/page.tsx](../src/app/mysteries/005a/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery005a.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/005b` | [src/app/mysteries/005b/page.tsx](../src/app/mysteries/005b/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/005b/play` | [src/app/mysteries/005b/play/page.tsx](../src/app/mysteries/005b/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery005b.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/005c` | [src/app/mysteries/005c/page.tsx](../src/app/mysteries/005c/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/005c/play` | [src/app/mysteries/005c/play/page.tsx](../src/app/mysteries/005c/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery005c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/006` | [src/app/mysteries/006/page.tsx](../src/app/mysteries/006/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery006a.ts; src/lib/mysteries/mystery006b.ts; src/lib/mysteries/mystery006c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/006a` | [src/app/mysteries/006a/page.tsx](../src/app/mysteries/006a/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/006a/play` | [src/app/mysteries/006a/play/page.tsx](../src/app/mysteries/006a/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery006a.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/006b` | [src/app/mysteries/006b/page.tsx](../src/app/mysteries/006b/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/006b/play` | [src/app/mysteries/006b/play/page.tsx](../src/app/mysteries/006b/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery006b.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/006c` | [src/app/mysteries/006c/page.tsx](../src/app/mysteries/006c/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/mysteries/006c/play` | [src/app/mysteries/006c/play/page.tsx](../src/app/mysteries/006c/play/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | src/lib/mysteries/mystery006c.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/onboarding` | [src/app/onboarding/page.tsx](../src/app/onboarding/page.tsx); Server Component-entry | account | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/companion.ts; src/lib/contentCollections.ts; src/lib/email.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/podcast/[episodeId]/[mode]` | [src/app/podcast/[episodeId]/[mode]/page.tsx](../src/app/podcast/[episodeId]/[mode]/page.tsx); Server Component-entry | media-hulpmiddelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/courses.ts; src/lib/db.ts; src/lib/email.ts; src/lib/exerciseGen.ts; src/lib/i18n/index.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/practice` | [src/app/practice/page.tsx](../src/app/practice/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/db.ts; src/lib/i18n/index.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/privacy` | [src/app/privacy/page.tsx](../src/app/privacy/page.tsx); Server Component-entry | hulp-juridisch | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/i18n/index.ts; src/lib/i18n/rich.tsx; src/lib/requestLanguage.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/profile` | [src/app/profile/page.tsx](../src/app/profile/page.tsx); Server Component-entry | account | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/profile/avatar` | [src/app/profile/avatar/page.tsx](../src/app/profile/avatar/page.tsx); Server Component-entry | account | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/reading-lesson/[lessonId]` | [src/app/reading-lesson/[lessonId]/page.tsx](../src/app/reading-lesson/[lessonId]/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/audioMirror.ts; src/lib/chapterTerm.ts; src/lib/contentAccess.ts; src/lib/courses.ts; src/lib/db.ts; src/lib/i18n/index.ts; src/lib/learning/contentProgress.ts; src/lib/readingLessons.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/register` | [src/app/register/page.tsx](../src/app/register/page.tsx); expliciete clientgrens | account | Foundation-toestand, gedeeltelijk; geen volledige routepariteit | src/lib/returnTo.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/reset-password` | [src/app/reset-password/page.tsx](../src/app/reset-password/page.tsx); Server Component-entry | account | Zelfde doel-URL; ontbreekt in lokale router | Zie bron en rootlayout; nog expliciet beoordelen | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/scrabble` | [src/app/scrabble/page.tsx](../src/app/scrabble/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canStartGame; getCurrentUser; src/lib/gameAvailability.ts; src/lib/i18n/index.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/scrabble/[gameId]` | [src/app/scrabble/[gameId]/page.tsx](../src/app/scrabble/[gameId]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/scripture/[chapterId]` | [src/app/scripture/[chapterId]/page.tsx](../src/app/scripture/[chapterId]/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/contentAccess.ts; src/lib/db.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/shop` | [src/app/shop/page.tsx](../src/app/shop/page.tsx); Server Component-entry | overig-vandaag | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/snelle-zendeling` | [src/app/snelle-zendeling/page.tsx](../src/app/snelle-zendeling/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canUseQuickMissionary; getCurrentUser; src/lib/session.ts; src/lib/snelleZendeling/access.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/snelle-zendeling/run/[runId]` | [src/app/snelle-zendeling/run/[runId]/page.tsx](../src/app/snelle-zendeling/run/[runId]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/companion.ts; src/lib/db.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/snelle-zendeling/samen/[code]` | [src/app/snelle-zendeling/samen/[code]/page.tsx](../src/app/snelle-zendeling/samen/[code]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/companion.ts; src/lib/db.ts; src/lib/navigation.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/streak` | [src/app/streak/page.tsx](../src/app/streak/page.tsx); Server Component-entry | overig-vandaag | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/study-folder` | [src/app/study-folder/page.tsx](../src/app/study-folder/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/study-lesson/[lessonId]/[collectionId]` | [src/app/study-lesson/[lessonId]/[collectionId]/page.tsx](../src/app/study-lesson/[lessonId]/[collectionId]/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/annotations/studyFocus.ts; src/lib/db.ts; src/lib/i18n/index.ts; src/lib/session.ts; src/lib/studyContent/cfmCourses.ts; src/lib/studyContent/personalStudyPage.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/study-lesson/[lessonId]/[collectionId]/stappen` | [src/app/study-lesson/[lessonId]/[collectionId]/stappen/page.tsx](../src/app/study-lesson/[lessonId]/[collectionId]/stappen/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts; src/lib/studyContent/personalStudyPage.ts; src/lib/studyContent/stepProgress.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/study-lesson/[lessonId]/[collectionId]/stappen/[stap]` | [src/app/study-lesson/[lessonId]/[collectionId]/stappen/[stap]/page.tsx](../src/app/study-lesson/[lessonId]/[collectionId]/stappen/[stap]/page.tsx); Server Component-entry | leren | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/db.ts; src/lib/session.ts; src/lib/studyContent/cfmCourses.ts; src/lib/studyContent/personalStudyPage.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/tools` | [src/app/tools/page.tsx](../src/app/tools/page.tsx); Server Component-entry | media-hulpmiddelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/contentCollections.ts; src/lib/db.ts; src/lib/dictionary.ts; src/lib/i18n/index.ts; src/lib/i18n/core.ts; src/lib/languages.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/tools/dictionary` | [src/app/tools/dictionary/page.tsx](../src/app/tools/dictionary/page.tsx); Server Component-entry | media-hulpmiddelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/tools/dictionary/[word]` | [src/app/tools/dictionary/[word]/page.tsx](../src/app/tools/dictionary/[word]/page.tsx); Server Component-entry | media-hulpmiddelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/tools/persons` | [src/app/tools/persons/page.tsx](../src/app/tools/persons/page.tsx); Server Component-entry | media-hulpmiddelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/contentCollections.ts; src/lib/db.ts; src/lib/i18n/index.ts; src/lib/i18n/core.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/tools/xp-guide` | [src/app/tools/xp-guide/page.tsx](../src/app/tools/xp-guide/page.tsx); Server Component-entry | media-hulpmiddelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/i18n/index.ts; src/lib/i18n/core.ts; src/lib/session.ts; src/lib/wordGame.ts; src/lib/xpRules.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/uitnodiging/[code]` | [src/app/uitnodiging/[code]/page.tsx](../src/app/uitnodiging/[code]/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/brand.ts; src/lib/branding.ts; src/lib/db.ts; src/lib/friendInvite.ts; src/lib/gameSettings.ts; src/lib/handle.ts; src/lib/i18n/index.ts; src/lib/requestLanguage.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/uitnodiging/groep/[token]` | [src/app/uitnodiging/groep/[token]/page.tsx](../src/app/uitnodiging/groep/[token]/page.tsx); Server Component-entry | sociaal | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/brand.ts; src/lib/branding.ts; src/lib/i18n/index.ts; src/lib/requestLanguage.ts; src/lib/session.ts; src/lib/social/joinLinks.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/uitschrijven/[token]` | [src/app/uitschrijven/[token]/page.tsx](../src/app/uitschrijven/[token]/page.tsx); Server Component-entry | hulp-juridisch | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; verifyPodcastUnsubscribeToken; verifyUnsubscribeToken; src/lib/i18n/index.ts; src/lib/languages.ts; src/lib/mailAddress.ts; src/lib/notifyCategories.ts; src/lib/requestLanguage.ts; src/lib/session.ts; src/lib/unsubscribe.ts; src/lib/unsubscribeActions.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/verify-email` | [src/app/verify-email/page.tsx](../src/app/verify-email/page.tsx); Server Component-entry | account | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/i18n/index.ts; src/lib/i18n/rich.tsx; src/lib/requestLanguage.ts; src/lib/returnTo.ts; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/word-game` | [src/app/word-game/page.tsx](../src/app/word-game/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | canResumeGameContent; canStartGame; getCurrentUser; src/lib/db.ts; src/lib/gameAvailability.ts; src/lib/session.ts; src/lib/wordGame.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/word-search` | [src/app/word-search/page.tsx](../src/app/word-search/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | assertWordSearchContext; getCurrentUser; src/lib/gameSettings.ts; src/lib/session.ts; src/lib/wordSearch/game.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/word-search/[gameId]` | [src/app/word-search/[gameId]/page.tsx](../src/app/word-search/[gameId]/page.tsx); Server Component-entry | spelen | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts; src/lib/wordSearch/game.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs
`/xp` | [src/app/xp/page.tsx](../src/app/xp/page.tsx); Server Component-entry | overig-vandaag | Zelfde doel-URL; ontbreekt in lokale router | getCurrentUser; src/lib/session.ts | Webtests: JSON-index; native: geen volledig route-/apparaatbewijs

### Alle API-routehandlers

Endpoint | Methoden | Bron | Domein / authenticatie | Native beschikbaarheid
--- | --- | --- | --- | ---
`/api/account` | DELETE, PATCH, PUT | [src/app/api/account/route.ts](../src/app/api/account/route.ts) | account; canUseAccessory, canUseAvatarCharacter, getCurrentUser, verifyPassword | Geen algemene bearer-toegang; expliciet contract vereist
`/api/account/totp/disable` | POST | [src/app/api/account/totp/disable/route.ts](../src/app/api/account/totp/disable/route.ts) | account; getCurrentUser, verifyTotpCode | Geen algemene bearer-toegang; expliciet contract vereist
`/api/account/totp/reset` | POST | [src/app/api/account/totp/reset/route.ts](../src/app/api/account/totp/reset/route.ts) | account; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/account/totp/setup` | POST | [src/app/api/account/totp/setup/route.ts](../src/app/api/account/totp/setup/route.ts) | account; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/account/totp/verify` | POST | [src/app/api/account/totp/verify/route.ts](../src/app/api/account/totp/verify/route.ts) | account; getCurrentUser, verifyTotpCode | Geen algemene bearer-toegang; expliciet contract vereist
`/api/activity-feed` | GET | [src/app/api/activity-feed/route.ts](../src/app/api/activity-feed/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/activity-feed/[itemId]/reaction` | POST | [src/app/api/activity-feed/[itemId]/reaction/route.ts](../src/app/api/activity-feed/[itemId]/reaction/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/activity-feed/[itemId]/reactions` | GET | [src/app/api/activity-feed/[itemId]/reactions/route.ts](../src/app/api/activity-feed/[itemId]/reactions/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/activity-status` | GET | [src/app/api/activity-status/route.ts](../src/app/api/activity-status/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/alleskenner` | GET | [src/app/api/admin/alleskenner/route.ts](../src/app/api/admin/alleskenner/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/alleskenner/[id]` | PUT | [src/app/api/admin/alleskenner/[id]/route.ts](../src/app/api/admin/alleskenner/[id]/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/branding` | GET, PUT | [src/app/api/admin/branding/route.ts](../src/app/api/admin/branding/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/changelog` | GET, POST | [src/app/api/admin/changelog/route.ts](../src/app/api/admin/changelog/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/changelog/[entryId]` | DELETE, PATCH | [src/app/api/admin/changelog/[entryId]/route.ts](../src/app/api/admin/changelog/[entryId]/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/content-inspection` | GET | [src/app/api/admin/content-inspection/route.ts](../src/app/api/admin/content-inspection/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/content-inventory` | GET, POST | [src/app/api/admin/content-inventory/route.ts](../src/app/api/admin/content-inventory/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/content-switcher` | GET, PUT | [src/app/api/admin/content-switcher/route.ts](../src/app/api/admin/content-switcher/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/courses` | GET | [src/app/api/admin/courses/route.ts](../src/app/api/admin/courses/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/courses/[courseId]` | PATCH | [src/app/api/admin/courses/[courseId]/route.ts](../src/app/api/admin/courses/[courseId]/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/deploy/maintenance` | POST | [src/app/api/admin/deploy/maintenance/route.ts](../src/app/api/admin/deploy/maintenance/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/deploy/rollback` | POST | [src/app/api/admin/deploy/rollback/route.ts](../src/app/api/admin/deploy/rollback/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/deploy/start` | POST | [src/app/api/admin/deploy/start/route.ts](../src/app/api/admin/deploy/start/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/deploy/status` | GET | [src/app/api/admin/deploy/status/route.ts](../src/app/api/admin/deploy/status/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/email-settings` | GET, PUT | [src/app/api/admin/email-settings/route.ts](../src/app/api/admin/email-settings/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/email-settings/test` | POST | [src/app/api/admin/email-settings/test/route.ts](../src/app/api/admin/email-settings/test/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/feedback` | GET | [src/app/api/admin/feedback/route.ts](../src/app/api/admin/feedback/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/feedback/[feedbackId]` | PATCH | [src/app/api/admin/feedback/[feedbackId]/route.ts](../src/app/api/admin/feedback/[feedbackId]/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/fsy` | GET, POST, PUT | [src/app/api/admin/fsy/route.ts](../src/app/api/admin/fsy/route.ts) | beheer; getCurrentUser, requireAdmin | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/fsy/[lessonId]/conversion` | GET, POST | [src/app/api/admin/fsy/[lessonId]/conversion/route.ts](../src/app/api/admin/fsy/[lessonId]/conversion/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/fsy/[lessonId]/publish` | POST | [src/app/api/admin/fsy/[lessonId]/publish/route.ts](../src/app/api/admin/fsy/[lessonId]/publish/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/game-scopes` | GET, PUT | [src/app/api/admin/game-scopes/route.ts](../src/app/api/admin/game-scopes/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/game-settings` | GET, PUT | [src/app/api/admin/game-settings/route.ts](../src/app/api/admin/game-settings/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/league-settings` | GET, PUT | [src/app/api/admin/league-settings/route.ts](../src/app/api/admin/league-settings/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/live-games` | GET | [src/app/api/admin/live-games/route.ts](../src/app/api/admin/live-games/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/live-games/[gameId]` | DELETE | [src/app/api/admin/live-games/[gameId]/route.ts](../src/app/api/admin/live-games/[gameId]/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/reseed` | GET, POST | [src/app/api/admin/reseed/route.ts](../src/app/api/admin/reseed/route.ts) | beheer; getCurrentUser, requireAdmin, requireCfmApproval | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/study-media/[mediaId]` | GET | [src/app/api/admin/study-media/[mediaId]/route.ts](../src/app/api/admin/study-media/[mediaId]/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/study-publications` | GET, POST | [src/app/api/admin/study-publications/route.ts](../src/app/api/admin/study-publications/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/study-publications/report` | GET | [src/app/api/admin/study-publications/report/route.ts](../src/app/api/admin/study-publications/report/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/users` | GET | [src/app/api/admin/users/route.ts](../src/app/api/admin/users/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/users/[userId]` | DELETE, PATCH | [src/app/api/admin/users/[userId]/route.ts](../src/app/api/admin/users/[userId]/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/admin/users/[userId]/reset-password` | POST | [src/app/api/admin/users/[userId]/reset-password/route.ts](../src/app/api/admin/users/[userId]/reset-password/route.ts) | beheer; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/alleskenner/seasons` | GET, POST | [src/app/api/alleskenner/seasons/route.ts](../src/app/api/alleskenner/seasons/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/alleskenner/seasons/[id]` | GET, PATCH | [src/app/api/alleskenner/seasons/[id]/route.ts](../src/app/api/alleskenner/seasons/[id]/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/alleskenner/seasons/[id]/evenings` | POST | [src/app/api/alleskenner/seasons/[id]/evenings/route.ts](../src/app/api/alleskenner/seasons/[id]/evenings/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/alleskenner/seasons/[id]/finale` | POST | [src/app/api/alleskenner/seasons/[id]/finale/route.ts](../src/app/api/alleskenner/seasons/[id]/finale/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/alleskenner/seasons/[id]/members` | DELETE, POST | [src/app/api/alleskenner/seasons/[id]/members/route.ts](../src/app/api/alleskenner/seasons/[id]/members/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/alleskenner/solo` | GET, POST | [src/app/api/alleskenner/solo/route.ts](../src/app/api/alleskenner/solo/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/annotations` | DELETE, GET, PUT | [src/app/api/annotations/route.ts](../src/app/api/annotations/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/annotations/resolve` | POST | [src/app/api/annotations/resolve/route.ts](../src/app/api/annotations/resolve/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/audio/[file]` | GET, HEAD | [src/app/api/audio/[file]/route.ts](../src/app/api/audio/[file]/route.ts) | media-hulpmiddelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/auth/forgot-password` | POST | [src/app/api/auth/forgot-password/route.ts](../src/app/api/auth/forgot-password/route.ts) | account; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/auth/login` | POST | [src/app/api/auth/login/route.ts](../src/app/api/auth/login/route.ts) | account; verifyPassword | Geen algemene bearer-toegang; expliciet contract vereist
`/api/auth/login/2fa` | POST | [src/app/api/auth/login/2fa/route.ts](../src/app/api/auth/login/2fa/route.ts) | account; verifyTotpCode, verifyTwoFactorChallengeToken | Geen algemene bearer-toegang; expliciet contract vereist
`/api/auth/logout` | POST | [src/app/api/auth/logout/route.ts](../src/app/api/auth/logout/route.ts) | account; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/auth/register` | POST | [src/app/api/auth/register/route.ts](../src/app/api/auth/register/route.ts) | account; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/auth/reset-password` | POST | [src/app/api/auth/reset-password/route.ts](../src/app/api/auth/reset-password/route.ts) | account; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/auth/verify-email/confirm` | GET | [src/app/api/auth/verify-email/confirm/route.ts](../src/app/api/auth/verify-email/confirm/route.ts) | account; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/auth/verify-email/resend` | POST | [src/app/api/auth/verify-email/resend/route.ts](../src/app/api/auth/verify-email/resend/route.ts) | account; getCurrentUser, verifyEmailTemplate | Geen algemene bearer-toegang; expliciet contract vereist
`/api/bookmarks` | GET | [src/app/api/bookmarks/route.ts](../src/app/api/bookmarks/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/branding/apple-touch-icon` | GET | [src/app/api/branding/apple-touch-icon/route.ts](../src/app/api/branding/apple-touch-icon/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/branding/favicon` | GET | [src/app/api/branding/favicon/route.ts](../src/app/api/branding/favicon/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/branding/manifest` | GET | [src/app/api/branding/manifest/route.ts](../src/app/api/branding/manifest/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/challenges` | GET, POST | [src/app/api/challenges/route.ts](../src/app/api/challenges/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/challenges/[challengeId]/accept` | POST | [src/app/api/challenges/[challengeId]/accept/route.ts](../src/app/api/challenges/[challengeId]/accept/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/challenges/[challengeId]/cancel` | POST | [src/app/api/challenges/[challengeId]/cancel/route.ts](../src/app/api/challenges/[challengeId]/cancel/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/challenges/[challengeId]/decline` | POST | [src/app/api/challenges/[challengeId]/decline/route.ts](../src/app/api/challenges/[challengeId]/decline/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/challenges/[challengeId]/forfeit` | POST | [src/app/api/challenges/[challengeId]/forfeit/route.ts](../src/app/api/challenges/[challengeId]/forfeit/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/changelog` | GET | [src/app/api/changelog/route.ts](../src/app/api/changelog/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/changelog/seen` | POST | [src/app/api/changelog/seen/route.ts](../src/app/api/changelog/seen/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/chapter-guess/[gameId]` | GET | [src/app/api/chapter-guess/[gameId]/route.ts](../src/app/api/chapter-guess/[gameId]/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/chapter-guess/[gameId]/answer` | POST | [src/app/api/chapter-guess/[gameId]/answer/route.ts](../src/app/api/chapter-guess/[gameId]/answer/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/chapter-guess/[gameId]/forfeit` | POST | [src/app/api/chapter-guess/[gameId]/forfeit/route.ts](../src/app/api/chapter-guess/[gameId]/forfeit/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/chapter-guess/[gameId]/hint` | POST | [src/app/api/chapter-guess/[gameId]/hint/route.ts](../src/app/api/chapter-guess/[gameId]/hint/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/chapter-guess/start` | POST | [src/app/api/chapter-guess/start/route.ts](../src/app/api/chapter-guess/start/route.ts) | spelen; canStartGame, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/chapters` | GET | [src/app/api/chapters/route.ts](../src/app/api/chapters/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/chapters/[chapterId]` | GET | [src/app/api/chapters/[chapterId]/route.ts](../src/app/api/chapters/[chapterId]/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/chapters/[chapterId]/audio-languages` | GET | [src/app/api/chapters/[chapterId]/audio-languages/route.ts](../src/app/api/chapters/[chapterId]/audio-languages/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/chapters/[chapterId]/read` | POST | [src/app/api/chapters/[chapterId]/read/route.ts](../src/app/api/chapters/[chapterId]/read/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/chapters/[chapterId]/submit` | POST | [src/app/api/chapters/[chapterId]/submit/route.ts](../src/app/api/chapters/[chapterId]/submit/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/content-api/status` | GET | [src/app/api/content-api/status/route.ts](../src/app/api/content-api/status/route.ts) | leren; verifyContentApiKey | Geen algemene bearer-toegang; expliciet contract vereist
`/api/content-context` | GET, PUT | [src/app/api/content-context/route.ts](../src/app/api/content-context/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/courses` | GET | [src/app/api/courses/route.ts](../src/app/api/courses/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/courses/[courseId]/subscribe` | POST | [src/app/api/courses/[courseId]/subscribe/route.ts](../src/app/api/courses/[courseId]/subscribe/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/courses/[courseId]/unsubscribe` | POST | [src/app/api/courses/[courseId]/unsubscribe/route.ts](../src/app/api/courses/[courseId]/unsubscribe/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/courses/catalog` | GET | [src/app/api/courses/catalog/route.ts](../src/app/api/courses/catalog/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/dictionary` | GET | [src/app/api/dictionary/route.ts](../src/app/api/dictionary/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/dictionary/[word]` | GET | [src/app/api/dictionary/[word]/route.ts](../src/app/api/dictionary/[word]/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/dorp` | GET, POST | [src/app/api/dorp/route.ts](../src/app/api/dorp/route.ts) | dorp; getCurrentUser, requireDorpAccess | Geen algemene bearer-toegang; expliciet contract vereist
`/api/exercises/[exerciseId]/check` | POST | [src/app/api/exercises/[exerciseId]/check/route.ts](../src/app/api/exercises/[exerciseId]/check/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/exercises/[exerciseId]/hint` | GET, POST | [src/app/api/exercises/[exerciseId]/hint/route.ts](../src/app/api/exercises/[exerciseId]/hint/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/feedback` | GET, POST | [src/app/api/feedback/route.ts](../src/app/api/feedback/route.ts) | hulp-juridisch; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/feedback/exercise` | POST | [src/app/api/feedback/exercise/route.ts](../src/app/api/feedback/exercise/route.ts) | hulp-juridisch; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/feedback/respond/[token]` | POST | [src/app/api/feedback/respond/[token]/route.ts](../src/app/api/feedback/respond/[token]/route.ts) | hulp-juridisch; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/freezes/gift` | POST | [src/app/api/freezes/gift/route.ts](../src/app/api/freezes/gift/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/freezes/received` | GET, POST | [src/app/api/freezes/received/route.ts](../src/app/api/freezes/received/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/friend-streaks` | GET, POST | [src/app/api/friend-streaks/route.ts](../src/app/api/friend-streaks/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/friend-streaks/[streakId]` | POST | [src/app/api/friend-streaks/[streakId]/route.ts](../src/app/api/friend-streaks/[streakId]/route.ts) | overig-vandaag; cancelFriendStreakInvite, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/friends` | GET | [src/app/api/friends/route.ts](../src/app/api/friends/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/friends/[friendshipId]` | DELETE | [src/app/api/friends/[friendshipId]/route.ts](../src/app/api/friends/[friendshipId]/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/friends/[friendshipId]/accept` | POST | [src/app/api/friends/[friendshipId]/accept/route.ts](../src/app/api/friends/[friendshipId]/accept/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/friends/[friendshipId]/decline` | POST | [src/app/api/friends/[friendshipId]/decline/route.ts](../src/app/api/friends/[friendshipId]/decline/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/friends/invite` | GET, POST | [src/app/api/friends/invite/route.ts](../src/app/api/friends/invite/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/friends/profiles/[userId]` | GET | [src/app/api/friends/profiles/[userId]/route.ts](../src/app/api/friends/profiles/[userId]/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/friends/recent` | GET | [src/app/api/friends/recent/route.ts](../src/app/api/friends/recent/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/friends/request` | POST | [src/app/api/friends/request/route.ts](../src/app/api/friends/request/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/group-invites/[inviteId]` | POST | [src/app/api/group-invites/[inviteId]/route.ts](../src/app/api/group-invites/[inviteId]/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/group-links/[token]` | POST | [src/app/api/group-links/[token]/route.ts](../src/app/api/group-links/[token]/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/groups` | GET, POST | [src/app/api/groups/route.ts](../src/app/api/groups/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/groups/[groupId]` | GET, PATCH | [src/app/api/groups/[groupId]/route.ts](../src/app/api/groups/[groupId]/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/groups/[groupId]/freeze` | POST | [src/app/api/groups/[groupId]/freeze/route.ts](../src/app/api/groups/[groupId]/freeze/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/groups/[groupId]/invites` | GET, POST | [src/app/api/groups/[groupId]/invites/route.ts](../src/app/api/groups/[groupId]/invites/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/groups/[groupId]/invites/[inviteId]` | DELETE | [src/app/api/groups/[groupId]/invites/[inviteId]/route.ts](../src/app/api/groups/[groupId]/invites/[inviteId]/route.ts) | sociaal; cancelGroupInvite, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/groups/[groupId]/leave` | POST | [src/app/api/groups/[groupId]/leave/route.ts](../src/app/api/groups/[groupId]/leave/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/groups/[groupId]/link` | POST | [src/app/api/groups/[groupId]/link/route.ts](../src/app/api/groups/[groupId]/link/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/groups/[groupId]/members/[memberId]` | POST | [src/app/api/groups/[groupId]/members/[memberId]/route.ts](../src/app/api/groups/[groupId]/members/[memberId]/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/groups/[groupId]/requests/[requestId]` | POST | [src/app/api/groups/[groupId]/requests/[requestId]/route.ts](../src/app/api/groups/[groupId]/requests/[requestId]/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/groups/leaderboard` | GET | [src/app/api/groups/leaderboard/route.ts](../src/app/api/groups/leaderboard/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/health` | GET | [src/app/api/health/route.ts](../src/app/api/health/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/hints` | GET | [src/app/api/hints/route.ts](../src/app/api/hints/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/hymns/[number]` | GET | [src/app/api/hymns/[number]/route.ts](../src/app/api/hymns/[number]/route.ts) | media-hulpmiddelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/hymns/[number]/sheet` | GET | [src/app/api/hymns/[number]/sheet/route.ts](../src/app/api/hymns/[number]/sheet/route.ts) | media-hulpmiddelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/hymns/index` | GET | [src/app/api/hymns/index/route.ts](../src/app/api/hymns/index/route.ts) | media-hulpmiddelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/hymns/recognition` | GET | [src/app/api/hymns/recognition/route.ts](../src/app/api/hymns/recognition/route.ts) | media-hulpmiddelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/hymns/report` | GET | [src/app/api/hymns/report/route.ts](../src/app/api/hymns/report/route.ts) | media-hulpmiddelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/intro-exercises/[exerciseId]/check` | POST | [src/app/api/intro-exercises/[exerciseId]/check/route.ts](../src/app/api/intro-exercises/[exerciseId]/check/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/intro-lessons/[lessonId]/submit` | POST | [src/app/api/intro-lessons/[lessonId]/submit/route.ts](../src/app/api/intro-lessons/[lessonId]/submit/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/invite/[code]` | GET, POST | [src/app/api/invite/[code]/route.ts](../src/app/api/invite/[code]/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/jigsaw` | POST | [src/app/api/jigsaw/route.ts](../src/app/api/jigsaw/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/jigsaw-v2` | POST | [src/app/api/jigsaw-v2/route.ts](../src/app/api/jigsaw-v2/route.ts) | overig-vandaag; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/kids-exercises/[exerciseId]/check` | POST | [src/app/api/kids-exercises/[exerciseId]/check/route.ts](../src/app/api/kids-exercises/[exerciseId]/check/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/kids-stories/[storyId]/submit` | POST | [src/app/api/kids-stories/[storyId]/submit/route.ts](../src/app/api/kids-stories/[storyId]/submit/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/kompas/state` | GET, POST | [src/app/api/kompas/state/route.ts](../src/app/api/kompas/state/route.ts) | hulp-juridisch; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/leaderboard` | GET | [src/app/api/leaderboard/route.ts](../src/app/api/leaderboard/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/list-order` | GET, PUT | [src/app/api/list-order/route.ts](../src/app/api/list-order/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/live/[code]` | GET | [src/app/api/live/[code]/route.ts](../src/app/api/live/[code]/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/live/create` | POST | [src/app/api/live/create/route.ts](../src/app/api/live/create/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/live/create-alleskenner` | POST | [src/app/api/live/create-alleskenner/route.ts](../src/app/api/live/create-alleskenner/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/live/create-chapter-guess` | POST | [src/app/api/live/create-chapter-guess/route.ts](../src/app/api/live/create-chapter-guess/route.ts) | spelen; canStartGame, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/live/create-family-game` | POST | [src/app/api/live/create-family-game/route.ts](../src/app/api/live/create-family-game/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/me` | GET | [src/app/api/me/route.ts](../src/app/api/me/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/mysteries/[mystery]/[variant]/progress` | GET, POST | [src/app/api/mysteries/[mystery]/[variant]/progress/route.ts](../src/app/api/mysteries/[mystery]/[variant]/progress/route.ts) | spelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/mysteries/[mystery]/hint` | POST | [src/app/api/mysteries/[mystery]/hint/route.ts](../src/app/api/mysteries/[mystery]/hint/route.ts) | spelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/mysteries/001/hint` | POST | [src/app/api/mysteries/001/hint/route.ts](../src/app/api/mysteries/001/hint/route.ts) | spelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/mysteries/001a/progress` | GET, POST | [src/app/api/mysteries/001a/progress/route.ts](../src/app/api/mysteries/001a/progress/route.ts) | spelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/mysteries/001b/progress` | GET, POST | [src/app/api/mysteries/001b/progress/route.ts](../src/app/api/mysteries/001b/progress/route.ts) | spelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/mysteries/001c/progress` | GET, POST | [src/app/api/mysteries/001c/progress/route.ts](../src/app/api/mysteries/001c/progress/route.ts) | spelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/mysteries/002/[variant]/progress` | GET, POST | [src/app/api/mysteries/002/[variant]/progress/route.ts](../src/app/api/mysteries/002/[variant]/progress/route.ts) | spelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/mysteries/002/hint` | POST | [src/app/api/mysteries/002/hint/route.ts](../src/app/api/mysteries/002/hint/route.ts) | spelen; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/mysteries/attempts` | GET, POST | [src/app/api/mysteries/attempts/route.ts](../src/app/api/mysteries/attempts/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/notifications` | DELETE, GET | [src/app/api/notifications/route.ts](../src/app/api/notifications/route.ts) | sociaal; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/nudges` | POST | [src/app/api/nudges/route.ts](../src/app/api/nudges/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/onboarding/complete` | POST | [src/app/api/onboarding/complete/route.ts](../src/app/api/onboarding/complete/route.ts) | account; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/onboarding/knowledge-level` | POST | [src/app/api/onboarding/knowledge-level/route.ts](../src/app/api/onboarding/knowledge-level/route.ts) | account; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/onboarding/profile-privacy` | POST | [src/app/api/onboarding/profile-privacy/route.ts](../src/app/api/onboarding/profile-privacy/route.ts) | account; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/open-actions` | GET | [src/app/api/open-actions/route.ts](../src/app/api/open-actions/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/persons/[slug]` | GET | [src/app/api/persons/[slug]/route.ts](../src/app/api/persons/[slug]/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/podcast-episodes/[episodeId]/[mode]/submit` | POST | [src/app/api/podcast-episodes/[episodeId]/[mode]/submit/route.ts](../src/app/api/podcast-episodes/[episodeId]/[mode]/submit/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/podcast-exercises/[exerciseId]/check` | POST | [src/app/api/podcast-exercises/[exerciseId]/check/route.ts](../src/app/api/podcast-exercises/[exerciseId]/check/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/podcast-notifications/[podcastId]` | PATCH | [src/app/api/podcast-notifications/[podcastId]/route.ts](../src/app/api/podcast-notifications/[podcastId]/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/podcast-playback` | DELETE, GET, PUT | [src/app/api/podcast-playback/route.ts](../src/app/api/podcast-playback/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/practice/submit` | POST | [src/app/api/practice/submit/route.ts](../src/app/api/practice/submit/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/profile` | GET | [src/app/api/profile/route.ts](../src/app/api/profile/route.ts) | account; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/profile/featured-achievements` | PUT | [src/app/api/profile/featured-achievements/route.ts](../src/app/api/profile/featured-achievements/route.ts) | account; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/progress/reset-reading` | POST | [src/app/api/progress/reset-reading/route.ts](../src/app/api/progress/reset-reading/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/public-language` | POST | [src/app/api/public-language/route.ts](../src/app/api/public-language/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/push/public-key` | GET | [src/app/api/push/public-key/route.ts](../src/app/api/push/public-key/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/push/subscribe` | POST | [src/app/api/push/subscribe/route.ts](../src/app/api/push/subscribe/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/push/test` | POST | [src/app/api/push/test/route.ts](../src/app/api/push/test/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/push/unsubscribe` | POST | [src/app/api/push/unsubscribe/route.ts](../src/app/api/push/unsubscribe/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/puzzle/coop` | POST | [src/app/api/puzzle/coop/route.ts](../src/app/api/puzzle/coop/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/puzzle/history` | GET | [src/app/api/puzzle/history/route.ts](../src/app/api/puzzle/history/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/puzzle/leaderboard` | GET | [src/app/api/puzzle/leaderboard/route.ts](../src/app/api/puzzle/leaderboard/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/puzzle/match` | POST | [src/app/api/puzzle/match/route.ts](../src/app/api/puzzle/match/route.ts) | overig-vandaag; cancelMatch | Geen algemene bearer-toegang; expliciet contract vereist
`/api/puzzle/overview` | GET | [src/app/api/puzzle/overview/route.ts](../src/app/api/puzzle/overview/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/puzzle/records` | GET | [src/app/api/puzzle/records/route.ts](../src/app/api/puzzle/records/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/reading-lessons/submit` | POST | [src/app/api/reading-lessons/submit/route.ts](../src/app/api/reading-lessons/submit/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/reading-position` | GET, PUT | [src/app/api/reading-position/route.ts](../src/app/api/reading-position/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/reading-sessions` | POST | [src/app/api/reading-sessions/route.ts](../src/app/api/reading-sessions/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/scrabble` | GET, POST | [src/app/api/scrabble/route.ts](../src/app/api/scrabble/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/scrabble/[gameId]` | GET | [src/app/api/scrabble/[gameId]/route.ts](../src/app/api/scrabble/[gameId]/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/scrabble/[gameId]/accept` | POST | [src/app/api/scrabble/[gameId]/accept/route.ts](../src/app/api/scrabble/[gameId]/accept/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/scrabble/[gameId]/cancel` | POST | [src/app/api/scrabble/[gameId]/cancel/route.ts](../src/app/api/scrabble/[gameId]/cancel/route.ts) | spelen; canResumeGameContent, cancelInvite, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/scrabble/[gameId]/decline` | POST | [src/app/api/scrabble/[gameId]/decline/route.ts](../src/app/api/scrabble/[gameId]/decline/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/scrabble/[gameId]/exchange` | POST | [src/app/api/scrabble/[gameId]/exchange/route.ts](../src/app/api/scrabble/[gameId]/exchange/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/scrabble/[gameId]/forfeit` | POST | [src/app/api/scrabble/[gameId]/forfeit/route.ts](../src/app/api/scrabble/[gameId]/forfeit/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/scrabble/[gameId]/hint` | POST | [src/app/api/scrabble/[gameId]/hint/route.ts](../src/app/api/scrabble/[gameId]/hint/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/scrabble/[gameId]/move` | POST | [src/app/api/scrabble/[gameId]/move/route.ts](../src/app/api/scrabble/[gameId]/move/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/scrabble/[gameId]/pass` | POST | [src/app/api/scrabble/[gameId]/pass/route.ts](../src/app/api/scrabble/[gameId]/pass/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/search` | GET | [src/app/api/search/route.ts](../src/app/api/search/route.ts) | media-hulpmiddelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/shop` | GET | [src/app/api/shop/route.ts](../src/app/api/shop/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/shop/freezes` | POST | [src/app/api/shop/freezes/route.ts](../src/app/api/shop/freezes/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/shop/genees` | POST | [src/app/api/shop/genees/route.ts](../src/app/api/shop/genees/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/shop/hints` | POST | [src/app/api/shop/hints/route.ts](../src/app/api/shop/hints/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/snelle-zendeling/leaderboard` | GET | [src/app/api/snelle-zendeling/leaderboard/route.ts](../src/app/api/snelle-zendeling/leaderboard/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/snelle-zendeling/runs` | POST | [src/app/api/snelle-zendeling/runs/route.ts](../src/app/api/snelle-zendeling/runs/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/snelle-zendeling/runs/[runId]` | GET | [src/app/api/snelle-zendeling/runs/[runId]/route.ts](../src/app/api/snelle-zendeling/runs/[runId]/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/snelle-zendeling/runs/[runId]/death` | POST | [src/app/api/snelle-zendeling/runs/[runId]/death/route.ts](../src/app/api/snelle-zendeling/runs/[runId]/death/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/snelle-zendeling/runs/[runId]/finish` | POST | [src/app/api/snelle-zendeling/runs/[runId]/finish/route.ts](../src/app/api/snelle-zendeling/runs/[runId]/finish/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/snelle-zendeling/runs/[runId]/genees` | POST | [src/app/api/snelle-zendeling/runs/[runId]/genees/route.ts](../src/app/api/snelle-zendeling/runs/[runId]/genees/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/snelle-zendeling/runs/[runId]/resume` | POST | [src/app/api/snelle-zendeling/runs/[runId]/resume/route.ts](../src/app/api/snelle-zendeling/runs/[runId]/resume/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/snelle-zendeling/runs/[runId]/revive` | POST | [src/app/api/snelle-zendeling/runs/[runId]/revive/route.ts](../src/app/api/snelle-zendeling/runs/[runId]/revive/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/snelle-zendeling/runs/[runId]/revive/answer` | POST | [src/app/api/snelle-zendeling/runs/[runId]/revive/answer/route.ts](../src/app/api/snelle-zendeling/runs/[runId]/revive/answer/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/snelle-zendeling/together` | POST | [src/app/api/snelle-zendeling/together/route.ts](../src/app/api/snelle-zendeling/together/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/streak` | GET | [src/app/api/streak/route.ts](../src/app/api/streak/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/streak/celebration` | GET, POST | [src/app/api/streak/celebration/route.ts](../src/app/api/streak/celebration/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/streak/continuation` | GET, POST | [src/app/api/streak/continuation/route.ts](../src/app/api/streak/continuation/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/study-context` | GET, PUT | [src/app/api/study-context/route.ts](../src/app/api/study-context/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/study-folder` | GET | [src/app/api/study-folder/route.ts](../src/app/api/study-folder/route.ts) | leren; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/study-media/[mediaId]` | GET | [src/app/api/study-media/[mediaId]/route.ts](../src/app/api/study-media/[mediaId]/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/study-preference` | PUT | [src/app/api/study-preference/route.ts](../src/app/api/study-preference/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/study-read` | POST | [src/app/api/study-read/route.ts](../src/app/api/study-read/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/study-references` | POST | [src/app/api/study-references/route.ts](../src/app/api/study-references/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/study-steps` | GET, POST | [src/app/api/study-steps/route.ts](../src/app/api/study-steps/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/study/[code]/units` | GET | [src/app/api/study/[code]/units/route.ts](../src/app/api/study/[code]/units/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/study/create` | POST | [src/app/api/study/create/route.ts](../src/app/api/study/create/route.ts) | overig-vandaag; canStartStudy, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/unsubscribe` | GET, POST | [src/app/api/unsubscribe/route.ts](../src/app/api/unsubscribe/route.ts) | overig-vandaag; verifyPodcastUnsubscribeToken, verifyUnsubscribeToken | Geen algemene bearer-toegang; expliciet contract vereist
`/api/user-badges` | GET | [src/app/api/user-badges/route.ts](../src/app/api/user-badges/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/users/avatars` | GET | [src/app/api/users/avatars/route.ts](../src/app/api/users/avatars/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/users/search` | GET | [src/app/api/users/search/route.ts](../src/app/api/users/search/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/v1/native/[...path]` | DELETE, GET, OPTIONS, POST | [src/app/api/v1/native/[...path]/route.ts](../src/app/api/v1/native/[...path]/route.ts) | native-kern; nativeApi | Bestaande begrensde catch-all; logische contracten hierboven
`/api/verses/[verseId]/bookmark` | POST | [src/app/api/verses/[verseId]/bookmark/route.ts](../src/app/api/verses/[verseId]/bookmark/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/verses/[verseId]/highlight` | POST | [src/app/api/verses/[verseId]/highlight/route.ts](../src/app/api/verses/[verseId]/highlight/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/verses/[verseId]/note` | PUT | [src/app/api/verses/[verseId]/note/route.ts](../src/app/api/verses/[verseId]/note/route.ts) | overig-vandaag; controle in bron/service nodig | Geen algemene bearer-toegang; expliciet contract vereist
`/api/word-game` | GET | [src/app/api/word-game/route.ts](../src/app/api/word-game/route.ts) | spelen; canResumeGameContent, canStartGame, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/word-game/guess` | POST | [src/app/api/word-game/guess/route.ts](../src/app/api/word-game/guess/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/word-game/hint` | POST | [src/app/api/word-game/hint/route.ts](../src/app/api/word-game/hint/route.ts) | spelen; canResumeGameContent, getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/word-game/ranking` | GET | [src/app/api/word-game/ranking/route.ts](../src/app/api/word-game/ranking/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/word-search` | GET, POST | [src/app/api/word-search/route.ts](../src/app/api/word-search/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/word-search/[gameId]` | GET | [src/app/api/word-search/[gameId]/route.ts](../src/app/api/word-search/[gameId]/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/word-search/[gameId]/find` | POST | [src/app/api/word-search/[gameId]/find/route.ts](../src/app/api/word-search/[gameId]/find/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/word-search/[gameId]/give-up` | POST | [src/app/api/word-search/[gameId]/give-up/route.ts](../src/app/api/word-search/[gameId]/give-up/route.ts) | spelen; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist
`/api/xp-history` | GET | [src/app/api/xp-history/route.ts](../src/app/api/xp-history/route.ts) | overig-vandaag; getCurrentUser | Geen algemene bearer-toegang; expliciet contract vereist

### Alle JSX-modules en expliciete clientgrenzen

Module | Eigen grens | Geëxporteerde namen
--- | --- | ---
[src/app/acties/page.tsx](../src/app/acties/page.tsx) | contextafhankelijk / server-entry waar page/layout | ActionsPage
[src/app/activity/page.tsx](../src/app/activity/page.tsx) | contextafhankelijk / server-entry waar page/layout | ActivityPage
[src/app/adminbackend/communicatie/page.tsx](../src/app/adminbackend/communicatie/page.tsx) | contextafhankelijk / server-entry waar page/layout | AdminCommunicationPage
[src/app/adminbackend/content-preview/page.tsx](../src/app/adminbackend/content-preview/page.tsx) | contextafhankelijk / server-entry waar page/layout | ContentPreviewPage
[src/app/adminbackend/content/inspect/page.tsx](../src/app/adminbackend/content/inspect/page.tsx) | contextafhankelijk / server-entry waar page/layout | AdminContentInspectionPage
[src/app/adminbackend/content/page.tsx](../src/app/adminbackend/content/page.tsx) | contextafhankelijk / server-entry waar page/layout | AdminContentPage
[src/app/adminbackend/content/study-publications/page.tsx](../src/app/adminbackend/content/study-publications/page.tsx) | contextafhankelijk / server-entry waar page/layout | StudyPublicationsPage
[src/app/adminbackend/gebruikers/page.tsx](../src/app/adminbackend/gebruikers/page.tsx) | contextafhankelijk / server-entry waar page/layout | AdminUsersPage
[src/app/adminbackend/page.tsx](../src/app/adminbackend/page.tsx) | contextafhankelijk / server-entry waar page/layout | AdminBackendPage
[src/app/adminbackend/spellen/page.tsx](../src/app/adminbackend/spellen/page.tsx) | contextafhankelijk / server-entry waar page/layout | AdminGamesPage
[src/app/adminbackend/systeem/page.tsx](../src/app/adminbackend/systeem/page.tsx) | contextafhankelijk / server-entry waar page/layout | AdminSystemPage
[src/app/alleskenner/alleen/[id]/page.tsx](../src/app/alleskenner/alleen/[id]/page.tsx) | contextafhankelijk / server-entry waar page/layout | AlleskennerSoloGamePage
[src/app/alleskenner/alleen/page.tsx](../src/app/alleskenner/alleen/page.tsx) | contextafhankelijk / server-entry waar page/layout | AlleskennerSoloPage
[src/app/alleskenner/page.tsx](../src/app/alleskenner/page.tsx) | contextafhankelijk / server-entry waar page/layout | AlleskennerPage
[src/app/alleskenner/seizoen/[id]/page.tsx](../src/app/alleskenner/seizoen/[id]/page.tsx) | contextafhankelijk / server-entry waar page/layout | AlleskennerSeasonPage
[src/app/alleskenner/seizoen/page.tsx](../src/app/alleskenner/seizoen/page.tsx) | contextafhankelijk / server-entry waar page/layout | AlleskennerSeasonsPage
[src/app/bookmarks/page.tsx](../src/app/bookmarks/page.tsx) | contextafhankelijk / server-entry waar page/layout | BookmarksPage
[src/app/challenges/page.tsx](../src/app/challenges/page.tsx) | contextafhankelijk / server-entry waar page/layout | ChallengesPage
[src/app/change-password/page.tsx](../src/app/change-password/page.tsx) | contextafhankelijk / server-entry waar page/layout | ChangePasswordPage
[src/app/chapter-guess/page.tsx](../src/app/chapter-guess/page.tsx) | contextafhankelijk / server-entry waar page/layout | ChapterGuessPage
[src/app/chapter-guess/solo/[gameId]/page.tsx](../src/app/chapter-guess/solo/[gameId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | ChapterGuessSoloPage
[src/app/competition/page.tsx](../src/app/competition/page.tsx) | contextafhankelijk / server-entry waar page/layout | CompetitionPage
[src/app/content/page.tsx](../src/app/content/page.tsx) | contextafhankelijk / server-entry waar page/layout | ContentPage
[src/app/cookies/page.tsx](../src/app/cookies/page.tsx) | contextafhankelijk / server-entry waar page/layout | CookiesPage
[src/app/courses/[courseId]/chapter/[chapterId]/page.tsx](../src/app/courses/[courseId]/chapter/[chapterId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | ReadingChapterPage
[src/app/courses/[courseId]/pad/page.tsx](../src/app/courses/[courseId]/pad/page.tsx) | contextafhankelijk / server-entry waar page/layout | ReadingPathPage
[src/app/courses/[courseId]/page.tsx](../src/app/courses/[courseId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | CourseDetailPage
[src/app/courses/page.tsx](../src/app/courses/page.tsx) | contextafhankelijk / server-entry waar page/layout | CoursesPage
[src/app/dashboard/page.tsx](../src/app/dashboard/page.tsx) | contextafhankelijk / server-entry waar page/layout | DashboardPage
[src/app/dev/lofzangen/page.tsx](../src/app/dev/lofzangen/page.tsx) | contextafhankelijk / server-entry waar page/layout | HymnsPocPage, dynamic, metadata
[src/app/dev/versado-dorp/page.tsx](../src/app/dev/versado-dorp/page.tsx) | contextafhankelijk / server-entry waar page/layout | VersadoDorpPrototypePage, metadata
[src/app/dorp/groups/[groupId]/page.tsx](../src/app/dorp/groups/[groupId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | GroupDorpPage
[src/app/dorp/page.tsx](../src/app/dorp/page.tsx) | contextafhankelijk / server-entry waar page/layout | DorpPage
[src/app/dorp/visit/[userId]/page.tsx](../src/app/dorp/visit/[userId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | VisitDorpPage
[src/app/feedback/page.tsx](../src/app/feedback/page.tsx) | contextafhankelijk / server-entry waar page/layout | FeedbackPage
[src/app/feedback/respond/[token]/page.tsx](../src/app/feedback/respond/[token]/page.tsx) | contextafhankelijk / server-entry waar page/layout | FeedbackRespondPage
[src/app/forgot-password/page.tsx](../src/app/forgot-password/page.tsx) | contextafhankelijk / server-entry waar page/layout | ForgotPasswordPage
[src/app/friends/[userId]/page.tsx](../src/app/friends/[userId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | FriendProfilePage
[src/app/friends/page.tsx](../src/app/friends/page.tsx) | contextafhankelijk / server-entry waar page/layout | FriendsPage
[src/app/fsy/[lessonId]/page.tsx](../src/app/fsy/[lessonId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | FsyLessonPage
[src/app/gezinsavond/page.tsx](../src/app/gezinsavond/page.tsx) | contextafhankelijk / server-entry waar page/layout | GezinsavondPage
[src/app/groups/[groupId]/page.tsx](../src/app/groups/[groupId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/groups/[groupId]/settings/page.tsx](../src/app/groups/[groupId]/settings/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/groups/leaderboard/page.tsx](../src/app/groups/leaderboard/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/groups/new/page.tsx](../src/app/groups/new/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/groups/page.tsx](../src/app/groups/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/intro/[lessonId]/page.tsx](../src/app/intro/[lessonId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | IntroLessonPage
[src/app/jigsaw/afgerond/page.tsx](../src/app/jigsaw/afgerond/page.tsx) | contextafhankelijk / server-entry waar page/layout | PuzzleHistoryPage
[src/app/jigsaw/page.tsx](../src/app/jigsaw/page.tsx) | contextafhankelijk / server-entry waar page/layout | JigsawPage
[src/app/jigsaw/records/[variantId]/page.tsx](../src/app/jigsaw/records/[variantId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | PuzzleLeaderboardPage
[src/app/jigsaw/records/page.tsx](../src/app/jigsaw/records/page.tsx) | contextafhankelijk / server-entry waar page/layout | PuzzleRecordsPage
[src/app/jigsaw/samen/[id]/page.tsx](../src/app/jigsaw/samen/[id]/page.tsx) | contextafhankelijk / server-entry waar page/layout | CoopPuzzlePage
[src/app/jigsaw/wedstrijd/[id]/page.tsx](../src/app/jigsaw/wedstrijd/[id]/page.tsx) | contextafhankelijk / server-entry waar page/layout | MatchPage
[src/app/kids/[storyId]/page.tsx](../src/app/kids/[storyId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | KidsStoryPage
[src/app/kompas/[topicId]/page.tsx](../src/app/kompas/[topicId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | KompasTopicPage
[src/app/kompas/page.tsx](../src/app/kompas/page.tsx) | contextafhankelijk / server-entry waar page/layout | KompasPage
[src/app/layout.tsx](../src/app/layout.tsx) | contextafhankelijk / server-entry waar page/layout | RootLayout, generateMetadata, viewport
[src/app/lesson/[chapterId]/page.tsx](../src/app/lesson/[chapterId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | LessonPage
[src/app/live/[code]/page.tsx](../src/app/live/[code]/page.tsx) | contextafhankelijk / server-entry waar page/layout | LiveGamePage
[src/app/live/page.tsx](../src/app/live/page.tsx) | contextafhankelijk / server-entry waar page/layout | LivePage
[src/app/login/page.tsx](../src/app/login/page.tsx) | use client | LoginPage
[src/app/mysteries/001/page.tsx](../src/app/mysteries/001/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery001Page
[src/app/mysteries/001a/page.tsx](../src/app/mysteries/001a/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery001DetailPage
[src/app/mysteries/001a/play/page.tsx](../src/app/mysteries/001a/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/001b/page.tsx](../src/app/mysteries/001b/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery001bPage
[src/app/mysteries/001b/play/page.tsx](../src/app/mysteries/001b/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/001c/page.tsx](../src/app/mysteries/001c/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery001cPage
[src/app/mysteries/001c/play/page.tsx](../src/app/mysteries/001c/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/002/page.tsx](../src/app/mysteries/002/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery002DetailPage
[src/app/mysteries/002a/page.tsx](../src/app/mysteries/002a/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery002aPage
[src/app/mysteries/002a/play/page.tsx](../src/app/mysteries/002a/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/002b/page.tsx](../src/app/mysteries/002b/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery002bPage
[src/app/mysteries/002b/play/page.tsx](../src/app/mysteries/002b/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/002c/page.tsx](../src/app/mysteries/002c/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery002cPage
[src/app/mysteries/002c/play/page.tsx](../src/app/mysteries/002c/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/003/page.tsx](../src/app/mysteries/003/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery003DetailPage
[src/app/mysteries/003a/page.tsx](../src/app/mysteries/003a/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery003aPage
[src/app/mysteries/003a/play/page.tsx](../src/app/mysteries/003a/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/003b/page.tsx](../src/app/mysteries/003b/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery003bPage
[src/app/mysteries/003b/play/page.tsx](../src/app/mysteries/003b/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/003c/page.tsx](../src/app/mysteries/003c/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery003cPage
[src/app/mysteries/003c/play/page.tsx](../src/app/mysteries/003c/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/004/page.tsx](../src/app/mysteries/004/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery004DetailPage
[src/app/mysteries/004a/page.tsx](../src/app/mysteries/004a/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery004aPage
[src/app/mysteries/004a/play/page.tsx](../src/app/mysteries/004a/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/004b/page.tsx](../src/app/mysteries/004b/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery004bPage
[src/app/mysteries/004b/play/page.tsx](../src/app/mysteries/004b/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/004c/page.tsx](../src/app/mysteries/004c/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery004cPage
[src/app/mysteries/004c/play/page.tsx](../src/app/mysteries/004c/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/005/page.tsx](../src/app/mysteries/005/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery005DetailPage
[src/app/mysteries/005a/page.tsx](../src/app/mysteries/005a/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery005aPage
[src/app/mysteries/005a/play/page.tsx](../src/app/mysteries/005a/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/005b/page.tsx](../src/app/mysteries/005b/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery005bPage
[src/app/mysteries/005b/play/page.tsx](../src/app/mysteries/005b/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/005c/page.tsx](../src/app/mysteries/005c/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery005cPage
[src/app/mysteries/005c/play/page.tsx](../src/app/mysteries/005c/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/006/page.tsx](../src/app/mysteries/006/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery006DetailPage
[src/app/mysteries/006a/page.tsx](../src/app/mysteries/006a/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery006aPage
[src/app/mysteries/006a/play/page.tsx](../src/app/mysteries/006a/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/006b/page.tsx](../src/app/mysteries/006b/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery006bPage
[src/app/mysteries/006b/play/page.tsx](../src/app/mysteries/006b/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/006c/page.tsx](../src/app/mysteries/006c/page.tsx) | contextafhankelijk / server-entry waar page/layout | Mystery006cPage
[src/app/mysteries/006c/play/page.tsx](../src/app/mysteries/006c/play/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/mysteries/page.tsx](../src/app/mysteries/page.tsx) | contextafhankelijk / server-entry waar page/layout | MysteryGamePage
[src/app/onboarding/page.tsx](../src/app/onboarding/page.tsx) | contextafhankelijk / server-entry waar page/layout | OnboardingPage
[src/app/page.tsx](../src/app/page.tsx) | contextafhankelijk / server-entry waar page/layout | HomePage
[src/app/podcast/[episodeId]/[mode]/page.tsx](../src/app/podcast/[episodeId]/[mode]/page.tsx) | contextafhankelijk / server-entry waar page/layout | PodcastLessonPage
[src/app/practice/page.tsx](../src/app/practice/page.tsx) | contextafhankelijk / server-entry waar page/layout | PracticePage
[src/app/privacy/page.tsx](../src/app/privacy/page.tsx) | contextafhankelijk / server-entry waar page/layout | PrivacyPage
[src/app/profile/avatar/page.tsx](../src/app/profile/avatar/page.tsx) | contextafhankelijk / server-entry waar page/layout | AvatarEditorPage
[src/app/profile/page.tsx](../src/app/profile/page.tsx) | contextafhankelijk / server-entry waar page/layout | ProfilePage
[src/app/reading-lesson/[lessonId]/page.tsx](../src/app/reading-lesson/[lessonId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | ReadingLessonPage
[src/app/register/page.tsx](../src/app/register/page.tsx) | use client | RegisterPage
[src/app/reset-password/page.tsx](../src/app/reset-password/page.tsx) | contextafhankelijk / server-entry waar page/layout | ResetPasswordPage
[src/app/scrabble/[gameId]/page.tsx](../src/app/scrabble/[gameId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | ScrabbleGamePage
[src/app/scrabble/page.tsx](../src/app/scrabble/page.tsx) | contextafhankelijk / server-entry waar page/layout | ScrabblePage
[src/app/scripture/[chapterId]/page.tsx](../src/app/scripture/[chapterId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | ScripturePage
[src/app/shop/page.tsx](../src/app/shop/page.tsx) | contextafhankelijk / server-entry waar page/layout | ShopPage
[src/app/snelle-zendeling/page.tsx](../src/app/snelle-zendeling/page.tsx) | contextafhankelijk / server-entry waar page/layout | QuickMissionaryPage
[src/app/snelle-zendeling/run/[runId]/page.tsx](../src/app/snelle-zendeling/run/[runId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | QuickMissionaryRunPage
[src/app/snelle-zendeling/samen/[code]/page.tsx](../src/app/snelle-zendeling/samen/[code]/page.tsx) | contextafhankelijk / server-entry waar page/layout | TogetherPage
[src/app/streak/page.tsx](../src/app/streak/page.tsx) | contextafhankelijk / server-entry waar page/layout | StreakPage
[src/app/study-folder/page.tsx](../src/app/study-folder/page.tsx) | contextafhankelijk / server-entry waar page/layout | StudyFolderPage, dynamic
[src/app/study-lesson/[lessonId]/[collectionId]/page.tsx](../src/app/study-lesson/[lessonId]/[collectionId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/study-lesson/[lessonId]/[collectionId]/stappen/[stap]/page.tsx](../src/app/study-lesson/[lessonId]/[collectionId]/stappen/[stap]/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/study-lesson/[lessonId]/[collectionId]/stappen/page.tsx](../src/app/study-lesson/[lessonId]/[collectionId]/stappen/page.tsx) | contextafhankelijk / server-entry waar page/layout | Page
[src/app/tools/dictionary/[word]/page.tsx](../src/app/tools/dictionary/[word]/page.tsx) | contextafhankelijk / server-entry waar page/layout | DictionaryWordPage
[src/app/tools/dictionary/page.tsx](../src/app/tools/dictionary/page.tsx) | contextafhankelijk / server-entry waar page/layout | DictionaryPage
[src/app/tools/page.tsx](../src/app/tools/page.tsx) | contextafhankelijk / server-entry waar page/layout | ToolsPage
[src/app/tools/persons/page.tsx](../src/app/tools/persons/page.tsx) | contextafhankelijk / server-entry waar page/layout | PersonsToolPage
[src/app/tools/persons/persons-search.tsx](../src/app/tools/persons/persons-search.tsx) | use client | PersonsSearch
[src/app/tools/xp-guide/page.tsx](../src/app/tools/xp-guide/page.tsx) | contextafhankelijk / server-entry waar page/layout | XpGuidePage
[src/app/uitnodiging/[code]/page.tsx](../src/app/uitnodiging/[code]/page.tsx) | contextafhankelijk / server-entry waar page/layout | InvitePage
[src/app/uitnodiging/groep/[token]/page.tsx](../src/app/uitnodiging/groep/[token]/page.tsx) | contextafhankelijk / server-entry waar page/layout | GroupLinkPage
[src/app/uitschrijven/[token]/page.tsx](../src/app/uitschrijven/[token]/page.tsx) | contextafhankelijk / server-entry waar page/layout | UnsubscribePage, metadata
[src/app/verify-email/page.tsx](../src/app/verify-email/page.tsx) | contextafhankelijk / server-entry waar page/layout | VerifyEmailPage
[src/app/word-game/page.tsx](../src/app/word-game/page.tsx) | contextafhankelijk / server-entry waar page/layout | WordGamePage
[src/app/word-search/[gameId]/page.tsx](../src/app/word-search/[gameId]/page.tsx) | contextafhankelijk / server-entry waar page/layout | WordSearchGamePage
[src/app/word-search/page.tsx](../src/app/word-search/page.tsx) | contextafhankelijk / server-entry waar page/layout | WordSearchPage
[src/app/xp/page.tsx](../src/app/xp/page.tsx) | contextafhankelijk / server-entry waar page/layout | XpPage
[src/components/ActionsClient.tsx](../src/components/ActionsClient.tsx) | use client | ActionsClient
[src/components/ActiveGamesBanner.tsx](../src/components/ActiveGamesBanner.tsx) | use client | ActiveGamesBanner
[src/components/ActivityFeedClient.tsx](../src/components/ActivityFeedClient.tsx) | use client | ActivityFeedClient
[src/components/ActivityTracker.tsx](../src/components/ActivityTracker.tsx) | use client | ActivityTracker
[src/components/AdminAlleskennerClient.tsx](../src/components/AdminAlleskennerClient.tsx) | use client | AdminAlleskennerClient
[src/components/AdminBrandingClient.tsx](../src/components/AdminBrandingClient.tsx) | use client | AdminBrandingClient
[src/components/AdminChangelogClient.tsx](../src/components/AdminChangelogClient.tsx) | use client | AdminChangelogClient
[src/components/AdminContentInventoryClient.tsx](../src/components/AdminContentInventoryClient.tsx) | use client | AdminContentInventoryClient
[src/components/AdminContentSwitcherClient.tsx](../src/components/AdminContentSwitcherClient.tsx) | use client | AdminContentSwitcherClient
[src/components/AdminCoursesClient.tsx](../src/components/AdminCoursesClient.tsx) | use client | AdminCoursesClient
[src/components/AdminDeployClient.tsx](../src/components/AdminDeployClient.tsx) | use client | AdminDeployClient
[src/components/AdminFsyClient.tsx](../src/components/AdminFsyClient.tsx) | use client | AdminFsyClient
[src/components/AdminGameSettingsClient.tsx](../src/components/AdminGameSettingsClient.tsx) | use client | AdminGameSettingsClient
[src/components/AdminLeagueSettingsClient.tsx](../src/components/AdminLeagueSettingsClient.tsx) | use client | AdminLeagueSettingsClient
[src/components/AdminLiveGamesClient.tsx](../src/components/AdminLiveGamesClient.tsx) | use client | AdminLiveGamesClient
[src/components/AdminUsersClient.tsx](../src/components/AdminUsersClient.tsx) | use client | AdminUsersClient
[src/components/AppSelect.tsx](../src/components/AppSelect.tsx) | use client | AppSelect
[src/components/AvatarEditorClient.tsx](../src/components/AvatarEditorClient.tsx) | use client | AvatarEditorClient
[src/components/BottomNav.tsx](../src/components/BottomNav.tsx) | use client | BottomNav
[src/components/ChallengesClient.tsx](../src/components/ChallengesClient.tsx) | use client | ChallengesClient
[src/components/ChangePasswordClient.tsx](../src/components/ChangePasswordClient.tsx) | use client | ChangePasswordClient
[src/components/ChangelogPopup.tsx](../src/components/ChangelogPopup.tsx) | use client | ChangelogPopup
[src/components/ChapterGuessGameRoom.tsx](../src/components/ChapterGuessGameRoom.tsx) | use client | ChapterGuessGameRoom
[src/components/ChapterGuessSetupClient.tsx](../src/components/ChapterGuessSetupClient.tsx) | use client | ChapterGuessSetupClient
[src/components/ChapterGuessSoloClient.tsx](../src/components/ChapterGuessSoloClient.tsx) | use client | ChapterGuessSoloClient
[src/components/ChapterListCourseView.tsx](../src/components/ChapterListCourseView.tsx) | use client | ChapterListCourseView
[src/components/ChapterPopup.tsx](../src/components/ChapterPopup.tsx) | use client | ChapterPopup
[src/components/ConfirmProvider.tsx](../src/components/ConfirmProvider.tsx) | use client | ConfirmProvider, useConfirm
[src/components/ContentSwitcher.tsx](../src/components/ContentSwitcher.tsx) | use client | ContentSwitcher
[src/components/ContinueAfterVerify.tsx](../src/components/ContinueAfterVerify.tsx) | use client | ContinueAfterVerify
[src/components/CourseBackTarget.tsx](../src/components/CourseBackTarget.tsx) | use client | CourseBackTarget
[src/components/CoursesClient.tsx](../src/components/CoursesClient.tsx) | use client | CoursesClient
[src/components/DictionaryClient.tsx](../src/components/DictionaryClient.tsx) | use client | DictionaryClient, dictionaryWordHref
[src/components/DivisionScroller.tsx](../src/components/DivisionScroller.tsx) | use client | DivisionScroller
[src/components/EdgeSwipeGuard.tsx](../src/components/EdgeSwipeGuard.tsx) | use client | EdgeSwipeGuard
[src/components/EmailSettingsClient.tsx](../src/components/EmailSettingsClient.tsx) | use client | EmailSettingsClient
[src/components/ExerciseFeedbackSheet.tsx](../src/components/ExerciseFeedbackSheet.tsx) | use client | ExerciseFeedbackSheet
[src/components/FamilyGameRoom.tsx](../src/components/FamilyGameRoom.tsx) | use client | FamilyGameRoom
[src/components/FamilyGameSetupClient.tsx](../src/components/FamilyGameSetupClient.tsx) | use client | FamilyGameSetupClient
[src/components/FeedbackAdminClient.tsx](../src/components/FeedbackAdminClient.tsx) | use client | FeedbackAdminClient
[src/components/FeedbackClient.tsx](../src/components/FeedbackClient.tsx) | use client | FeedbackClient
[src/components/FeedbackRespondClient.tsx](../src/components/FeedbackRespondClient.tsx) | use client | FeedbackRespondClient
[src/components/Footer.tsx](../src/components/Footer.tsx) | use client | Footer
[src/components/ForgotPasswordClient.tsx](../src/components/ForgotPasswordClient.tsx) | use client | ForgotPasswordClient
[src/components/FreezeGiftPopup.tsx](../src/components/FreezeGiftPopup.tsx) | use client | FreezeGiftPopup
[src/components/FriendInviteCard.tsx](../src/components/FriendInviteCard.tsx) | use client | FriendInviteCard
[src/components/FriendPicker.tsx](../src/components/FriendPicker.tsx) | use client | FriendPicker
[src/components/FriendProfileClient.tsx](../src/components/FriendProfileClient.tsx) | use client | FriendProfileClient
[src/components/FriendsClient.tsx](../src/components/FriendsClient.tsx) | use client | FriendsClient
[src/components/FsyContentBlocks.tsx](../src/components/FsyContentBlocks.tsx) | contextafhankelijk / server-entry waar page/layout | FsyContentBlocks
[src/components/FsyCourseView.tsx](../src/components/FsyCourseView.tsx) | use client | FsyCourseView
[src/components/FsyLessonView.tsx](../src/components/FsyLessonView.tsx) | use client | FSY_CATEGORY_KEYS, FsyLessonView
[src/components/GameRoom.tsx](../src/components/GameRoom.tsx) | use client | GameRoom
[src/components/HeaderInstallHint.tsx](../src/components/HeaderInstallHint.tsx) | use client | HeaderInstallHint
[src/components/I18nProvider.tsx](../src/components/I18nProvider.tsx) | use client | I18nProvider, useT, useUiLanguage
[src/components/InstallAppCard.tsx](../src/components/InstallAppCard.tsx) | use client | InstallAppCard
[src/components/IntroAudioButton.tsx](../src/components/IntroAudioButton.tsx) | use client | IntroAudioButton
[src/components/IntroCourseView.tsx](../src/components/IntroCourseView.tsx) | use client | IntroCourseView
[src/components/IntroLessonFlow.tsx](../src/components/IntroLessonFlow.tsx) | use client | IntroLessonFlow
[src/components/InviteAcceptButton.tsx](../src/components/InviteAcceptButton.tsx) | use client | InviteAcceptButton
[src/components/InviteListener.tsx](../src/components/InviteListener.tsx) | use client | InviteListener
[src/components/JigsawV2Client.tsx](../src/components/JigsawV2Client.tsx) | use client | JigsawV2Client, Puzzle
[src/components/KidsCourseView.tsx](../src/components/KidsCourseView.tsx) | use client | KidsCourseView
[src/components/KidsLessonFlow.tsx](../src/components/KidsLessonFlow.tsx) | use client | KidsLessonFlow
[src/components/LanguageSettings.tsx](../src/components/LanguageSettings.tsx) | use client | LanguageSettings
[src/components/LeaderboardClient.tsx](../src/components/LeaderboardClient.tsx) | use client | LeaderboardClient
[src/components/LessonFlow.tsx](../src/components/LessonFlow.tsx) | use client | ExerciseCard, LessonFlow, LessonResultMascot, ReaderView
[src/components/LiveDataProvider.tsx](../src/components/LiveDataProvider.tsx) | use client | LiveDataProvider
[src/components/LiveLobbyForm.tsx](../src/components/LiveLobbyForm.tsx) | use client | LiveLobbyForm
[src/components/LiveRefresh.tsx](../src/components/LiveRefresh.tsx) | use client | LiveRefresh
[src/components/LobbyClosedNotice.tsx](../src/components/LobbyClosedNotice.tsx) | use client | LobbyClosedNotice
[src/components/LobbyInviteCard.tsx](../src/components/LobbyInviteCard.tsx) | use client | LobbyInviteCard
[src/components/NativeAppBridge.tsx](../src/components/NativeAppBridge.tsx) | use client | NativeAppBridge
[src/components/NavUserBadges.tsx](../src/components/NavUserBadges.tsx) | use client | NavUserBadges
[src/components/NotificationCenter.tsx](../src/components/NotificationCenter.tsx) | use client | NotificationCenter
[src/components/OnboardingClient.tsx](../src/components/OnboardingClient.tsx) | use client | OnboardingClient
[src/components/PersonCard.tsx](../src/components/PersonCard.tsx) | use client | PersonCard
[src/components/PodcastCourseView.tsx](../src/components/PodcastCourseView.tsx) | use client | PodcastCourseView
[src/components/PodcastLessonFlow.tsx](../src/components/PodcastLessonFlow.tsx) | use client | PodcastLessonFlow
[src/components/PodcastMiniPlayer.tsx](../src/components/PodcastMiniPlayer.tsx) | use client | PodcastMiniPlayer
[src/components/ProfileCharacterHero.tsx](../src/components/ProfileCharacterHero.tsx) | use client | ProfileCharacterHero
[src/components/ProfileClient.tsx](../src/components/ProfileClient.tsx) | use client | ProfileClient
[src/components/PublicLanguageSwitcher.tsx](../src/components/PublicLanguageSwitcher.tsx) | use client | PublicLanguageSwitcher
[src/components/PuzzleHintPanel.tsx](../src/components/PuzzleHintPanel.tsx) | use client | PuzzleHintPanel
[src/components/PuzzleTable.tsx](../src/components/PuzzleTable.tsx) | use client | default/locale declaratie; zie bron
[src/components/QuickPracticeFlow.tsx](../src/components/QuickPracticeFlow.tsx) | use client | QuickPracticeFlow
[src/components/ReadAloudMiniPlayer.tsx](../src/components/ReadAloudMiniPlayer.tsx) | use client | ReadAloudMiniPlayer
[src/components/ReadAloudPlayer.tsx](../src/components/ReadAloudPlayer.tsx) | use client | ReadAloudPlayer
[src/components/ReaderBackTarget.tsx](../src/components/ReaderBackTarget.tsx) | use client | ReaderBackTarget
[src/components/ReadingChapterView.tsx](../src/components/ReadingChapterView.tsx) | use client | ReadingChapterView
[src/components/ReadingCourseView.tsx](../src/components/ReadingCourseView.tsx) | use client | ReadingCourseView
[src/components/ReadingLessonFlow.tsx](../src/components/ReadingLessonFlow.tsx) | use client | ReadingLessonFlow
[src/components/ReseedClient.tsx](../src/components/ReseedClient.tsx) | use client | ReseedClient
[src/components/ResendVerificationButton.tsx](../src/components/ResendVerificationButton.tsx) | use client | ResendVerificationButton
[src/components/ResetPasswordClient.tsx](../src/components/ResetPasswordClient.tsx) | use client | ResetPasswordClient
[src/components/ScrabbleBoardClient.tsx](../src/components/ScrabbleBoardClient.tsx) | use client | ScrabbleBoardClient
[src/components/ScrabbleListClient.tsx](../src/components/ScrabbleListClient.tsx) | use client | ScrabbleListClient
[src/components/ScriptureAvatar.tsx](../src/components/ScriptureAvatar.tsx) | contextafhankelijk / server-entry waar page/layout | ScriptureAvatar
[src/components/SearchBar.tsx](../src/components/SearchBar.tsx) | use client | SearchBar
[src/components/ServiceWorkerRegister.tsx](../src/components/ServiceWorkerRegister.tsx) | use client | ServiceWorkerRegister
[src/components/ShopClient.tsx](../src/components/ShopClient.tsx) | use client | ShopClient
[src/components/SortableList.tsx](../src/components/SortableList.tsx) | use client | DragHandle, SortableList
[src/components/StickyHeader.tsx](../src/components/StickyHeader.tsx) | contextafhankelijk / server-entry waar page/layout | StickyHeader
[src/components/StreakCelebrationFlow.tsx](../src/components/StreakCelebrationFlow.tsx) | use client | StreakCelebrationFlow
[src/components/StreakClient.tsx](../src/components/StreakClient.tsx) | use client | StreakClient
[src/components/StreakContinuation.tsx](../src/components/StreakContinuation.tsx) | use client | StreakContinuationCard, StreakContinuationProvider, useStreakContinuation
[src/components/SubpageBackBar.tsx](../src/components/SubpageBackBar.tsx) | use client | SubpageBackBar
[src/components/ThemePreference.tsx](../src/components/ThemePreference.tsx) | use client | ThemePreference
[src/components/ThemeScript.tsx](../src/components/ThemeScript.tsx) | contextafhankelijk / server-entry waar page/layout | ThemeScript
[src/components/TimeZoneSync.tsx](../src/components/TimeZoneSync.tsx) | use client | TimeZoneSync
[src/components/TwoFactorSettings.tsx](../src/components/TwoFactorSettings.tsx) | use client | TwoFactorSettings
[src/components/UserAvatar.tsx](../src/components/UserAvatar.tsx) | use client | UserAvatar, invalidateAvatarCache, setAvatarAppearance
[src/components/UserTag.tsx](../src/components/UserTag.tsx) | contextafhankelijk / server-entry waar page/layout | UserTag
[src/components/WordDetailClient.tsx](../src/components/WordDetailClient.tsx) | use client | WordDetailClient
[src/components/WordGameClient.tsx](../src/components/WordGameClient.tsx) | use client | WordGameClient
[src/components/WordGameHintPanel.tsx](../src/components/WordGameHintPanel.tsx) | use client | WordGameHintPanel
[src/components/WordSearchClient.tsx](../src/components/WordSearchClient.tsx) | use client | WordSearchClient
[src/components/XpHistoryClient.tsx](../src/components/XpHistoryClient.tsx) | use client | XpHistoryClient
[src/components/admin/AdminCategoryCard.tsx](../src/components/admin/AdminCategoryCard.tsx) | contextafhankelijk / server-entry waar page/layout | AdminCategoryCard
[src/components/admin/AdminContentInspectionClient.tsx](../src/components/admin/AdminContentInspectionClient.tsx) | use client | AdminContentInspectionClient
[src/components/admin/AdminNotice.tsx](../src/components/admin/AdminNotice.tsx) | contextafhankelijk / server-entry waar page/layout | AdminNotice
[src/components/admin/AdminPageHeader.tsx](../src/components/admin/AdminPageHeader.tsx) | contextafhankelijk / server-entry waar page/layout | AdminPageHeader
[src/components/admin/AdminSection.tsx](../src/components/admin/AdminSection.tsx) | contextafhankelijk / server-entry waar page/layout | AdminSection
[src/components/admin/AdminStudyPublicationsClient.tsx](../src/components/admin/AdminStudyPublicationsClient.tsx) | use client | AdminStudyPublicationsClient
[src/components/admin/AdminTable.tsx](../src/components/admin/AdminTable.tsx) | contextafhankelijk / server-entry waar page/layout | AdminTable
[src/components/admin/StudyRevisionContent.tsx](../src/components/admin/StudyRevisionContent.tsx) | contextafhankelijk / server-entry waar page/layout | StudyRevisionContent
[src/components/alleskenner/AlleskennerGame.tsx](../src/components/alleskenner/AlleskennerGame.tsx) | use client | AlleskennerGame, TEAM_DOTS
[src/components/alleskenner/AlleskennerRoom.tsx](../src/components/alleskenner/AlleskennerRoom.tsx) | use client | AlleskennerRoom
[src/components/alleskenner/AlleskennerSetupClient.tsx](../src/components/alleskenner/AlleskennerSetupClient.tsx) | use client | AlleskennerSetupClient
[src/components/alleskenner/SeasonClient.tsx](../src/components/alleskenner/SeasonClient.tsx) | use client | SeasonClient
[src/components/alleskenner/SeasonListClient.tsx](../src/components/alleskenner/SeasonListClient.tsx) | use client | SEASON_STATUS_KEY, SeasonListClient
[src/components/alleskenner/SoloClient.tsx](../src/components/alleskenner/SoloClient.tsx) | use client | SoloClient
[src/components/annotations/AnnotationActions.tsx](../src/components/annotations/AnnotationActions.tsx) | use client | AnnotationActions, AnnotationTrigger, StudyAnnotationContext
[src/components/annotations/AnnotationRecovery.tsx](../src/components/annotations/AnnotationRecovery.tsx) | use client | AnnotationRecovery
[src/components/annotations/MarkSwatch.tsx](../src/components/annotations/MarkSwatch.tsx) | contextafhankelijk / server-entry waar page/layout | MarkSwatch
[src/components/annotations/StudyAnnotations.tsx](../src/components/annotations/StudyAnnotations.tsx) | use client | StudyAnnotations
[src/components/content/FullscreenContentPicker.tsx](../src/components/content/FullscreenContentPicker.tsx) | use client | FullscreenContentPicker
[src/components/dorp/DorpEntry.tsx](../src/components/dorp/DorpEntry.tsx) | use client | DorpEntry
[src/components/dorp/DorpPrototypeClient.tsx](../src/components/dorp/DorpPrototypeClient.tsx) | use client | DorpCanvas, DorpPrototypeClient
[src/components/dorp/FriendVillagePreview.tsx](../src/components/dorp/FriendVillagePreview.tsx) | use client | FriendVillagePreview
[src/components/dorp/ServerDorpClient.tsx](../src/components/dorp/ServerDorpClient.tsx) | use client | ServerDorpClient
[src/components/home/HomeContent.tsx](../src/components/home/HomeContent.tsx) | contextafhankelijk / server-entry waar page/layout | HomeContent
[src/components/hymns-poc/HymnList.tsx](../src/components/hymns-poc/HymnList.tsx) | use client | HymnList
[src/components/hymns-poc/HymnsPocClient.tsx](../src/components/hymns-poc/HymnsPocClient.tsx) | use client | HymnsPocClient
[src/components/hymns-poc/LibraryReportPanel.tsx](../src/components/hymns-poc/LibraryReportPanel.tsx) | use client | LibraryReportPanel
[src/components/hymns-poc/LyricsView.tsx](../src/components/hymns-poc/LyricsView.tsx) | use client | LyricsView
[src/components/hymns-poc/Sheet.tsx](../src/components/hymns-poc/Sheet.tsx) | use client | Sheet
[src/components/hymns-poc/SheetMusicView.tsx](../src/components/hymns-poc/SheetMusicView.tsx) | use client | SheetMusicView
[src/components/hymns-poc/TechnicalPanel.tsx](../src/components/hymns-poc/TechnicalPanel.tsx) | use client | TechnicalPanel
[src/components/kompas/ContextOffer.tsx](../src/components/kompas/ContextOffer.tsx) | use client | ContextOffer
[src/components/kompas/KompasEntryCard.tsx](../src/components/kompas/KompasEntryCard.tsx) | use client | KompasEntryCard
[src/components/kompas/KompasIcon.tsx](../src/components/kompas/KompasIcon.tsx) | contextafhankelijk / server-entry waar page/layout | KompasIcon, TopicIcon
[src/components/kompas/KompasProvider.tsx](../src/components/kompas/KompasProvider.tsx) | use client | KOMPAS_TOUR_PARAM, KompasProvider, useKompas
[src/components/kompas/MarkViewed.tsx](../src/components/kompas/MarkViewed.tsx) | use client | MarkViewed
[src/components/kompas/OffersOptIn.tsx](../src/components/kompas/OffersOptIn.tsx) | use client | OffersOptIn
[src/components/kompas/TopicCard.tsx](../src/components/kompas/TopicCard.tsx) | contextafhankelijk / server-entry waar page/layout | TopicCard
[src/components/kompas/TourButton.tsx](../src/components/kompas/TourButton.tsx) | use client | TourButton
[src/components/kompas/TourOverlay.tsx](../src/components/kompas/TourOverlay.tsx) | use client | TourOverlay
[src/components/learning/ContentStatus.tsx](../src/components/learning/ContentStatus.tsx) | use client | ContentStatusInline, ContentStatusLine, LongChapterNotice, SharedProgressHint
[src/components/mysteries/Mystery001aClient.tsx](../src/components/mysteries/Mystery001aClient.tsx) | use client | MysteryClient
[src/components/mysteries/MysteryDetailPage.tsx](../src/components/mysteries/MysteryDetailPage.tsx) | contextafhankelijk / server-entry waar page/layout | MysteryDetailPage
[src/components/mysteries/MysteryPlayPage.tsx](../src/components/mysteries/MysteryPlayPage.tsx) | contextafhankelijk / server-entry waar page/layout | MysteryPlayPage
[src/components/native/NativeFoundation.tsx](../src/components/native/NativeFoundation.tsx) | use client | NativeFoundation
[src/components/native/entry.tsx](../src/components/native/entry.tsx) | contextafhankelijk / server-entry waar page/layout | default/locale declaratie; zie bron
[src/components/profile/ProfileContentViews.tsx](../src/components/profile/ProfileContentViews.tsx) | use client | AchievementsView, CompetitionView
[src/components/profile/ProfilePage.tsx](../src/components/profile/ProfilePage.tsx) | use client | ProfilePage
[src/components/profile/ProfileSettingsViews.tsx](../src/components/profile/ProfileSettingsViews.tsx) | use client | GameFeedbackView, NotificationsView, PresenceView, PrivacyView, ReadAloudView, ReadingView, WhatsNewView
[src/components/profile/settings.tsx](../src/components/profile/settings.tsx) | use client | ProfileCard, SettingsActions, SettingsButton, SettingsField, SettingsInfoRow, SettingsRow, SettingsSection, SettingsStatus, SettingsToggleRow, settingsFieldClass, settingsInlineFieldClass
[src/components/puzzle/CompletionCard.tsx](../src/components/puzzle/CompletionCard.tsx) | use client | CompletionCard, CompletionRecord
[src/components/puzzle/CoopClient.tsx](../src/components/puzzle/CoopClient.tsx) | use client | CoopClient
[src/components/puzzle/FinishedPuzzleRow.tsx](../src/components/puzzle/FinishedPuzzleRow.tsx) | use client | FINISHED_ROW_CLASS, FinishedPuzzleRow
[src/components/puzzle/LeaderboardClient.tsx](../src/components/puzzle/LeaderboardClient.tsx) | use client | LeaderboardClient
[src/components/puzzle/MatchClient.tsx](../src/components/puzzle/MatchClient.tsx) | use client | MatchClient
[src/components/puzzle/PuzzleBackTarget.tsx](../src/components/puzzle/PuzzleBackTarget.tsx) | use client | PuzzleBackTarget
[src/components/puzzle/PuzzleBoardLayout.tsx](../src/components/puzzle/PuzzleBoardLayout.tsx) | use client | PuzzleBoardLayout
[src/components/puzzle/PuzzleHistoryClient.tsx](../src/components/puzzle/PuzzleHistoryClient.tsx) | use client | PuzzleHistoryClient
[src/components/puzzle/PuzzleTogetherOverview.tsx](../src/components/puzzle/PuzzleTogetherOverview.tsx) | use client | PuzzleTogetherOverview
[src/components/puzzle/RecordCard.tsx](../src/components/puzzle/RecordCard.tsx) | use client | RecordCard
[src/components/puzzle/RecordNotice.tsx](../src/components/puzzle/RecordNotice.tsx) | use client | RecordNotice
[src/components/puzzle/RecordsClient.tsx](../src/components/puzzle/RecordsClient.tsx) | use client | RecordsClient
[src/components/puzzle/RotateButton.tsx](../src/components/puzzle/RotateButton.tsx) | contextafhankelijk / server-entry waar page/layout | ROTATE_BUTTON_SIZE_PX, ROTATE_ICON_SIZE_PX, RotateButton
[src/components/reading/ChapterPath.tsx](../src/components/reading/ChapterPath.tsx) | use client | ChapterPath
[src/components/reading/CoursePathHeader.tsx](../src/components/reading/CoursePathHeader.tsx) | use client | CoursePathHeader
[src/components/reading/MyStepNav.tsx](../src/components/reading/MyStepNav.tsx) | use client | MyStepNav, currentScrollTarget
[src/components/reading/ReadingPath.tsx](../src/components/reading/ReadingPath.tsx) | use client | ReadingPath
[src/components/reading/pathParts.tsx](../src/components/reading/pathParts.tsx) | use client | ActiveChapterCard, CARD, ChapterLinkCard, ChapterThumb, Connector, DoneMark, Heading, LockedChapterCard, THUMB_PAD, hasArtwork
[src/components/shell/FocusModeController.tsx](../src/components/shell/FocusModeController.tsx) | use client | FocusModeController
[src/components/shell/HeaderAvatar.tsx](../src/components/shell/HeaderAvatar.tsx) | use client | HeaderAvatar
[src/components/shell/NavIcon.tsx](../src/components/shell/NavIcon.tsx) | contextafhankelijk / server-entry waar page/layout | NavIcon
[src/components/shell/NavigationScroll.tsx](../src/components/shell/NavigationScroll.tsx) | use client | NavigationScroll
[src/components/shell/PrimaryNav.tsx](../src/components/shell/PrimaryNav.tsx) | use client | PrimaryNav
[src/components/shell/ShellMetrics.tsx](../src/components/shell/ShellMetrics.tsx) | use client | ShellMetrics
[src/components/shell/SocialTabs.tsx](../src/components/shell/SocialTabs.tsx) | use client | SocialTabs
[src/components/snelleZendeling/Leaderboard.tsx](../src/components/snelleZendeling/Leaderboard.tsx) | use client | QuickMissionaryLeaderboard
[src/components/snelleZendeling/RevivePanels.tsx](../src/components/snelleZendeling/RevivePanels.tsx) | use client | DeathPanel, ReviveFailurePanel, ReviveQuestionPanel
[src/components/snelleZendeling/RunClient.tsx](../src/components/snelleZendeling/RunClient.tsx) | use client | QuickMissionaryRunClient
[src/components/snelleZendeling/StartClient.tsx](../src/components/snelleZendeling/StartClient.tsx) | use client | QuickMissionaryStartClient
[src/components/snelleZendeling/TogetherRoom.tsx](../src/components/snelleZendeling/TogetherRoom.tsx) | use client | TogetherRoom
[src/components/snelleZendeling/TogetherRun.tsx](../src/components/snelleZendeling/TogetherRun.tsx) | use client | TogetherRun
[src/components/social/FriendStreaksSection.tsx](../src/components/social/FriendStreaksSection.tsx) | use client | FriendStreaksSection
[src/components/social/GroupDetailClient.tsx](../src/components/social/GroupDetailClient.tsx) | use client | GroupDetailClient
[src/components/social/GroupJoinPreview.tsx](../src/components/social/GroupJoinPreview.tsx) | use client | GroupJoinPreview
[src/components/social/GroupLeaderboardClient.tsx](../src/components/social/GroupLeaderboardClient.tsx) | use client | GroupLeaderboardClient
[src/components/social/GroupLinkSettings.tsx](../src/components/social/GroupLinkSettings.tsx) | use client | GroupLinkSettings, groupLinkUrl
[src/components/social/GroupSettingsClient.tsx](../src/components/social/GroupSettingsClient.tsx) | use client | GroupSettingsClient
[src/components/social/GroupTodayLine.tsx](../src/components/social/GroupTodayLine.tsx) | use client | GroupTodayLine
[src/components/social/GroupsClient.tsx](../src/components/social/GroupsClient.tsx) | use client | GroupsClient
[src/components/social/GroupsEntryCard.tsx](../src/components/social/GroupsEntryCard.tsx) | use client | GroupsEntryCard
[src/components/social/NewGroupClient.tsx](../src/components/social/NewGroupClient.tsx) | use client | NewGroupClient
[src/components/social/shared.tsx](../src/components/social/shared.tsx) | use client | NudgeButton, ProgressBar, SocialHeading, StreakBadge, chip, socialRequest
[src/components/study-folder/StudyFolderClient.tsx](../src/components/study-folder/StudyFolderClient.tsx) | use client | StudyFolderClient
[src/components/study/CfmCourseView.tsx](../src/components/study/CfmCourseView.tsx) | use client | CfmCourseView
[src/components/study/CfmTodayCard.tsx](../src/components/study/CfmTodayCard.tsx) | use client | CfmTodayCard
[src/components/study/CfmWeekPath.tsx](../src/components/study/CfmWeekPath.tsx) | use client | CfmWeekPath
[src/components/study/ImageViewer.tsx](../src/components/study/ImageViewer.tsx) | use client | ImageViewer
[src/components/study/PersonalStudyParts.tsx](../src/components/study/PersonalStudyParts.tsx) | use client | HeaderMenu, StepDots, WeekNav, formatWeekPeriod, lessonBase, menuItem
[src/components/study/ProgramContextPanel.tsx](../src/components/study/ProgramContextPanel.tsx) | contextafhankelijk / server-entry waar page/layout | ProgramContextPanel
[src/components/study/ProgramLessonPicker.tsx](../src/components/study/ProgramLessonPicker.tsx) | use client | ProgramLessonPicker
[src/components/study/ReferenceLink.tsx](../src/components/study/ReferenceLink.tsx) | use client | BlockedReferencesContext, ReferenceActionsContext, ReferenceLink
[src/components/study/ReferencePreview.tsx](../src/components/study/ReferencePreview.tsx) | use client | ReferencePreview
[src/components/study/ReferenceReturn.tsx](../src/components/study/ReferenceReturn.tsx) | use client | ReferenceReturn
[src/components/study/RichContentBlocks.tsx](../src/components/study/RichContentBlocks.tsx) | use client | InlineContent, RichContentBlocks
[src/components/study/StudyReader.tsx](../src/components/study/StudyReader.tsx) | use client | StudyReader
[src/components/study/StudyRoom.tsx](../src/components/study/StudyRoom.tsx) | use client | StudyRoom
[src/components/study/StudyTogetherButton.tsx](../src/components/study/StudyTogetherButton.tsx) | use client | StudyTogetherButton
[src/components/today/ContinueSection.tsx](../src/components/today/ContinueSection.tsx) | use client | ContinueSection
[src/components/today/DiscoverySection.tsx](../src/components/today/DiscoverySection.tsx) | contextafhankelijk / server-entry waar page/layout | DiscoverySection
[src/components/today/FriendRequestButtons.tsx](../src/components/today/FriendRequestButtons.tsx) | use client | FriendRequestButtons
[src/components/today/GeneralConferenceCountdown.tsx](../src/components/today/GeneralConferenceCountdown.tsx) | use client | GeneralConferenceCountdown
[src/components/today/Greeting.tsx](../src/components/today/Greeting.tsx) | contextafhankelijk / server-entry waar page/layout | Greeting
[src/components/today/OpenActions.tsx](../src/components/today/OpenActions.tsx) | contextafhankelijk / server-entry waar page/layout | OpenActions
[src/components/today/SectionHeader.tsx](../src/components/today/SectionHeader.tsx) | contextafhankelijk / server-entry waar page/layout | SectionHeader
[src/components/today/SocialLive.tsx](../src/components/today/SocialLive.tsx) | use client | SocialLive
[src/components/today/SocialPreview.tsx](../src/components/today/SocialPreview.tsx) | contextafhankelijk / server-entry waar page/layout | SocialPreview
[src/components/today/TodaySection.tsx](../src/components/today/TodaySection.tsx) | contextafhankelijk / server-entry waar page/layout | TodaySection
[src/components/today/TogetherBlock.tsx](../src/components/today/TogetherBlock.tsx) | contextafhankelijk / server-entry waar page/layout | TogetherBlock
[src/components/today/WordGameCountdown.tsx](../src/components/today/WordGameCountdown.tsx) | use client | WordGameCountdown
[src/components/versado/AchievementIcon.tsx](../src/components/versado/AchievementIcon.tsx) | use client | AchievementIcon
[src/components/versado/Carousel.tsx](../src/components/versado/Carousel.tsx) | use client | Carousel
[src/components/versado/CompanionPicker.tsx](../src/components/versado/CompanionPicker.tsx) | use client | CompanionPicker, companionName
[src/components/versado/ContentCard.tsx](../src/components/versado/ContentCard.tsx) | use client | CardMenu, CardPicker, CardProgress, ContentCard, StatusChip, cardActions
[src/components/versado/ContentIcon.tsx](../src/components/versado/ContentIcon.tsx) | use client | ContentIcon
[src/components/versado/DivisionEmblem.tsx](../src/components/versado/DivisionEmblem.tsx) | contextafhankelijk / server-entry waar page/layout | DivisionEmblem
[src/components/versado/FocusLayout.tsx](../src/components/versado/FocusLayout.tsx) | contextafhankelijk / server-entry waar page/layout | FocusLayout
[src/components/versado/ImmersiveLayout.tsx](../src/components/versado/ImmersiveLayout.tsx) | contextafhankelijk / server-entry waar page/layout | ImmersiveLayout
[src/components/versado/MascotSlot.tsx](../src/components/versado/MascotSlot.tsx) | contextafhankelijk / server-entry waar page/layout | FamilyState, MascotCharacter, MascotSlot, MascotState
[src/components/versado/MediaArtwork.tsx](../src/components/versado/MediaArtwork.tsx) | use client | MediaArtwork
[src/components/versado/PageIntro.tsx](../src/components/versado/PageIntro.tsx) | contextafhankelijk / server-entry waar page/layout | PageIntro
[src/components/versado/PersonalMascot.tsx](../src/components/versado/PersonalMascot.tsx) | use client | CompanionProvider, PersonalMascot, useCompanion
[src/components/versado/RankMedal.tsx](../src/components/versado/RankMedal.tsx) | use client | RankMedal
[src/components/versado/SearchField.tsx](../src/components/versado/SearchField.tsx) | use client | SearchField
[src/components/versado/StateMessage.tsx](../src/components/versado/StateMessage.tsx) | contextafhankelijk / server-entry waar page/layout | StateMessage
[src/components/versado/StreakDayIndicator.tsx](../src/components/versado/StreakDayIndicator.tsx) | contextafhankelijk / server-entry waar page/layout | StreakDayIndicator
[src/components/versado/SystemIcon.tsx](../src/components/versado/SystemIcon.tsx) | contextafhankelijk / server-entry waar page/layout | SystemIcon
[src/components/versado/ToggleSwitch.tsx](../src/components/versado/ToggleSwitch.tsx) | use client | ToggleSwitch
[src/components/versado/VisualIdentityIcon.tsx](../src/components/versado/VisualIdentityIcon.tsx) | use client | VisualIdentityIcon
[src/lib/i18n/rich.tsx](../src/lib/i18n/rich.tsx) | contextafhankelijk / server-entry waar page/layout | rich
[src/lib/podcastPlayerContext.tsx](../src/lib/podcastPlayerContext.tsx) | use client | PodcastPlayerProvider, usePodcastPlayer
[src/lib/readAloudPlayerContext.tsx](../src/lib/readAloudPlayerContext.tsx) | use client | ReadAloudPlayerProvider, getVoice, useReadAloudPlayer

### Aanvullende routes en gebeurtenissen

- Metadata: [src/app/robots.ts](../src/app/robots.ts).
- Metadata: [src/app/sitemap.ts](../src/app/sitemap.ts).
- Rewrite: `/manifest.webmanifest` → `/api/branding/manifest` (`next.config.js`).

- Profielscherm: `/profile?view=competition` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=achievements` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=reading` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=guide` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=language` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=readAloud` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=gameFeedback` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=notifications` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=privacy` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=presence` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=about` — ontbreekt als volwaardig lokaal scherm.
- Profielscherm: `/profile?view=twoFactor` — ontbreekt als volwaardig lokaal scherm.

Socket-events (web; native handshake nog niet aanwezig):

- `activity_update`
- `add_guest`
- `cancel_game`
- `choose_event`
- `data_subscribe`
- `data_unsubscribe`
- `disconnect`
- `enter_physical_roll`
- `forfeit`
- `friend_profile_changed`
- `friend_statuses_request`
- `friendship_changed`
- `invite_friend`
- `join_game`
- `leave_game`
- `presence_settings_changed`
- `remove_guest`
- `roll_dice`
- `scrabble_changed`
- `start_game`
- `submit_answer`
- `submit_family_answer`
- `use_hint`

<!-- END NATIVE PARITY INVENTORY -->
