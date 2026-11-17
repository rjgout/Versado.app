# Architectuurbesluit: Capacitor, app-first

Status: besluit van de eigenaar. Vervangt de open architectuurvraag uit de Expo-proef (PR #286).

## Besluit

1. **Versado wordt app-first.** iOS en Android zijn de primaire producten; de website is
   aanvullend (en blijft de plek voor beheer, ontwikkeltools en juridische pagina's).
2. **Capacitor, lokaal gebundeld** (Ringtools-model). Eén gedeelde React-client, één backend,
   één set bedrijfsregels. Geen Expo-/React-Native-migratie.
3. **Eén account- en sessiesysteem.** Web gebruikt de cookie-sessie, native de bestaande
   `NativeSession` (Bearer, rotatie, Keychain/Keystore). Geen tweede accountsysteem.
4. **Server blijft autoritatief** voor XP, reeksen, beloningen en spelvalidatie. De client
   stuurt nooit uitkomsten.
5. **Geen nieuwe infrastructuur zonder concrete functie.** Elke PR levert een compleet
   werkend onderdeel (bestemming of functiegroep), geen losse bouwstenen.

## Waarom niet Expo / React Native

De Expo-proef (PR #286, gearchiveerd in `docs/archief-expo-proef/`) bewees dat het kan, maar
vereist een tweede UI-laag voor ~145 schermen, een tweede lezer/annotatiestack en dubbel
onderhoud van spelschermen. De bestaande React-componenten, i18n, tokens en
spellogica zijn al herbruikbaar in Capacitor. De winst van native rendering weegt niet op
tegen de duplicatie.

## Wat uit PR #286 bruikbaar is

| Onderdeel | Besluit |
|---|---|
| Eindrapport, meetresultaten, screenshots | Bewaard in `docs/archief-expo-proef/` |
| Expo-/RN-afhankelijkheden en app-code | **Niet** overnemen |
| Maestro-/seedideeën voor toestelflows | Alleen als referentie |
| Backend-hardening (friends-misbruik #287, test-proxy-encoding #288) | Wel nodig, los gemerged |
| Prisma-transactietimeout-bevinding | Blijft open punt (zie implementatieplan) |
| Studieles-routes en tombstones | **Niet overnemen** (zie hieronder) |

PR #286 blijft een niet-gemergede draft.

## Review studieles-routes en tombstones uit #286

- **Noodzaak:** de Capacitor-lezer hergebruikt de bestaande `StudyReader`. Die heeft een
  server-data-projectie nodig (`StudyReaderDTO`), geen aparte lesroutes. De webstatus
  (`state` bij opnieuw toevoegen) lost het tombstone-scenario al op.
- **Veiligheid:** extra routes vergroten het aanvalsoppervlak (TS-/Swift-/Java-allowlist)
  zonder dat een Capacitor-scherm ze gebruikt.
- **Terugwaartse compatibiliteit:** tombstones introduceren een tweede levenscyclus voor
  annotaties naast het bestaande systeem, wat oudere appversies kan breken.
- **Oordeel:** niet nodig voor het Capacitor-pad; buiten `develop` houden.

## Client-/API-structuur

- Eén client, twee hosts (native bundel en Next-pagina's) via adapters
  (`AppNavigationProvider`, `ApplicationRuntime`, `useNativeLiveQuery`).
- Native API onder `/api/v1/native/*`, expliciete route-allowlists (TS + gegenereerd Swift/Java),
  versioned page-data-endpoints voor pagina's met serverdata.
- Beheer en `/dev/*` blijven web-only.

### Welke schermen kunnen niet lokaal draaien

Auditresultaat (145 pagina's, 0 Server Actions, 244 API-routes):

| Klasse | Aantal | Aanpak |
|---|---|---|
| Dunne host (client component, API-data) | 94 | Direct in de bundel |
| Server-data (SSR leest Prisma) | 37 | Page-data-projectie + native route |
| Web-only (beheer, dev, juridisch) | 12 | Blijft web |
| Client | 2 | Direct |

Server Actions zijn er niet, dus geen blokkade daar. De 37 server-data-pagina's zijn het
echte werk; zie het implementatieplan.
