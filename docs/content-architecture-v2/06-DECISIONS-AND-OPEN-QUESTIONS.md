# 06 — Besluiten, aanbevelingen en echte open punten

Status: fase-0-review. Vastgelegde UX-besluiten worden niet opnieuw ter
discussie gesteld. Technische modelnamen/interfaces zijn voorstellen en
vormen geen reeds uitgevoerde implementatie.

## 1. Besluiten van de producteigenaar

| ID | Vaststaand besluit | Ontwerpgevolg |
|---|---|---|
| P1 | Uitsluitend fase 0, alleen documentatie | Geen functionele code, schemawijziging, migratie/import of merge naar main |
| P2 | Schriften en Studieprogramma's onderscheiden | Bronsoort bepaalt structuur/capability, niet waarde als studiecontent |
| P3 | Vandaag, Leren→Lezen/Cursussen en Spelen blijven leidend | Geen nieuwe primaire navtab, geen automatische bronmix |
| P4 | Fullscreen bronkiezer vanaf bestaande headeringang, twee groepen, taal geïntegreerd | Echte route, actieve keuze herkenbaar, één tik, geen detail/bevestiging |
| P5 | Alleen beschikbare/toegankelijke/gepubliceerde bronnen publiek | Consistente servertoegang, geen onzichtbare bron via losse API |
| P6 | Actieve les persistent per gebruiker/programma; geen automatische weekwissel | CFM- en FSY-context apart, eerdere les blijft, huidige-weekactie expliciet |
| P7 | Volledige doorlopende officiële lessen met geïntegreerde media | Semantische rich-contentreader, geen geforceerde schermstappen |
| P8 | Leespositie automatisch bewaren/hervatten; restart; expliciet gelezen | Positie, READ en cursus-/oefenstatus gescheiden; 100% scroll niet voltooien |
| P9 | Officiële vragen/opdrachten blijven officiële tekst | Niet automatisch Exercise, geen lege cursuskaart als er geen quiz is |
| P10 | Gedeelde verwijzingspreview; Meer lezen kan bron bewust wisselen | Preview read-only; tijdelijke terugkeerroute naar originele les/positie |
| P11 | Zelfstandig verder navigeren wisselt bron niet automatisch terug | Returncontext geen permanente gebruikersselectie of globale terugnavigatie-interceptie |
| P12 | Bekende officiële externe fallback, anders nette melding/beheerinzicht | URL's/targets niet verzinnen; resolver herkent latere interne imports |
| P13 | Eén contextuele annotatiebediening voor vers/passages | Geen drie vaste knoppen; rustige highlights, mobile sheet/desktopcontext |
| P14 | Mijn studiemap onder Leren, standaard alle bronnen | Zoeken/type/bronfilters, bewerken/verwijderen, terugkeer naar de passage; geen extra navtab |
| P15 | Notities privé; annoteren geen XP/reeks | Eigenaargate, geen feed/rewardmutaties |
| P16 | Les logisch dezelfde in talen, offsets niet blind vertalen | Logische selectie/status delen waar bewezen; tekstselectors per editie |
| P17 | CFM begint met 2026 — Oude Testament, voorbereid op andere jaren | Echte officiële identiteiten/kalender, geen aanname van 52 lessen per jaar |
| P18 | FSY mag technisch/visueel vernieuwen, eigen maand/categorie behouden | Geen dwang in CFM-weekmodel; legacygegevens/links wel beschermen |
| P19 | Eigenaar heeft toestemming voor volledige teksten/afbeeldingen | Volledige integratie ontwerpen, interne herkomst/rechten, footer alleen indien concrete voorwaarde |
| P20 | Gefaseerde implementatie met aparte beoordelingen | Geen toekomstige functionaliteit bouwen zonder goedgekeurde scope |
| P21 | Het Verborgen Woord later Solo/accounts/klassikale host/presentatiescherm | Geen gastaccounts bij netwerkspel; publieke broncontext nu ontwerpen, spelregels later |

Deze besluiten zijn uitgangspunt, geen vragenlijst. Ook de huidige XP- en
reeksregels, zes pogingen bij Woord van de Dag, betaalde hints en puzzelarchitectuur
worden niet in dit project heronderhandeld.

## 2. Aanbevolen technische besluiten

| ID | Advies | Waarom en alternatief |
|---|---|---|
| T1 | Behoud ContentCollection als concrete taaleditie; kleine ContentWork-catalogus | Voorkomt hardcoded bronsoortlijsten zonder bestaande relaties te vervangen |
| T2 | StudyPeriod/Lesson/Edition/Revision, JSON-body met stabiele sectie/blok-id’s | Versies/rollback/taalidentiteit nodig; geen kunstmatige Chapter/Verse of tabel per tekstblok |
| T3 | Eén availabilityservice voor aanbod/API/preview/start | Verbergen in de UI en GameContentScope alleen zijn aantoonbaar onvoldoende |
| T4 | Behoud activeContent; nieuwe UserStudyContext per programma | activeCourse of één globale activeLesson vermengt onafhankelijke voorkeuren |
| T5 | ReadingPosition los; ContentProgress als gelezenstatus | Geen tweede rewardengine of scroll=voltooid; huidige beloningen behouden |
| T6 | Native modal in bodyportal voor previews/acties | Bestaand hintpanelpatroon heeft top-layer/focus, de ChapterPopup-flow kan functioneel hergebruikt worden |
| T7 | Tijdelijke returncontext in centrale navigatielaag | Gebruikersselectie blijft persistent, tabuitstap is tijdelijk; expliciete Terug naar les |
| T8 | Uitbreiden Bookmark/Highlight/Note achter één service | Geen vierde opslag/dualcopy; bestaande id/privacy/timestamps behouden |
| T9 | Selector: stabiel blok + positie + quote/context + revisie | Updates veilig of als orphan bewaren; offsets niet naar andere taal projecteren |
| T10 | Publicatie immutable revisie + mutable pointer | De enkele FSY-publicatiekopie mist geschiedenis; pointerrollback is voorspelbaar |
| T11 | Kleine bronadapters, DB-importlease, bestaand admin/runnerpatroon | FSY-/CFM-bronontdekking verschillen; geen nieuwe queue of CMS nodig |
| T12 | Gepinde media op persistent volume, checksum/readygate | Betrouwbare volledige integratie zonder hotlinkafhankelijkheid of brandingmisbruik |
| T13 | Bestaande GAME_CATALOG/Scope/Settings plus echte adapters | Eén catalogus; capabilities/content/correcte pool expliciet |
| T14 | Frozen bron/les/revisie/pool/rules in spelrecord | Lopende sessie blijft correct na bronwissel/publicatie; geen onbedoelde replayreward |
| T15 | Bestaande voortgangssleutels behouden; nieuwe families namespacen | Huidige key mist editie, maar globale rewrite beschadigt credits/rewards |
| T16 | Fase-1-context met legacy-key, fase-2-FK; minimale speltoegang al in fase 1 | Lost fasering op zonder alle rijke lesmodellen of speladapters vroeg te bouwen |
| T17 | FSY-concept en gepubliceerde kopie beide migreren | status DRAFT kan nog een geldige publicatie hebben; niets resetten |
| T18 | Eerst veilige compatibele rollbackversie vóór nullable verseId-gebruik | Volledig oude annotatiejoins kunnen nieuwe null-targets niet lezen |

Deze besluiten voegen alleen complexiteit toe waar een concrete eis die nodig
maakt. Geen generieke generieke documentdatabase, workflowdesigner, herbouw van alle
Schrifturenlezers, zoekservice, offlineplatform of toekomstige ranglijst.

## 3. Werkelijk benodigde productbeslissingen

Er hoeft voor fase 0 geen antwoord te worden afgewacht. De volgende keuzes
moeten vóór de genoemde implementatiegate expliciet zijn:

### Q1 — Bestaande podcastbron in de nieuwe kiezer (vóór fase 1C)

Feit: podcasts zijn nu een eigen selecteerbare collectie, met eigen cursussen,
afleveringen en voortgang. De nieuwe UX-beschrijving noemt twee groepen en
CFM/FSY, maar geeft geen bestemming voor deze bestaande bron.

Advies: podcasts als herkenbare extra rij binnen de tweede groep behouden,
zonder studiespecifieke week-/lescontrols. De technische bronsoort blijft
OTHER, niet een geforceerd CFM-programma. Als de eigenaar een andere plek
bedoelt, moet de huidige bronselectie en bereikbaarheid behouden blijven.
Deze audit verwijdert of verbergt niets. Geen derde primaire navgroep bouwen.

### Q2 — Editiebeleid voor verwijzingen met meerdere beschikbare families (vóór fase 2D)

Feit: OTB is een bestaande Bijbelimportfamilie, terwijl officiële programma-
verwijzingen mogelijk een andere teksteditie/nummering bedoelen. Deze audit
heeft de concrete bronverwijzingen niet live gecontroleerd.

Advies: bronadapter bewaart de bedoelde canon/familie waar bekend. Interne
preview alleen bij een goedgekeurde canonieke mapping; anders bekende
officiële externe fallback. UI mag een beschikbare afwijkende editie niet
stilzwijgend presenteren als dezelfde tekst. Welke editie standaard voor
officiële CFM-citaten gebruikt mag worden, moet vóór publicatie vaststaan.
Er wordt geen nieuwe Bijbelvertaling geïmporteerd in dit besluit.

### Q3 — Eerste contenttalen/publicatieomvang (vóór fase 3A)

Vijf UI-vertalingen zijn verplicht voor de implementatie. Dat bepaalt niet
automatisch welke officiële CFM-/FSY-teksttalen direct geïmporteerd/gepubliceerd
moeten worden. Kies de eerste bronedities en completenessgate per taal.
Advies: één volledige, gecontroleerde editie als eerste uitrol; aanvullende
edities op hetzelfde schema. Alleen echt gepubliceerde talen aanbieden,
nooit een lege taaloptie of vertaalde UI als vertaalde broninhoud voorstellen.

### Q4 — Bewaar- en herstelbeleid vóór contract/mediaopruiming

Advies voor eerste uitrol: alle gerefereerde revisies en legacy-FSY-snapshots
behouden; geen automatische media-GC. Bepaal later bewaartermijn van
niet-gerefereerde imports/revisies en de observatieperiode vóór legacycontract.
Privéannotaties behouden totdat eigenaar ze verwijdert of accountdeletebeleid
geldt. Dit blokkeert fase 1/2 niet, wel het definitief wissen van oude inhoud.

De precieze spel-, score- en klassikale regels van Het Verborgen Woord horen bij fase 5,
niet bij goedkeuring van het contentfundament. Beurtvolgorde, gezamenlijk
foutenbudget, pogingen met het hele woord, presentatiescherm en geen gasten bij netwerkspel zijn
al vaste eisen; scoring en latere concurrencydetails worden daar concreet.

## 4. Aannames die technisch gevalideerd moeten worden

| Aanname/onzekerheid | Noodzakelijke verificatie | Moment |
|---|---|---|
| Werkelijk aanwezige FSY-lessen/publicaties/persoonlijke context | Alleen-lezen productie-inventaris met counts/hashes, geen privéschrijfacties | Vóór M3 |
| Officiële CFM-kalender 2026 en stabiele leskeys | Gecontroleerd bronmanifest; geen URL-/weekmodelgok | Vóór fase 3A/import |
| FSY-maand/categorie/lesstructuur en talen | Nieuwe bronfixtures, oude→officiële mapping met ambiguïteitsrapport | Vóór fase 3C |
| Concrete tekst-/mediarechten en verplichte zichtbare attributie | Toestemming als gegeven; exacte voorwaarden per bron/media vastleggen | Vóór import/publicatie |
| Oude collecties met null work en sleutelconflicten | Catalogus/legacy-key-inventaris | Vóór M1/FK |
| Gelijke logische les tussen vertalingen | Officiële id-/sectiemapping, geen titel/offsetheuristiek | Vóór taalpublicatie |
| Image/mime/grootte en ondersteunde bloktypen | Echte lesfixtures en mediavalidatie | Vóór fase 2B/3A |
| Mediavolume/backup en app-rollback | Herstelproef inclusief nieuwe annotaties met null verseId | Vóór activatie betreffende fase |
| Safari/WebView-selectie, keyboard, back en safe areas | Browser/toestelmatrix, concrete screenshots/hit/focustests | Vóór UI-productieacceptatie |
| Spelpoolkwaliteit bij nieuwe bron/les | Taalgebonden extractorfixtures en voldoende inhoud | Vóór fase-5-adapter |

Er is geen aanwijzing dat deze onzekerheden een nieuw framework vereisen.
Wel mogen onbewezen bron-/gegevensaannames niet in migratie-defaults of
publicatie-automatisering terechtkomen.

## 5. Fase-0-reviewbesluit

Te beoordelen: behoudende uitbreidingsrichting, de toegang/identiteitgates,
gescheiden drie statussen, minimale schema-uitbreidingen per fase,
annotatiebehoud en veilige rollback. De zeven documenten zijn één consistent
voorstel; goedkeuring hiervan start geen fase 1 zonder concrete nieuwe opdracht.

Gereed voor beoordeling van fase 0. Er zijn nog geen functionele wijzigingen aan Versado uitgevoerd.
