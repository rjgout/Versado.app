# Profiel — vergelijkbaar browserbewijs

Synthetische accounts op de eigen wegwerpdatabase, echte productie-Next-webapp
naast lokaal gebundelde native React-renderers. Chromium; **geen fysieke
iPhone-/iPad-/Android-acceptatie**. De native proef toont een interne buildbadge.

| Situatie | Web | Lokale native weergave |
| --- | --- | --- |
| 390px, licht | [Web](web-390.png) | [Native](native-390.png) |
| 320px, 200% tekst, donker | [Web](web-320-200.png) | [Native](native-320-200.png) |
| Privacy, 390px | [Web](web-privacy.png) | [Native](native-privacy.png) |

Dezelfde profielhero, kaarten en instellingen worden gebruikt. Verschillen in
shell en nog ontbrekende bestemmingen blijven zichtbaar; dit is geen volledige
pariteitsclaim. Zie [werkende acties en open punten](../NATIVE-PROFILE.md).
De automatische proef legt ook de overige talen en alle twaalf onderdelen vast
in `/tmp/versado-native-browser/shared-profile` (bestaand CI-browserartifact).

## Lokale controle

- TypeScript, productie-webbuild en lokale native bundel gecontroleerd.
- 64 gerichte profiel-/foundation-/avatar-/beveiligingstests geslaagd.
- 47 HTTP-integratietests geslaagd: profiel, account, accountverwijdering,
  reauthenticatie, discriminatorbotsing, contenttaal/CAS en globale sessie-intrekking.
- Browserproef geslaagd in vijf talen, 320px/200%, licht/donker en tablet.
  Werkelijke opslag/herstel, 2FA, oude accountantwoorden, avatardrafts,
  globale logout en accountwisseling; geen ontbrekende verpakte afbeeldingen.
- 38 lokale nginx-verzoeken geslaagd, inclusief begrensde profielpoorten en
  behoud van de website/productieconfiguratie. Openbare testcontextbestanden
  moesten lokaal leesrechten krijgen: de werkruimte had ze als `0600` uitgecheckt.

Een eerdere lokale gecombineerde run faalde met een vijfseconden-transactietimeout
en locktimeout terwijl daarnaast een losse diagnosetest op dezelfde database liep.
De oorzaak van die afzonderlijke overschrijding is niet sluitend gereproduceerd.
De daaropvolgende normale keten hierboven slaagde; een tijdelijke, uitsluitend
lokale eventloopmeting registreerde procespauzes tot 3657 ms in de testserver en
ook pauzes in afzonderlijke testprocessen. Geen transactielimiet, lock of
beveiligingsassertie is aangepast. Deze observatie blijft expliciet onderdeel van
de review; geslaagde browserproeven zijn geen toestel- of release-GO.

Exacte-head GitHub Actions, platformcompilatie en onafhankelijke review worden
afzonderlijk bij de draft-PR beoordeeld. Geen signingrun of upload gestart.
