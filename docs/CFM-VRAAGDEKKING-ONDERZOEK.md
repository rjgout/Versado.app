# CFM-vraagdekking: oorzaken en besluit over een officiële pilot

Vervolg op draft-PR #218, onderzocht op branch `feat/cfm-leesvragen-xp`.
**Stop vóór bronverbreding:** de huidige bronafbakening blijft gelden. Een volledige
pilot is niet geactiveerd. Er is geen productiequery, import, publicatie of deployment
uitgevoerd. Dit verslag en de conceptvragen zijn voorbereiding voor het benodigde
productbesluit; geen vervanging van de bestaande fase-A-roadmap.

## 1. Wat de 17/624 wel en niet betekent

Alle 104 gepinde Nederlandstalige lessen uit 2026/2027 zijn opnieuw verwerkt met
`loadCfmLesson`, `personalStudyFor`, `preparedStudyQuestions` en `studyExercisePlan`.
De bestaande catalogus bevat **45 gecontroleerde citaatbronnen**, verdeeld over
**18 stappen**. Ze komen alle 45 door de huidige blokhash-, letterlijke-tekst-,
URL- en taalcontrole. Er zijn **nul afgewezen catalogusbronnen** in deze snapshot.
Zeventien stappen leveren drie vragen op; `2026/01`, stap 3 levert er twee op.

Van de 607 ontbrekende stappen hebben **606 geen gecontroleerde cataloguskoppeling**.
Eén heeft een gecontroleerd citaat maar onvoldoende generatorresultaten.
Dit is geen bewijs dat in die 606 stappen geschikte schrifttekst ontbreekt.
De huidige catalogus is een kleine handmatig geselecteerde bronset, geen volledige
inventaris van alle mogelijke schriftcitaten. De eerdere 17/624-meting was correct
als beschikbaarheidsmeting, maar geen oorzakenanalyse van de overige 607 stappen.

### Aantallen per gevraagde oorzaak

De oorzaken kunnen overlappen. Daarom onderscheidt dit verslag bewezen feiten van
mechanische triage. De laatste kolom mag niet als inhoudelijke goedkeuring gelden.

| Gevraagde oorzaak | Wat daadwerkelijk is vastgesteld | Primaire technische triage van de 607 |
|---|---|---:|
| 1. Geen geschikte schrifttekst beschikbaar | **Niet definitief geteld.** In 131 stappen is geen gemarkeerd citaat van 20–600 tekens aangetroffen. Dat bewijst niet dat geen interne schrifttekst of korter citaat bestaat. Gekoppelde hoofdstukken worden niet automatisch gelezen. | 131 zonder lang citaatsignaal |
| 2. Schrifttekst beschikbaar, maar niet gekoppeld | **Niet definitief geteld als geschikte schrifttekst.** 142 stappen hebben wel zulke citaatsignalen, maar geen citaatsignaal en officiële schriftlink samen in één blok. Ook titels/toespraakuitspraken worden gedetecteerd. De productie-DB is niet geïnventariseerd. | 142 zonder directe kandidaat-koppeling |
| 3. Gekoppeld, maar afgewezen door broncontrole | **0** van de 45 bestaande gecontroleerde catalogusbronnen wordt afgewezen. Niet-gecatalogiseerde bronnen zijn geen afgewezen vragen. | 0 |
| 4. Geschikt, maar te weinig vraagvarianten | **1** inhoudelijk reeds gecatalogiseerde stap: `cfm-old-testament-2026/01`, stap 3, Mozes 6:63. Invullen en woordbank lukken; waar/niet waar niet. | 1 |
| 5. Onvoldoende inhoudelijk gecontroleerde vragen | **606** ontbrekende stappen hebben nog geen gecontroleerde cataloguskoppeling; dit overlapt categorie 1/2. Daarvan hebben 333 een citaatsignaal plus schriftlink in hetzelfde blok, maar nog geen gecontroleerde bron. | 333 nog te beoordelen kandidaat-stappen |
| Totaal primaire triage | Alleen de derde kolom vormt een exclusieve verdeling, geen volledige semantische classificatie. | **607** |

Het zou onjuist zijn om 131 definitief als ongeschikte schrifttekst, 142 als bewezen
beschikbare schrifttekst, of 333 als onmiddellijk publiceerbare stappen te presenteren.
Een volledige inhoudelijke beoordeling van alle 607 stappen is niet uitgevoerd.
De [CSV met alle 624 stappen](cfm-pilot/triage-624-stappen.csv) maakt de telling controleerbaar.
Code 0 is beschikbaar; 1–5 verwijzen naar de triage hierboven.

Reproduceren, uitsluitend lokale bronbestanden lezen:

```bash
npx tsx scripts/study-content/cfm-question-audit.ts --csv docs/cfm-pilot/triage-624-stappen.csv
```

De detector zoekt gemarkeerde tekstfragmenten van 20–600 tekens en officiële
schrift-URLs. Hij leest ook lijsten, tabellen en bijschriften via `readingBlockText`.
Hij verifieert geen betekenis, vertaaledities of werkelijk getoonde databaseverzen.
Aanhalingstekens alleen bewijzen geen schriftcitaat. Er vindt geen vraagpublicatie plaats.

## 2. Waarom de automatische kandidaatweek geen officiële pilot is

Slechts vier weken hebben in de ruwe detectie in alle zes stappen een lang
citaatsignaal met schriftlink in hetzelfde blok. Inspectie toont concrete blokkades:

| Week | Voorbeeld dat automatische publicatie uitsluit |
|---|---|
| 2026/35 | Stap 3 `b-p5`: ‘We kunnen meer doen om een beter mens te worden’ is een toespraaktitel; stap 4 `b-p8`: ‘Hij kan mij genezen!’ eveneens. Een Alma-/Psalm-link erbij verandert die titel niet in een schriftvers. |
| 2026/42 | Stap 5 `b-p17`: ‘Zodat zij kunnen zien’ is een conferentietoespraak. De lange schriftachtige kop `b-title6` heeft zelf geen directe schriftlink. Een ander blok koppelen of extra verzen tonen vereist expliciete bronbinding. |
| 2027/36 | Stap 3 `b-p_swTHm`: het lange citaat is van Russell M. Nelson, geen tekst van 1 Korinthe 14:34–35. Stap 5/6 detecteert video-/toespraaktitels. |
| 2027/46 | Stap 4 detecteert lied-/toespraaktitels en een invulzin; de Bijbelkop bevat een bewerkt citaat. Het zijn geen drie gecontroleerde schriftvragen. |

Dit bewijst dat deze ruwe vier kandidaten niet direct publiceerbaar zijn, niet dat
iedere mogelijke korte of ongemarkeerde schriftzin in alle andere lessen is onderzocht.
Er is op basis van dit onderzoek geen veilige volledige pilot aangetoond binnen
uitsluitend de huidige zichtbare lestekst en bestaande bronadapter.

## 3. Lesmateriaal en gekoppelde schriftlezing zijn verschillende bronnen

`personalStudy.ts` deelt de persoonlijke CFM-blokken in zes stukken op basis van
onderwerpen en tekstverdeling. Een stap kan uitsluitend een studietip, video,
conferentiecitaat of vervolg van een onderwerp bevatten. `READING_LABEL` is een
opdracht/verwijzing, geen ingebedde tekst van de genoemde hoofdstukken. Sommige
labels staan zelfs bij het einde van de vorige stap; alleen dat label overnemen is
geen betrouwbare afbakening van een nieuwe leesopdracht.

`ReferencePreview`, `references/resolver.ts` en `/scripture/[chapterId]` kunnen
werkelijk beschikbare interne verzen tonen, met toegang, werk, taal, uitgave en
bewijs per hoofdstuk. Dat mechanisme wordt nu niet door de CFM-vragenadapter gebruikt
om een gekoppelde passage als daadwerkelijk aangeboden leesinhoud vast te leggen.

Beschikbare herbruikbare bronnen:

- `prisma/bomContent*.json`, `dcContent*.json`, `pgpContent*.json`: officiële teksten
  per taal, `references/scripture-evidence.json` voor canonieke identiteit en hashes.
- OTB-Bijbel: `scripts/otb/source-lock.json` en de bestaande importer; de upstream
  tekstbestanden staan niet in deze repository. De reader vraagt de werkelijk
  toegankelijke `Chapter`/`Verse` op. Een catalogus of bronlock bewijst niet dat
  alle hoofdstukken in een bepaalde installatie gepubliceerd zijn.
- OTB heeft uitgave `otb`; officiële Nederlandse CFM-citaten zijn niet automatisch
  letterlijk dezelfde vertaling. Kerk-URL, OTB-tekst en versnummer mogen niet
  stilzwijgend als één tekstuitgave worden behandeld. Versnummering en bereik
  moeten door de bestaande canonieke resolver worden bewezen.

De huidige adapter controleert een citaat in één CFM-blok, niet een passage uit de
schriftuurdatabase. Zo hoort het zolang de gebruiker alleen dat CFM-blok heeft gelezen.
Alleen een link openen bewijst bovendien niet dat een volledige opgegeven reeks is
getoond; een afgekapt preview mag geen vragen over de weggelaten verzen opleveren.

## 4. Concreet productvoorstel dat eerst akkoord vraagt

**Voorgestelde pilot: 5–11 januari 2026, ‘Dit is mijn werk en mijn heerlijkheid’:
Mozes 1; Abraham 3 (`2026/02`).** Deze bestaande officiële les verwijst aantoonbaar
naar teksten die in de Nederlandse `pgp`-uitgave in de repository staan. Voor de
vijftien nieuwe vragen is geen OTB-vertalingsvervanging nodig.

Aanbevolen keuze: toon een duidelijk onderscheiden **schriftlezing bij deze stap**
met de geselecteerde volledige verzen uit de bestaande interne bron vóór de vragen.
Hergebruik de bestaande passage-resolver en versweergave; geen herschrijven van het
CFM-document, geen nieuw annotatiedoel in de officiële les en geen nieuw kaartsysteem.
De tekst moet daadwerkelijk beschikbaar en aangeboden zijn. Alleen een les- of
linklabel telt niet. Bind de vraagset aan precies die passage, taal, uitgave en hash.
Bij ontoegankelijke/ontbrekende tekst blijft lezen mogelijk zonder die vragen.

Het [uitgewerkte voorstel met achttien conceptvragen](cfm-pilot/2026-02-voorstel.md)
toont per vraag bron, passage, type, vaste seed, antwoord en geschiktheidsreden.
Drie zijn bestaande zichtbare-citaatvragen; vijftien vereisen de aanvullende lezing.
De selectie voor stap 3 en 5 binnen het hele hoofdstuk is expliciet als nieuwe
product-/beheerkeuze gemarkeerd. Er zijn geen echte productie-Exercise-ID's opgevraagd.
Alle bestaande stap-1-vragen en identiteiten moeten bij uitvoering worden behouden.

Alternatief: houd vragen uitsluitend bij letterlijk zichtbare CFM-schriftcitaten.
Dan blijven ongeschikte stappen zonder vragen. Een volledige zesstappenpilot is
binnen die keuze nog niet veilig aangetoond; ik forceer geen vragen om achttien te halen.

**Open productbesluit:** mag de pilot aanvullende, geselecteerde interne schriftlezing
bieden en daarna vragen over die daadwerkelijk aangeboden tekst? Zo ja, gelden de
expliciete passagekeuzes voor stap 3 en 5 uit het voorstel ook als akkoord?
Tot dat besluit blijven bronadapter, vraagcatalogus, runtime en XP ongewijzigd.

## 5. Uitvoerbare uitbreiding binnen de bestaande fase A

Geen tweede publicatiesysteem. `docs/CONTENTBEHEER.md`, `contentUpdate.ts`, de
check/prepare/publish-flow met `planHash`, `StudyRevision`-publicatie en de bestaande
`Exercise.status` blijven het uitgangspunt. Die voorzieningen zijn herbruikbare
bouwstenen, geen reeds bestaande complete CFM-vragenbeheerfunctie.

1. **Bronselectie voorbereiden:** Codex of beheerder maakt per gepubliceerde
   lesrevisie en persoonlijke stap een voorstel uit exacte blokken of, na akkoord,
   opgeloste schriftpassages. Een broad hoofdstuklabel wordt niet automatisch
   een goedgekeurde versselectie. Bewaar waarom de selectie bij het onderwerp hoort.
2. **Automatisch controleren:** normale toegang, bronrechten/publicatiestatus,
   werk/taal/uitgave, versnummering, volledige selectie zonder afkapping, bronhash,
   CFM-revisie en stapvingerafdruk. Ontbrekende vertalingen worden niet vervangen.
3. **Vragen voorbereiden:** bestaande `exerciseGen.ts`, inhoudelijk gekozen vaste
   seeds, bestaande afleiders en antwoordcontrole. Kies verschillende passende
   passages/inhoudswoorden, geen cosmetische varianten om een tekort op te vullen.
   Waar/niet waar alleen als de bestaande naamgebonden generator geschikt is.
   Deze generator herkent veel Bijbelse namen niet; de globale namenlijst wijzigen
   kan bestaande imports beïnvloeden en gebeurt hier niet.
4. **Review vóór beschikbaarheid:** voorstellen blijven documenten/offline output
   of, na een beoordeelde beheeruitbreiding, bestaande `Exercise`-rijen met status
   `DRAFT`/`IN_REVIEW`. Toon passage, vraag, antwoorden, afleiders en reden aan de
   reviewer. Een generatorresultaat of eigen correct antwoord dat slaagt, is geen
   inhoudelijke goedkeuring. Bestaande adapter mag concepten niet automatisch
   opnieuw als `APPROVED` aanmaken. Geen importer/route die elk nieuw voorstel
   vanzelf aan de goedgekeurde broncatalogus toevoegt.
5. **Bewust publiceren:** uitbreiden van bestaande beheeractie met expliciete
   review-/planhash en bronset, onder dezelfde importlock en auditregistratie.
   Geen nieuwe schrijvende endpoint of goedkeuringssysteem in deze opdracht.
   Alleen beoordeelde `APPROVED`-vragen worden aangeboden; `REJECTED`/`RETIRED`
   blijven buiten aanbod. Publiceer bronnen en vraagset consistent.
6. **Identiteiten/XP beschermen:** behoud bestaande vragen, seeds, bronkoppelingen,
   opties, credits en week-contentKey. Hergebruik `exerciseSignature`/sync-regels
   waar passend. Nieuwe selectie mag een oude beloning niet resetten; centrale
   `applyAttempt`-grens blijft gelden. Veranderde passage/revisie maakt oude sessies
   ongeldig, maar wist geen historie. Tel bij bonusberekening niet dubbel door
   een oude vraag cosmetisch opnieuw te identificeren.
7. **Dekkingsgate:** per jaargang tellen drie per goedgekeurde stap en exact dezelfde
   achttien in de weekroute; ontbrekende/ongeldige bronnen blokkeren uitsluitend
   de betreffende vragen. Valideer nieuwe jaren en gewijzigde revisies vóór
   vrijgave. Toon welke gaten ontbreken, niet alleen een totaalscore.

## 6. Acceptatie en tests na het productbesluit

De officiële pilot moet dan in een eigen testdatabase de gepinde echte CFM-revisie
én echte officiële Nederlandse schriftteksten gebruiken. Geen synthetische week.
Test alle zes stappen los, dezelfde achttien IDs in de weekroute, beide routevolgorden,
centraal berekende XP/bonus/herhalingskorting, fouten later verbeteren, dubbele
submit/concurrency/verloren response en reeds bestaande credits/leesvinkjes.
Ook wijzigende passagehash, andere editie, ontbrekende toegang en afgekapt preview.
Controleer annotatie-/leespositiebehoud en nul nieuwe Dorp-groei. Browser: daadwerkelijke
passages vóór de vragen, 320/390 px, 200% tekst, licht/donker, terugkeer en zes groepen.

**Nog niet uitgevoerd:** deze officiële gekoppelde pilot, zijn volledige route-/XP-
integratie en browserflow. De bestaande synthetische achttienvragentests zijn geen
vervanging voor dat bewijs. Native router/Bearer- en fysieke iPhone/iPad/Android-
beperkingen uit [het fase-A-verslag](CFM-LEESVRAGEN-FASE-A.md) blijven open.

## 7. Status van deze aanvulling

| Soort bewijs | Status |
|---|---|
| Technisch geïmplementeerd | Alleen readonly audit en reproduceerbare triage. De bestaande runtime is niet gewijzigd. |
| Inhoudelijk door Codex onderzocht | Bestaande catalogus; vier misleidende kandidaatweken; bronselectie en achttien conceptvragen voor 2026/02. |
| Automatisch gevalideerd | 624 stappen, 45 bestaande bronchecks, tellingen, generator/antwoordcontrole van de concepten; resultaten in PR #218. |
| Nog te beoordelen/besluiten | Bronverbreding en expliciete versselectie; onafhankelijke inhoudelijke review; daadwerkelijke officiële pilotimplementatie en tests; apparaat-/nativevalidatie. |

De actuele CI-status en werkelijk uitgevoerde checks worden in PR #218 bijgehouden.
