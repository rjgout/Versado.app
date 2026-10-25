# 06 — Besluiten, aanbevelingen en technische uitrolvoorwaarden

Status: de vier resterende productbesluiten voor fase 0 zijn vastgesteld door
de producteigenaar. Er staan hierover geen productvragen meer open.
Vastgelegde UX-besluiten worden niet opnieuw ter discussie gesteld.
Technische modelnamen/interfaces blijven voorstellen, geen reeds uitgevoerde
implementatie. Deze afronding autoriseert geen fase 1.

**Aanvulling 25 oktober 2026:** de nieuwe CFM-leesvragenopdracht en vaststaande
spelafspraken staan in [31](31-CFM-LEESVRAGEN-XP-EN-VERBORGEN-WOORD.md), met een
afzonderlijke lijst resterende uitwerking en latere productkeuzes (§4). De zeven
CFM-productbesluiten zijn definitief verwerkt in §2 van 31 en P26/P28–P33 hieronder.
Zij zijn geen open vragen meer; technische uitwerking autoriseert geen implementatie.
Uitvoeringsprioriteit: [roadmap A–D](04-IMPLEMENTATION-ROADMAP.md#vervolg-a-d--cfm-leesvragen-eerst).

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
| P22 | Podcasts als herkenbare aparte rij onder Studieprogramma’s | Technisch OTHER; geen wekelijkse leslogica; bestaande functies behouden |
| P23 | Interne previews alleen bij bewezen canonieke én editie-equivalentie | Anders bekende officiële externe bron of nette melding; geen stille vertalingssubstitutie |
| P24 | Eerste CFM-content: volledig gecontroleerd Nederlands, 2026 | Meertalig ontwerp en vijf bestaande UI-talen behouden; andere contenttalen alleen beschikbaar én gepubliceerd aanbieden |
| P25 | Bestaande publicaties, relevante revisies, snapshots, gerefereerde media en persoonlijke annotaties behouden | Geen automatische garbage collection of destructieve contractmigratie zonder afzonderlijk goedgekeurd beleid |
| P26 | Drie vragen per CFM-leesstap volgens de bestaande Boek van Mormon-logica | Hergebruik de bestaande lees-/vragenlogica; uitsluitend documentatie nu, geen implementatie |
| P27 | Het Verborgen Woord: solo/klas, bron-/CFM-gebonden gecontroleerde bank, beurtletters of heel woord, gezamenlijk foutenbudget, hostproxy, gesynchroniseerde presentatie, accountplicht en geen gasten | Nadere definitieve afspraken en open regels in 31; geen gastpatroon of hangmanbeeld; schriftuur + toelichting na afloop |
| P28 | Volledige CFM-weekles biedt dezelfde achttien vragen als de zes stappen | Zelfde oefenset/credits als de volledige-hoofdstukroute; geen aparte drie weekvragen |
| P29 | Bestaande vraagvormen: ontbrekende woorden aanvullen, woorden kiezen en waar/niet waar waar passend | Hergebruik FILL_BLANK, WORD_BANK en TRUE_FALSE; geen nieuw CFM-vraagtype |
| P30 | Vragen op daadwerkelijk gelezen schriftteksten baseren | Concrete passage/editie aan de stap binden; geen lange zelfbedachte uitleg, interpretatievragen of beoordeling van persoonlijke geloofsopvattingen |
| P31 | Bestaande XP-regels volledig overnemen | Eén maximale basisbeloning per inhoud, bestaande bonusvoorwaarden en normale herhalingskorting; geen tweede XP-systeem |
| P32 | Bestaande antwoordcontrole, feedback, correctieronde en voortgangsregistratie hergebruiken | Gedeelde services en routegedrag; geen afzonderlijke CFM-vragenengine |
| P33 | Versado Dorp blijft werken zoals nu | Alleen toekomstige koppeling voorbereiden; geen CFM-groeipunten of wijziging van huidige Dorp-regels |

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
maakt. Geen generieke documentdatabase, workflowdesigner, herbouw van alle
Schrifturenlezers, zoekservice, offlineplatform of toekomstige ranglijst.

## 3. Definitief vastgestelde aanvullende productbesluiten

De voormalige open punten Q1–Q4 zijn gesloten. Hieronder staan de concrete
keuzes en hun gevolgen voor de planning. Bronvalidatie en uitvoeringsbewijs
blijven technische uitrolvoorwaarden; ze heropenen deze productbesluiten niet.

### D1 — Podcasts in de contentkiezer (voorheen Q1, vastgesteld)

Podcasts blijven een herkenbare aparte rij onder de **visuele groep
Studieprogramma’s** in de fullscreen contentkiezer. Technisch blijft de
bronsoort `OTHER`; de visuele indeling maakt podcasts niet tot een programma
met wekelijkse leslogica. Bestaande selectie, cursussen, afleveringen,
voortgang en navigatie blijven behouden. Geen derde primaire navigatiegroep.
Dit is een vaste eis voor fase 1C, geen nog te beoordelen plaatsingsvoorstel.

### D2 — Betrouwbare verwijzingsedities (voorheen Q2, vastgesteld)

Interne previews zijn uitsluitend toegestaan bij **bewezen canonieke én
editie-equivalentie**. De bronadapter bewaart bedoelde canon, editie, taal en
nummering waar bekend. Zonder betrouwbare mapping gebruikt de resolver een
bekende officiële externe bron; als ook die ontbreekt, een nette melding en
beheerdersdiagnose. Geen stilzwijgende substitutie van vertalingen of edities.

De concrete keuze en technische onderbouwing van ondersteunde
verwijzingsedities/mappings is een noodzakelijke voorwaarde voor **fase 2D**
en latere publicatie van lessen. De referentievalidatie toont per verwijzing
een bewezen intern doel, betrouwbare externe fallback of expliciet ontbrekend
doel. Een ontbrekende interne mapping wordt niet als equivalent gepresenteerd.

Dit blokkeert **fase 1A niet**: het bronfundament kan bestaande identiteit en
toegang vastleggen zonder al alle officiële lesverwijzingen te resolveren.
De officiële bronstructuur en concrete mappings zijn in fase 0 niet extern
gevalideerd; die technische controle blijft vereist. Er wordt met dit besluit
geen andere Bijbelvertaling geselecteerd of geïmporteerd.

### D3 — Eerste contenttaal en omvang (voorheen Q3, vastgesteld)

Begin met de **volledige, gecontroleerde Nederlandse Kom dan en volg Mij
2026-content — Oude Testament**. Het bronmanifest en de volledigheidscontrole
voor fase 3A/3B omvatten de echte officiële leskalender, teksten, betekenisvolle
media en verwijzingen. Geen aanname van een vast aantal weken of lessen.

Het ontwerp blijft meertalig; de vijf bestaande UI-talen nl/en/de/fr/es
blijven behouden. Aanvullende contenttalen verschijnen pas als die werkelijk
beschikbaar, gecontroleerd en gepubliceerd zijn. Een vertaalde interface is
geen bewijs van vertaalde lesinhoud. Bestaande FSY- en podcastinhoud blijft
onder het compatibiliteits- en bewaarbeleid behouden.

### D4 — Bewaarbeleid (voorheen Q4, vastgesteld)

Behoud alle bestaande publicaties, relevante revisies, snapshots,
gerefereerde media en persoonlijke annotaties. Rollback wisselt de
publicatiepointer en verwijdert geen historische of persoonlijke gegevens.
Er komt **geen automatische garbage collection of destructieve
contractmigratie zonder afzonderlijk goedgekeurd beleid**. Een observatieperiode
of geslaagde back-up is op zichzelf geen toestemming voor verwijdering.

Dit beleid is definitief voor de huidige planning. Alleen een toekomstige
afzonderlijke opruim-/contractopdracht kan een wijziging toestaan; daar wordt
nu geen bewaartermijn voor ingevuld. Bewuste verwijdering van een eigen
annotatie blijft de bestaande gebruikersactie, geen migratie of garbage collection.

De precieze spel-, score- en klassikale regels van Het Verborgen Woord horen bij fase 5,
niet bij goedkeuring van het contentfundament. Beurtvolgorde, gezamenlijk
foutenbudget, pogingen met het hele woord, presentatiescherm en geen gasten bij netwerkspel zijn
al vaste eisen; scoring en latere concurrencydetails worden daar concreet.

### D5 — Risicoacceptatie bij hervatting fase 1A (vastgesteld na fase 0)

De eigenaar heeft expliciet uitsluitend lezende inventarisatie van de
NAS-productiedatabase in Docker-container `jehova-db` toegestaan. Dagelijkse
volledige Synology Hyper Backup is door de eigenaar bevestigd. Hij kiest
bewust de aanvullende geïsoleerde herstelproef over te slaan. Dit is een
geaccepteerd risico, geen bewijs van daadwerkelijk getest herstel.

Controleer bestaande backupmetadata en database-/mediabereik waar toegang dat
mogelijk maakt; noteer onbekende dekking expliciet. Geen nieuwe backup,
herstelproef, productie-DDL, backfill, seed, import of containerherstart.
De daadwerkelijke inventaris moet nog steeds worden beoordeeld voordat de
additieve ContentWork/publicatie-migratie in de PR wordt uitgewerkt. De
migratie wordt uitsluitend geïsoleerd getest; productie-uitrol vereist
afzonderlijke beoordeling. Normale API's geven ook beheerders normale
leesrechten; uitgebreide previewrechten vereisen een expliciete beheerroute.
De actuele bewijstoestand en technische blokkades staan in [fase-1A-status](07-PHASE-1A-STATUS.md).

## 4. Aannames die technisch gevalideerd moeten worden

| Aanname/onzekerheid | Noodzakelijke verificatie | Moment |
|---|---|---|
| Werkelijk aanwezige FSY-lessen/publicaties/persoonlijke context | Alleen-lezen productie-inventaris met counts/hashes, geen privéschrijfacties | Vóór M3 |
| Officiële CFM-kalender 2026 en stabiele leskeys | Gecontroleerd bronmanifest; geen URL-/weekmodelgok | Vóór fase 3A/import |
| FSY-maand/categorie/lesstructuur en talen | Nieuwe bronfixtures, oude→officiële mapping met ambiguïteitsrapport | Vóór fase 3C |
| Concrete tekst-/mediarechten en verplichte zichtbare attributie | Toestemming als gegeven; exacte voorwaarden per bron/media vastleggen | Vóór import/publicatie |
| Betrouwbare canonieke en editie-equivalente verwijzingsmappings | Bedoelde bron/taal/nummering bewijzen; intern/externe fallback/melding met fixtures controleren | Vóór fase 2D en latere lespublicatie; geen gate voor fase 1A |
| Oude collecties met null work en sleutelconflicten | Catalogus/legacy-key-inventaris | Vóór M1/FK |
| Gelijke logische les tussen vertalingen | Officiële id-/sectiemapping, geen titel/offsetheuristiek | Vóór taalpublicatie |
| Image/mime/grootte en ondersteunde bloktypen | Echte lesfixtures en mediavalidatie | Vóór fase 2B/3A |
| Mediavolume/backup en app-rollback | Herstelproef inclusief nieuwe annotaties met null verseId | Vóór activatie betreffende fase |
| Safari/WebView-selectie, keyboard, back en safe areas | Browser/toestelmatrix, concrete screenshots/hit/focustests | Vóór UI-productieacceptatie |
| Spelpoolkwaliteit bij nieuwe bron/les | Taalgebonden extractorfixtures en voldoende inhoud | Vóór fase-5-adapter |

Er is geen aanwijzing dat deze onzekerheden een nieuw framework vereisen.
Wel mogen onbewezen bron-/gegevensaannames niet in migratie-defaults of
publicatie-automatisering terechtkomen.

## 5. Afronding van fase 0

De vier resterende productbesluiten zijn definitief verwerkt. De zeven
documenten vormen het fase-0-ontwerp met gescheiden lees-/oefenstatus,
behoudende schema-uitbreidingen, annotatiebehoud en veilige rollback.
Technische bronvalidatie, inventaris, herstelproeven en fasegebonden tests
blijven vereist. Fase 1 begint uitsluitend na een concrete nieuwe opdracht;
deze documentatieafronding start geen implementatie en merge naar main.

Gereed voor beoordeling van fase 0. Er zijn nog geen functionele wijzigingen aan Versado uitgevoerd.

### Bewijstoestand hervatting 1A

De eigenaar heeft de echte admininventarisatie van 2026-10-11T18:51:50.752Z
aangeleverd. Zod, identiteitsanalyse en migratiechecksums zijn offline gecontroleerd:
21 collecties, zeven werken, geen null-work/conflicten of gemeten relatiegaten.
De inventarisatieblokkade is opgeheven. De additieve 1A-migratie wordt uitsluitend
in een wegwerpdatabase getest. Het overslaan van de aanvullende backupherstelproef
blijft expliciete risicoacceptatie; backupmetadata en herstelbaarheid zijn niet
bewezen. Geen nieuwe productiequery, migratie, seed, import, restart of deploy
in deze opdracht. Afzonderlijke productie-uitroltoestemming blijft nodig wegens
automatische Prisma-migraties bij appstart. Details: [status](07-PHASE-1A-STATUS.md).
