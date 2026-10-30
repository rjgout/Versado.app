# Native routefocus en beperkte buildcorrecties (#240)

De lokale Foundation houdt echte `h1`-focus voor de routeaankondiging aan
VoiceOver/TalkBack. Alleen een niet-interactieve `h1[tabindex="-1"]` binnen
`.native-foundation` krijgt tijdens de programmatische focus de tijdelijke
`data-native-route-focus`-marker. De native CSS onderdrukt uitsluitend daarvan
de outline. Bij blur/routecleanup verdwijnt de marker; links, knoppen,
formuliervelden, dialogen en tekstselectie behouden hun bestaande gedrag.
`focus({ preventScroll: true })` laat de centrale scrolllaag het scrollen regelen.

De browserregressie vond daarnaast 65 px verlies bij terugkeer naar een lange
leesroute: de oude positie werd pas na de React-DOM-wissel opgeslagen. De
navigatiesubscriptie bewaart haar nu vóór de React-notificatie. Zoals de webshell
blijft native herstel daarna kort volgen tot de hoogte 500 ms stabiel is
(maximaal 1500 ms), met tijdelijke uitschakeling van browser-scrollanchoring.
Touch, wheel, toetsenbord of pointer beëindigen het herstel onmiddellijk.

## Dependencyonderzoek op 30 oktober 2026

`npm audit --json`, `npm explain prebuild-install uuid eslint`, `npm ls --all`
en registrymetadata zijn werkelijk uitgevoerd. Geen force-fix of overrides.

| Waarneming | Oorzaak en resultaat |
| --- | --- |
| Drie moderate auditmeldingen | Eén devtoolketen: CLI 8.5.3 → xcode 3.0.1 → uuid 7.0.3, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Stabiele CLI 8.6.0 gebruikt xcode 4.0.0 en verwijdert uuid. `npm audit` daarna: **0 kwetsbaarheden**. Node-eis blijft >=22. Geen Capacitor-runtime-/pluginupgrade. |
| `uuid@7.0.3` deprecated | Verdwijnt bij bovenstaande upstream CLI-correctie, zonder een onverenigbare uuid-override. |
| `prebuild-install@7.1.3` deprecated | Optionele keten opensheetmusicdisplay 2.2.1 → gl 9.0.0-rc.10 → prebuild-install. Registry geeft 2.2.1 als nieuwste OSMD met dezelfde optionele dependency. Een losse override of verwijdering van de muziekweergave is geen beperkte bewezen correctie; blijft voor upstream/vervolg. |
| ESLint 9.39.5 buiten ondersteuning | Nieuwste 9.x blijft deprecated. Huidige eslint-plugin-import 2.32.0, react 7.37.5 en jsx-a11y 6.10.2 verklaren geen ESLint 10-peercompatibiliteit. Volledige lint draait met 0 fouten; majorupgrade van deze combinatie blijft afzonderlijk werk. |
| Zes install-scriptpakketten | Lockbestand noemt @prisma/engines, prisma, esbuild, gl, fsevents en unrs-resolver. Dit is uitvoerbaar installatiewerk, geen zes auditkwetsbaarheden. Geen blanket-allowlist/approval toegevoegd. De gerichte CLI-installatie gebruikte `--ignore-scripts`; haar twee gewijzigde pakketten hebben geen installscript. |
| Tailwind mixed units | Eén `min-[26rem]` in het beheer publicatiescherm vervuilde de Tailwind 3-unitcache voor volgende `px`-varianten. Omgezet naar `min-[416px]`: dezelfde grens bij de initiële 16px-lettergrootte van mediaqueries, ook bij tekstschaling. Configuratie en andere breakpoints blijven gelijk. De test compileert de werkelijke bronboom en bewijst 380/390/400/416-regels; browserprobes bewijzen de mobiele computed styles. |
| Prisma 8 RC-updatebanner | Is een CLI-updateaanbod, geen geïnstalleerde RC. `prisma`, `@prisma/client` en `@prisma/adapter-pg` blijven exact **7.10.0**. Geen update of onderdrukking van de melding; schema-validatie en generatie blijven de bestaande checks. |

De zes scripts zijn afzonderlijk te beoordelen: Prisma controleert de runtime
en installeert engines; esbuild en unrs-resolver controleren/installeren hun
platformbinary; gl gebruikt `prebuild-install || node-gyp rebuild`; fsevents is
uitsluitend optioneel op macOS. De bestaande CI gebruikt `npm ci`; deze PR
wijzigt het installatiescriptbeleid niet. De melding zelf is geen reden om alle
scripts goed te keuren of verplichte buildbinaries stilzwijgend over te slaan.

## Bewijs en fysieke hercontrole

`npm run test:native:focus` gebruikt de echte Foundation-componenten, routeprovider
en gegenereerde native CSS met synthetische HTTP-contractantwoorden. Het is geen
bewijs van backendauthenticatie; daarvoor blijft `test:native:integration` bestaan.
De matrix bevat 320/375/390/400 px, 100/200% tekst, licht/donker; echte actieve
kopfocus en markercleanup, Vandaag → Profiel → Vandaag, login/logout, selectie,
zichtbare toetsenbordfocus (ook dialoogbedieningen), lange leesroute → privacy →
terug en hervatten met exact bewaarde scrollpositie. Screenshots/resultaten staan
als `native-route-focus-browser` bij de bestaande Native Foundation-CI.

Een Chromium-focusassertie bewijst niet hoe WKWebView de blauwe systeemoutline
tekent, hoe VoiceOver/TalkBack aankondigen of hoe het OS-kopieermenu werkt. De
eigenaar controleert op fysieke iPhone én Android: open Vandaag/Profiel zonder
blauw titelkader, luister naar routeaankondigingen, selecteer/kopieer een vers,
ga vanaf een lange leespositie terug/vooruit en hervat de app, en controleer
zichtbare focus met een extern toetsenbord. Bestaande platform-CI compileert iOS
en Android; geen signing, publicatie of deployment.

CFM-data, locks, fixtures en workflows van #237 worden niet gewijzigd. Een
eventuele bestaande CFM-hashfout op develop blijft een afzonderlijke blokkade;
geen herstarts om toevallig groen te krijgen.
