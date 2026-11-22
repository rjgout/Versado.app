# Gecontroleerde Bijbelpublicatie in het bestaande beheer

## Oorzaak en bestaande architectuur

`enabled`, `visibleToUsers` en `publicationState` zijn onafhankelijke voorwaarden. De OTB-import bewaart bestaande instellingen en maakt nieuwe collecties als concept. De bestaande pagina Content beheerde alleen inschakeling van de kiezer en zichtbaarheid. De bestaande actie ‘Schriftbronnen bijwerken’ controleert/importeeert bronupdates, maar publiceert geen `ContentCollection`. Daardoor kunnen tien zichtbare, ingeschakelde conceptuitgaven terecht ontbreken in beide gebruikerscatalogi.

De centrale regels in `contentAccess.ts` blijven ongewijzigd: normaal gebruik vereist `LEGACY`/`PUBLISHED`, een geldige werkrelatie en een ingeschakelde collectie; gewone gebruikers hebben bovendien zichtbaarheid nodig. Beheerpreview is een afzonderlijk recht. Studie-/CFM-publicatie gaat over andere modellen en wordt niet aangepast.

## Gerichte uitbreiding

In **Adminbackend → Content → Content**, onder de bestaande zichtbaarheidsschakelaars, staat ‘Schriftuitgaven publiceren’. Per OTB-uitgave ziet de beheerder werk, naam, taal, beide instellingen, publicatiestatus, controletellingen en blokkeerredenen. Publiceer één gecontroleerd concept of selecteer gecontroleerde concepten per Testament. De bevestiging noemt precies de gekozen uitgaven en de gevolgen van hun bestaande zichtbaarheid.

De actie schrijft uitsluitend `ContentCollection.publicationState = PUBLISHED` en een afgeronde registratie van het nieuwe type `SCRIPTURE_RELEASE` in het **bestaande** `ContentUpdateRun`-logboek. De additieve enum-migratie publiceert niets. Identiteiten, teksten, instellingen, cursussen, oefeningen, audio en gebruikersvoortgang blijven staan. Er komt geen tweede CMS, import, audiopublicatie of algemene concept-vrijgave.

## Controlebewijs en publicatievoorwaarden

`scripts/otb/publication-evidence.json` bevat tien verwachte tekstdigests en tellingen uit de bestaande gepinde OTB-commit. Het bevat geen Bijbeltekst. Reproduceren:

```sh
node --import tsx scripts/otb/build-publication-evidence.mjs /pad/naar/schone-gepinde-checkout
```

De generator vereist een schone Git-checkout op de exacte bestaande source-lock, leest de upstreamlicentie (CC BY-SA 4.0) en gebruikt de bestaande OTB-parser, boekmapping en vijf-talige bronvalidator. Er moet een identieke canonieke structuur zonder gemelde problemen zijn, met 39/27 boeken en 929/260 hoofdstukken. De digest omvat alle boekidentiteiten, titels, volgordes, hoofdstukken, versnummers en genormaliseerde teksten die de bestaande importer schrijft. Dit is een tekst-/structuurcontrole, geen onafhankelijke theologische beoordeling van de vertaling.

De server controleert uitsluitend de tien expliciete OTB-collectie-identiteiten. Werk, SCRIPTURE-type, taal, editie, bron-URL, bronvermelding en licentie moeten overeenkomen. Aantallen en alle tekst-/structuurvelden van de importer moeten exact het bronbewijs volgen. Extra hoofdstukkoppen worden geweigerd: de OTB-importer levert hiervoor geen geverifieerde tekst. Andere uitgaven kunnen niet via deze actie worden vrijgegeven. Een afwijking wordt gemeld, niet automatisch gerepareerd. Een latere bronupdate vereist opnieuw gegenereerd, gereviewd bewijs; gewijzigde inhoud kan nooit met oud bewijs worden vrijgegeven.

Voorcontrole levert een token over metadata, tekst, structuur en database-identiteiten. Bevestiging leest alles opnieuw. Gewijzigde zichtbaarheid of inhoud maakt de bekeken bevestiging ongeldig. De server controleert actuele beheerdersrechten en sessieversie; de API vereist een adminsessie, toegestane Origin, begrensde JSON en een strikte selectie met expliciete bevestiging.

## Gelijktijdigheid, integriteit en herhaling

De hele selectie en het logboek worden in één bestaande Prisma-transactie verwerkt, met de normale transactielimiet. Het bestaande content-importslot wordt transactioneel gedeeld; een import en publicatie kunnen niet tegelijk plaatsvinden. Collecties, beheerder en werken worden op de benodigde rijen vergrendeld. Alleen tijdens de definitieve controle worden Book/Chapter/Verse kort in SHARE-modus vastgezet: zo kunnen ook onverwachte tekstschrijvers geen extra rijen tussen controle en commit invoegen. Een actieve tekstschrijver laat de actie direct veilig mislukken; gewone leesverzoeken en voortgangstabellen blijven beschikbaar. Er wordt geen timeout verhoogd.

Een conflict, incompleetheid, gewijzigd controletoken of fout betekent rollback van de volledige selectie, inclusief auditregistratie. Geen gedeeltelijke publicatie. Actie-ID plus actor en aanvraaghash maken een herhaald identiek verzoek tot een no-op; een andere selectie bij hetzelfde ID wordt geweigerd. De UI verstuurt na een onzeker antwoord nooit automatisch opnieuw, maar haalt de actuele status op.

Na succesvolle publicatie of een wijziging aan bestaande collectie-zichtbaarheid stuurt de bestaande Socket.IO-laag alleen het bestaande `contentChanged`-event. Web en native maken hun eigen cataloguscache ongeldig en halen opnieuw geautoriseerde gegevens op. Focus, hervatten, herladen en opnieuw inloggen blijven de bestaande verversingspaden gebruiken. Het event bevat geen tekst, selectie, gebruiker of rechten.

## Bediening door de eigenaar

1. Na onafhankelijke review, toestemming, merge en afzonderlijk goedgekeurde uitrol: open Adminbackend → Content → Content.
2. Open de sectie Content. Controleer per uitgave werk/taal, status en verificatieresultaten. Bij een blokkade: niet handmatig omzeilen; onderzoek de opgegeven afwijking.
3. Selecteer de gewenste geverifieerde concepten van Oude of Nieuwe Testament, of publiceer een afzonderlijke uitgave.
4. Lees de bevestiging en bevestig expliciet. Een al ingeschakelde, zichtbare uitgave wordt na publicatie meteen aangeboden; verborgen/uitgeschakelde uitgaven blijven dat.
5. Controleer de vernieuwde status. Bij een onderbroken aanvraag eerst opnieuw controleren; een aanvraag kan al verwerkt zijn.
6. Gebruik de **bestaande zichtbaarheidsschakelaar** om een gepubliceerde uitgave te verbergen of weer te tonen. Publicatiestatus, teksten en voortgang worden daarmee niet verwijderd of teruggezet naar concept.

Deze ontwikkeling voert geen van die eigenaarshandelingen op de draaiende backend uit.

## Native-lezer: afzonderlijke functionele uitbreiding

De web- en nativecatalogus gebruiken al `getContentPickerContext` en de centrale rechten. Publicatie maakt de juiste uitgaven selecteerbaar, met vijf talen en afzonderlijke werken voor Oude/Nieuwe Testament. Dat betekent niet automatisch dat iedere native-bestemming deze bron al ondersteunt.

`NativeLearningView.tsx` biedt de Schriftlezer uitsluitend aan voor het actieve werk `bofm`; `native/reader.server.ts` vereist bij het uitlezen nogmaals `work: "bofm"`, naast centrale leesrechten en cursus-/staprechten. Deze grenzen blijven in deze PR intact. De OTB-import maakt tekst, geen nieuwe cursussen of oefeningen; publicatie maakt die evenmin aan. Het bestaande cursusaanbod en bestemmingresolver bepalen dus of een gekozen uitgave een cursusbestemming heeft.

Een afzonderlijke OTB-lezerwijziging moet beide expliciete bofm-beperkingen vervangen door een gecontroleerd contract voor de ondersteunde Schriftwerken, met de bestaande cursus-/hoofdstuk-/stapselectie, selectieversie/ABA-controle en sessiehercontrole. Controleer daarbij de bestaande cursusplannen en boekidentiteit (`gen` … `rev`, tegenover `bofm/...`), hervatten/voortgangssleutels, annotaties, verwijzingen, alle vijf talen en veilige onbeschikbaarheid bij ontbrekende cursussen. Audio moet zijn eigen bestaande bronrechten en beschikbaarheidscontrole behouden. Geen booleaanse ‘alle werken’-vrijgave en geen tweede lezer. Dit wordt hier uitsluitend gerapporteerd, niet geïmplementeerd.

## Verificatie

De gerichte suite gebruikt de echte productiehandlers en de bestaande importer op een eigen Postgres-container, met de echte gepinde tekst van alle tien uitgaven. Er is geen productie-bypass of synthetisch goedkeuringsbewijs. Browserproeven gebruiken dezelfde productiebuild, echte admincookies, vijf talen, kleine iPhone-viewporten, 200% tekst, licht/donker, toetsenbord, focus en annulering/bevestiging. Exacte resultaten en CI-head worden in de draft-PR vastgelegd.

Aanvullend: de bestaande `syncCourses` kan Schriftcursussen voor andere collecties synchroniseren wanneer dat bestaande beheerpad bewust wordt uitgevoerd. Publicatie roept dit niet aan en verandert geen cursusplan of abonnement. Ontbrekende cursussen moeten dus via het bestaande cursusbeheer worden beoordeeld, niet stilzwijgend tijdens publiceren worden aangemaakt.

### Uitgevoerde lokale controles

Basis: `develop` op `a5eb9e16f210544ccc959a349bb680e9e55c7697`. Geen overlappende open PR voor deze publicatiebediening aangetroffen.

| Controle | Resultaat |
| --- | --- |
| `npm ci`, Prisma generate/validate, volledige TypeScriptcontrole | Geslaagd |
| Schone `npm run build` | Geslaagd |
| Gerichte ESLint | Geen fouten of waarschuwingen in de gewijzigde publicatiecode/tests |
| Volledige `npm run lint` | Geen fouten; 174 bestaande waarschuwingen |
| Beveiligingsbeleid + Prisma/Effect-regressies; productie-audit | Geslaagd; `npm audit --omit=dev --audit-level=high`: 0 kwetsbaarheden |
| Centrale contenttoegang/inventaris | 40 geslaagd |
| Bestaande OTB-tests | Geslaagd |
| Live-data/cachelaag | 57 geslaagd |
| Audio-contracten | 19 geslaagd |
| Annotaties | 56 geslaagd |
| Privacy-inventaris | 2 geslaagd |
| Native unit-/contract-/lokale distributiebundeltests en native-data | Geslaagd |
| iOS-release-/signingguards | 47 geslaagd, 1 bestaande macOS-specifieke proef niet uitvoerbaar op Linux |
| Android-releaseguards | 5 geslaagd, 1 bestaande signingproef niet uitvoerbaar zonder Android-signingomgeving |
| Native store-readinessguards en broninventaris | Geslaagd; geen signingrun of platformupload uitgevoerd |

De gerichte publicatiesuite omvat de echte importer/routehandlers, bronbewijs voor **330 boeken, 5.945 hoofdstukken en 155.515 verzen**, autorisatie/Origin/payload, incomplete/afwijkende tekst en identiteit, niet-geverifieerde extra hoofdstukkoppen, gewijzigd controletoken, twee beheerders, import-/tekstschrijverslot, auditfout met volledige rollback, idempotentie, verborgen/uitgeschakelde publicatie, één selectie van alle tien uitgaven en de bestaande web-/native-selectie heen/terug. Voor/na-fingerprints controleren **23 bestaande tabellen**, inclusief tekst, cursuskoppelingen, oefeningen, annotaties, voortgang en echte audiomodellen. Er worden ook een OTB-hervatpunt, privénotitie en legacy-audiometadata als behoudsfixtures gebruikt. Er wordt geen audiopublicatie aangemaakt.

Browserproeven: tien combinaties over alle vijf talen, 320/375/390/430 px, licht met normale tekst en donker met 200% tekst. Getest: geen horizontale paginaoverflow, semantische checkboxen/toetsenbordselectie, vijf uitgaven samen selecteren, bevestigingsdialoog/focus, Escape zonder mutatie, één echte bevestiging en blijvende status na herladen. Screenshots en JSON-resultaten staan in het CI-artifact `scripture-publication-browser`. Dit is browserbewijs, geen fysieke iPhone-/VoiceOver-acceptatie.

**Bestaande losse testfout:** `npm run test:content-picker` heeft 47 geslaagde tests en één fout in `tests/navigation-departure.test.ts`: de synthetische `window` mist `history`, terwijl `currentEntryKey()` `history.state` leest. Dezelfde test faalt afzonderlijk met dezelfde stacktrace op een schone, ongewijzigde checkout van bovenstaande `develop`-commit met dezelfde Node/dependencies. Navigatiecode en deze test zijn in deze PR niet gewijzigd. Deze mislukking wordt niet als groen gerapporteerd.

Herhalen op eigen testomgeving, na `npm ci`, generate en productiebuild:

```sh
export OTB_PUBLICATION_TEST_SOURCE=/tmp/versado-otb-publication-source
node scripts/otb/prepare-publication-test-source.mjs
node scripts/content-architecture/test-access-isolated.mjs --focused --scripture-publication --browser
```

De bestaande runner start en verwijdert zelf de lokale Postgres-container. De bronvoorbereiding downloadt alleen de vastgepinde publieke Git-bron; de testimport gaat uitsluitend naar deze gecontroleerde wegwerpdatabase. De bestaande migratieproeven behouden hun synthetische records; hun onvolledige OTB-voorbeelden worden vóór de echte bronproef in eigen verborgen fixturecollecties ondergebracht. Er is geen onbetrouwbaar synthetisch publicatiebewijs of productie-override.

De draft-PR vermeldt de uiteindelijke head en actuele CI-status. Onafhankelijke review, eigenaarstoestemming en een apart goedgekeurde backenduitrol blijven nodig. Deze PR publiceert geen collectie op de draaiende backend en breidt de native-lezer niet uit.

Definitieve lokale ronde: **18/18 gerichte tests en 10/10 mobiele browsercombinaties geslaagd**, inclusief de extra hoofdstukkopcontrole, echte bevestiging/herladen en de volledige afsluitende fixture-inventaris en beschikbaarheidsbenchmark. De aanvraag voor één atomaire selectie van tien uitgaven duurde lokaal ongeveer **1,45 seconde**; de bestaande Prisma-transactielimiet is niet verhoogd.
