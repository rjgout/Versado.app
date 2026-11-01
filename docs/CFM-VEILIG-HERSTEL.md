# CFM 2026: gecontroleerd mediaherstel en aanvullen

## Reikwijdte en bewijs

Deze wijziging is voorbereid vanaf develop `1abe2b6a94622bc270aa49163b60e06499b34006`.
Er is geen toegang tot de development-NAS, mediavolume, back-ups of development-database gebruikt.
De toestand “2026 DRAFT, 2027 52 gepubliceerd” komt van de eigenaar; deze is niet als live waarneming bevestigd.
Er is niets geïmporteerd, gepubliceerd of uitgerold buiten een eigen wegwerpomgeving.

De eerdere audit vond zeven gewijzigde officiële JPEG's bij lessen 07 (twee beelden), 14, 34, 39, 42 en 43.
Draft #237, gecontroleerde head `50856194165a8f34966bfedfd5fa50dfd9e46b5e`, bevat dezelfde zeven voorgestelde nieuwe pins.
Die PR lost ook een afzonderlijk CI-/testdatasetprobleem op en is **niet** als geheel overgenomen.
`data/study-content/cfm-2026-nl/media-revision-candidates.json` bevat uitsluitend een beoordeelbaar voorstel:
bron-URL, oude/nieuwe SHA-256 en omvang, MIME-type en ongewijzigde afmetingen.
De actieve `media-lock.json`, lesbronnen, OTB-index en bestaande revisies zijn niet gewijzigd.
Zonder oude bytes is pixelgelijkheid niet bewijsbaar. Een huidige officiële bron is op zichzelf geen toestemming voor vervanging.

## Twee gescheiden handelingen

**Nieuwe content ophalen** vult ontbrekende CFM-lessen aan. Bestaande gepubliceerde of geïmporteerde conceptlessen
worden niet opnieuw gedownload of van nieuwe revisies voorzien. Een onderbroken importrun met een reeds opgeslagen
item wordt via zijn bestaande lease hervat. Een complete, volledig gepubliceerde jaargang slaat ook de automatische
publicatiefase over. Een verdwenen bestand wordt hiermee niet stilzwijgend “gezond verklaard”: integriteitscontrole
blijft in de bestaande voorcontrole, publicatie en afspeel-/mediatoegang bestaan.

**CFM 2026 veilig herstellen** is een afzonderlijke beheeractie. Het plan wordt alleen op verzoek uitgelezen,
niet bij iedere statuspoll. Het onderzoekt precies de zeven bekende oorspronkelijke pins:

1. Kloppen de oorspronkelijke bytes al op de geregistreerde volume? Dan blijven ze intact.
2. Anders: zoek in bestaande CFM-importsnapshots naar dezelfde bron-URL en SHA-256.
   De complete base64, rechten, MIME, omvang, afmetingen en volledige decodering moeten kloppen.
   De originele bytes krijgen altijd voorrang. Hoogstens zestien kandidaat-snapshots worden gelezen;
   bij meer onbruikbare kandidaten stopt de actie voor afzonderlijk onderzoek.
3. Pas bij ontbreken van zo'n origineel kan de beheerder de zeven vastgelegde vervangingskandidaten expliciet beoordelen.
   De daadwerkelijke download moet opnieuw exact aan de nieuwe pin voldoen. Geen automatische hashacceptatie.
4. Voorbereiden herstelt zo nodig uitsluitend exact oorspronkelijke bestanden en maakt ontbrekende lessen of
   benodigde mediarevisies als **concept**. Er vindt geen publicatie of zichtbaarheidwijziging plaats.

Het herstelplan is aan beheerder, bronset, kandidaatset, editie-/publicatiestand en gevonden originelen gebonden.
Een verouderd plan wordt vóór de handeling geweigerd en binnen de bestaande importlock opnieuw gecontroleerd.
Er worden geen willekeurige URL's, checksums, back-uppaden of testinjecties uit de browser geaccepteerd.

## Wat de eigenaar na afzonderlijke goedkeuring kan doen

Deze stappen vereisen eerst een goedgekeurde merge en een door de eigenaar uitgevoerde update van uitsluitend
zijn bestaande development-app. Deze PR voert die stappen niet uit. Geen migratie of seed is voor deze wijziging nodig.

1. Open op **dev.versado.app** de Adminbackend → Content → Nieuwe content ophalen.
2. Kies **Herstelplan bekijken (alleen lezen)**. Controleer aantallen, bronlessen, volledige hashes en
   de melding per beeld: origineel geldig / origineel in snapshot / mediabeoordeling nodig.
3. Als een gecontroleerde back-up nog oude bytes kan bevatten: stop vóór voorbereiden. Deze app doorzoekt geen NAS-back-ups.
   Laat de eigenaar die alleen-lezen controleren en originele bytes eerst aan een afzonderlijke herstelbeoordeling voorleggen.
4. Als originelen ontbreken: open de officiële bronlinks, beoordeel ieder beeld en de leskoppeling.
   De checkbox keurt alleen de getoonde media als concept goed, niet de publicatie.
5. Bevestig **Originelen herstellen en concepten voorbereiden**. Laat de actie uitlopen en bekijk het beheerlogboek.
   Een fout laat reeds geslaagde concepten staan. Vraag een nieuw herstelplan op voordat je handmatig hervat.
6. Ga naar **Studielespublicaties**. Kies CFM 2026 en voer de bestaande **Controleren**-actie uit.
   Beoordeel de concepten/voorbeelden en los alle blokkades op. Er moeten 52 complete, publiceerbare lessen zijn.
7. Alleen na jouw afzonderlijke publicatiegoedkeuring: gebruik de bestaande bevestigde publicatiehandeling.
   Geef daarna de collectie inhoudelijk vrij en maak haar alleen bewust zichtbaar voor gebruikers.
8. Controleer dat de **2026-ankercollectie** enabled, PUBLISHED en visibleToUsers is; de bestaande cursussen en
   CFM 2027 blijven aan dat programma gekoppeld. Deze herstelactie zet die flags niet zelf aan.
9. Test B3a-2 via de bestaande develop → Mac → Capacitor → Xcode → iPhone-route.
   Controleer beide leeswijzen, huidige/gekozen/bestudeerde week, zes stappen, afbeeldingen, archief en terugnavigatie.

Een normale latere contentupdate publiceert herstelconcepten niet automatisch, ook niet als automatisch publiceren
is ingeschakeld. Een concept dat een bestaande publicatie zou vervangen vereist eveneens de bestaande expliciete revisiepublicatie.
De automatische publicatie van daadwerkelijk nieuwe, onaangeroerde officiële lessen blijft als bestaand gedrag beschikbaar.

## Fouten, deelresultaten en herstelbaarheid

MEDIA-diagnostiek vermeldt de jaargang, bronles, validatiefase, verwachte/ontvangen hash en omvang wanneer bekend,
media-ID en HTTP-status/host/pad wanneer beschikbaar. Geen cookies, credentials, querystrings of vrije upstreamfoutpagina's.
De melding komt in de bestaande joblogs en het duurzame ContentUpdateRun-logboek; geen Portainer-shell nodig.
Een fout in 2026 houdt de verwerking van 2027 niet tegen. De per-jaargangregels zijn leidend: een fout van de totale job
betekent niet dat geslaagde publicaties van een andere jaargang zijn teruggedraaid.

Herstel van een origineel gebruikt dezelfde checksumgebonden PostgreSQL-lock als media-installatie. Een geldig bestand
wordt nooit vervangen. Bij een beschadigd regulier bestand blijft de oude inode onder `.damaged-<uuid>-<hash>.<ext>` bewaard;
alleen exact gevalideerde originele bytes worden atomair op het oorspronkelijke hashpad teruggezet. Ontbrekende bestanden
worden exclusief geplaatst. Symlinks blijven geweigerd. Een bestand- of procesfout kan een gedeeltelijk geslaagde reparatie
achterlaten; opnieuw controleren maakt dat zichtbaar en herhalen is veilig. Deze bestandsactie is geen database-rollback.

Nieuwe media krijgen nieuwe hashbestanden en ContentMedia-identiteiten via de bestaande importer. Oude media, snapshots,
revisies, lesidentiteiten, voortgang, leesposities, annotaties, XP en rechten worden niet gewist of aangepast.
Er is geen schema- of migratiewijziging. Terugdraaien van een mediapublicatie loopt via de bestaande expliciete
revisie-/rollbackbediening, nooit door hashes in een bestaande revisie te veranderen.

De bekende zeven afbeeldingen zijn geen bewijs dat alle andere bestanden gezond zijn. De volledige bestaande
voorcontrole en collectievrijgave blijven nodig. Niet-beschikbare opslag, onvoldoende vrije ruimte, afwijkende
nieuwe upstreambytes en onbruikbare originelen blokkeren veilig. De gebruiker kan back-ups uitsluitend zelf onderzoeken.

## Verificatie

Zie de actuele PR voor exact uitgevoerde resultaten. De nieuwe gerichte suite gebruikt een eigen lokale PostgreSQL,
synthetische PNG's, de bestaande import-/publicatieketen en de echte HTTP-beheerroute, zonder externe mediadoorvoer.
Getest worden onder meer: read-only plannen, onbevoegde/verouderde aanvragen, twee herstelprocessen, oorspronkelijke
snapshotvoorrang, ontbrekende/corrupte bestanden, symlinks, append-only retries, onderbroken runs, expliciete mediarevisies,
blokkade van automatische publicatie en behoud van gebruikersgegevens. Dat is geen fysieke iPhone-acceptatie of NAS-validatie.

### Daadwerkelijk lokaal uitgevoerd (2026-11-01)

| Controle | Resultaat |
| --- | --- |
| `npm run test:cfm-2026` | 35/35, geen skips |
| `npm run test:cfm-personal` | 101/101, geen skips |
| `npx tsx --test tests/cfm-recovery.test.ts tests/cfm-managed.test.ts` | 4/4, geen skips |
| `npm run test:native` | 80/80, geen skips |
| Bestaande native runner `--today-only --no-browser` | 26/26; eigen PostgreSQL/Redis, bestaande migratiebehoud-/rollbackcontroles ook geslaagd |
| Bestaande contentrunner `--focused --cfm-suite=cfm-recovery.integration.test.ts --browser` | 11/11, geen skips; bestaande migratiebehoud-/rollbackcontroles ook geslaagd |
| Nieuwe browserbediening | 3/3: 320px/200% licht, 390px donker, 1280px licht; geen horizontale overflow; annuleren schrijft niets, dubbel tikken verzendt eenmaal |
| TypeScript en schone Next-productiebuild | Geslaagd |
| ESLint gewijzigde herstelbestanden | Geen fouten of waarschuwingen; bestaande effectwaarschuwing in ReseedClient apart |
| Repositorylint | Geen fouten met uitsluitend lokale oude gegenereerde `dist/native-b3a1-*`-bundels buiten beschouwing; 171 bestaande waarschuwingen |
| i18n- en workflowvalidatie | Geslaagd; bestaande vertaalachterstand buiten deze nieuwe teksten blijft staan |
| Zeven eerder gecontroleerde lokale auditkopieën | SHA-256, omvang, MIME, afmetingen en volledige decodering opnieuw gecontroleerd tegen het kandidaatvoorstel |

De integratiesuite oefent ook een echte `cfm-prepare`-POST met een gecontroleerd ontbrekend bestand:
jobstart, importlock, nieuw plan, concrete MEDIA-fout en duurzaam ContentUpdateRun.error zijn bewezen.
De succesvolle herstel-, import- en handmatige publicatiestappen zijn afzonderlijk met echte domeinservices getest.
Een volledig succesvolle job met alle echte developmentbestanden is nog **niet** uitgevoerd; dat vereist eigenaaracceptatie.
De verwachte PostgreSQL-fout `CFM_TEST_ROLLBACK` is bewuste foutinjectie. Een `pg`-deprecatiewaarschuwing is niet-blokkerend.

De nieuwe suite vergelijkt users, media, revisies, edities en stap-/leesvoortgang vóór/na de handelingen.
Annotaties, leesposities en inschrijvingen zijn daarin niet afzonderlijk gefixtured; behoud daarvan is hier onderbouwd
met codecontrole van ongewijzigde domeinpaden. De bestaande uitgebreidere video-revisietest is aangepast aan expliciete
revisiepublicatie, maar is lokaal niet uitgevoerd: de volledige gepinde officiële assetset is hier niet aanwezig.
Er wordt geen groene uitslag voor die niet-uitgevoerde suite geclaimd. Fysieke iPhone-/Android-tests staan open.

[Herstelplan op 390px, donker](cfm-recovery/herstelplan-390-dark.png) en
[afzonderlijke bevestiging op 320px met 200% tekst](cfm-recovery/bevestiging-320-200.png)
zijn screenshots van de **synthetische wegwerpomgeving**; de getoonde aantallen zijn geen developmentinventarisatie.
De CI bewaart ook alle zes afbeeldingen en `resultaten.json` als browserartifact.
