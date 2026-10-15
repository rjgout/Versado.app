# Lofzangen: tests, praktijkmetingen en resterende beperkingen (fase 4)

Alle claims in `09` t/m `15` steunen op de tests en metingen hieronder. **BEWEZEN / AANNEMELIJK / ONBEKEND** als in `01-SOURCE-AUDIT.md`.

## 1. Geautomatiseerde tests

| Opdracht | Dekt |
|---|---|
| `npm run test:hymns` | bibliotheek (205 nummers, 203 teksten, licentie-uitzonderingen, lofzang 86, capaciteiten, afscherming van onzekere muziek, gedeelde melodieën, zoeken, manifest), engine, voorspel/zangbegin, herkenning in de hele bibliotheek (voorfilter, regressie 36 bij 55/min, onbekende melodie, gedeelde melodie, bibliotheekmodus), UI-afleidingen, privacy |
| `npm run test:content-picker`, `test:focus`, `test:live-data` | contentkiezer (admin ziet Lofzangen, anderen niet), focusmodus en shell, live-data-laag |
| `npx tsc --noEmit`, `npm run lint`, `rm -rf .next && npm run build` | typecontrole, lint, productiebuild |
| `scripts/hymns/e2e-browser.mjs` (Chromium, nepmicrofoon) | zoeken, 54/86/82, herkennen → volgen in één microfoon- en AudioContext-sessie, rustige herkenstatus, actieve woord, instellingenpaneel, paneel privacy (uitklapbaar), 320/375/390/430/768/1280/844x390, licht/donker, 200 % tekst, safe areas, viewporthoogte |
| `scripts/hymns/e2e-library-access.mjs` | gewone gebruiker en anoniem: 404 op pagina en alle `/api/hymns/*`; beheerder: gegevens en groottes; lokale opslag zonder API |
| `scripts/hymns/eval-library.ts` | herkenning op de 152 gevalideerde begeleidingsopnamen; tempo, ruis, onbekende melodie |
| `scripts/hymns/eval-service.ts bibliotheek` | synthetische "diensten" (voorspel, pauze, samenzang; kinderen, galm, gemeentezang, roepende kinderen, wisselend tempo) met herkennen tegen de hele bibliotheek |

De privacytests zijn niet versoepeld: nog steeds geen netwerk, opslag of analytics in `src/lib/hymns` en `src/components/hymns-poc`.

## 2. Gemeten (BEWEZEN op dit materiaal)

Zie `12-HERKENNING-SCHAALBAAR.md` (herkenning, rekentijd, geheugen), `13-PRESTATIES-EN-OFFLINE.md` (omvang, lokale opslag) en
`15-KWALITEITSRAPPORT.md` (aantallen per niveau).

## 3. Niet gemeten of niet mogelijk

- **Een echte telefoon, iPhone-Safari of een WKWebView**: er was geen toestel beschikbaar; layout is alleen in Chromium met viewport-emulatie en gesimuleerde safe areas gemeten.
- **Een echte dienst**: orgel of piano in een kerkgebouw, gemeentezang in het Nederlands, kinderen, een afwijkend tempo of stemming. De opnamen zijn schoon studiospel van de Engelse begeleiding. **Praktijkresultaat ONBEKEND.**
- **Batterijverbruik**: niet gemeten. Rekentijd per frame is gemeten op een ontwikkelmachine (zie 12), niet op een telefoon.
- **Rechten per bestand** voor gebruik door gewone gebruikers: niet bevestigd (zie `09-...`, 5); daarom blijft alles admin-only.

## 4. Resterende uitzonderingen

Per lofzang met nummer en concrete reden: `15-KWALITEITSRAPPORT.md`, 2. Samengevat: 2 teksten ontbreken door licentie (54, 151), 1 lofzang heeft tekst maar geen bladmuziek (86),
en voor de overige lofzangen zonder gevalideerde muziek is de extractie (maatsom, triolen, meerstemmig ritme) of de koppeling aan de officiële tekst niet betrouwbaar genoeg. Twee
PDF's hebben herhalingstekens en zijn afgeschermd. Eén lofzang met opname (17) wordt binnen 90 s niet herkend (status "onbekend", nooit een gok).
