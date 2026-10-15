# Fase 3B.1 — CFM-verwijzingen, media en publicatiekwaliteit

Vervolg op concept-PR #120, basis `4a7260c41ea24b8b6fb7ab13316403dc2c99acba`.
Alleen code, brononderzoek, geïsoleerde tests en deze bestaande PR. Geen nieuwe
Prisma-migratie, productiequery, import, publicatie, merge, deploy of NAS-mutatie.

## Resultaat en reproduceerbaar bewijs

De 52 bron-snapshots en hun oorspronkelijke hashes zijn behouden. De lessen
behouden 3.200 blokken, 3.609 verwijzingen, 10 tabellen en 563 afbeelding-/poster-
occurrences. Het nieuwe bronresultaat is:

| Afhandeling | Fase 3B | Fase 3B.1 |
| --- | ---: | ---: |
| Intern bron-gecontroleerd OTB-doel | 1.679 | 1.960 |
| Bewezen officiële externe verwijzing | 449 | 1.096 |
| Geblokkeerd / beoordeling nodig | 1.481 | 553 |
| Ontbrekende alttekst | 52 | 0 |
| Gecontroleerde video-occurrences | nog te beoordelen | 95 |
| Veilig extern te openen video-occurrences | 0 | 95 |
| Gespiegelde videobestanden | 0 | 0 |

Dit is **bronbewijs, geen nieuwe inventarisatie van productie**. Een intern doel
wordt bij importreview en gebruik door de centrale resolver opnieuw tegen de
werkelijke database, publicatie, editie, taal en normale leesrechten gecontroleerd.
De integratietest gebruikt daarvoor uitsluitend een eigen gepubliceerde OTB-fixture.

Reproduceerbare bestanden:

- `reference-review-baseline.json`: alle oorspronkelijke 1.481 geblokkeerde
  occurrences, met les, anker, label, oorspronkelijk target en oorspronkelijke reden.
- `reference-source-checks.json`: controle van 1.053 unieke oorspronkelijke URL's,
  inclusief twee aanvullende unieke URL's bij nieuw gevonden conflicten. Bewaart
  datum, exacte URL, canonieke bronidentiteit/taal/ankers of technische fout,
  responsehash of gecontroleerde binary-prefixhash en MIME.
- `reference-review.json`: beoordeling per oorspronkelijke occurrence met
  A/B/C-afhandeling, oorspronkelijke en actuele reden, voorgestelde behandeling,
  afzonderlijke label- en URI-kandidaten en OTB-bronbestand/blobbewijs. Vier
  aanvullende bevindingen staan afzonderlijk, zodat de basis niet wordt herschreven.
- `quality-report.json`: actuele totalen en verwijzing naar de volledige beoordeling.
- `official-resources-cfm.json`: 538 exact gecontroleerde officiële URL's voor de
  bestaande resolver; geen host-wildcard.

`review-cfm-reference-sources.py --refresh` voert bewust het openbare brononderzoek
opnieuw uit. `--retry-transient` controleert uitsluitend tijdelijke fouten en nog
ontbrekende aanvullende URL's. De offline stappen zijn:
`node scripts/study-content/register-cfm-official-resources.mjs` en
`npx tsx scripts/study-content/audit-cfm-2026.ts`.
Gewijzigde netwerkuitkomsten vereisen review; CI keurt niet automatisch nieuwe
bronnen goed. De runtime haalt nooit externe broninhoud op om een preview te maken.

## Oorspronkelijke categorieën

| Oorspronkelijke reden | Aantal | Intern | Officieel extern | Review |
| --- | ---: | ---: | ---: | ---: |
| Niet-geregistreerde resources | 670 | 0 | 400 | 270 |
| Meerdere hoofdstukken | 257 | 255 | 0 | 2 |
| Nieuwe Testament | 209 | 0 | 0 | 209 |
| PDF | 105 | 0 | 104 | 1 |
| Video | 95 | 0 | 95 | 0 |
| Nummeringsconflicten | 67 | 0 | 0 | 67 |
| Andere Schriftuur | 37 | 0 | 37 | 0 |
| Heel boek | 17 | 17 | 0 | 0 |
| BJS | 11 | 0 | 11 | 0 |
| Samengestelde verwijzing | 9 | 9 | 0 | 0 |
| Groot expliciet versbereik | 4 | 4 | 0 | 0 |

Dit lost 285 oorspronkelijke blokkades intern en 647 extern op; 549 oorspronkelijke
occurrences blijven geblokkeerd. Vier eerder ten onrechte toegestane korte
verslabels komen daar bij: totaal 553. Het aantal interne verwijzingen stijgt
daardoor netto met 281, niet 285.

## Passagekeuzes, editie en navigatie

Een deel van de oude hoofdstukcategorie bestond uit lokale labels zoals
“vers 10–22”. De adapter gebruikt het expliciet gelinkte hoofdstuk en vergelijkt
de volledige versselectie met de bron-URI. Tegenstrijdige nummers worden geweigerd.

De minimale uitbreiding `otb-set:` bevat maximaal 40 afzonderlijke bestaande
passages binnen de bestaande bronsleutellimiet van 512 tekens. Hoofdstukbereiken,
hele boeken, enkele bewezen hoofdstukoverschrijdende bereiken en grote expliciete
versselecties worden niet tot hun eerste deel ingekort. Grote versselecties worden
opgedeeld in volledige segmenten van maximaal 40 verzen. Geen pseudohoofdstuk.

De bestaande resolver controleert alle onderdelen in dezelfde batchquery. Alle
onderdelen moeten beschikbaar zijn en tot dezelfde exacte collectie behoren.
Een ontbrekend onderdeel maakt de bundel onbeschikbaar. De response bevat alleen
de geselecteerde preview plus een begrensde lijst passagekeuzes. De bestaande
48KB-responsegrens, 40-verspreview, querylimieten en timeouts blijven behouden.

`passageIndex` is een optioneel, strikt gevalideerd veld van het bestaande request
(0–39). De server controleert ook de daadwerkelijke bundellengte. Oude requests
blijven passage 0 gebruiken. De native ReferencePreview-dialog toont contextuele
keuzes, behoudt focus tijdens laden en verwerpt late responses via AbortController.
Meer lezen laat de server de gekozen passage opnieuw bepalen; de bestaande
savequeue, versiecontrole, terugkeertoken en Terug naar les blijven leidend.

Alle interne CFM-Bijbeldoelen blijven exact `old-testament / otb / nl`. UI-taal
verandert deze identiteit niet. Er is geen NT-, BJS- of andere vertaling geïmporteerd.
De bestaande BOM/DC/PGP-bewijzen en collecties blijven intact. De 37 beoordeelde
bronselecties buiten het bestaande interne selectie-/editiecontract openen hun
bewezen Nederlandse officiële pagina extern; er wordt geen extra interne mapping
verzonnen. BJS blijft altijd onderscheiden van OTB.

## Nummering en resterende beslissingen

De 67 oorspronkelijke conflicten hebben geen bewezen nieuwe interne mapping.
Voor elk conflict staan zichtbaar label, oorspronkelijke URL/URI-selectie,
OTB-kandidaat, bronbestand/blob en Nederlandse broncontrole in het rapport. De
gecontroleerde Nederlandse bron-API levert hiervoor geen bruikbaar passagebewijs.
Een API-404 bewijst niet dat iedere webweergave permanent verdwenen is: het betekent
dat deze controle geen veilige Nederlandse fallback heeft kunnen bevestigen.
Geen generieke offset, tekstgelijkenis of Engelse substitutie wordt goedgekeurd.

Er zijn zes extra conflicten gevonden: twee binnen de oude hoofdstukcategorie en
vier eerder toegestane korte labels in les 35 en 47. Bijvoorbeeld “vers 3” bij
Psalm 49 wees naar URI `p2`. Alle **73** nummeringsconflicten blijven veilig dicht.

Overige open punten:

- 209 NT-verwijzingen: metadata voor NT-collecties is geen bewijs van beschikbare,
  equivalente, gepubliceerde Nederlandse tekst. De gecontroleerde Nederlandse
  officiële passages zijn niet bevestigd. Geen omleiding naar OTB of andere taal.
- 270 resources: 182 API-404's, 38 onbewezen taal/canonieke identiteit, 33 onbewezen
  ankers, 15 niet ondersteunde resourcevormen en twee niet goedgekeurde hosts.
- Eén PDF-link naar een niet goedgekeurde externe host (boekje Mijn familie).

Deze punten vereisen afzonderlijk controleerbaar bron-/editie- of ankerbewijs,
een veilige exacte officiële fallback, of een bewuste inhoudelijke beslissing.
Zij worden niet als “opgelost” geteld om het rapport groen te maken.

## Video, PDF en alttekst

Alle 95 video's zijn tegen hun gepinde les-HTML gekoppeld aan oorspronkelijke
URL, titel, video-ID en posterchecksum. Alleen een kleine byteprefix is gecontroleerd
op MP4-signatuur/MIME; video's worden niet gespiegeld of in een nieuwe speler gezet.
42 occurrences verwijzen naar een oorspronkelijke NL-asset en 53 naar een
oorspronkelijk Engelstalige asset. Ook de laatste openen exact hun oorspronkelijke
officiële URL, met een zichtbare Engelstaligheidsmelding in alle vijf UI-talen.
Er is geen automatische vervanging van een Nederlandse bron door een Engelse.

De 104 veilige PDF-occurrences verwijzen naar gecontroleerde oorspronkelijke
officiële bestanden, met PDF-signatuur en MIME. Hun taal wordt niet uit een
bestandsnaam afgeleid. Er komt geen PDF-reader. Externe acties gebruiken de
bestaande expliciete link met `noopener noreferrer`; actieve bron en voortgang
blijven behouden.

De banner met SHA-256
`9e9f60cd6b12ef4b069d6ae3eb07829bd8736aacd6ab5c869f60dce192b1e88c`
is visueel bekeken: een informatiebanner met de tekst “Meer voor onderwijs aan
kinderen” en “Nu bekijken”. De alttekst is uitsluitend voor deze gepinde afbeelding
op 52 plaatsen: **Meer voor onderwijs aan kinderen — Nu bekijken.** Geen andere
afbeeldingen of bestanden zijn veranderd; de lege-alt-publicatiecontrole blijft staan.

## Opslag, tests en uitrol

Adapterversie 2 gebruikt dezelfde import-, lease-, media- en immutable revisieservice.
Nieuwe inhoud levert conceptrevisies; oude publicatiepointers en revisies blijven
behouden. De operatorbevestigingshash omvat nu ook de kwaliteitsreview en het
bronbewijs. Geen automatische import bij seed, containerstart of deployment.

Gerichte controles omvatten alle 52 lessen, alle 1.481 basisbeoordelingen en de vier
extra bevindingen, exacte URL-registratie, bron-/posterbewijs, bundels en grenzen,
ontbrekende onderdelen, indexmanipulatie, taalindicatie, idempotente herimport,
databehoud en normale toegang tegenover beheerpreview.

De productiebuild-browsertest gebruikt werkelijke geïmporteerde lessen op 320px/
200% tekst, 390px en desktop, met licht/donker. Hij controleert passagekeuze en
focus, het tweede hoofdstuk, Ruth 4, Genesis 41:55–57, lange hoofdstukken, PDF/
NL-video/EN-video, de banner en NT zonder OTB-fallback, met Meer lezen/Terug naar les
en zonder READ-, XP-, hint- of activiteitmutaties. Geen fysieke iOS-/Androidtest.
Screenshots komen in het bestaande CI-artifact `cfm-2026-import-browser`.

Lokale eindresultaten:

- TypeScript, Prisma validate/generate, i18n en schone productiebuild: geslaagd.
- 8 CFM-/reviewtests, 18 resolvertests, 57 reader-/positiecontroles en 33
  publicatie-/contenttests: geslaagd, geen skips.
- Volledige PostgreSQL-import/herimport van 52 lessen: geslaagd; 1.960 interne,
  1.096 externe en 553 onopgeloste referenties daadwerkelijk door de resolver
  vastgesteld. Bestaande publicatie, revisie-ID's en twintig gegevensmodellen behouden.
- Alle twaalf browsercases tegen de productiebuild: geslaagd. De externe nieuwe
  tab wordt daadwerkelijk geopend; alleen de externe response is onderschept om
  geen volledig video-/PDF-bestand te downloaden. De openbare bron zelf is
  afzonderlijk via de echte broncontrole geverifieerd.
- ESLint: nul fouten, 143 bestaande waarschuwingen, geen nieuwe waarschuwingen.
  De bestaande i18n-achterstand blijft 418 sleutels per niet-Nederlandse UI-taal;
  beide nieuwe sleutels zijn in alle vijf talen aanwezig.
- Een eerdere databasecontrole werd door een werkruimteherstart onderbroken en
  is niet als geslaagd geteld. De volledige ronde is daarna op een nieuwe eigen
  database afgerond. Geen productie- of herstelactie uitgevoerd.

De definitieve GitHub Actions-status en screenshot-artifactlinks worden op de
exact gepushte head gecontroleerd en in PR #120 vastgelegd.

De officiële productiepublicatiegate blijft gesloten. Geen databasemigratie of
stackaanpassing nodig. Een latere goedgekeurde conceptimport vereist de bestaande
persistente mediaopslag en een nieuwe bewuste operatorbevestiging. Publieke
vrijgave vereist eerst afhandeling van de open referenties en afzonderlijke
toestemming; technisch importsucces verleent die toestemming niet.

Rollback naar de vorige image behoudt alle revisies, media, context en voortgang.
Houd CFM verborgen zolang nog een reader zonder passagebundelondersteuning kan
worden teruggezet. Geen downmigratie, verwijdering of automatische garbage collection.
Het eerder geaccepteerde ontbreken van een onafhankelijke Hyper Backup-restoretest
blijft ongewijzigd; hier wordt geen nieuw herstelbewijs geclaimd.
