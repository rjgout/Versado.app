# App-first implementatieplan (integraal)

Besluit en achtergrond: [ARCHITECTUURBESLUIT-APP-FIRST.md](ARCHITECTUURBESLUIT-APP-FIRST.md).
Grenzen: geen automatische merge, geen NAS-uitrol, geen TestFlight-upload, geen App Store-release.
Eigenaar doet productie en live tests.

## Uitgangspunt

De basis bestaat al: gedeelde shell (`NativeFoundation`), vier bestemmingen in de tabbalk,
adapters, spelbrug (`gamesRoutes`/`dispatchNativeGame`). Wat ontbreekt: de Vrienden-bestemming,
page-data-projecties voor ~37 server-data-pagina's en de nog ontbrekende Leren-/Vandaag-/sociale
pagina's. Paritystand: 8 volledig, 83 gedeeltelijk, 54 ontbreekt
(`docs/native-feature-parity.inventory.json`).

## Werkpakketten (grote, complete delen)

| # | Pakket | Inhoud | Afhankelijk van |
|---|---|---|---|
| 1 | **Vrienden-kern** (eerste oplevering) | Vierde bestemming, vrienden, verzoeken, profiel van vriend, `social-v1`, proactieve tokenverversing | #287, #288 |
| 2 | **Vandaag volledig** | `/`, `/streak`, `/xp`, `/dashboard`, `/acties`, `/shop` | 1 (shell) |
| 3 | **Leren volledig** | Lezer, oefenen, studiemap, bladwijzers, CFM-stappen, `StudyReaderDTO` | page-data-projectie |
| 4 | **Spelen volledig** | Resterende spelroutes (mysteries, jigsaw, live, Samen) via de spelbrug | bestaande brug |
| 5 | **Sociaal volledig** | Groepen, competitie, activiteit, uitnodigingen | 1 |
| 6 | **Profiel, instellingen, onboarding** | Resterende account-/hulppagina's, Kompas | — |
| 7 | **Audio, meldingen (push), offline** | Achtergrondaudio, APNs/FCM, netwerkverlies, lokale content | 2–3 |
| 8 | **Toegankelijkheid en storevoorbereiding** | Toesteltests, 9 storeblokkades | alle |

Per pakket: i18n in alle `uiReady`-talen, Kompas-controle, parity-inventaris bijwerken,
`tsc`, schone build, relevante tests. Geen nieuwe tweede cache, sessie of regelset.

## Paginaklassen (aanpak)

- **Dunne host (94):** direct in de bundel via `AppLink`/`useAppNavigation`/`applicationFetch`.
- **Server-data (37):** versioned page-data-endpoint onder `/api/v1/native/*`, hergebruik van
  bestaande servicefuncties; geen Prisma in de client.
- **Web-only (12):** beheer, `/dev/*`, uitschrijven; blijven web.

## Eerste oplevering: Vrienden-kern

Scope volgens `docs/NATIVE-VRIENDEN-AUDIT.md`:
- `src/lib/native/socialRoutes.ts` (allowlist), handlerkaart en generalisatie van
  `dispatchNativeGame` naar een gedeelde dispatcher;
- capability `social-v1` in `src/lib/native/api.ts`;
- `friends` in `nativePrimaryNav` (`shell.ts`), Liquid Glass-tab op iOS, passende navigatie op Android;
- `NativeFriendsView` en adapters in `FriendsClient`;
- gegenereerde Swift/Java-policy en test-proxy uit de routetabel;
- proactieve tokenverversing in `client.ts` (zie open punt 1);
- tests (policy, integratie, browser) en `npm run native:parity:update`.
Backend- en beveiligingscontroles blijven ongewijzigd.

## Open punten, op risico en afhankelijkheid

1. **401 bij vriendverzoek accepteren (iOS-run).** Oorzaak: toegangstoken van 5 minuten, bewust
   geen verversing/herhaling voor schrijfacties, geen vervaltracking. Oplossing: vóór een
   schrijfactie proactief verversen op basis van opgeslagen `accessExpiresAt`. Onderdeel van pakket 1.
2. **Prisma-transactietimeouts (5 s)** in `commitAccountMutation` (vrienden, annotaties) onder
   belasting. Eerst meten, dan gericht ruimere timeout of kleinere transactie; geen blind verhogen.
3. **Test-proxy #285/#288.** Code via PR; uitrol van de proxy-images op de NAS door de eigenaar.
4. **Toegankelijkheid op echte toestellen** (200% tekst, screenreader): eigenaar met toestel,
   gebundeld in pakket 8.
5. **Store-readiness (9 blokkades):** `npm run native:store-readiness`; eigenaarstaken in
   `NATIVE-STORE-RELEASE-PLAN.md`; geen releaseprofiel vrijgeven.

Volgorde: 1 → (3, 2 parallel te meten) → pakket 2–6 → 7 → 8. Elke fase vraagt onafhankelijke
review en eigenaarakkoord vóór de volgende start.
