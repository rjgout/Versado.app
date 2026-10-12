# Fase 1C — compacte contentkiezer

## Basis en visuele aanpassing

Branch `codex/content-architecture-v2-1c-polish`, vanaf actuele main `edfc528`
(merge PR #88). De eigenaar meldt dat fase 1C live staat. Geen productie-
verbinding, deploy of migratie uitgevoerd.

De bestaande `/content`-route, Focus-shell, gemeten terugbalk, safe areas en
centrale navigatie blijven intact. De pagina gebruikt dezelfde VS-tokens,
PageIntro, ContentIcon en officiële bronassets.

- Het taalblok gebruikt compacte pills, minder padding en een kortere uitleg.
  Alle vijf native taalnamen blijven zichtbaar, met 44px minimum touchhoogte.
- Kaarten tonen alleen bronicoon, naam, taal en eventueel het selectievinkje
  met selectietekst. Kleiner icoon en padding, minder ruimte tussen de kaarten.
- “Beschikbaar in …”, kaartaccordions, editie-/taallijsten en preview-CTA’s zijn
  verwijderd uit de renderflow. Bestaande vertaalsleutels blijven compatibel.
- Bij 200% tekst blijft het bestaande rem-grid één kolom gebruiken. Decoratieve
  broniconen/chevrons laten ruimte voor tekst; de tekstgrootte wordt niet verkleind.

## Beheerpreview

De voorkeursoptie uit productfeedback is gevolgd: alleen normaal selecteerbare
edities staan in de gewone kiezer, ook bij beheerders. Een werk zonder publieke
editie verdwijnt uit deze pagina. Een verborgen editie verschijnt niet als
kaartoptie of previewknop. Het bestaande adminbackend en expliciete previewroute
zijn behouden; de servercatalogus en alle toegangsregels zijn ongewijzigd.
Manipulatie van de selectiepayload geeft nog steeds geen normale leestoegang.

## Exacte taal en edities

De globale, getoonde contenttaal is leidend bij een kaartklik. De oude kaart-
fallback naar de eerste editie in een andere taal is verwijderd. Een bron die
niet in deze taal beschikbaar is, toont een compacte melding en veroorzaakt
geen API-mutatie. De bestaande selectie, UI-taal en studiecontext blijven staan.

`resolvePickerEdition` is een kleine pure presentatiehelper binnen het bestaande
pickercontract: uitsluitend publieke edities van hetzelfde werk en de gevraagde
taal, met voorkeur voor de reeds actieve familie. Hij is geen nieuwe
serverselectieservice of autorisatiebron; de bestaande API valideert opnieuw.

Een andere familie wordt niet stilzwijgend gekozen. Alleen bij een noodzakelijke
familiekeuze verschijnt één compact globaal native editieveld, buiten de
kaarten. Openen kost geen mutatie; expliciet kiezen gebruikt de bestaande
één-tikflow. Er is geen permanent editieveld, lijst of accordion per bron.
Deze uitzondering is getest met synthetische meerdere-edities-fixtures; de
laatst gecontroleerde inventaris (2026-10-11) bevatte zeven werken met ieder
één geregistreerde familie. Dit is geen nieuwe productie-inventarisatie.

De centrale API, rowlock/compare-and-set, stale-responsebeveiliging, live-data,
vertrekcontext en scrollherstel uit fase 1C zijn behouden. Geen schema,
UserStudyContext-contract, beloning, XP, hintsaldo, podcastfunctie of spelregel
is gewijzigd. De eerder gedocumenteerde ABA-grens van het bron-/taalpaar blijft
gelden; deze polish introduceert geen nieuwe serverversie.

## Validatie en screenshots

TypeScript en schone productiebuild geslaagd. Picker/route/focus/shell: 40
unit/regressietests; live-data 51; Kompas 60 geslaagd. De losse Kompas-run slaat
negen DB-tests over zonder DB-binding; die worden wel uitgevoerd in de
geïsoleerde puzzel-/Kompas-run: 40 geslaagd, nul skips.

Geïsoleerde content-/toegangs-/studiecontext-/picker-run: 110 geslaagd
(59 + 10 + 22 + 19), nul fouten/skips. Behoud van bestaande gegevens is met
synthetische fixtures en tabelvingerafdrukken gecontroleerd; geen productie-
gegevens gekopieerd. API-rechten, studiecontext, edities en concurrency blijven
beschermd.

Bestaande shell-/kaart-/Woordzoeker-browsermatrix: 28 combinaties, vijf UI-talen
en drie echte spelafrondingen geslaagd. Definitieve picker-browsermatrix: 28
combinaties, vijf UI-talen en alle interacties geslaagd; zeven kaartregressies
ook geslaagd. De eerste proefrun vond een te smalle taalchip bij 320px/200%;
padding/gap zijn gericht aangepast. De definitieve run controleert de echte
scrollWidth/clientWidth van ieder chiplabel.

Vergelijking van volledige mobiele screenshots (390×844, licht, 100%, dezelfde
synthetische zeven bronkaarten): 2144px vóór polish, 1146px erna, circa 47%
minder document-/scrollhoogte. Dit is een fixturevergelijking, geen meting of
wijziging van productiecontent. Kaart- en taalblokhoogte worden daadwerkelijk
in de browser gemeten, niet uitsluitend via CSS-klassen gecontroleerd.

ESLint: nul fouten, 132 bestaande waarschuwingen. Alle nieuwe/gewijzigde teksten
zijn vertaald in nl/en/de/fr/es. i18n-check: 3330/3753 per extra taal; de 423
bestaande ontbrekende sleutels vallen buiten deze wijziging. Kompas beschrijft
al globale taalkeuze en expliciete edities en blijft inhoudelijk correct.

De bestaande productie-browsertest meet 320/375/390/430px, tablet, desktop en
landscape, licht/donker en 100/200% tekst, plus vijf UI-talen. Nieuwe checks
controleren echte chip-/kaartafmetingen, geen afgekapt label, afwezigheid van
accordions/previewlinks/talenrijen, een ontbrekende brontaal zonder mutatie en
een expliciete globaal geplaatste editie-keuze. Ook verborgen admincontent,
annuleren, scrollherstel, dubbele tikken en late antwoorden blijven getest.

Screenshots en meetrapporten staan buiten Git in `/tmp/versado-layout-browser`;
GitHub Actions bewaart ze als `header-wordsearch-browser` (zeven dagen):

- `content-picker-390x844-light-100.png` — compacte mobiele pagina.
- `content-picker-320x844-dark-200.png` — kleinste telefoon/grote tekst.
- `content-picker-768x1024-dark-100.png` — tablet.
- `content-picker-1280x900-light-100.png` — desktop.
- `content-picker-844x390-dark-200.png` — landscape/grote tekst.

Chromium met touch- en safe-area-emulatie; geen fysieke iOS/Android- of WebKit-
test. Geen productiedata of privégegevens gebruikt voor browserfixtures.

## Uitrol en terugdraaien

Concept-PR laten beoordelen; geen automatische merge of deploy. Publiceren pas
na afzonderlijke toestemming via het bestaande Versado-deploypaneel. De
container voert zijn bestaande Prisma-migratiecheck uit bij starten; deze PR
voegt geen migratie of backfill toe. Controleer live selectie, taal en terug-
navigatie. Bij problemen terug naar de eerdere goedgekeurde app-image; geen
schema-rollback of aanpassing/verwijdering van persoonlijke gegevens nodig.

De dagelijkse Hyper Backup wordt door de eigenaar beheerd; de eerder bewust
overgeslagen aanvullende herstelproef is hier niet alsnog als bewezen herstel
beschreven. Deze wijziging voert geen backup- of herstelactie uit.
