# Fase 5 — implementatieplan (op basis van de audit)

Audit: `PHASE-5-UX-AUDIT.md`. Dit plan wacht op akkoord; er is nog niets gebouwd.
**Onaantastbaar** (alle stappen): puzzelvalidatie en engine, tijdregistratie (`completedAt - startedAt`, `finishAttempt`), hint- en hinttegoedregels, reeksverlenging, verplichte Solo-vraag, wedstrijdresultaten en regelversies,
records/ranglijsten/privacy, historische gegevens, server-autoritaire commits, expliciete navigatie, fullscreen werktafel zonder permanente toolbar. Geen nieuwe puzzelengine. Presentatiecode leest alleen bestaande staat.

Indeling: **A** noodzakelijke bugfix · **B** UX-verbetering · **C** visuele verfijning · **D** optionele uitbreiding. Prioriteit P0 (eerst) – P2.

## Overzicht en afhankelijkheden
```
5B (A, P0) startcamera ─────────────┐
5B (A, P2) Path2D-opruiming          ├─ onafhankelijk, klein
5C (B) gedeelde renderer  ───────────┼─▶ 5D (B/C) bijna-passend, snap/remote-tween, voltooiing, record-viering
5E (B/D) feedbacklaag (haptiek/geluid) ─▶ gebruikt de events uit 5D
5F (test) fysieke toesteltest ─ parallel en blokkerend vóór livegang van 5D/5E
```

## Fase 5B — noodzakelijke bugfixes (A)
**5B-1 (P0) Startcamera voor grote borden.** Oorzaak: `viewport.ts:36-37` kiest het midden tussen het dichtstbijzijnde stuk en de puzzelzone, buiten beeld bij ≥ 150 stukken op ruime schermen.
- Aanpak: bepaal de startschaal en het midden zo dat de puzzelzone **en** een aantal losse stukken in beeld zijn (bij grote borden eventueel lagere schaal, nooit kleiner dan ~28 px per stuk), met behoud van het bestaande gedrag voor ≤ 96 stukken zolang daar ≥ 4 stukken zichtbaar zijn. Camera-/viewport-functies blijven puur en deterministisch; alleen `initialPuzzleCamera` verandert.
- Acceptatie: voor alle schermen uit de probe (320×568, 360×740, 390×844, 740×360, 768×1024) en 24/48/96/150/300 stukken ≥ 4 stukken én het puzzelmidden in beeld bij start; geen verandering voor Solo-hervatten (camera blijft bij resize/hervatten behouden); geen stuk buiten de tafel.
- Tests: uitbreiding van `tests/puzzle-fit.test.ts` met de probe-matrix; browser `puzzle-mobile` (zes maten) en `puzzle-multiplayer` (300 stukken) + screenshots; handmatig tablet/landscape.
- Regressierisico: laag (alleen startweergave); Solo-sessies die al lopen veranderen niet. Mobiele impact: geen. DB: geen.

**5B-2 (P2) Path2D-cache opruimen.** Verwijder cache-items voor groepen die niet meer bestaan (na elke snapshotwijziging). Acceptatie: geheugen blijft stabiel in een lange sessie (meting: 300 stukken, 200 merges). Test: unit voor de cache-sleutellogica + `puzzle-perf`. Risico laag.

## Fase 5C — gedeelde renderer (B, voorwaarde voor 5D)
**5C-1 (P1) Eén tekenmodule** `src/lib/puzzle/render.ts` (puur canvas, geen React) voor `paint` van Solo/wedstrijd en Samen (bord, groepen, schaduw/lift, hintmarkeringen, selectie, lock-/remote-weergave via parameters). Gedragsgelijk refactoren: pixelvergelijking van de bestaande browserscreenshots vóór/na.
- Acceptatie: alle bestaande browsersuites ongewijzigd groen; geen verschil in naadpixels (`puzzle-mobile`); Samen krijgt dezelfde snap-animatie als Solo.
- Tests: `flow`, `mobile`, `drag`, `difficulty`, `hint-inventory`, `multiplayer`, `perf` (frametijd niet slechter). Risico: **middel** (raakt alle modi) — daarom los en eerst, zonder visuele nieuwigheden. Mobiele impact: neutraal; mogelijk lichte winst door één geoptimaliseerd pad.

## Fase 5D — spelbeleving (B/C)
**5D-1 (P1, B) Bijna-passend-feedback tijdens slepen.** Pure, client-side hint: `findSnapConnection` / `boardSnapTarget` (< 0,1 ms) tijdens `pointermove`, alleen weergave (subtiele contour/gloed op de doelrand, geen serverstatus, geen schending van het "geen plaatshulp"-beleid per niveau: alleen tonen waar de snap anders ook plaatsvindt, dus Expert/Meester alleen voor onderlinge verbindingen).
- Acceptatie: gloed verschijnt binnen de snapafstand en verdwijnt bij loslaten; nooit zichtbaar bij niveaus waar plaatshulp uitstaat; ≤ 1 extra tekenoperatie per frame.
- Tests: unit (zelfde functie als de engine), `puzzle-drag`/`puzzle-difficulty`. Risico laag-middel (prestaties: meten op toestel).

**5D-2 (P1, B) Snap-feel en voortgang.** Snap-animatie (reduced motion: uit), kleine "verbonden"-puls, voortgangsindicator (verbonden stukken/totaal) als subtiel element in het menu of kop, niet als permanente toolbar. Geen extra serverrondes.

**5D-3 (P1, B) Solo-voltooiing toont de puzzeltijd** (alleen weergave van `completedAt - startedAt`, geen vraagtijd) en de recordmelding eerder/duidelijker. Acceptatie: tijd gelijk aan de opgeslagen recordtijd; tekst in vijf talen; vraag blijft verplicht voor reeks/record (Solo). Test: browser `records`/`flow`.

**5D-4 (P1, B) Samen en wedstrijd.** Tween (≈ 120 ms) voor remote verplaatsingen, subtiele melding wanneer iemand verbindt (nooit modaal), wedstrijdvoortgang als balk met tekstalternatief. Realtime blijft gelijk (geen extra berichten); optioneel adaptieve sleepdoorgifte (100 ms bij ≥ 150 stukken). Test: multi-instance, `multiplayer`, `perf` (verkeer niet hoger).

**5D-5 (P1, C) Voltooiing en records in Versado-stijl.** Mascotte via `PersonalMascot state="celebrate"` (geen directe asset-paden) op de voltooiingskaart; recordmelding met onderscheid zonder/met hints (tekst en icoon, niet alleen kleur); respecteert `celebrationGate` (resultaatkaart eerst) en `prefers-reduced-motion`. Geen nieuwe assets zonder licentie.

**5D-6 (P2, B) Toetsenbord.** Pijltjes: samenvoegen tot één commit per losgelaten reeks (debounce) in plaats van één serveractie per toets; focus-/selectie-aanduiding verbeteren; schermlezerteksten voor "geselecteerd stuk" en voortgang. Test: unit + `puzzle-flow` (toetsenbord) + handmatig VoiceOver/TalkBack.

**5D-7 (P2, B) Vindbaarheid grote borden.** "Ga naar een los stuk"/"Toon puzzelzone" in het bordmenu (bij ≥ 150 stukken) en een compacte oriëntatie; geen minimap-component vooraf. Optioneel **D** (kleine minimap) pas na toesteltest.

**5D-8 (P2, B) Chooser-aanraakdoelen**: `FriendPicker`-knoppen naar ≥ 44 px (alleen stijl).

## Fase 5E — geluid en haptiek (B/D)
Bevinding: geen centrale laag. Voorstel (klein, geen databasewijziging):
- `src/lib/feedback.ts`: één API `feedback("pickup" | "place" | "complete" | "record" | "remoteConnect")`; **haptiek** via bestaande `lightHaptic()` (native) en web `navigator.vibrate` waar beschikbaar; **geluid** met zeer korte, zachte WebAudio-tonen (geen bestanden, dus geen licentie- of asset-risico), pas na een eerste gebruikersgebaar ontgrendeld.
- Voorkeur **apparaatlokaal** (zoals de voorleesvoorkeur "bewaard op dit apparaat") in het profiel bij de bestaande audio-instellingen: aan/uit voor geluid en voor trillen. Standaard terughoudend: haptiek alleen bij plaatsen/voltooien, geluid **uit tot de gebruiker het aanzet** *(zie open beslissing 1)*; respecteert reduced motion en de systeemstilte voor zover de browser dat toelaat. Multiplayer: alleen eigen acties + voltooiing, nooit geluid voor andermans sleepbeweging.
- Acceptatie: uit = geen geluid/trilling; geen auto-afspelende langdurige effecten; voltooiing/record niet harder dan ≈ −18 dBFS; werkt niet door op de server. Tests: unit voor voorkeur/ontgrendeling, browser (audio-context aangemaakt pas na gebaar), handmatig op toestel.
- Risico: laag-middel (autoplayregels, iOS stilteschakelaar). Mobiele impact: verwaarloosbaar. **Categorie D** voor eventueel meer events.

## Fase 5F — validatie op toestellen
Checklist uit de audit (§9) uitvoeren vóór en na 5D/5E; framemeting bij 96 solo en 150/300 samen op een oudere iPhone en instaptoestel; resultaten in een verslag. 5D/5E gaan pas live na een succesvolle toesteltest.

## Volgorde en timing
1. 5B-1 (P0, klein, los uitrolbaar) → 2. 5C-1 (refactor, eigen PR, geen zichtbare wijziging) → 3. 5D-1…5D-5 (per stap een PR) → 4. 5E → 5. 5D-6…5D-8 en 5B-2 (P2) → parallel 5F.
Elke PR: tsc, eslint, i18n, `test:puzzle*`, schone build, bestaande browsersuites en de nieuwe tests; geen merge zonder review.

## Databasewijzigingen
Geen vereist. (Een serverzijdige geluidsvoorkeur is bewust niet gekozen; zie open beslissing 1.)

## Open beslissingen (graag akkoord)
1. **Geluid standaard uit of zacht aan?** Voorstel: uit tot de gebruiker het inschakelt; haptiek alleen in de native app standaard aan op "plaatsen/voltooien".
2. **Bijna-passend-gloed** ook bij Expert/Meester (alleen onderlinge verbindingen) of alleen Ontdekker/Avonturier? Voorstel: alleen waar de snap ook plaatshulp is.
3. **Minimap** (D) pas na toesteltest, of uit scope?
4. **Mascotte** op de voltooiingskaart: gekozen gids (`PersonalMascot`) — akkoord?
