# Lofzangen: tekst, woorden en lettergrepen aan noten koppelen

Fase 4. `scripts/hymns/build_nld_music.py` legt de officiële tekst langs de lettergrepen onder de noten en schrijft per lofzang
`link/NNN.json`. Doel: woordmarkering waar de koppeling betrouwbaar is, regelmarkering als dat niet zo is, en nooit een verzonnen woord.

## 1. Werkwijze

1. **Rijen**: de lettergrepen van elk systeem worden op hoogte (y) in tekstrijen gegroepeerd; rij k van elk systeem hoort bij het
   k-de couplet onder de muziek. Coupletnummers (`1.`) en uitvoeringsaanwijzingen (`Koren:`) vervallen.
2. **Kolommen**: elke lettergreep krijgt de beat van de dichtstbijzijnde notenkolom (de lettergreep staat links uitgelijnd onder zijn noot).
3. **Tekenvergelijking** (`align_words`): de tekens van alle lettergrepen van een rij en de tekens van het couplet uit de officiële tekst
   worden uitgelijnd (`difflib.SequenceMatcher`). Dit is bestand tegen woorden die over twee regels gesplitst zijn, aan elkaar gekleefde
   woorden, samenstellingen en kleine spellingverschillen, en toont elk echt verschil. Een woord krijgt de beat van zijn eerste
   teken; de bijbehorende lettergrepen worden bewaard.
4. **Kwaliteit per couplet**: <3 % ontbrekende tekens = goed; tot 15 % = bruikbaar op regelniveau (woorden zonder koppeling hebben `b = null`);
   daarboven, of een regel zonder enig gekoppeld woord = **onbruikbaar** (de lofzang wordt dan niet als muziek bewaard).
5. **Refrein**: de grens tussen couplet- en refreinmuziek is een **beat**, gekozen uit de systeemgrenzen en de sectie-einden als de
   waarde waarbij couplet én refrein het best met de officiële tekst overeenkomen. Bij meerdere tekstrijen onder het refrein telt de rij die het best past.
6. **Coupletten zonder eigen tekstrij** (onder de muziek gedrukt) krijgen de frasering van couplet 1: alleen regelstart (`linking = "line"`).

## 2. Wat de interface ervan gebruikt

| Niveau | Voorwaarde | Weergave |
|---|---|---|
| woord (`linking = "word"`) | alle woorden van het couplet gekoppeld en oplopend | actieve woord in de accentkleur |
| regel (`linking = "line"`) | regelstarten bekend, woorden niet allemaal | de hele actieve regel in de accentkleur, geen enkel woord |
| alleen tekst | geen gevalideerde compositie | leesweergave, geen microfoon |

Zonder betrouwbare woordkoppeling wordt dus nooit een woord gemarkeerd (BEWEZEN in `LyricsView` en `tests/hymns-ui.test.ts`).

## 3. Resultaten

De aantallen (woordvolging, regelvolging) staan in `15-KWALITEITSRAPPORT.md`. De eerste drie proeflofzangen (24, 36, 82) geven
dezelfde noten, maten en secties als de handgemaakte proefgegevens uit fase 1 (BEWEZEN: vergelijking vóór het vervangen van het
proefbestand). Lofzang 82 heeft zes coupletten, waarvan twee zonder eigen rij: die volgen op regelniveau.

## 4. Beperkingen

- Een Nederlandse tekst die op de website anders is dan op de gedrukte bladmuziek (zeven lofzangen) wordt niet gekoppeld; de
  gedrukte versie is niet de officiële tekst en wordt nooit als tekst getoond.
- Lofzangen met een afwijkend refrein per couplet (154): alleen de eerste refreinvariant wordt gevolgd.
- Herhalingen binnen een regel ("Halleluja, halleluja") die in de partituur anders staan gedrukt dan in de tekst, geven een bruikbare
  regelkoppeling maar geen woordkoppeling.
