# Native studiemap: ontbrekende API-proxyroutes herstellen

Basis: develop `0ac6e1e0b2b19e82cfff86fa284082ebd3dc5563`.

## Oorzaak en bewijslimiet

PR #300 voegde de studiemap toe aan TypeScript, Swift, Android en de native backend,
maar niet aan `render-test-api-proxy.mjs`. De API-listener op 8081 weigert daardoor
`POST /api/v1/native/study-folder/query` (zowel lijst als bronnen), de mutatieroute en
passage-/annotatiereads. De nieuwe regressieproef faalt vóór herstel op de echte
nginx-development-image: HTML-404 in plaats van JSON-200. Swift weigert een antwoord
zonder native CORS-/JSON-headers terecht als `access_invalid_response`. De UI
meldde deze toegangsfout globaal én lokaal, met twee herstelknoppen.

Dit bewijst de ontbrekende route in de huidige code, niet de exacte foutcode of
draaiende image op de iPhone. Geen fysieke build, telefoon, Cloudflare-configuratie,
NAS of Bearer-sessie van de eigenaar is onderzocht. Geen live verzoeken uitgevoerd.

## Herstel

- Twee expliciete proxyregels: POST query/annotations; GET van alleen
  bookmark/highlight/note + begrensd ID + annotations/passage. OPTIONS volgt dezelfde
  route-inventaris. Geen algemene proxy of andere website-/beheerroute.
- Eén lokale foutpresentatie voor lijst én bronnen; één read-herstelactie ververst
  beide. Sessieverloop blijft centraal uitloggen en privégeheugen wissen.
- Netwerk, sessie, ontbrekende/geweigerde toesteltoegang en ongeldige backendrespons
  krijgen verschillende bestaande of vertaalde meldingen. Toesteltoegang leidt naar
  de bestaande diagnose-/herstelpagina. Geen transportdetails of privéinhoud gelogd.
- Passage gebruikt dezelfde foutpresentatie. Onzekere schrijfacties worden niet
  automatisch herhaald; de bestaande editor en actie-ID/conflictregels blijven intact.
- Het browserharnas gebruikt voor deze suite nu de echte TypeScript native bridge-
  adapter met uitsluitend een synthetische OS-bridge. De echte lokale backendhandlers
  verwerken alle annotaties; dit bootst Swift/Java of een echte telefoon niet na.

## Controle van overige grenzen

Store-test blijft `https://api-test.versado.app`, local-internal blijft
`https://dev.versado.app`. Buildmetadata selecteert de native host/credentialmodus;
geen wijzigingen aan profielen, signing of Cloudflare Access. Cookies zijn geen
native identiteit. De bestaande Bearer-, sessiestempel-, origin-, CORS-, JSON-,
16 KiB request-, 1 MiB response- en timeoutgrenzen blijven staan. De backend
adverteert `study-folder-v1` en valideert eigendom/sessie/bronrechten opnieuw.
Accountgebonden caching en terugnavigatie zijn niet vervangen.

## Uitgevoerde technische verificatie

- TypeScript en schone productiebuild geslaagd; lokale native bundel geslaagd.
- 31 gerichte contract-/transport-/proxy-unittests geslaagd.
- Echte nginx-imageproef: 390 verzoeken geslaagd; ook foute methoden, queryinjectie,
  vreemde origin/host, traversal, cookies/credentials, productie-listener en website.
- Geïsoleerde native studiemap: 12 database-/handlertests geslaagd, inclusief
  sessie-intrekking, accountisolatie, bronintrekking, conflict, idempotentie en rollback.
- 80 mobiele browsergevallen: vijf talen, 320/375/390/430 px, licht/donker en
  100/200% tekst. Zoeken, paginering, opslag/verwijderen, terugkeer, scroll/focus,
  accountwisseling en veilig falen van niet-ondersteunde leesbestemmingen.
- Extra foutgevallen via de bridge: HTML-404 en JSON-503; één alert/knop en herstel.

De eerste bundelpoging en eerste databasepoging liepen tegen een volle lokale
werkruimteschijf aan. Alleen gegenereerde dependencies/cache opgeruimd; dezelfde
controles daarna geslaagd. Een lokale nginx-onderhoudspaginafixture had door de
werkruimte-umask onleesbare bestandsrechten; lokale leesrechten hersteld, geen
productcode omzeild. Definitieve lint-, volledige native-unit-, audit-, guards- en
GitHub-resultaten staan in de PR-beschrijving.

## Eigenaaracceptatie / uitrol (niet uitgevoerd)

Na review en mergebesluit: publiceer/gebruik de bij de merge horende bestaande DEV-
app- en proxy-images; de eigenaar werkt de DEV-proxy bij. Geen Cloudflare-beleid
veranderen. Controleer image-SHA/digests en `study-folder-v1` met het bestaande
alleen-lezen releaseproces. Een bijgewerkte app zonder bijgewerkte proxy lost dit
probleem niet op. De foutpresentatie vereist een nieuwe lokale native bundel.

Controleer daarna op de eigen iPhone: annotatie vinden, zoeken, bewerken, verwijderen,
uitloggen/inloggen en terugkeer met filters/scroll. Verifieer beide queryvarianten,
HTTP-status en JSON/CORS uitsluitend met geschoonde categorieën; geen tokens of
notitieteksten delen. Android, VoiceOver/TalkBack en echte toesteltoegang blijven
fysieke acceptatie. Geen deployment, signingbuild, upload of merge gestart.
