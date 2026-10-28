# WP6 deel 1 — gedeelde querykern voor de lokale lezer

Basis: main `096f66c9ebcb11577fbfbeaf1af1e7de34ac2a28`, met de afzonderlijk reviewbare CI-correctie uit #228.
Dit is een kleine eerste WP6-stap; geen volledige Vandaag-/Leren-/CFM-migratie en geen wijziging van het formele pariteitsbeleid.

## Implementatie

- De bestaande React-querylogica staat nu in `src/lib/data/queryHooks.ts`, zonder imports van cookiesockets of Next-navigatie.
  De publieke webhook `useLiveQuery` blijft dezelfde adapter en gebruikt dezelfde webstore. Bestaande webcomponenten hoeven niet aangepast.
- `NativeDataRuntime` gebruikt **dezelfde** `LiveDataStore`, scopes en eventnamen; één geheugenstore per lokale appclient.
  De native adapter gebruikt uitsluitend de bestaande expliciete `NativeSessionClient`-contracten, nooit webcookies of een algemene Bearer-uitzondering.
- De bestaande lokale hoofdstukleeslus gebruikt de gedeelde queryhook: deduplicatie, cache, zichtbare queries, loading/foutstaten,
  herstel na online/focus/hervatten en native realtime-invalidatie. Geen tweede belonings- of voortgangsberekening.
- Accountwissel/logout verhoogt de cache-epoch en wist de store. Late responses van account A kunnen niet als gegevens van B worden weergegeven.
  Hoofdstuk-ID is de bestaande concrete tekstuitgave-identiteit; keys bevatten daarnaast account en epoch. Een andere hoofdstukroute toont nooit oude tekst.
- Bewust afronden gebruikt de bestaande native backendmutatie en invalideert `activityCompleted` pas na succes.
  Geen offline mutatiewachtrij, automatische schrijfretry, optimistische XP of lokaal toegekende reeks.
- Socketlisteners gebruiken uitsluitend de bestaande native ticketverbinding, worden opgeruimd en volgen de gedeelde scope-events.
  Reconnect hercontroleert de zichtbare queries; geen tweede Socket.io-authenticatie.

## Grenzen en vervolg

De bestaande `AppNavigation` en `NativeNavigator` blijven leidend; er is geen tweede router gemaakt.
Er zijn geen knoppen naar nog ontbrekende schermen toegevoegd. De bestaande shell/safe areas/keyboard/backknop blijven behouden.
Er is geen nieuw zichtbaar label; dezelfde vertalingen blijven gebruikt.
Contentkiezer, taalwisselbediening en volledige lokale hoofdnavigatie zijn nog niet klaar: daarvoor zijn echte featurecontracten en schermen nodig.
WP6 is hiermee **gedeeltelijk**, niet volledig, geïmplementeerd. WP8 (Vandaag), WP9 (Leren) en WP14 (CFM) kunnen daarna per functie aansluiten.

## Verificatie

`tests/native-data.test.ts` controleert met dezelfde store: gelijktijdige lezers, exacte hoofdstukidentiteit, offline/achtergrond/hervatten,
geen mutatieretry, gerichte invalidatie, accountwissel met late mutation/fetch en native socketlistener-opruiming.
De bestaande native browserproef doorloopt de werkelijk gebundelde lokale UI op 320px/200%, donker/licht, heropening,
leesafronding en inlog-/beveiligingsflows. De webdata-architectuur- en focustests blijven actief.
TypeScript, lokale native bundel, schone webproductiebuild, lint en volledige geïsoleerde native keten worden op de branch gecontroleerd.
Een Chromium-proef is geen fysieke Android-/iPhone-test; zie het M0-protocol in #199.

De samenloop met #205 wordt op een tijdelijke integratiebranch getest. Die branch wordt nooit naar main gemerged of als extra productimplementatie aangeboden.
Geen schemawijziging, seed, productiehandeling, deployment, signing of store-upload.
