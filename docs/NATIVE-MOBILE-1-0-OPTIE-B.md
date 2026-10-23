# Mobile 1.0 — scope optie B en voorgestelde pariteitsuitzonderingen

Status: **voorstel**. De eigenaar heeft optie B gekozen als planningsgrondslag (D1). De uitzonderingen hieronder zijn
nog **niet** doorgevoerd in `docs/NATIVE-FEATURE-PARITY.md` of `docs/native-feature-parity.inventory.json`; dat gebeurt
alleen na uitdrukkelijke goedkeuring per onderdeel, met testbewijs (zie `docs/NATIVE-FEATURE-PARITY.md`). Tot die tijd
blijven alle niet-geïmplementeerde functies als native achterstand geregistreerd.

## 1. Scope van Mobile 1.0 (optie B)

In scope voor de store-release: Vandaag, Leren (cursusoverzicht en leespaden), lezen, oefeningen, voortgang (XP, reeks,
beloningsweergave zoals de server die levert), profiel en instellingen, bestaande hoofdstukaudio, en CFM ("Kom dan en
volg Mij": Stap voor stap en Vrije studie). Daarnaast de verplichte store-onderdelen: accountverwijdering, juridische
toegang, minimale versie-melding, privacy en storemetadata (WP4, WP5, WP16).

Buiten 1.0 (volgt later): alle spellen en live multiplayer, Samen/sociaal (vrienden, groepen, seintjes), Lofzangen, Dorp,
Mijn studiemap als aparte ingang (annotaties blijven wel werken waar de lezer ze toont), pushmeldingen, FSY-lezer.

## 2. Voorgestelde tijdelijke pariteitsuitzonderingen (ter goedkeuring)

| Gebied | Webgedrag | Voorgestelde native uitzondering voor 1.0 | Voorwaarden | Vervolg |
|---|---|---|---|---|
| Spellen (Woordzoeker, Scrabble, Slimste Heilige, Raad het hoofdstuk, Legpuzzel, Vliegende gids, Mysteries, Snelle Zendeling) | Volledig | Niet aanwezig in de native app; geen dode ingang | Navigatie toont ze niet; geen verwijzing die naar een lege plek leidt; webversie blijft volledig | WP17 na 1.0 |
| Live multiplayer-quiz en Samen studeren | Volledig | Niet aanwezig | Realtime-handshake blijft werken voor wat er wel is; geen half spel | WP17/WP18 |
| Vrienden, groepen, seintjes, uitnodigingslinks | Volledig | Niet aanwezig | Server-contracten ongewijzigd; geen native uitnodigingslink die in niets eindigt | WP18 |
| Lofzangen | Beheerd, standaard verborgen | Niet aanwezig | Microfoon wordt in 1.0 niet gevraagd (geen extra permissie) | Na 1.0 |
| Pushmeldingen | Webpush | Niet aanwezig (D6) | Geen permissieprompt; instellingenscherm verwijst niet naar push | WP12 |
| Dorp, kaartpersonalisatie (verbergen/volgorde) | Volledig | Alleen weergave van wat de server levert; geen bewerking | Verbergen verwijdert nooit gegevens | Na 1.0 |
| Beheer (`/adminbackend`) | Volledig | Niet aanwezig | Beheer blijft uitsluitend web | Blijvend |
| FSY-lezer en overige studieprogramma's | Per programma | Niet aanwezig; CFM wel | De contentkiezer toont alleen wat de native app kan lezen | WP14 indien gewenst |

## 3. Wat een uitzondering nooit mag betekenen

- Geen verborgen of dode ingangen: een functie die niet bestaat, wordt niet getoond.
- Geen afwijkende regels voor XP, reeksen, beloningen of toegang: de server blijft de bron (CLAUDE.md, leervoortgang).
- Geen uitzondering voor accountverwijdering, privacy, juridische toegang of beveiliging.
- Geen stilzwijgende statuswijziging in de pariteitsinventaris: elke uitzondering krijgt eigenaarsgoedkeuring en testbewijs.

## 4. Gevolg voor de werkpakketten

Verplicht voor 1.0: WP2, WP3 (voorbereid), WP4 (accountverwijdering/juridisch), WP5 (versiebeleid), WP6 (native shell en
datalaag), WP8 (Vandaag), WP9 (Leren), WP10 (lezer en oefeningen), WP11 (hoofdstukaudio, na besluit D7), WP13 (profiel),
WP14 alleen voor CFM, WP15 (toesteltests), WP16 (storemetadata). Uitgesteld: WP12, WP17, WP18.

## 5. Beslispunten voor de eigenaar

1. Keur de tabel in §2 goed (per rij of als geheel), waarna de pariteitsdocumentatie bijgewerkt wordt.
2. Bevestig dat CFM in 1.0 de volledige studieroute heeft (Stap voor stap én Vrije studie) of alleen Stap voor stap.
3. Bevestig dat hoofdstukaudio in 1.0 zit (D7) en daarmee de achtergrond- en lifecycletests van WP15.
