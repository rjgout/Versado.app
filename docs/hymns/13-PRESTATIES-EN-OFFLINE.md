# Lofzangen: prestaties, omvang en offline gebruik

Fase 4. Gemeten waar mogelijk; waar niet gemeten is dat gezegd. Alle metingen zijn op een ontwikkelmachine (4 kernen,
Node 22) of in Chromium met viewport-emulatie, **niet** op een telefoon.

## 1. Omvang van de gegevens

| Onderdeel | Ruw | Gzip | Wanneer geladen |
|---|---:|---:|---|
| Alle afgeleide bibliotheekbestanden in git (205 lofzangen, 173 composities-met-koppeling) | 1,8 MB | n.v.t. | nooit tegelijk: alleen op de server |
| Lijst/zoekindex (`/api/hymns/index`) | 63 KB | ~6 KB | bij het openen van de pagina |
| Eén lofzang (tekst + koppeling + compositie) | ~13-16 KB | ~4 KB | pas als de gebruiker hem opent |
| Herkenningsbundel (`/api/hymns/recognition`, alle composities) | 0,52-0,78 MB | ~0,12 MB | één keer vóór de microfoon start; daarna lokaal bewaard |
| Kwaliteitsoverzicht (alleen beheerders) | 7 KB | - | op verzoek |

**BEWEZEN**: de bibliotheek zit niet in de eerste JavaScript-bundel van de pagina. De gegevens komen via de API en worden per lofzang
geladen; de pagina zelf bevat alleen code. `scripts/hymns/e2e-library-access.mjs` controleert dat een lofzang bij een tweede keer openen geen nieuw verzoek geeft.

De server comprimeert API-antwoorden zelf (de aangepaste server doet dat niet): `jsonMaybeGzip` in `src/lib/hymns/apiAccess.ts`.

## 2. Wat blijft lokaal en wat niet

- **Alle realtime audio** (microfoon, extractie, herkenning, volgen) draait op het toestel: **BEWEZEN** door `tests/hymns-privacy.test.ts`
  (geen netwerk/opslag in `src/lib/hymns` en `src/components/hymns-poc`; een sessie werkt met `fetch` en `WebSocket` uitgeschakeld) en
  door de browsertest (geen verzoeken met inhoud naar lofzang-eindpunten, geen grote WebSocket-frames, één microfoonaanvraag en één
  AudioContext per sessie). Er is geen audio-upload, geen opslag van audio, geen externe AI en geen Socket.IO-audio.
- **Wat wel naar de server gaat**: alleen het ophalen van bibliotheekinhoud (tekst en noten) vóór en tijdens het kiezen. Tijdens een
  luistersessie zijn er geen verzoeken, behalve één eventuele opvraging van de tekst van een herkende lofzang die nog niet lokaal staat.

## 3. Lokale opslag (IndexedDB)

`src/lib/hymnLibraryClient.ts` bewaart index, geopende lofzangen en herkenningsbundel in IndexedDB (database `versado-lofzangen`),
met de `dataVersion` uit het manifest als sleutel: bij een nieuwe versie worden oude kopieën vervangen. Zonder verbinding of bij een fout
geldt de lokale kopie; zonder IndexedDB (privévenster) werkt alles met geheugen en netwerk. Het bestand staat buiten `src/lib/hymns`
omdat de privacytest daar opslag verbiedt. **BEWEZEN** in Chromium met de API geblokkeerd (`e2e-library-access.mjs`): de lijst komt uit
de lokale kopie, een eerder geopende lofzang is volledig bruikbaar, een nooit geopende lofzang geeft een nette foutmelding.

Er bestaat bewust **geen** aanpassing van de service worker: die is een kale doorgeefluik (`public/sw.js`, geen offline-caching van pagina's,
om verouderde of verkeerde gegevens van een ingelogde app te voorkomen).

## 4. Drie begrippen die niet door elkaar mogen

| Begrip | Status |
|---|---|
| **Offline muziekengine** (herkennen en volgen zonder netwerk) | **BEWEZEN**: alle analyse draait lokaal; met `fetch` uit werkt een volledige sessie. |
| **Lokaal beschikbare bibliotheek** (na een eerste keer laden) | **BEWEZEN** voor lijst, geopende lofzangen en herkenningsbundel (zie 3). De herkenning moet dus vóór de dienst één keer met verbinding zijn voorbereid ("Herken lofzang" laadt de bundel). |
| **Volledig offline startbare webapp** | **NEE**: de pagina en de code worden bij het openen van het netwerk gehaald (service worker is een doorgeefluik, bewust niet aangepast). Een reeds geopende pagina met geladen gegevens blijft bruikbaar; opnieuw openen zonder verbinding niet. |

## 5. Rekentijd en geheugen

Zie `12-HERKENNING-SCHAALBAAR.md` voor de herkenning. Het volgen van één lofzang is ongewijzigd (~0,2 ms per frame, geheugen constant;
`tests/hymns-privacy.test.ts`, "resources").
