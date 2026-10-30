# Gedeelde applicatiestructuur — fase A

Ontwikkelbasis: `develop` `f7dd12a309591a30603900fc36e7c09feb8459d5`.
Dit is de eerste kleine implementatiestap van [#238](https://github.com/rjgout/Versado.app/issues/238)
en [roadmap #163](https://github.com/rjgout/Versado.app/issues/163), geen volledige schermpariteit.

## Daadwerkelijk gedeeld

Next.js `RootLayout` en de lokaal gebundelde `NativeFoundation` renderen **dezelfde**
`AppShellFrame` en `AppShellHeader`. De bestaande React-presentatie van de terugbalk,
profielavatar, reeks, XP en divisie staat in gedeelde views. `BottomNav`, `PrimaryNav`,
`StickyHeader`, `ShellMetrics` en `FocusModeController` blijven de bestaande implementaties.
Web behoudt SSR, contentkiezer, meldingen, spelers en de webavatarcache via slots/adapters.
Native gebruikt bestaande `AppNavigation`, hashgeschiedenis, platformlifecycle, thema,
vertalingen, safe areas en toestelterug. Alleen de bestaande Vandaag-route is als primaire
native bestemming actief; profiel blijft via de avatar bereikbaar. Geen lege Leren-,
Spelen- of Vriendenbestemmingen. De statistieken zijn informatief totdat hun detailpagina's
lokaal beschikbaar zijn. Dit levert nog geen gedeelde Vandaag-kaarten op.

De bestaande geauthenticeerde native `GET me` levert optioneel `shellHeader.version=1`
met eigen serverwaarden en compacte avataridentiteiten. Oudere servers zonder dit veld
blijven bruikbaar, zonder verzonnen statistieken. De projectie leest de bestaande pure
reeksweergaveregels en de bestaande divisieservice; zij boekt geen reeks-/XP-/freezeactie.
Web behoudt zijn bestaande settlementgedrag. De gedeelde `LiveDataStore` verzorgt gerichte
invalidatie en herladen; sessie-epoch en accountidentiteit verwerpen late antwoorden.
Geen tweede cache, sessie, voortgang, offlinebeloning of automatische schrijfretry.
Er is geen nieuwe API-route of verruiming van de TS/Swift/Java-routegrens nodig.

De bestaande Cloudflare Service Auth, HTTP-bridge, beveiligde opslag, login, verplichte
setup, sessierotatie en uitgestelde logoutintentie blijven behouden. Realtime blijft begrensd
met `features.includes("realtime-ticket-v1") && client.realtimeSupported`: de interne
Access-build opent geen socket. Voorbereide Apple-authenticatie blijft bestaan; de UI
vereist een afzonderlijke, nog niet aangeboden `apple-sign-in-ui-v1`-vrijgave naast configuratie.
Dit is geen nieuwe authenticatielaag of wijziging van storebeleid.

## Volgende uitvoerbare PR's en afhankelijkheden

1. **Contentcontext en kiezer:** bestaande webpresentatie met expliciete native adapter;
   serverrechten, taal en exacte collectie-identiteit blijven leidend.
2. **Leescursussen en lezer:** bestaande cursuskaarten/leespaden en servercursor hergebruiken.
   De huidige Foundation kiest nog het eerste hoofdstuk. Dat is geen Stap-voor-stap-cursus;
   de proef mag niet als volledige cursusacceptatie worden gebruikt. Een versstap moet via
   bestaande cursuslogica afronden, nooit als volledig hoofdstuk. Audio en oefeningen volgen
   in afzonderlijke afhankelijke PR's, zonder een tweede beloningslogica.
3. **Vandaag en profiel/accountcontracten:** bestaande kaarten/services/presentatie delen;
   accountverwijdering uit bestaand WP4-werk (#202/#205) gericht integreren, niet dupliceren.
4. **Native push vroeg inplannen na shell/accountcontracten:** aparte APNs-/FCM-PR met gedeelde
   `notifyUser`-gebeurtenissen/voorkeuren, veilige tokenbinding en afmelding, permissies,
   badges en gevalideerde deep links. Wacht niet op alle spellen. Apple Developer-/Firebase-
   eigenaarchecklist en providermocks horen bij die PR; fysieke aflevering vereist toestelbewijs.
5. **Spellen en vrienden:** eerst veilige realtime onder Access onderzoeken met bestaande
   socketbewijzen, sessiecontroles en Redis; geen bypass of tweede spelstaat. Daarna bestaande
   engines/schermen per functie aansluiten.
6. **Platformbeschikbaarheid en systeemintegraties:** voortbouwen op bestaande contentrechten,
   oudere appversies veilig behandelen; delen, haptiek, lifecycle en audio gericht uitbreiden.
   Apple-login blijft een latere afzonderlijke fase; privacy/accountverwijdering niet uitstellen.

Volledige bestaande gebruikersfunctionaliteit op alle drie platformen plus push is het einddoel.
De oude Mobile 1.0-scope is geen toestemming om spellen, sociale functies of push na release
uit te stellen. Elke volgende fase vereist onafhankelijke review en eigenaarakkoord.

## Bewijs en toestelacceptatie

`tests/native-shell.test.tsx` controleert de gedeelde rendercontracten, vijf talen,
versiecompatibiliteit, werkelijke bestemmingen en compacte lokale assets.
`tests/native-shell.integration.test.ts` controleert echte geïsoleerde autorisatie,
web/native badgewaarden en dat `GET me` geen gebruikersvoortgang wijzigt.
`tests/native-shell.browser.mjs` gebruikt de echte Next-webapp én lokale Foundation,
maakt vergelijkbare screenshots en controleert de werkelijke esbuild-inputs:
de gedeelde views zitten in de native bundel, Next/Prisma/servercode niet.
Voorbeelden van synthetische testaccounts: [native 390px](native-shell/native-390.png),
[web 390px](native-shell/web-390.png), [native 320px/200%](native-shell/native-320-200.png).
De volledige vijf-talen-/tabletset en bundelprovenance worden als CI-browserbewijs bewaard.
De bestaande auth-, account-, Access-, data-, leesafrondings- en sockettests blijven vereist.
Resultaten en CI-status worden bij de PR per uiteindelijke commit vastgelegd.

De eigenaar heeft de eerdere Foundation op een fysieke iPhone getest (PR #233):
Service Auth, login, verplichte 2FA en sessieherstel. **Deze nieuwe shell is nog niet fysiek
geaccepteerd.** Chromium en platformcompilatie bewijzen geen toestelpariteit.

Na review: eigenaar installeert een nieuwe interne iOS-build via de bestaande ontwikkelroute.
Voor badges moet de goedgekeurde backendversie het additieve `me`-veld aanbieden; de oudere
backend blijft werken zonder badges. Geen wijziging van Tunnel, DNS, NAS-poort of geheimen.
Controleer iPhone/iPad/Android: login/setup, profiel via avatar, terug, hervatten, accountwissel,
200% tekst, thema, veilige schermranden/toetsenbord en bereikbaarheid van logout.
Vergelijk de bestaande webshell en bevestig geen cursus-, spel- of pushpariteit op basis van
alleen deze PR. Releaseguards en afzonderlijke merge-/uitroltoestemming blijven verplicht.


## Correctie na onafhankelijke review 5712045692

De Apple-login-UI blijft uitgesteld. Loginknop en hersteladvies gebruiken dezelfde
bestaande poort: iOS, geconfigureerde Apple-capability én `apple-sign-in-ui-v1`.
Zonder die vrijgave toont een niet-gekoppeld profiel geen Apple-status, koppelactie
of ongebruikte wachtwoord-/2FA-velden. Een werkelijk gekoppelde identiteit blijft
zichtbaar; bestaande beveiligde ontkoppeling vereist nog steeds een alternatieve
inlogmethode, wachtwoord en eventuele 2FA. Een Apple-only-account kan zijn laatste
inlogmethode niet via deze bediening ontkoppelen. Authservices, routes en contracten
zijn voor deze correctie niet gewijzigd; de gedeelde shellviews evenmin.

`tests/native-foundation-apple.browser.mjs` controleert echte login/herstel/profiel-
weergave met gesimuleerde iOS-/Android-detectie en capability-aanbod, alle vijf talen,
logout/herlogin/accountwisseling, een bestaande koppeling met echte geïsoleerde
TOTP-ontkoppeling en een Apple-only-account. Dit test geen Apple-provideraflevering
of fysieke toestelintegratie. De bestaande shell-/Access-/sessietests blijven actief.

### Nog uit te voeren iPhone-smoketest door de eigenaar

Gebruik de opnieuw gebouwde interne PR-build via de bestaande ontwikkelroute.
Voer geen netwerk-, NAS- of Cloudflare-configuratiewijziging uit voor deze proef.
Noteer build-SHA, iPhone/iOS-versie, resultaat per stap en eventuele screenshots.

1. Start de app en log in met bestaande Versado-inloggegevens en verplichte 2FA.
   Controleer dat bij uitgestelde Apple-login geen Apple-knop of Apple-hersteladvies
   op login/registratie/wachtwoordherstel staat. Gewone wachtwoordreset blijft bereikbaar.
2. Bekijk header, avatar, reeks en XP; vergelijk met de bevestigde eigen serverwaarden.
   Controleer de divisie indien de gebruiker een bestaande competitietoewijzing heeft.
3. Open profiel via de avatar en controleer terugknop en Vandaag-navigatie.
   Een niet-gekoppeld account heeft geen Apple-status/koppelvelden. Een werkelijk
   gekoppeld account mag zijn bestaande beheer zien; ontkoppel niet alleen voor deze
   smoketest een gebruikte identiteit.
4. Log uit en opnieuw in. Controleer dat de loginpagina geen oude accountgegevens toont.
5. Wissel tussen twee bestaande testaccounts en controleer avatar, badges en profielstatus.
   Gegevens van het vorige account mogen niet terugkomen, ook niet bij traag netwerk.
6. Controleer de bestaande Cloudflare Access-verbinding. Sluit de app volledig af,
   open haar opnieuw en controleer veilig sessieherstel. Geen Apple- of Access-bypass.
7. Bekijk licht/donker, scrollen, schermranden/safe areas en terugnavigatie; controleer
   ook 200% tekst en toetsenbord openen/sluiten zonder onbereikbare bediening.

Deze stappen zijn **nog niet fysiek uitgevoerd voor deze PR-build**. Ook Android-
apparaatacceptatie blijft nodig vóór platform-/releaseacceptatie. De eerder bevestigde
Foundation-test bij #233 vervangt dit nieuwe bewijs niet. Geen merge of deployment
zonder afzonderlijk eigenaarsbesluit.
