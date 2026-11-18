# B3b-2b — gedeelde bladwijzers, markeringen en notities

Onderdeel van [#254](https://github.com/rjgout/Versado.app/issues/254), vanaf
`develop` na #257 (`d54d993c`). Geen audio/TTS, vragen, afronding, XP of CFM-uitbreiding.
Fysieke acceptatie van deze uitbreiding is nog niet uitgevoerd.

## Gerichte audit en hergebruik

| Bestaande bron | Beslissing |
| --- | --- |
| `ScriptureReaderView` | Dezelfde tekstpresentatie blijft op web en native staan. |
| `LessonFlow.ReaderView` | De bestaande tik-/selectiebeveiliging en versnummerknoppen zijn ondergebracht in `useVerseAnnotationMenu`, dat beide platformen aanroepen. |
| `AnnotationActions` | De bestaande dialoog, kleuren, note-editor, focusafhandeling en handmatige retry staan in `AnnotationActionsView`. De webwrapper behoudt cookie-/Origin-transport; native levert een Bearer-/Service-Auth-adapter. |
| `MarkSwatch`, `clientContract`, `contract` | Dezelfde vijf kleuren, versidentiteiten, notitielimiet, actie-UUID en versiecontrole. |
| `annotations/service` | Bestaande Bookmark/Highlight/Note-tabellen, tombstones, schrijfregels, privénotities en `annotationsChanged` blijven leidend. Een transactierunner laat native dezelfde schrijflogica binnen de bestaande sessiecommit uitvoeren. |
| `nativeScriptureReader` | Bepaalt welke cursus, bron, hoofdstukken en losse stapverzen de gebruiker werkelijk mag lezen. Geen tweede cursus- of toegangsberekening. |
| `NativeDataRuntime` / `LiveDataStore` | Account-/sessie-epoch, bronversie, gerichte invalidatie en bevestigde cache-updates; geen tweede cache of offline outbox. |
| Native Access-bridges | Alleen de hieronder genoemde extra GET-/POST-paden; bestaande header-, geheim-, redirect-, response- en profielcontroles blijven gelden. |

Dezelfde dialoog en versbediening worden dus daadwerkelijk geïmporteerd door web
en de lokale Capacitor-bundel. Web-API-aanroepen, Next.js, `ReadAloudPlayer` en
servermodules gaan niet via deze extractie naar de native bundel.

## Ondersteunde interface

Alle drie de bestaande Boek-van-Mormon-leesmethoden gebruiken deze uitbreiding:
Stap voor stap, Hoofdstuk voor hoofdstuk en Vrije keuze. Alleen de verzen van het
geautoriseerde leesdoel zijn beschikbaar. Een los versbereik wordt nooit een
hele hoofdstukactie.

Een tik op de tekst of de semantische versnummerknop opent het bestaande menu.
Selectie, slepen en scrollen openen het menu niet. Markeringen gebruiken
`yellow`, `green`, `blue`, `pink` en `purple`; bladwijzers en notities houden de
bestaande indicatoren. Notities hebben dezelfde limiet van 2.000 tekens als web.
Alle vijf bestaande UI-talen krijgen een correcte capability-afhankelijke uitleg.

Het menu houdt toetsenbordfocus vast en geeft deze zonder scrollsprong terug.
Niet-opgeslagen tekst en een onzekere actie vragen bij sluiten of native
navigeren om een expliciete keuze. Een geblokkeerde navigatie vervalt bij
opslaan, herladen of annuleren; bewust weggooien kan de gekozen navigatie hervatten.
Authenticatie-intrekking naar de login mag nooit door een concept worden geblokkeerd.
Concepten staan alleen in het bestaande dialooggeheugen, niet in een lokale database.

De navigatieguard verandert de normale teruggeschiedenis niet. Invoer en scrollen
in een open dialoog gelden niet als leesinteractie voor de bestaande positiehook;
een eventuele mislukte positie-intentie wordt hiervoor niet gewist of herhaald.

## Native contract en begrenzing

Capability: `scripture-annotations-v1`, naast de bestaande reader-capability.
Zonder deze capability verschijnen geen annotatieknoppen en worden geen
annotatieverzoeken verstuurd. Oude clients kunnen hun bestaande readercontract blijven gebruiken.

Prefix: `courses/<courseId>/read/{steps|chapters}/<targetId>`.

| Methode en suffix | Functie |
| --- | --- |
| `GET /annotations` | Eigen annotaties voor uitsluitend de toegestane verzen, inclusief versiemetadata van verwijderde annotaties. |
| `GET /annotations/<verseId>` | Verseigen readback, inclusief tombstones voor correcte heractivatie en versiecontrole. |
| `POST /annotations` | Getypeerde `put`/`delete`-actie met bestaande `expectedVersion` en `actionId`, plus verwachte bron/taal/versgrenzen. |

Geen PUT/DELETE-doorlaatroute, algemene annotatieproxy, queryparameters of
cookie-fallback. TypeScript, Swift en Java staan exact dezelfde paden toe.
De bestaande requestgrens is 16 KiB. Een lijst bevat maximaal 200 rijen per soort
en blijft onder een conservatief budget van 768 KiB. Hele rijen worden bij de
budgetgrens weggelaten met `complete: false`; notitietekst wordt nooit afgekapt.
De bestaande melding voor onvolledige lijsten blijft zichtbaar. De gerichte
versread kan de volledige notitie alsnog laden. Geen weggelaten rij wordt verwijderd.

## Autorisatie en transacties

GET controleert de native sessie, bronselectie, cursus en versgrenzen vóór en na
de aggregatie. Het ophalen van annotaties schrijft niets. Een vertraagd antwoord
na intrekking of een bron-ABA-wissel wordt geweigerd.

Native schrijft binnen `commitAccountMutation`. De lockvolgorde is User →
NativeSession → collectie → cursus → boek → hoofdstuk → cursusleesdoel → doelvers
→ bestaande annotatie-advisorylock. De actuele sessie en oorspronkelijke
autorisatie worden na lockwachten opnieuw gecontroleerd. De readerautoriteit wordt
voor en na de domeinactie herhaald, de response wordt vóór commit gevalideerd en
de bestaande sessiecontrole bewaakt ook verloop vóór commit.

Web-, legacy- en resolutiemutaties nemen eveneens de User-lock vóór domeinlocks,
zodat de native FK-/advisorylockvolgorde geen tegengestelde lockvolgorde introduceert.
De niet-lockende observatie van een bestaande privénotitie vindt vóór die
User-lock plaats. Zo blijft een al gestarte privébewerking een conflict na DELETE,
ook wanneer de aanvrager een toekomstige mutatieversie had gegist. De definitieve
versiecontrole, tombstonecontrole, actiehash en opslag blijven in één transactie.

Dit wijzigt het bestaande recht op eigen verborgen privénotities niet. Zij blijven
op web beheerbaar volgens de bestaande regels. De native reader verleent daarvoor
geen nieuwe broninzage en verwijdert zulke notities niet wanneer een bron verdwijnt.

Er zijn geen nieuwe tabellen, velden of migraties. READ, oefensessies, XP, reeks,
hints, cursusafronding en de bestaande voortgangsgegevens worden niet door de
annotatieactie gewijzigd. `annotationsChanged` volgt pas na een geslaagde commit.

## Conflicten, netwerk en synchronisatie

De bestaande dialooglock voorkomt dubbel tikken. Alleen een bevestigde serveractie
toont de opgeslagen-status. Een mislukte of onzekere actie wordt niet automatisch
bij online herstel of hervatten herhaald. Handmatige retry behoudt de UUID,
verwachte versie, inhoud en operatie. Een versieconflict vereist herladen en een
nieuwe bewuste keuze; er is geen blinde overschrijving.

Native cache-identiteit omvat epoch, gebruiker, bron, selectieversie, taal,
cursus, leeswijze, doel, hoofdstuk en versgrenzen. Een late respons van account A
komt niet bij B. Bevestigde versies gaan vóór oudere GETs én oudere POST-responsen.
Tombstones blijven in de scoped native readback beschikbaar zodat een oudere
opslagrespons een nieuwere verwijdering ook visueel niet kan terugdraaien.

Web krijgt de bestaande domeinevents. Native gebruikt dezelfde LiveDataStore en
de bestaande focus-/hervatverversing; de interne Access-build krijgt hiervoor geen
onbeveiligde WebSocket. Echte autorisatie- of Access-weigeringen schermen oude
reader-/annotatiegegevens af. Een handmatige GET-retry moet eerst weer slagen.

## Testen en onafhankelijk oordeel

De gerichte eenheidsproeven, nieuwe native PostgreSQL-proeven, twee afzonderlijke
Node-processen met één poolverbinding, bestaande webannotatiesuites en browserproeven
lopen via de bestaande scripts en Native Foundation-workflow. Er wordt één webbuild
hergebruikt; geen officiële contentdownloads of productiegegevens.

Gericht lokaal: `node scripts/native/test-isolated.mjs --annotations-only` met de
bestaande Playwright-/Chromium-inrichting, uitsluitend in de geïsoleerde ontwikkelomgeving.
`--no-browser` houdt dezelfde SQL-proeven en bestaande webdomeinregressies over.
De standaard CI-keten houdt daarnaast alle bestaande native suites intact.

Reviewbevindingen en reparaties blijven afzonderlijk vermeld in de PR:

- Achtergebleven conceptnavigatie na opslaan/herladen: gewist; een gerichte
  Foundation-browserproef controleert zowel annuleren als bewust navigeren.
- Vertraagde privé-edit na DELETE: oorspronkelijke conflictregel behouden;
  de bestaande webregressie is ongewijzigd.
- Late POST na een nieuwere verwijdering: versiecontrole bij cachemerge;
  de regressie wordt eerst rood aangetoond en vervolgens opnieuw uitgevoerd.

Definitieve aantallen, screenshots, head-SHA, onafhankelijke review en alle
GitHub-checks staan bij de opleverings-PR; alleen werkelijk uitgevoerde resultaten tellen.

## Fysieke acceptatie — PENDING PHYSICAL ACCEPTANCE

Een nieuwe native build en een backend met de capability zijn noodzakelijk.
Gebruik na afzonderlijke goedkeuring de bestaande develop → Mac → Capacitor-sync
→ Xcode → iPhone-werkwijze; Android afzonderlijk. Geen nieuwe distributieroute.

1. Open iedere leesmethode; tik op tekst en versnummer. Hetzelfde menu opent op
   het juiste vers. Scrollen en selecteren mogen het niet openen.
2. Maak/verwijder een bladwijzer en probeer alle vijf markeerkleuren. Controleer
   dezelfde indicatoren op web en na heropenen.
3. Maak/bewerk/verwijder een notitie, ook een lange tekst en emoji. Controleer de
   volledige inhoud op web en wijzig die daar weer terug.
4. Probeer een niet-opgeslagen notitie te sluiten of verlaat het scherm. Bewaren,
   annuleren en bewust weggooien moeten duidelijk en voorspelbaar werken.
5. Verbreek internet tijdens opslaan. Er mag geen onterechte opgeslagen-status
   of automatische schrijfretry verschijnen. Probeer daarna zelf opnieuw.
6. Wissel account en bron. Oude privégegevens mogen niet zichtbaar zijn. Controleer
   ook ingetrokken sessies en toegang.
7. Controleer grote tekst, licht/donker, veilige schermranden, toetsenbord,
   VoiceOver op iPhone en TalkBack op Android.

De bekende fysieke bugs [#258](https://github.com/rjgout/Versado.app/issues/258)
en [#259](https://github.com/rjgout/Versado.app/issues/259) blijven open voor de
afgesproken stabilisatiefase. Deze uitbreiding claimt niet dat ze zijn opgelost.
Audio/TTS blijft B3b-2c; vragen, afronding en beloningen blijven B3c. CFM-reader,
imports, publicaties, main, NAS, Portainer en Cloudflare worden niet aangepast.
