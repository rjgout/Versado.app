# Samen: vriendenreeksen, groepen en seintjes

Versado beloont samen volhouden, niet onderlinge competitie.

- **Vriendenreeksen** zijn bewust streng en persoonlijk: twee vrienden houden
  allebei hun reeks vast.
- **Groepsreeksen** zijn bewust tolerant en gezamenlijk: genoeg leden samen,
  niet iedereen.
- **Seintjes** zijn lichte sociale duwtjes, geen chat.
- Een **geschonken reeksbevriezing** beschermt de groep alleen als dat echt
  nodig blijkt.

Code: `src/lib/social/`, schermen in `src/components/social/` en
`src/app/groups/`, tests met `npm run test:social`.

## De bron: de persoonlijke reeks

Er is één regel voor wat een geldige dag is, en die zit in de persoonlijke
reeks (`recordLearningActivity`, zie `docs/LEERVOORTGANG.md`). Samen voegt
daar niets aan toe en verandert er niets aan:

```
geldige activiteit → persoonlijke reeks (StreakDay) → sociale reeksen
```

Iemand draagt op dag D bij als hij een `StreakDay` heeft voor zijn eigen
kalenderdag D, gestudeerd (`STUDIED`) of bevroren (`FROZEN`, een persoonlijke
reeksbevriezing). Een sociale reeks heeft dus geen eigen oefeningen,
activiteitsregels of XP. Bijdragen aan een groep, een seintje geven of een
bevriezing schenken levert nooit XP op.

### Wanneer is een dag definitief? (`rules.ts`)

Een bevroren dag krijgt pas een rij als de dag voorbij is (reeksafsluiting in
`scheduler.ts`, of de volgende studiedag). "Geen rij" is daarom pas
definitief "niet behouden" als:

- D in beide tijdzones van de reeksregel voorbij is (de huidige, en die van
  de laatste reeksdag; zie `docs/TIJD.md`);
- en de eigen reeks die dag al heeft verwerkt (geen lopende reeks met een
  oudere laatste dag meer).

Het uiterste moment is wanneer D overal ter wereld voorbij is (`dayOverEverywhere`).

`resolveSocialDay` is de gedeelde uitkomst voor vriend- en groepsreeks:

- **gehaald**: genoeg bijdragen. Dat kan al tijdens de dag en is daarna
  definitief.
- **beschermd**: het doel is niet gehaald, maar er was een bevriezing aangeboden.
- **gepauzeerd**: minder dan 3 leden telden mee.
- **gemist**: geen van de bovenstaande.

## Vriendenreeks (`friendStreaks.ts`)

- Altijd precies twee vrienden. Uitnodigen en accepteren (`PENDING` → `ACTIVE`).
- Per paar hooguit één open of lopende reeks: `openKey` is uniek en wordt
  `null` zodra de reeks stopt.
- Een dag telt als beiden die dag hun reeks behielden, ieder op de eigen
  kalenderdag. Er is bewust geen compensatie voor tijdzoneverschillen.
- De eerste dag is de nieuwste "vandaag" van de twee op het moment van
  accepteren. Hebben ze die dag al allebei gestudeerd, dan telt hij meteen.
- Maximaal 5 actieve reeksen per persoon. Uitnodigen en accepteren
  controleren dat onder rijvergrendeling.
- Een lopende reeks kun je niet zelf stoppen. Hij stopt pas als hij verbreekt
  (`BROKEN`, de plek komt vrij), of als de vriendschap eindigt (`ENDED`).
- Prestaties `friend-streak-1/7/30/100/365`, op basis van de langste
  vriendenreeks die je ooit had. Ze blijven dus staan na een breuk.

## Groepen (`groups.ts`, `groupStreak.ts`, `groupFreeze.ts`)

Een groep heeft bewust **geen type**: een naam, leden, beheerders,
instellingen, een reeks, prestaties en geschiedenis. Wat het is (gezin, klas,
wijk), bepalen de mensen zelf.

### Limieten

De limieten staan in `rules.ts`. Ze worden gecontroleerd in één transactie
met rijvergrendeling, altijd eerst gebruikers en dan de groep:

- maximaal 500 leden per groep (`GROUP_MAX_MEMBERS`);
- maximaal 10 groepen per persoon;
- minimaal 3 leden die meetellen, anders is de reeks gepauzeerd;
- 7 dagen wachttijd na vertrekken of verwijderd worden. Een uitnodiging
  omzeilt die niet: accepteren controleert alles opnieuw.

### Hoeveel leden moeten bijdragen?

```
requiredPercentage   = 45 + 55 / sqrt(n)
requiredContributors = ceil(n × requiredPercentage / 100)   (bij n = 3: altijd 3)
```

Voorbeelden: 4 → 3, 10 → 7, 25 → 14, 100 → 51, 500 → 238. Er is één
functie, `requiredContributors`. De app toont aantallen ("11 van 15 nodig",
"Nog 4 nodig"), nooit het percentage.

### Wie telt mee op een groepsdag?

- Een lid telt mee vanaf `GroupMembership.eligibleFromDay`. Dat is de dag na
  de nieuwste kalenderdag die bij het toetreden al bij een van de leden was
  begonnen. Zo verandert het vereiste aantal van een lopende dag nooit door
  een nieuwkomer.
- Vertrekken of verwijderd worden telt direct: het lid valt uit de lopende
  dag.
- Afgesloten dagen (`GroupDay.settledAt`) veranderen nooit meer. Een gehaalde
  dag blijft gehaald.
- Historische dagen tellen niet als persoonlijke bijdrage van een nieuwkomer.
  "Jouw bijdrage" telt alleen afgesloten, niet-gepauzeerde dagen vanaf de
  eigen instapdag.

### Bijwerken van de groepsreeks

Bijwerken is idempotent en veilig om vaak aan te roepen:

- De groep wordt vergrendeld met `FOR UPDATE SKIP LOCKED`.
- **Live**: een open dag met genoeg bijdragen wordt meteen `ACHIEVED`. De
  reeks gaat dan +1.
- **Afsluiten**: de oudste open dag (`nextDay`) wordt definitief zodra
  iedereen die meetelt hem voorbij is (`nextCheckAt`). De uitkomst is
  gehaald, beschermd (reeks blijft staan), gepauzeerd (reeks blijft staan)
  of gemist.
- Bij gemist wordt de reeks **onderbroken**: `SocialGroup.streakInterruptedDay`
  wordt gevuld, maar `currentStreak` en de opgebouwde waarde blijven staan.
  Extra gemiste dagen veranderen die waarde niet.
- De eerstvolgende normale dag die het doel haalt, zet de reeks voort en telt
  precies één dag op. Er is voor een groep geen aparte herstelopdracht en geen
  deadline.

Dit gebeurt op drie momenten:

- elke minuut in `scheduler.ts` (`runSocialTick`): nieuwe `StreakDay`-rijen
  sinds de vorige tick, en groepen waarvan een dag afgesloten kan worden;
- bij het openen van de groepspagina;
- elk uur voor de beheerders.

Tellingen gaan per groep in één query (`groupDays.ts`), ook bij 500 leden.

**Schaal van de minuuttaak.** Elke stap zoekt via een index alleen wat nu
relevant is:

- **Nieuwe reeksdagen**: `StreakDay.createdAt` (index) sinds de vorige
  ronde. Alleen de groepen en vriendenreeksen van die mensen worden
  bijgewerkt.
- **Af te sluiten groepsdagen**: groepen met `nextCheckAt <= nu` (index).
  `nextCheckAt` is het moment waarop de open dag voor alle leden voorbij
  is. Wacht een dag nog op een paar leden (bv. na een tijdzonewissel), dan
  bepalen alleen hún tijdzones de volgende poging. Alleen als het nog op de
  eigen reeksafsluiting wacht, wordt het over een minuut opnieuw
  geprobeerd.
- **Vriendenreeksen**: hetzelfde patroon met `FriendStreak.nextCheckAt`
  (index op status + nextCheckAt).
- **Beheerders, elk uur**: eerst alleen de beheerders zelf en een telling
  per groep (`adminMaintenanceCandidates`). Alleen groepen met een inactieve
  of ontbrekende beheerder laden daarna hun leden.

### Statussen van een groepsreeks

- **actief**: de groep kan een normale groepsdag halen;
- **beschermd**: de dag werd niet gehaald, maar een aangeboden
  reeksbevriezing houdt de reeks actief;
- **gepauzeerd**: minder dan drie leden tellen voor die dag mee; er wordt
  niets verloren en de reeks schuift niet op;
- **onderbroken**: een dag werd gemist zonder groepsfreeze. De oude waarde
  blijft bewaard en wordt hervat zodra de groep weer één normale groepsdag
  behaalt.

Een groepsfreeze voorkomt dus een onderbreking, maar is geen extra reeksdag.
Een onderbroken groep hoeft alleen weer samen de bestaande
`requiredContributors()`-voorwaarde te halen.

### Tijdelijke pauze van een groepslid

Een groepsbeheerder kan een ander lid voor maximaal 30 dagen pauzeren voor de
groepsreeks. Het lid blijft lid, houdt zijn rol en sociale functies, en de
persoonlijke reeks wordt niet geraakt. De pauze begint pas op de eerstvolgende
veilige groepsdag en verandert lopende of afgesloten `GroupDay`-rijen nooit.

Een lid telt tijdens de pauze niet mee voor `requiredContributors()`. Als er
minder dan drie leden overblijven, geldt gewoon de bestaande status
`PAUSED`. Na afloop telt het lid vanaf de juiste volgende groepsdag weer mee.
Na het einde geldt per groep en lid een cooldown van 30 dagen voordat opnieuw
een pauze kan worden ingesteld. Een echte geldige studieactiviteit tijdens de
actieve pauze beëindigt die pauze automatisch voor toekomstige groepsdagen;
een persoonlijke bevriezing doet dat niet. Er is geen automatische pauze of
inactiviteitsregel voor gewone leden.

Er wordt dus nooit elke minuut over alle gebruikers, groepen of leden
gelopen. Een groep van 500 leden kost per afgesloten dag één keer het laden
van de leden, en verder alleen telqueries.

### Geschonken reeksbevriezing

- Een lid biedt een eigen reeksbevriezing aan voor de groepsdag van vandaag
  (de eigen kalenderdag). Hij wordt meteen apart gezet (`GROUP_RESERVED`,
  freezeCount −1), zodat hij niet ook elders gebruikt kan worden.
- Hooguit één per groepsdag (uniek op groep + dag). Een tweede gelijktijdige
  poging faalt zonder iets af te schrijven.
- Haalt de groep het doel alsnog, dan gaat hij terug (`GROUP_RELEASED`) en
  krijgt de aanbieder "Niet nodig!". Er volgt geen wachttijd.
- Is de dag gemist, dan wordt hij gebruikt (`CONSUMED`). De reeks blijft
  staan maar telt niet op (184 blijft 184). Eén bevriezing beschermt één dag,
  hoeveel mensen er ook ontbraken.
- Na gebruik geldt 30 dagen wachttijd voor die persoon in die groep. Die volgt
  uit de `CONSUMED`-rijen zelf, dus vertrekken en terugkomen zet hem niet
  terug. Anderen en andere groepen kunnen gewoon.
- Vertrekt de aanbieder, dan gaat de bevriezing terug (`CANCELLED`).

### Beheerders

- De maker is beheerder. Er kunnen meerdere beheerders zijn, en er blijft
  altijd minstens één.
- Een beheerder kan eerst de beheerdersrol afnemen en daarna verwijderen;
  een beheerder rechtstreeks verwijderen kan niet.
- Een beheerder die 14 dagen op rij niet studeerde, wordt weer gewoon lid
  (een bevroren dag is geen activiteit). Een andere beheerder kan hem later
  opnieuw beheerder maken.
- Is er geen beheerder meer, dan wordt automatisch een actief lid gekozen:
  eerst de grootste bijdrage aan de huidige groepsreeks, bij gelijke stand
  wie het langst lid is.

### Privacy en ranglijst

- Een groep is standaard privé. `showOnLeaderboard` (alleen beheerders) zet
  hem op de openbare groepsranglijst. Daar staan naam, aantal leden, reeks en
  het aantal prestaties.
- De ledenlijst is alleen zichtbaar voor leden.
- Via de ranglijst kun je geen mensen vinden of vriendschapsverzoeken sturen.
- Uitnodigen kan alleen voor eigen vrienden. Gewone leden kunnen alleen
  uitnodigen als de beheerders `membersCanInvite` aanlaten (standaard aan).
- Vanuit de ledenlijst kun je een vriendschapsverzoek sturen aan leden die
  nog geen vriend zijn.

### Groepslink en QR-code (`joinLinks.ts`)

Een groeps-QR is een veilige voordeur naar een besloten groep, geen sleutel
waarmee iemand rechtstreeks naar binnen kan. Er zijn daarom twee manieren
om lid te worden.

- **Persoonlijke uitnodiging** (bestond al): een lid nodigt een eigen
  vriend uit, die accepteert.
- **Groepslink of QR**: iemand vraagt toegang, en een bevoegd persoon uit de
  groep laat hem binnen. De link maakt nooit zelf lid.

#### Token

- Een beheerder zet de link aan in Groepsinstellingen. De link is
  `/uitnodiging/groep/<token>`. Het token bestaat uit 32 willekeurige bytes
  (256 bits, als base64url 43 tekens), staat in `SocialGroup.joinLinkToken`
  (uniek) en bevat geen groeps-id of naam.
- De QR-code bevat precies die link. Er is geen tweede token, dus intrekken
  geldt voor link en QR samen.
- **Intrekken** zet het token op `null`: oude links en QR-codes (bv. op een
  poster) werken meteen niet meer. Opnieuw aanzetten geeft altijd een nieuw
  token. Een ingetrokken token komt nooit terug, want er wordt nooit een
  oud token hergebruikt en 256 willekeurige bits botsen in de praktijk niet.
- Een misvormd, ingetrokken of onbekend token geeft dezelfde neutrale
  melding ("Deze groepslink is niet meer geldig."), zonder naam, leden of
  reeks. Gokken op tokens of groeps-id's levert dus niets op.
- Link en ranglijst staan los van elkaar. Een privégroep met een link blijft
  privé, en een openbare groep op de ranglijst is zonder link of uitnodiging
  niet aan te vragen.

#### Wat iemand met de link ziet (`groupLinkView`)

| Situatie | Wat er gebeurt |
|---|---|
| Niet ingelogd | Alleen "Open deze uitnodiging in Versado" met Inloggen en Account maken, geen enkel groepsgegeven. |
| Al lid | Rechtstreeks naar `/groups/<id>`, zonder nieuw verzoek. |
| Anders | Een beperkte voorpagina, zie hieronder. |

De voorpagina toont:

- naam, groepsreeks, aantal leden en de groepsprestaties;
- eerst de eigen vrienden die al lid zijn;
- kent hij niemand, dan alleen de beheerders, met naam en avatar maar zonder
  id of nummer;
- nooit de ledenlijst, bijdragen, instellingen of geschiedenis;
- één knop: "Vraag om mee te doen". Er is geen formulier en geen bericht.

**Terug na inloggen**: inloggen en registreren krijgen `?next=` mee.
Registreren onthoudt het doel ook in de browser (`src/lib/returnTo.ts`, 24
uur), omdat de weg via de e-mailbevestiging en een nieuwe inlog loopt. Er
worden alleen paden binnen de app geaccepteerd.

#### Toegangsverzoeken

Een verzoek (`GroupJoinRequest`) hoort bij de groep, niet bij één persoon,
zodat het niet blijft hangen als iemand niet actief is.

- **Afhandelen**: beheerders handelen alle verzoeken af. Een gewoon lid
  handelt alleen het verzoek van zijn eigen vriend af, en alleen als
  "Leden mogen verzoeken van vrienden goedkeuren" aan staat (standaard aan).
  Een gewoon lid ziet nooit onbekende aanvragers.
- **Dubbel**: hooguit één open verzoek per persoon per groep (unieke
  `openKey`), ook bij twee klikken tegelijk.
- **Spam**: na een weigering kan iemand
  `JOIN_REQUEST_DECLINE_COOLDOWN_DAYS` (3) dagen niet opnieuw vragen. Over
  alle groepen samen zijn hooguit `JOIN_REQUEST_HOURLY_LIMIT` (5) nieuwe
  verzoeken per uur toegestaan. Beide staan in `rules.ts` en gelden per
  database, dus ook na een herstart. Iemand wordt nooit voor altijd
  geblokkeerd.
- **Goedkeuren** (`decideJoinRequest`): in één transactie met dezelfde
  vergrendeling als elke toetreding (eerst de aanvrager, dan de groep)
  worden opnieuw gecontroleerd:
  - de rechten van wie goedkeurt;
  - of het verzoek nog openstaat;
  - via de gewone `joinTx`: een bestaand lidmaatschap, 7 dagen wachttijd,
    10 groepen en 500 leden.

  Gaat er iets mis, dan rolt alles terug en blijft het verzoek open. Bij twee
  gelijktijdige goedkeuringen ontstaat één lidmaatschap; de tweede krijgt
  "al afgehandeld". Na toelating gelden de gewone regels: het nieuwe lid telt
  pas vanaf de volgende groepsdag mee.
- **Andere weg**: wordt iemand langs een andere weg lid (persoonlijke
  uitnodiging), dan sluit een open verzoek vanzelf (`CANCELLED`).
- **Na intrekken**: openstaande verzoeken blijven bestaan als de link wordt
  ingetrokken. Ze zijn al gedaan, en een bevoegd persoon beslist erover.

Meldingen:

- een nieuw verzoek gaat alleen naar wie het mag afhandelen
  (`joinRequestRecipients`): de beheerders, plus leden die vriend van de
  aanvrager zijn als dat mag. Nooit naar de hele groep;
- de aanvrager hoort "Je bent toegelaten tot …" of een neutrale melding na
  een weigering.

## Seintjes (`nudges.ts`)

- Generiek opgezet (`NudgeContext`). De context bepaalt alleen de tweede
  regel van de melding. Spellen kunnen het later ook gebruiken.
- Alleen tussen vrienden, ook binnen een groep. Er is geen knop om alle
  inactieve leden tegelijk een seintje te geven.
- Hooguit één per 6 uur per richting. Dit gaat via één atomaire
  insert-of-update op `Nudge`, die alleen het laatste seintje bewaart. Er is
  bewust geen teller en geen geschiedenis.
- De instelling "Seintjes van vrienden" (`User.nudgesEnabled`, standaard aan)
  staat bij de meldingen in het profiel. Staat hij uit, dan toont de app bij
  die vriend geen seintjesknop.

## Meldingen

Meldingen gaan via `notify.ts`, met de bestaande voorkeuren (categorie
"social").

- **Persoonlijk**, als gewone melding met push en e-mail volgens de
  voorkeuren: uitnodigingen, toegangsverzoeken voor wie ze mag afhandelen,
  toegelaten of geweigerd, seintjes en nieuwe beheerder. Daarbij horen ook
  de twee meldingen voor wie een reeksbevriezing aanbood: "Niet nodig!" en
  "Je hebt de reeks gered!". Die gaan alleen naar de aanbieder.
- **Groepsbreed**, zoals "Thomas heeft de reeks gered!": alleen in het
  meldingencentrum, in één keer (`notifyGroupMembersInApp`), zonder push of
  e-mail. Zo wordt een groep van honderden leden niet bestookt.
- Een aangeboden bevriezing staat op de groepspagina, niet in een melding.

## Geschiedenis (`SocialEvent`)

Vanaf de eerste versie wordt elke betekenisvolle gebeurtenis vastgelegd, voor
een latere tijdlijn:

- groep gestart, lid erbij of weg, beheerderswissels;
- reeks gestart, dag gehaald, perfecte dag, mijlpaal, onderbroken, voortgezet,
  gepauzeerd of hervat;
- lid tijdelijk gepauzeerd of vroegtijdig door activiteit hervat;
- bevriezing aangeboden, teruggegeven of gebruikt, en wie de reeks redde;
- de dagen, mijlpalen en breuk van vriendenreeksen.

Een tijdlijnscherm is er nog niet.

## Prestaties

- **Vriendenreeksen**: prestaties per gebruiker (`Achievement`), zonder XP.
- **Groepen**: prestaties per groep (`GroupAchievement`). Dat zijn eerste dag,
  7, 30, 100 en 365 dagen, iedereen deed mee (perfecte dag), een perfecte week
  en samen gered.
- Alles wordt maar één keer toegekend (unieke sleutels) en blijft staan na een
  breuk.
- "Samen gered" kan een groep maar één keer verdienen. Er is dus geen reden om
  expres een dag te laten lopen.
