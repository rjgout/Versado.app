# AI-ontwikkelworkflow voor Versado

Deze permanente taakverdeling geldt voor ChatGPT, Codex en andere ontwikkelagents
die aan Versado werken. De bestaande beveiligings-, privacy-, migratie-, test-,
Next.js- en architectuurregels in [CLAUDE.md](../CLAUDE.md) blijven gelden.
`AGENTS.md` blijft een symlink naar datzelfde instructiebestand.

## Branch- en mergebeleid

Dit is het centrale beleid voor Codex, Claude Code en andere ontwikkelagents.
De technische publicatie- en Portainer-procedure staat in
[Development-pipeline](DEVELOPMENT-PIPELINE.md).

- Maak nieuwe featurebranches standaard vanaf de actuele `origin/develop` en
  richt nieuwe feature-PR's op `develop`. Werk op een eigen branch; push niet
  rechtstreeks naar de gedeelde branches en force-push die niet.
- Een draft-PR mag worden geopend om werk reviewbaar te maken. Bied een PR pas
  ter merge aan nadat de relevante tests en verplichte Actions op de laatste
  commit slagen én de onafhankelijke review een GO heeft gegeven. Eigen
  testresultaten vervangen die review niet. Merge blijft afhankelijk van
  expliciete toestemming van de eigenaar en geldende branchbescherming.
- `main` is uitsluitend voor gecontroleerde productiereleases en expliciet
  goedgekeurde hotfixes. Voor zo'n afzonderlijk goedgekeurde hotfix mag een
  hotfixbranch vanaf `main` met een PR naar `main` worden gemaakt; alle test-,
  review- en toestemmingsregels blijven gelden.
- Een release van `develop` naar `main` vereist een afzonderlijke release-PR
  en afzonderlijke toestemming. Toestemming voor een feature-merge naar
  `develop` of een dev-test is geen toestemming voor die release of deployment.
- Na wijzigingen op `main` volgt een gecontroleerde synchronisatie naar
  `develop`: maak een synchronisatiebranch vanaf actuele `origin/develop`,
  integreer daarin `origin/main`, los conflicten inhoudelijk op en open een PR
  naar `develop`. Laat tests, onafhankelijke review en mergegoedkeuring opnieuw
  plaatsvinden. Geen automatische merge, rebase of force-push van gedeelde branches.
- Bestaande open PR's behouden hun doelbranch totdat hun inhoud, afhankelijkheden
  en reeds opgenomen wijzigingen afzonderlijk zijn beoordeeld en de eigenaar
  over eventuele overzetting heeft beslist. Niet automatisch retargeten of sluiten.

## Taakverdeling

### ChatGPT — architect, onderzoeker en reviewer

ChatGPT verzorgt vóór implementatie:

- Gericht GitHub-codeonderzoek en de architectuuraudit.
- Analyse van bestaande modellen, services, API's en afhankelijkheden.
- Technisch ontwerp, implementatiekeuzes en bestandsgerichte impactanalyse.
- Migratie- en compatibiliteitsontwerp.
- Beveiligings- en privacyanalyse.
- Testscenario's, acceptatiecriteria en concrete implementatieopdrachten voor Codex.

ChatGPT verzorgt na implementatie de onafhankelijke review van PR-diffs,
migraties, testresultaten en GitHub Actions. De review controleert de oorspronkelijke
opdracht, formuleert gerichte herstelopdrachten bij concrete tekortkomingen en
levert het GO/NO-GO-advies voor merge. Een code-audit door ChatGPT vervangt geen
daadwerkelijk uitgevoerde technische tests.

### Codex — programmeur

Codex implementeert de aangeleverde specificatie, opent alleen direct relevante
bestanden en hergebruikt bestaande functies en patronen. Codex lost TypeScript-,
Prisma-, lint- en buildfouten op, schrijft en draait gerichte automatische tests,
test migraties veilig in een lokale/geïsoleerde ontwikkel- of testdatabase en
voert noodzakelijke integratie- en browserchecks uit. Codex pusht de branch en
levert een reviewbare concept-PR op.

Een actueel, vooraf onderzocht implementatiepakket is het uitgangspunt. Codex
herhaalt dan niet standaard een brede architectuuraudit en bedenkt geen nieuwe
productfunctionaliteit, architectuur of ontwerpkeuzes buiten de goedgekeurde scope.
Bij ontbrekend of aantoonbaar verouderd vooronderzoek onderzoekt Codex alleen wat
nodig is voor veilige implementatie.

Bij een concrete afwijking tussen de audit en de actuele code:

1. Controleer uitsluitend het betreffende codepad.
2. Los een kleine, evidente technische afwijking binnen de opdracht op.
3. Rapporteer een wezenlijke architectuurafwijking of nieuw datarisico.
4. Verander de afgesproken architectuur niet zelfstandig; vraag alleen een
   gericht besluit wanneer dat noodzakelijk is voor het betreffende werk.

Vermijd onnodige onderzoeksrondes, herhaalde inventarisaties en lange zelfevaluaties.

### Eigenaar — productbeslissingen, deployment en live tests

De eigenaar bepaalt de functionele wensen, keurt belangrijke ontwerpbesluiten
goed en beslist over merge en release. De eigenaar voert zelf deployments op
Synology uit, beheert productiebackups, volumes en Docker-images en voert alle
functionele tests in de live omgeving uit. De eigenaar beoordeelt de werkelijke
gebruikerservaring op mobiel en desktop en geeft akkoord voor een volgende
roadmapfase.

Ontwikkelagents voeren **geen NAS-verbinding, Portainer-actie, productiequery,
productiebackup, deployment of live test** uit. Dit geldt ook voor de afzonderlijke
ontwikkelstack: de eigenaar beheert zowel dev als productie. Vraag de eigenaar
niet om NAS-toegang voor een agent. Ontbrekende
productiecontroles blokkeren het afronden van een ontwikkel-PR niet: vermeld
beknopt welke acceptatie of uitrolcontrole bij de eigenaar ligt. Dit heft een
onopgelost technisch dataverlies- of beveiligingsrisico niet op.

## Twee verschillende soorten verificatie

### Technische verificatie — Codex

Voor gewijzigde functionaliteit blijven de toepasselijke controles verplicht:

- Compilatie en TypeScript; Prisma-validatie bij relevante databasewijzigingen.
- Migratie- en database-integriteitstests in een geïsoleerde testdatabase.
- Gerichte unit-, integratie-, beveiligings-, privacy- en regressietests.
- ESLint en i18n waar relevant, plus een productiebuild van gewijzigde code.
- Relevante automatische browserchecks bij UI-wijzigingen.
- GitHub Actions op de daadwerkelijk gepushte commit.

Gebruik uitsluitend een lokale of geïsoleerde testomgeving. Rapporteer werkelijke
resultaten en maak fouten, skips en niet-uitgevoerde controles zichtbaar. Een
technisch geverifieerde PR is niet automatisch functioneel geaccepteerd als release.

### Functionele acceptatie in productie — eigenaar

De eigenaar controleert de daadwerkelijk uitgerolde versie, gebruikerservaring,
vormgeving, navigatie en dagelijks gebruik op mobiel en desktop met echte
productiecontent. De eigenaar besluit over functionele acceptatie van de release.
Deze live tests vervangen de noodzakelijke automatische technische verificatie niet.

## Standaardproces

1. **Vooronderzoek door ChatGPT.** Gericht onderzoek van bestaande code,
   GitHub-documentatie, risico's en ontwerpkeuzes.
2. **Implementatiepakket door ChatGPT.** Een concrete opdracht met doel en scope,
   vastgestelde beginsituatie, relevante bestanden, gewenste implementatie,
   migratievoorwaarden, testscenario's, acceptatiecriteria en expliciete verboden
   en grenzen.
3. **Implementatie door Codex.** Featurebranch vanaf `develop`, code schrijven,
   minimale noodzakelijke aanvullende inspectie, verplichte automatische
   technische tests en een concept-PR naar `develop`, volgens het branchbeleid.
4. **Onafhankelijke review door ChatGPT.** PR-diff, migraties, tests en CI
   beoordelen; zo nodig een kleine, gerichte herstelopdracht.
5. **Merge na toestemming.** Na groene controles en onafhankelijke GO, alleen
   met expliciete toestemming van de eigenaar; branch protection blijft gelden.
   Een release naar `main` of hotfix volgt de afzonderlijke toestemmingsgrenzen
   uit het branchbeleid hierboven.
6. **Productie-uitrol en live tests door de eigenaar.** Codex neemt niet deel aan
   productiehandelingen.
7. **Volgende roadmapfase.** Alleen starten na expliciet akkoord van de eigenaar.

## Efficiëntie en rapportage

- Geen volledige repositoryscan bij iedere opdracht of herhaalde algemene audits.
- Geen ongevraagde refactoring of uitgebreide rapportages over vooraf vastgestelde zaken.
- Geen nieuwe documentatie behalve wat de opdracht vereist.
- Geen afzonderlijke architectuuronderzoek-PR bij een bestaand goedgekeurd ontwerp.
- Herhaal tests niet zonder relevante codewijziging of concrete aanleiding,
  behalve verplichte eindcontroles.
- Controleer altijd de werkelijk gewijzigde code technisch. Stop bij onopgeloste
  risico's op dataverlies of beveiligingsproblemen.
- Bij uitsluitend documentatie/instructieconfiguratie: controleer documentlinks,
  de relevante symlink en de diff. Geen onnodige appbuild, database- of browsertests.
  Verplichte GitHub Actions blijven gelden: wacht op de werkelijke status op de
  laatste commit, zonder onnodige extra workflows of herstarts aan te vragen.

Het eindrapport van Codex is standaard compact:

1. PR-link en commit.
2. Wat is geïmplementeerd?
3. Technische test- en CI-status.
4. Afwijkingen, beperkingen of blokkades.

Het onafhankelijke GO/NO-GO-advies komt uit de ChatGPT-review, niet uit een
uitgebreide zelfaudit door Codex. De eigenaar neemt het merge- en releasebesluit.

## Tijdelijke uitvoeringsvolgorde van de roadmap

De eigenaar heeft deze volgorde gekozen:

**Vervolgprioriteit vanaf 25 oktober 2026:** CFM-leesvragen en bestaande XP-regels
(A), validatie en beloningskoppeling (B), daarna Het Verborgen Woord solo (C/5C)
en klassikaal/presentatie (D/5D). Zie de aanvulling in de
[enige implementatieroadmap](content-architecture-v2/04-IMPLEMENTATION-ROADMAP.md#vervolg-a-d--cfm-leesvragen-eerst).
Dit is uitsluitend voorbereidende documentatie, geen implementatieautorisatie.
De onderstaande oorspronkelijke volgorde blijft de herkomst van de fasepakketten:

1. Fase 3B — afgerond.
2. Fase 4A — annotatiefundament.
3. Fase 4B — contextuele bediening.
4. Fase 4C — Mijn studiemap.
5. Fase 4D — revisieherstel en compatibiliteit.
6. Terug naar fase 3C — FSY.
7. Fase 3D — programma-integratie.
8. Fase 5A–5D — spelintegratie en Het Verborgen Woord.

Dit is een planningsbesluit, geen wijziging van de technische afhankelijkheden
in de [bestaande implementatieroadmap](content-architecture-v2/04-IMPLEMENTATION-ROADMAP.md).
De inhoud van die roadmap blijft ongewijzigd. Deze workflow geeft geen toestemming
om een volgende fase zelfstandig te starten.
