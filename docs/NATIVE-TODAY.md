# B2a — één Vandaag-weergave, read-only native gegevens

Basis: develop `4161dceecc9048118801672cf029b29d802f439d` na #239, #241 en #242.
Uitvoering: [#243](https://github.com/rjgout/Versado.app/issues/243), roadmap
[#238](https://github.com/rjgout/Versado.app/issues/238). Dit is de eerste B2-PR,
geen volledige native functiepariteit of vrijgave voor deployment.

## Wat daadwerkelijk gedeeld is

`dashboard/page.tsx` behoudt alle bestaande web-SSR-/authenticatiepoorten en
`getTodayData`. `WebTodayView` en `NativeTodayView` gebruiken **dezelfde**
`TodayView`: dezelfde volgorde, kaarten, CSS, tablet-/desktopkolommen en
zichtbaarheidsregels. De bestaande `Greeting`, `OpenActions`, `ContinueSection`,
`TodaySection`, `GeneralConferenceCountdown`, `SocialPreview`, `TogetherBlock`
en `DiscoverySection` zijn hergebruikt, geen nagebouwde kaarten.

De bestaande online-vrienden-JSX is verplaatst naar `SocialView`; alleen de
webadapter `SocialLive` opent de bestaande cookiesocket. De oorspronkelijke
vriendenknoppen, reeksvoortzetkaart en Kompas-kaart hebben gedeelde views.
`TodayProgramView` gebruikt de oorspronkelijke CFM-kaart en de bestaande
programmasamenvatting; `getTodayProgram` is de uit `ProgramContextPanel`
gehaalde serverresolver met dezelfde weekselectie, rechten en cursusroute.
De webkiezer behoudt zijn bestaande schrijfacties. `CardMenu` is uit de brede
`ContentCard`-module gehaald en onder dezelfde export behouden; native hoeft
niet de Next-kaartcomponent te laden.

`TodayInteractionsProvider` bevat alleen platformacties/rendererpoorten, geen
cache, accountopslag of businessregels. Web behoudt zijn bestaande
vriendenmutaties, persoonlijke hide-voorkeur en realtime-adapter. Native toont
bij nog niet aangesloten acties een toegankelijke, sluitbare melding via de
bestaande `ConfirmProvider`. Systeemterug sluit eerst een open dialoog.
Er wordt geen mutatie verstuurd, geen kaart optimistisch verborgen en geen
cursusroute omgeschreven naar de Foundation-hoofdstukafronding.

## Native contract en read-only grens

- Additieve capability `today-overview-v1` en uitsluitend
  `GET /api/v1/native/today-overview`, envelope `version: 1`.
- Dezelfde `getTodayData` en compacte, geautoriseerde programma-, gids-, Kompas-
  en avatarweergaven. Geen e-mail, wachtwoordhash, sessiebewijs, privéprofiel of
  clientgestuurde actor. Avatar-ID's komen uitsluitend uit het eigen, reeds
  geautoriseerde overzicht. Onbekende geneste DTO-velden worden gestript.
- Exacte TS-, Swift- en Java-Access-poorten; geen brede prefix, querydoorlaat,
  nieuwe origin, credential in JavaScript of WebSocket-bypass.
- De bestaande native sessie wordt vóór en na de aggregatie gecontroleerd.
  Intrekking/accountverwijdering of een gewijzigde selectieversie, taal of
  accounttijdzone maakt het antwoord ongeldig. Lezen houdt geen lange rijlocks.
- Een GET mag geen freeze, leesstatus, XP of voortgang wijzigen. De bestaande
  `getTodayData` heeft daarom een expliciete read-only modus. De reeksweergave
  gebruikt `previewStreakContinuation`: de bestaande `missedDayPlan` en
  `continuationView`, zonder dagen af te boeken of een activiteit te claimen.
  De webaanroep blijft standaard de bestaande domeinafhandeling gebruiken.
  Een integratieproef vergelijkt de read-only projectie met die echte
  domeinafhandeling en controleert de ongewijzigde rijen vóór/na GET.
- Een lege toegestane catalogus levert nooit cursusdata uit het historische,
  niet-null Boek-van-Mormon-label op. `getTodayData` begrenst alle contentqueries
  tot zijn bestaande geautoriseerde catalogus en geeft zonder toegestane bron
  geen cursuspositie, ontdekkingscursus of dagtekst terug. Globale/persoonlijke
  kaarten blijven beschikbaar. Dezelfde correctie geldt voor web; de nieuwe
  regressie reproduceerde eerst aantoonbaar een verborgen cursuspositie.
- `serverNow`/`expiresAt` gebruiken de accounttijdzone, lokale middernacht en de
  bestaande woordrelease; de cliënt berekent het interval vanaf ontvangst.
  De selectie-/beloningsregels en opgeslagen cursusposities zijn niet vervangen.

Een capabele backend wordt uitsluitend via dit overzicht gelezen: de bestaande
`GET today`-eerste-hoofdstukproef wordt dan niet aangeroepen of als cursusknop
getoond. Oude apps houden hun bestaande contract. Zonder capability behoudt de
nieuwe app de eerdere Foundation-proef; dat is expliciet geen volledige
Vandaag-/cursuspariteit. De nog bestaande handmatige `/lesson`-proef en
`chapters/:id/complete` zijn niet tot Stap-voor-stap-implementatie verklaard.

## Verversen en isolatie

De bestaande `LiveDataStore` en sessie-epoch blijven de enige datalaag. Keys
bevatten gebruiker en bevestigde bron-/selectieversie. Een late response van
account A of een oude bron wordt geweigerd; een nieuwe bron toont geen vorige
inhoud. De serverresultaten gaan door een getypeerd, begrensd Zod-contract.

De bestaande gebeurtenisscopes voor Vandaag, content, voortgang, XP/reeks,
cursussen, programma, vrienden/groepen en Kompas maken het overzicht ongeldig.
Focus, onlineherstel en apphervatten gebruiken dezelfde store. De serverexpiry
ververst bij een nieuwe dag of woordrelease, ook bij een afwijkende toestelklok.
Onder interne Access is er geen socket: het zichtbare overzicht en de reeds
bestaande headerquery pollen begrensd iedere 60 seconden (+ storetick/netwerk).
De B1-contextpoll blijft 15 seconden. Verborgen/offline wordt niet gepolld;
leesfouten versnellen de klok niet. Geen offline mutatiewachtrij of schrijfretry.

Een nieuwe 320px/200%-proef vond een bestaande sectiekop die zijn Leren-link
buiten de viewport duwde. De **gedeelde** sectiekop en voortzetkaartfooter
mogen nu gecontroleerd afbreken; de decoratieve Kompas-afbeelding volgt de
bestaande `vs-decor`-regel bij grote tekst. De gewone kaartinhoud, tokens en
compositie blijven behouden; geen native CSS-uitzondering of overflow-clipping.

## Beelden

Het bestaande artworkregister blijft de bron. De lokale build maakt 89
begrensde WebP-varianten (maximaal 640px breed, kwaliteit 78, circa 5,7 MiB)
van precies die publieke afbeeldingen. Er wordt niets gedownload en niets in
`public/` overschreven. De originele bronidentiteit blijft in `data-artwork`
zichtbaar; web behoudt Next Image. De bestaande shell-assetlimiet blijft intact;
de build weigert meer dan 8 MiB gegenereerd Vandaag-artwork.

De bestaande drie gidsen en hun benodigde begroeting-/rust-/ontdekstates worden
lokaal verpakt. Er wordt geen gids vervangen door Novi als een andere gekozen is.
Private `/api/study-media`-afbeeldingen worden **niet** als cookie-URL vanuit de
native WebView opgehaald. Zonder `study-media-v1` blijft de bestaande veilige
CFM-weergave zonder foto behouden. B2b-2 koppelt hieronder dezelfde kaart aan de
beveiligde native media-adapter. Volledige reader-/audiopariteit is hiermee niet
geleverd.

## Ontbrekende acties en bestemmingen

Alle kaarten houden hun bestaande inhoud. Ontbrekende bestemmingen worden niet
vertaald naar een onjuiste lokale reader en openen geen remote WebView.
`nativeTodayDestination` en `data-native-unavailable-href` maken de grens
controleerbaar. De gebruiker krijgt een expliciete melding, geen leeg scherm.

| Kaart/handeling | Bestaande bestemming | Nog nodig |
| --- | --- | --- |
| Header/contentkiezer/avatar | `/content`, huidig `/profile` | B1/shell werken; volledig profiel B4 |
| Ga verder, dagelijkse tekst | cursus-/hoofdstuk-/leesles-/podcast-/kids-/introroute | B3: werkelijke cursus-/verscursor en reader |
| CFM/programmacontext | `/study-lesson/...`, cursus-/weekpad | B3; beveiligde studiemedia B2-vervolg/B5 |
| Reeks, Kompas | `/streak`, `/kompas` | B4 |
| Hide voortzetkaart | bestaande persoonlijke lijstvoorkeur | B2b-1: dezelfde UserListOrder-service via expliciete native poort |
| Vriendenverzoek accepteren/weigeren | bestaande vriendschapsservice | B2b-1: gedeelde transactieservice; volledige vriendenpagina blijft B5 |
| Open acties/uitnodigingen | `/acties`, bestaande spel-/groepsroutes | B5 |
| Woord, dagelijkse quiz, ontdekspellen | bestaande spelroutes | B5 |
| Lofzangen | `/dev/lofzangen` | B5, inclusief veilige media |
| Vrienden, groepen, divisie, activiteit | bestaande sociale routes | B5; geen onveilige realtime-omweg |
| Ontdekcursussen | `/courses/...` | B3 |

Geen nieuwe cursussen, oefeningen, notificaties, XP-, reeks- of voortgangsregels.
Native push blijft een vroege afzonderlijke fase. CFM-CI #237, Apple-login,
main, NAS, Portainer en Cloudflare blijven buiten deze opdracht.

## Bewijs en fysieke acceptatie

Lokaal uitgevoerd: 165 bestaande/nieuwe native-/datatests en twee aanvullende
SSR-renderproeven (60 dagelijkse toestandscombinaties in vijf talen, plus CFM,
reeksvoortzetting, conferentie en afscherming van private studiemedia), 28 shell/
layouttests, 13 profieltests en 50 relevante domeintests. De geïsoleerde keten
behoudt de bestaande 43 account-/sessietests en 55 socket-/selectietests; acht
nieuwe Vandaag-API-tests controleren ook hidden/draft/disabled en de lege
catalogus. De gerichte Vandaag-browserproef levert 100 beelden (50 web/native-
paren), met bron-/interfacetaalwissel, web-hide zonder cursorverlies, selectie,
zichtbare toetsenbordfocus, systeemterug bij de melding, scrollherstel,
leesfout/herstel, late accountresponse en intrekking. De PR bevat de exacte
combinatie-uitkomst, eindcommit en uiteindelijke CI-runlinks.
De relevante proeven omvatten het echte geïsoleerde API-/sessiecontract,
read-only rijen, bron-/sessieraces en dezelfde Next-SSR-/lokale Vandaag-view.
Screenshots staan in het Native Foundation-artifact onder `today`.
Eerdere toestelresultaten voor Foundation/shell/B1 zijn geen B2-acceptatie.

Voor gericht lokaal ontwikkelen kan
`npm run test:native:integration -- --today-only` de Vandaag-suite op een eigen
wegwerpdatabase uitvoeren. Dit is geen vervanging van de volledige
`npm run test:native:integration`; CI gebruikt altijd de volledige standaardketen
met alle bestaande socket-, account- en compatibiliteitsproeven.

Eigenaarstest na afzonderlijk goedgekeurde backenduitrol en een nieuwe interne
appbuild (beide moeten `today-overview-v1` ondersteunen):

1. Bestaande login/2FA, sessieherstel na afsluiten en Access-herstel controleren.
2. Dezelfde gebruiker/bron naast web openen; kaarten, volgorde, datum, gids,
   reeksstatus en echte cursuspositie vergelijken. Geen eerste-hoofdstukproef.
3. Contentbron/taal wisselen; nieuwe inhoud en behoud van bestaande voortgang
   controleren. Ook een wijziging via web en hervatten testen.
4. Kaarten met ontbrekende bestemming openen: begrijpelijke melding, sluiten
   en Android-systeemterug; geen leesafronding of beloning.
5. Scrol diep, open Profiel/contentkiezer en ga terug: positieherstel, geen
   focusrand om de titel, zichtbare interactieve toetsenbordfocus.
6. Offline/online, trage aanvraag, hervatten, account A→B, logout en ingetrokken
   sessie testen; nooit oude privéinhoud onder een ander account.
7. iPhone/iPad/Android, 320px, 200% tekst, vijf talen, licht/donker, safe areas,
   VoiceOver/TalkBack en selecteren/kopiëren van de dagtekst controleren.
8. Rond lokale middernacht/woordrelease verversen en zondagse Lofzangen-gate
   controleren met bestaande accountinstellingen. Geen apparaataflevering van
   push, reader-/audio- of multiplayerpariteit afleiden uit deze proef.


## B2b-1 — bevestigde Vandaag-acties

Voortzetkaarten verbergen en inkomende vriendenverzoeken accepteren/afwijzen
gebruiken dezelfde componenten op web en native. `FriendRequestControl` bewaakt
snelle tikken met een synchrone in-flight-vlag, toont fouten en bewaart de
serverbevestiging wanneer een volgende leesactie mislukt. `CardMenu` en
`ContinueSection` blijven gedeeld. Een mislukte actie blijft handmatig te proberen;
een offline actie wordt niet bewaard of automatisch opnieuw verstuurd.

De additieve capability `today-actions-v1` ontsluit uitsluitend:

- `POST /api/v1/native/today-actions/hide` met `{ itemKey }`.
- `POST /api/v1/native/today-actions/friend-response` met
  `{ friendshipId, action: "accept" | "decline" }`.

Beide leveren een begrensd versie-1-contract met actor-ID en de bevestigde
uitkomst. TypeScript, Swift en Java staan alleen deze exacte POST-paden toe.
Oudere apps blijven werken; zonder capability behoudt native de melding uit B2a.
Er is geen tweede cookie-/Bearer-sessie, endpointwildcard of Access-omweg.

`saveListPreferences` bewaart dezelfde `UserListOrder`-voorkeuren als web.
Lezen en herschrijven gebeuren nu binnen één transactie en User-lock, zodat
tegelijk verbergen geen eerder opgeslagen voorkeur verliest. Een expliciete
verbergactie heeft ook bij een eerder geordende kaart voorrang. Geen cursus,
leespositie, beloning of bronselectie wordt aangepast. De bestaande activiteit-
gebonden visibilityKey maakt de kaart pas bij nieuwe activiteit weer relevant.

`respondFriendRequest` gebruikt de bestaande Friendship-status en
`checkAndAwardAchievements`, zonder nieuwe beloningsregels of notificaties.
Alle betrokken User-rijen worden op ID gesorteerd vergrendeld, vervolgens de
NativeSession indien van toepassing en daarna de Friendship-rij. Alleen de
ontvanger mag native reageren; web behoudt het annuleren van een eigen
uitgaand PENDING-verzoek. Een reeds geaccepteerd verzoek opnieuw accepteren is
een bevestiging zonder nieuwe prestaties of feeditems. Afwijzen verwijdert
zoals voorheen de PENDING-rij; opnieuw reageren op die verdwenen identiteit
levert 404 zonder mutatie. Een accept/decline-race kan nooit een reeds
geaccepteerde vriendschap verwijderen (409); verwijderen als vriend blijft de
bestaande aparte handeling. Beide gebruikers krijgen pas na commit het bestaande
`friends_changed`-signaal. Er wordt geen extra push-/meldingssysteem toegevoegd.

Voor native bewaakt `commitAccountMutation` dezelfde bestaande NativeSession
vóór en na domeinwerk binnen de commitgrens. User → NativeSession-locks
serialiseren logout, replay en beveiligingswijzigingen met de actie; de tweede
controle weigert ook klokverloop. Geen netwerkwerk binnen deze transactie.
De app gebruikt `actionOnce`: ook een 401 herhaalt deze write niet automatisch.

Bevestigde resultaten worden gericht geprojecteerd in dezelfde LiveDataStore-
entry en maken alleen relevante scopes ongeldig. De bestaande writeVersion
verwerpt oudere GET-antwoorden. De port legt de sessie-epoch bij render vast;
een oude klik of laat antwoord van A kan nooit B wijzigen. De actieve querykey
wordt expliciet doorgegeven, ook wanneer een gewijzigde accounttaal eerder in
het Vandaag-antwoord dan in `me` zichtbaar wordt. Er is geen tweede cache.

B2b-1 levert geen private studiemedia, readers, spellen of volledige sociale
schermen. De beveiligde media-adapter staat hieronder in B2b-2; de overige bestemmingen houden de
veilige melding uit B2a. Geen schema-/migratie-, Apple-, CFM-inhouds-, NAS- of
productiewijzigingen.

Gerichte proeven: afzonderlijke Node-processen op dezelfde geïsoleerde
PostgreSQL/Redis, web/native-preferentieraces, dubbele acceptatie en tegengestelde
reacties, actor/methode/bodycontrole, intrekking/beveiligingswijziging en verloop
bij lockwachten, rollback van voorkeuren en prestatieverwerking. Browserbewijs
in `native-foundation-browser/today-actions` omvat fouten, handmatige retry,
offline zonder replay, bevestigde write gevolgd door mislukte/oude GET,
herstart, late A-bevestiging na B-login en 320px/200%-bediening. De definitieve
PR vermeldt de daadwerkelijk geslaagde aantallen en CI-head; hieruit volgt
geen fysieke apparaatacceptatie.

Aanvullende eigenaarstest op iPhone en Android: verberg één echte voortzetkaart,
controleer dezelfde webvoorkeur na herstart en behoud van de cursuspositie;
accepteer en wijs afzonderlijke verzoeken af; controleer beide accounts op web,
offline/fout/herstel zonder spontane acties, accountwisseling, Access,
schermlezer, menu-/knopfocus en scrollherstel. Publicatie/deployment blijft een
afzonderlijke eigenaarshandeling.




## B2b-2 — beveiligde studiemedia

Synchronisatiebasis van #246: develop-squashmerge #245
`8a3a97cddfc192c656634d5a2fc80d175910aa51`. De actuele integratiebasis is
`0224360dd31f230bc203ea701697bf87c211d62e`, inclusief de ongewijzigd behouden
broncontroles van #247 en #248 (drie tests en de development-workflow; geen
applicatiecode). Alleen de mediacommit
`ee6b50338cb9c04eb05e6ffbda3f6fb11e196ac2` is overgezet; de oorspronkelijke
actiecommit `1c3e69cdb0b9251010abe53a52533d29b94ee4a0` is geen extra commit
in deze branch. Squash- en actiebestandsboom zijn identiek; de overzetting had
geen conflicten of applicatiecodeaanpassingen nodig. Aanvullend zijn deze
basisnotitie en de pariteitsintroductie bijgewerkt. De hercontrole vond één
onbetrouwbare testwachtrij: `native-study-media.test.ts` wacht nu op dezelfde
lopende LiveDataStore-query inclusief WebCrypto, in plaats van op twee
eventlooprondes. Alle deduplicatie-, wis- en foutasserties blijven behouden;
er is geen timeout verhoogd of productcode aangepast. De broninventaris is
opnieuw gegenereerd voor deze testwijziging.
De nieuwe head en opnieuw uitgevoerde checks staan in de PR; eerdere groene
runs op de oude gestapelde head gelden niet als bewijs voor deze synchronisatie.

De bestaande `CfmTodayCard` gebruikt op web en native dezelfde Image-poort.
Met capability `study-media-v1` onderschept uitsluitend de native adapter een
exacte `/api/study-media/<id>`-bron. Die web-URL wordt nooit aan native `img.src`
of een cookie-fetch gegeven: de ID gaat via de bestaande Bearer-/Service
Auth-bridge naar `GET /api/v1/native/study-media/<id>`. Zonder capability blijft
de veilige B2a-weergave zonder foto behouden. Publiek artwork blijft lokaal.

`authorizeStudyMedia` is geëxtraheerd uit dezelfde bestaande
`authorizedStudyMedia`-service. De webroute blijft dezelfde oorspronkelijke
bytes leveren. De native route gebruikt exact dezelfde gepubliceerde revisie-,
collectie-, bronpin-, rechtenhash-, figuur- en opslagcontroles, zonder adminpreview.
Na lezen/decoderen worden sessie, bronselectie en publicatierechten opnieuw
gecontroleerd. Niet-READY, verborgen/niet-toegankelijke, DRAFT, retired,
ontpubliceerde of corrupte brondata levert geen afbeelding op. Bestaande
beheerrechten blijven leidend: beheerders mogen vrijgegeven verborgen bronnen
lezen zoals op web, nooit DRAFT via deze gewone route.

Er is geen bron-URL-, bestandspad- of proxyparameter. Alleen een ID van maximaal
128 ASCII-tekens en de exacte GET-methode zijn toegestaan in TypeScript, Swift
en Java. Queryparameters, traversal en preview worden geweigerd. Het antwoord
is versie 1 met noodzakelijke actor-/selectie-identiteit, bronchecksum,
uitvoerchecksum, MIME, afmetingen, grootte, serverklok/expiry en base64. Geen
cookie, servicecredential, sleutel of sessietoken staat in een afbeeldings-URL.
De bestaande HTTP-bridge blijft JSON, zonder redirects/cookies/schijfcache en
met zijn ongewijzigde responslimiet van 1 MiB.

Een tijdelijke WebP-weergave blijft binnen 640×640 pixels en 256 KiB (circa
350 KiB JSON). Er worden geen originelen aangepast of varianten opgeslagen.
De bestaande bronlimiet is 10 MiB; de transformatie weigert meer dan 16 miljoen
invoerpixels en verwerkt maximaal twee aanvragen per proces tegelijk. Het
bestaande gedeelde authenticatiebudget begrenst aanvragen tot 30 per gebruiker
per minuut; drukte/uitval geeft een placeholder. Dit zijn grenzen, geen gemeten
NAS-capaciteitsclaim. Er is geen nieuwe persistentie, importer of database.

De client controleert de DTO, base64lengte, WebP-signatuur/RIFF-lengte en
SHA-256 vóór weergave. Alleen de bestaande LiveDataStore bewaart de beelddata
in geheugen, met dezelfde sessie-epoch en bron-/selectieversie. Gelijktijdige
lezers delen één aanvraag. `discardOnRevalidate` wist de beschermde entry vóór
een hercontrole, ook als die mislukt. Actieve beelden krijgen maximaal iedere
60 seconden (+ de bestaande storetick) een rechtenhercontrole; netwerk-/decodewachttijd
verlengt de geldigheid niet. Achtergrond/offline pollt niet. Hervatten,
bronwisseling (ook via web), offline en logout/accountwisseling wissen of
hercontroleren de relevante beelden. Losgelaten entries worden ook bij een
bevestigde nieuwe bron ongeldig gemaakt; oude netwerk-/decode-antwoorden
worden verworpen. Geen tweede cache, offline beeldarchief of writes.

Een nette decoratieve placeholder verschijnt bij laden, ontbrekende rechten,
netwerkproblemen, beschadigde antwoorden of een decodefout. De overige kaarten,
publieke lokale beelden, focus/scroll, grote tekst en navigatiemeldingen blijven
werken. Een externe intrekking is zonder realtime pas bij de volgende controle
bekend (maximaal het 60-secondenvenster terwijl zichtbaar); reeds waargenomen
pixels kunnen niet op afstand uit een screenshot worden gewist. Er wordt geen
onbeveiligde socket gebruikt om die grens te omzeilen.

Gerichte proeven gebruiken uitsluitend bestaande synthetische CFM-fixtures en
een eigen gemarkeerde testmediamap. De echte importer/publicatieservices maken
alleen in die wegwerpdatabase de testpublicatie. Tests controleren dezelfde
webbron, hash/grootte/decodering, verborgen/retired/ontpubliceerde bronnen,
bestandscorruptie, vertraagde intrekking/selectiewissel, accountisolatie,
querydeduplicatie en cachewissen vóór een geweigerde hercontrole. Browserbewijs
staat onder `native-foundation-browser/study-media`: dezelfde echte gepubliceerde
Vandaag-kaart, vijf talen, 320px/200%, licht/donker/tablet, placeholder/offline,
bronwissel en late A-bytes na B-login. Definitieve aantallen en CI-head staan
in de PR; geen fysieke acceptatie of productiecontrole geclaimd.

Eigenaarstest op iPhone én Android na afzonderlijk goedgekeurde backend/appbuild:
open dezelfde gepubliceerde CFM-week naast web; controleer foto en kaart,
Access/sessionherstel, offline-placeholder en herstel, achtergrond/hervatten,
bron/taal, grote tekst/oriëntatie, logout en accountwisseling. Controleer een
veilige tijdelijke intrekking uitsluitend in de ontwikkelomgeving en verifieer
de placeholder bij hercontrole. Geen productiepublicatie of NAS-wijziging is
onderdeel van deze PR. Volledige studielezer/cursuspariteit blijft B3; audio en
andere doelroutes worden hiermee niet alsnog geleverd.
