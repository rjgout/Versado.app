# CFM — verwijzingen en navigatie vereenvoudigd

Bouwt voort op `CFM-TECHNICAL-FINALIZATION.md` (PR #158). Geen wijziging aan officiële teksten, afbeeldingen, revisies of de
zesstappenindeling; geen migratie; geen productie-import.

## 1. Welke verwijzingen waren defect, en waarom

Onderzocht aan de hand van de gepinde bronbestanden (`data/study-content/cfm-2026-nl/source/*.json`, door dezelfde adapterfunctie
`cfmReferenceTarget` gehaald als bij de import) en de resolver. Alles hieronder staat als regressietest in
`tests/cfm-references.test.ts`.

| Soort | Aantal in de bron | Vóór | Oorzaak | Nu |
|---|---|---|---|---|
| Bijbel (Oude Testament) | 2033 voorkomens | intern (OTB), 1960 (96%) | — | ongewijzigd; Engelse namen toegevoegd |
| Bijbel (Nieuwe Testament) | 209 | geblokkeerd | bewuste beoordeling: geen editiesubstitutie | ongewijzigd geblokkeerd |
| Boek van Mormon, Leer en Verbonden, Parel van Grote Waarde | 486 | **altijd extern** (kerkwebsite) | de adapter schrijft alleen voor Bijbelverwijzingen werk/editie/taal in het doel; de resolver eiste die metadata. Daarnaast weigerde `parseScriptureUrl` elke URL met `%`/komma, dus samengestelde verwijzingen konden niet intern | **477 intern**, 9 extern (zie §2) |
| Lofzangen (`/study/manual/hymns/<slug>`, `/media/music/songs/<slug>`) | 68 | extern of niet-klikbaar | geen koppeling met het eigen zangboek | 63 koppelbaar via lofzang-id (57 klikbaar, 6 blijven geblokkeerd); zie §3 |

## 2. Standaardwerken

* `evidence.ts` (`parseScriptureUrl`): een samengestelde selectie (`id=p21-p29%2Cp38-p42`) is een oplopende, niet-overlappende lijst van
  bereiken; `%2C` is de enige toegestane procentcodering. Alles anders (andere codering, omgekeerde of overlappende bereiken, onbekend
  boek of hoofdstuk, fragment buiten het bereik) blijft `null`.
* `standardWorks.ts` (`labelMatchesPassage`): een doel zonder metadata (alle al gepubliceerde revisies, geen re-import nodig) wordt alleen
  intern als het **label exact dezelfde passage noemt als de bron-URL** (boek, hoofdstuk, verzen), of alleen verzen/hoofdstuknummer ("53–57", "122")
  of een geloofsartikel ("vierde geloofsartikel"). Nederlandse en Engelse namen en afkortingen (1 Ne., LV, L&V, D&C, Moses, …). Het label is
  nooit de bron van het doel; het bewijs per hoofdstuk (`scripture-evidence.json`, hash van de lokale tekst) blijft de enige toegang tot de
  lokale tekst. Een expliciet doel (met `workKey`) gedraagt zich ongewijzigd.
* Blijft bewust extern (nette fallback naar de officiële bron): hoofdstukbereiken over meerdere hoofdstukken (1 Nephi 1–2, 3 Nephi 3–4,
  Mozes 2–3, Mozes 4–5, Abraham 1–2, Abraham 4–5, Moroni 4–5), "vers 53–65" waar de bron-URL 48–68 bedoelt (label ≠ URL), en het titelblad
  van het Boek van Mormon (geen hoofdstuk). Bundels over meerdere hoofdstukken zijn een mogelijk vervolg.
* Bijbel: Engelse namen en afkortingen zijn toegevoegd aan de bestaande Nederlandse tabel (`otb.ts`), met dezelfde ondubbelzinnigheidscontrole.

## 3. Lofzangen

* Stabiele sleutel: het officiële lofzang-id (slug) staat in het zangboek (`manifest.hymns[].slug`) én in de bron-URL; het lofzangnummer
  binnen het Nederlandse zangboek (`nld-lofzangen`) is de sleutel van de koppeling, nooit de zichtbare titel (`references/hymns.ts`).
  Dubbele of onbekende slugs geven geen koppeling.
* Alleen exact `/study/manual/hymns/<slug>` of `/media/music/songs/<slug>` (https, host `www.churchofjesuschrist.org`, geen extra
  parameters, `lang` ontbreekt of is `nld`).
* Resolutie (`withHymnLink`, alleen in het gebruikerspad `referenceInTransaction`): een bewezen externe lofzangverwijzing wordt een
  `hymn`-resolutie **als Lofzangen voor deze gebruiker beschikbaar is** (`getHymnsAccess`: beheerbare zichtbaarheid, technische noodstop
  `HYMNS_POC=0` geldt ook voor beheerders). Anders blijft de bewezen externe bron. De preview toont "Lofzang N · titel" met "Lofzang
  openen" (`/dev/lofzangen?lofzang=N`, de pagina valideert het nummer en opent de lofzang één keer, net als een keuze uit de lijst) en de
  externe bron als tweede keuze.
* Niet gekoppeld (blijven zoals ze waren): kinderliederen (`childrens-songbook` en vier `media/music/songs/*` zonder zangboeknummer: Zoek de
  Heer, Als ik gedoopt ben, Volg de profeet, Bij zijn wederkomst), het lofzangenoverzicht ("topics") en lofzangen die niet in het
  Nederlandse zangboek staan. De 6 `media/music/songs/*`-verwijzingen die in de
  importbeoordeling als *handmatige beoordeling* zijn geblokkeerd, blijven niet-klikbaar tot een expliciete revisiebeoordeling (regel in CLAUDE.md).

## 4. Navigatie Stap voor stap

* De hoofdterugknop (`SubpageBackBar` met `ReaderBackTarget`, niet-zacht) gaat met `router.replace` naar het leerpad van de cursus
  (`/courses/<id>/pad`, `cfmCoursePathTarget`: collectie + leeswijze) is sinds §18 van `docs/CFM-PERSOONLIJKE-STUDIE.md` alleen de veilige terugval; de hoofdterugknop volgt de werkelijke herkomst (browser-terug), zodat Vandaag → les → terug weer op Vandaag uitkomt.
  Zonder cursus (nog niet aangemaakt) valt de balk terug op het cursusoverzicht.
* Vrije studie en de volledige les: zelfde bestemming (leerpad van Vrije studie) maar **zacht**: browser-terug als er een vorige pagina in de app is.
* Stapnavigatie: stap 1 heeft geen "vorige", stap 6 heeft geen "volgende" maar "Terug naar het leerpad".

## 5. Driepuntjesmenu en tussenpagina's

| Onderdeel | Besluit |
|---|---|
| Driepuntjesmenu in de stapweergave | verwijderd |
| Opnieuw bovenaan beginnen | in de stapweergave vervallen; blijft in het menu van Vrije studie/volledige les |
| Volledige les bekijken | in de stapweergave vervallen; bereikbaar via het menu van Vrije studie (`?weergave=volledig`) |
| Stappenoverzicht (menu-item en pagina) | verwijderd; `/stappen` stuurt als redirect naar de stap waar je verder kunt (`activeStepIndex`), zodat bestaande links en "Ga verder" werken |
| Week kiezen | vervallen in de stapweergave (de hoofdterugknop gaat naar het leerpad); in Vrije studie wijst het naar het leerpad |
| Link "Terug naar weekoverzicht" onder de titel | verwijderd (dezelfde functie als de hoofdterugknop) |
| Weekkaart → stap | rechtstreeks (zes stapknoppen); de link "Stappen van deze week" naar het overzicht is verwijderd |
| Behouden | zes stappen en voortgangsindicator, stapnavigatie, leespositie en synchronisatie (incl. de melding over een nieuwere versie/positie), annotaties en bladwijzers, schriftverwijzingen, leesinstellingen, stap afronden |

## 6. Tests

`tests/cfm-references.test.ts` (echte bronverwijzingen), `tests/cfm-step-navigation.test.ts`, `tests/reference-resolver.test.ts` (aangepast voor
samengestelde selecties), `tests/reference-resolver.integration.test.mjs` (label-afgeleide interne resolutie), `tests/cfm-courses.integration.test.ts`
(terugbestemming), `tests/cfm-personal.browser.mjs` (geen menu/tussenpagina, hoofdterugknop met en zonder geschiedenis, eerste en laatste stap).

## 7. iPhone-testchecklist

1. Leren → Stap voor stap → weekkaart → een stapknop: je komt direct in de stap (geen tussenscherm).
2. In de stap: geen driepuntjesmenu en geen "Terug naar weekoverzicht". Stap 1 heeft alleen "Volgende stap"; stap 6 heeft "Terug naar het leerpad".
3. Hoofdterugknop linksboven → het leerpad (ook na meerdere stappen, ook als je de stap via een link opende).
4. Een verwijzing naar het Boek van Mormon / Leer en Verbonden / Parel van Grote Waarde (ook "1 Nephi 13:21–29, 38–42") toont de tekst in Versado met "Meer lezen"; een hoofdstukbereik (bv. Mozes 2–3) opent de officiële bron.
5. Een verwijzing naar een lofzang (bv. "Nader, mijn God, tot U"): "Lofzang openen" opent die lofzang; zonder toegang tot Lofzangen blijft de officiële bron.
6. Vrije studie: menu (opnieuw beginnen, volledige les) werkt; terugknop volgt de browsergeschiedenis.
7. Nieuwe versie/positie op een ander apparaat: de melding blijft verschijnen.

> **Bijgewerkt:** de eerdere regel "hoofdterugknop = vast leerpad, nooit `router.back()`" is vervallen; zie het navigatiecontract in `docs/CFM-PERSOONLIJKE-STUDIE.md` §18.

> **Verouderd (vervangen door `docs/CFM-PERSOONLIJKE-STUDIE.md` §18):** de hoofdterugknop is niet langer een vaste bestemming; de werkelijke herkomst heeft voorrang (`src/lib/studyOrigin.ts`) en het weekpad is alleen de veilige terugval. De regels hierboven over `cfmCourseBackTarget` en "nooit `router.back()`" gelden niet meer.
