# Mijn studiemap — native integratie

Basis: develop `a548a579d66c4488058febde4500436d03a04143` (inclusief #299). Geen overlappende open feature-PR voor studiemap aangetroffen; de Expo-proef is geen gekozen architectuur.

## Compacte audit en architectuurbesluit

| Onderdeel | Hergebruik en noodzakelijke aanpassing |
| --- | --- |
| StudyFolderClient | De bestaande kaarten, zoeken, filters, sortering, paginering en focusweergave blijven één gedeelde view. Next-router/searchparams/Link worden een kleine webadapter. Native gebruikt AppNavigation en accountgebonden geheugen. |
| annotations/studyFolder | Bestaande drie annotatietabellen, accountfilter, bronrechten vóór zoeken/paginering, cursorbinding, privétekst/quote en revisieherstel blijven gezaghebbend. Native voegt uitsluitend sessiecontrole en begrensde DTO's toe. |
| annotations/studyFocus | Bestaande revisie-identiteiten en exacte plaatsing blijven behouden. Geen fuzzy passage of alternatieve vertaling openen. |
| API study-folder | Web houdt cookie-/CSRF-gedrag. Native krijgt afzonderlijke begrensde routes onder de bestaande native API en Bearer-sessielaag. Zoektermen gaan native in een read-only POST-body, niet in URL/history/logregels. |
| ContentPickerView / FullscreenContentPicker | De gedeelde studiemapkaart staat al direct boven de taalkeuze. Web geeft de link al door; native nog niet. Native geeft die alleen door bij echt scherm + transport en een bijbehorende backendcapability. Geen selectie-POST bij openen. |
| NativeFoundation / navigation | Eén lokaal scherm, eigen annotatieref-route voor de leesuitstap, bestaande terugknop/modal-/scrollarchitectuur. Geen tab of externe browser. Geen algemene querystringtoelating. |
| annotations.server / service | Bestaande versie-/actie-ID-/tombstone-/privénotitie-/bronregels en editor hergebruiken; accountbrede adapter heeft een eigen annotatie als anker, geen actieve cursus als onjuiste voorwaarde. Commit via de bestaande User → NativeSession-grens, met sessiehercontrole. |
| Native cache | Bestaande epoch/account/session-stamp en LiveDataStore. Ook extra pagina's en filter-/scrollstatus in dit vluchtige geheugen; niet in een tweede moduleglobale native cache of persistente opslag. Bij logout/accountwisseling resetten en late antwoorden weigeren. |
| Lezers | De cursuslezer heeft expliciet bofm als grens. De bestaande vrije games-leesadapter is ruimer en mag niet als OTB-omweg worden gebruikt. De studiemapuitstap gebruikt de gedeelde ScriptureReaderView, normale bronrechten en expliciet ondersteunde werken. |

**Besluit:** Capacitor, bestaande backend/modellen en gedeelde presentatie behouden. Geen migratie, tweede studiemap, generieke proxy of remote WebView. Een beperkt versie-1-contract koppelt eigen annotatie → oorspronkelijke bron/editie/hoofdstuk/vers. Dat contract kan later gecontroleerd OTB ondersteunen, maar doet dat hier niet. Bestaande studierevisies/quotes blijven beheerbaar; voor een nog niet lokaal ondersteunde studielezer verschijnt een duidelijke melding en veilige terugweg, geen verkeerde passage of bronwissel.

## Beveiligings- en herstelgrenzen

- Iedere read controleert native sessie en eigenaar vóór en na de service; accountbrede gegevens zijn onafhankelijk van de actieve Schriftbron.
- Bewerken/verwijderen gebruikt dezelfde annotatieservice en bestaande herauthenticatie-/sessie-intrekkingsgrens. Een target moet overeenkomen met het eigen anker. Geen automatische write-retry na een onzekere uitkomst. De bestaande editor biedt een bewuste retry met exact dezelfde actie-ID en payload; de server handelt die idempotent af. Eigen readback inclusief tombstones blijft beschikbaar voor conflictherstel.
- Tijdelijk ontoegankelijke bronnen houden uitsluitend de bestaande eigen privégegevens; geen afgeschermde bronlabels, snippets of nieuwe tekst uitleveren.
- Eén gedeelde editor; verwijderen krijgt expliciete bevestiging in de studiemap. Conflicten behouden de bestaande versie-/herlaadregels.
- Native zoek-/filterstatus en paginadata zijn vluchtig en accountgebonden. Geen notitietekst in history, logs, telemetrie of opslag.
- Passages openen wijzigt geen bron, taal, cursus, voortgang, XP, reeks of beloning. Geen CFM-inhoud, import, publicatie of audio wijzigen.
- Ondersteundheidsmelding is geen toestemming voor broninzage. Iedere passage en sessie wordt opnieuw gecontroleerd; geen fallback naar een ander werk of vers.

## Acceptatie en verificatie

Unit-/integratie-/browserbewijs en exacte CI-head worden na implementatie toegevoegd. Echte serverhandlers en eigen wegwerp-Postgres worden gebruikt. Fysieke iPhone-/Android- en VoiceOver-/TalkBack-acceptatie blijft expliciet open totdat de eigenaar daadwerkelijk toestelbewijs levert. Er wordt geen signingbuild, upload, deployment of merge gestart.

## Geïmplementeerd contract

- `study-folder-v1` kondigt uitsluitend de geïmplementeerde adapter aan. De gedeelde contentswitcherkaart wordt native alleen bij deze capability aangeboden. Een oudere backend toont geen dode ingang.
- `POST /api/v1/native/study-folder/query` accepteert hetzelfde strikte zoek-/filter-/cursorcontract als de web-GET. Dit is uitsluitend een leesactie. De response bevat versie 1 en de geauthenticeerde accountidentiteit. Grote pagina's worden met de bestaande cursor verkleind; notitieteksten of quotes worden nooit afgekapt.
- `GET /api/v1/native/study-folder/{kind}/{id}/annotations` leest uitsluitend het eigen anker en de eigen annotaties daarop, inclusief tombstones voor herstel.
- `POST /api/v1/native/study-folder/annotations` accepteert een eigen referentie, canonical targetKey en de bestaande actie-ID/verwachte versie/inhoud. De server haalt het oorspronkelijke target, de revisie en selector op. De volledige quote hoeft daardoor niet door de begrensde requestbridge om een notitie te bewerken. Schrijven gebruikt `mutateAnnotation` binnen `commitAccountMutation`; een vervallen sessie of gewijzigd anker verhindert commit.
- `GET /api/v1/native/study-folder/{kind}/{id}/passage` lost de eigen annotatie op. Bij bofm wordt het exacte hoofdstuk uit de oorspronkelijke taaluitgave aangeboden met dezelfde `ScriptureReaderView`. De response bevat collectie, werk, editie, taal en focusvers. Er wordt geen actieve bron/taal/cursus gewijzigd en geen leesvoortgang of XP geschreven.
- De lokale route is `/study-folder` of `/study-folder/{kind}/{id}`. Filters en geladen paginatelling blijven uitsluitend in de bestaande account-/sessiegebonden LiveDataStore; niet in URL, history, localStorage of een tweede annotatiecache. Bij terugkeer worden de bestaande navigatie- en scrollcoördinatie gebruikt, inclusief later geladen inhoud en focusherstel.
- De gedeelde editor behoudt zijn bestaande versie-, conflict-, tombstone- en onzekere-opslaggedrag. Verwijderen vanuit de native studiemap vraagt aanvullend een expliciete bevestiging. Een bewuste retry na een verloren antwoord gebruikt dezelfde actie-ID; achtergrond/focus/online voert geen schrijfactie opnieuw uit.

## Verificatie en bewijs

De testfixtures en servers gebruiken uitsluitend geïsoleerde localhost-PostgreSQL/Redis. Er zijn geen echte accounts of productiegegevens gebruikt.

- `npm ci` en `npm run db:generate`: geslaagd.
- Gerichte native studiemapproef (`node scripts/native/test-isolated.mjs --study-folder`): **12 echte handler-/databasetests geslaagd**. Inclusief web/native-gelijkheid, alle kleuren, paginering/cursorbinding, sessies en eigendom, bronintrekking, idempotentie, conflicten, gelijktijdige schrijvers en intrekking tijdens een echte User-lockwacht. Studieannotaties bewaren hun oorspronkelijke revisie/selector; OTB/studielezers falen expliciet veilig.
- Dezelfde proef: **80 mobiele layoutgevallen geslaagd**: nl/en/de/fr/es × 320/375/390/430 px × licht/donker × 100/200% tekst. Inclusief een 200%-editor op 320 px, echte opslag en verwijdering, behoud na herladen, filters/paginering/scroll na passagebezoek, onveranderde bronkeuze, onzekere opslag zonder automatische replay en accountwisseling met een vertraagd privéantwoord van het vorige account.
- De identiteit-projectietest is eerst aantoonbaar rood gemaakt en daarna hersteld: een gedeelde folderkaart levert alleen soort en ID aan het strikte native referentiecontract. Extra velden in daadwerkelijke API-verzoeken blijven verboden.
- `npm run test:annotations`: **56 geslaagd**.
- `npm run test:security`: **7 geslaagd** (4 beleid + 3 Prisma/Effect).
- `npm run test:native:ios-release`: **47 geslaagd**, 1 bestaande macOS/plutil-proef op Linux overgeslagen; deze lokale uitslag vervangt geen macOS-compilatie.
- `npm run test:native:store-readiness`: **14 geslaagd**.
- Volledige TypeScript-controle en een productiebuild vanuit een lege `.next`: geslaagd.
- `npm run test:native`: **336 unit-/contracttests + 80 datalaagtests geslaagd**. `npm run test:focus`: **29 geslaagd**.
- Bestaande webannotatieketen op de definitieve productiebuild (`--focused --annotations --browser`): **42 databasetests**, **16 DOM-controles**, **40 reader-/audiomenucontroles**, **169 studiemapcontroles**, **68 kleur-/layoutcontroles** en **51 herstelcontroles geslaagd**.
- Twee tijdens de extractie gevonden webregressies zijn hersteld met behoud van de oorspronkelijke assertions: een vertraagd paginavenster mag na een bevestigde mutatie geen 50 items terugzetten (verwacht: 25), en een tijdelijke netwerkfout mag een bevestigde web-itemkaart niet als verwijderd behandelen. Web behoudt zijn bestaande herstelbeleid; native kiest expliciet voor `discardOnRevalidate` en de bestaande sessie-epoch.
- Native ontwikkelbundel, Capacitor-copy en asset-/metadata-/hashverificatie voor **iOS én Android geslaagd**. Hiervoor is uitsluitend `local-development` met `https://example.invalid` gebruikt; dit is geen signing- of distributierun en geen lokale SDK-compilatie.
- Productieafhankelijkhedenaudit: **0 kwetsbaarheden**. Lint: **0 fouten**; de bestaande waarschuwing in het gewijzigde NativeFoundation-bestand is ook op ongewijzigde develop bevestigd.
- De GitHub-checks en echte ongetekende macOS-/Android-compilaties worden op de exacte PR-head vastgelegd in de PR-beschrijving. Nog lopende controles zijn geen geslaagde controles.

Browserbeelden worden door de bestaande Native Foundation-workflow meegenomen vanuit `/tmp/versado-native-browser/study-folder` (ook `layout-results.json`). Het OS-materiaalvoorkeurpunt wordt in het browserharnas gesimuleerd; de schermen, navigatie, editor en serverhandlers zijn de daadwerkelijke implementatie. Dit zijn geen fysieke iPhone-/Android-screenshots.

## Resterende grenzen en acceptatie

- Het beheren van eigen annotaties werkt accountbreed, inclusief leesbare en tijdelijk niet-leesbare bronnen volgens de bestaande webregels. Een eigen opgeslagen quote/notitie mag behouden blijven; beschermde bronmetadata en snippets worden server-side afgeschermd.
- OTB en studie-/CFM-teksten worden niet via een alternatieve native lezer geopend. Zij geven een begrijpelijke melding en terugweg. De toekomstige OTB-lezer kan op dezelfde eigen annotatiereferentie en expliciete bron-/editie-identiteit aansluiten. Studieherstel wordt niet automatisch bevestigd of aan een andere revisie gekoppeld.
- De passage-uitstap is een leesweergave zonder voortgangs-/beloningsmutaties. De bestaande cursuslezers en audiotransportlaag blijven behouden; er is geen nieuwe audio- of voortgangsstack.
- De backend moet deze capability daadwerkelijk aanbieden voordat de ingang zichtbaar wordt in een nieuwe appbundel. Deze PR publiceert of deployt geen backend en start geen distributie.
- Er is geen fysieke toestelacceptatie uitgevoerd. De eigenaar moet op iPhone én Android bevestigen: passage annoteren → studiemap vanuit contentswitcher openen → annotatie terugvinden → bekijken/bewerken → juiste passage heropenen → met filters/positie terugkeren → na uit-/inloggen dezelfde opgeslagen gegevens terugvinden. Daarbij horen toetsenbord, VoiceOver/TalkBack, safe areas en de echte systeemtabbalk.
- Een onafhankelijke review en eigenaarstoestemming blijven nodig voor merge. Geen NAS-deployment, signing, TestFlight-upload of store-indiening uitgevoerd.
