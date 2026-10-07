# Profielstandaard

Hoe profielpagina's en instellingen gebouwd worden. Geldt voor het overzicht
(`/profile`), de onderdelen (`/profile?view=...`) en losse profielpagina's
(`/change-password`, `/feedback`). Een nieuwe instelling is een combinatie
van onderstaande bouwstenen, zonder eigen kaart-, rij-, formulier- of
layout-CSS.

## Pagina

- **Shell**: elke profielpagina rendert binnen `ProfilePage`
  (`src/components/profile/ProfilePage.tsx`). Die regelt de breedte
  (`max-w-3xl`, voor overzicht en onderdelen gelijk), de afstand tussen
  blokken en de footer. De footer (disclaimer met privacy en cookies) staat
  alleen op het overzicht `/profile`; onderdelen (`?view=...`) en losse
  profielpagina's tonen hem niet. Dat volgt uit de route
  (`isProfileOverview` in `src/lib/profileViews.ts`), dus een nieuw onderdeel
  begint zonder footer en heeft geen eigen uitzondering nodig. Op het
  overzicht staat hij onderaan het scherm op een korte pagina, na de inhoud
  op een lange (`.page-fill` + `mt-auto`, zie `globals.css`). Ruimte voor de
  vaste bovenbalk en de onderbalk (met safe-area) komt van `<main>` via
  `--main-pad-top`/`--main-pad-bottom`; een pagina zet daar zelf niets voor.
- **Kop en terug**: de kop "← Titel" komt uit `SubpageBackBar`. Een nieuw
  onderdeel krijgt een regel in `PROFILE_VIEWS` (`src/lib/profileViews.ts`),
  een losse route een regel in `PROFILE_SUBPAGES` (`SubpageBackBar.tsx`).
  Geef `ProfilePage` dezelfde titel mee (`title`): die staat alleen voor
  schermlezers, nooit nog een keer in beeld. Geen eigen terugknop.
- **Onderdeel toevoegen**: weergave in `src/components/profile/` (instellingen
  in `ProfileSettingsViews.tsx`, inhoud in `ProfileContentViews.tsx`),
  gegevens en opslaan in `ProfileClient` (één `/api/profile`, opslaan via
  `PATCH /api/account`), en een rij op het overzicht met `SettingsRow` en
  `openView(...)`.

## Bouwstenen (`src/components/profile/settings.tsx`)

| Component | Wanneer |
|---|---|
| `SettingsSection` | Een groep instellingen: kaart met optionele kop en uitleg, rijen gescheiden door een dunne lijn. Liever meerdere secties dan één grote kaart. |
| `ProfileCard` | Een kaart met vrije inhoud (uitleg, raster, formulier) en optioneel `actions` (knoppen onderaan). |
| `SettingsRow` | Gaat ergens heen: icoon, label, waarde, pijl. `href` voor een route, `onClick` voor een onderdeel. |
| `SettingsToggleRow` | Aan/uit. `disabled` als het niet kan (zet de reden in `description`), `busy` tijdens opslaan (houdt de focus). |
| `SettingsField` | Label, uitleg en een bediening eronder (keuzelijst, invoer). `inline` voor een kleine bediening rechts (tijd, snelheid). `htmlFor` voor een eigen invoerveld. |
| `SettingsInfoRow` | Alleen tonen, niet klikbaar (status, tijdzone). |
| `SettingsActions` | Knoppen of een melding tussen rijen, op één lijn met de rijen. |
| `SettingsButton` | `primary` (opslaan), `secondary` (standaard), `danger` (onomkeerbaar, zoals resetten), `quietDanger` (account verwijderen). |
| `SettingsStatus` | Korte melding met icoon: `info`, `success`, `warning`, `error` (fouten als `role="alert"`). `boxed` voor iets dat je niet mag missen. |
| `settingsFieldClass` / `settingsInlineFieldClass` | Stijl voor `input`, `textarea` en `AppSelect` (`className`). |

- **Bevestigen**: een onomkeerbare of ingrijpende actie (uitloggen, resetten,
  account verwijderen) gaat via `useConfirm()` met `{ title, confirmLabel,
  destructive }`, niet via een blok dat in de pagina openklapt.
- **Inhoudelijke onderdelen** (Competitie, Prestaties) zijn geen
  instellingen: geen rijen of schakelaars, wel `ProfileCard`, dezelfde
  kopjes en tokens. Eigen beeld mag (divisie-emblemen, prestatieraster).
- **Winkel, XP, reeks en rondleiding** zijn eigen onderdelen van de app
  (eigen hero of flow) en gebruiken deze shell bewust niet.

## Regels

- Mobiel eerst. Rijen minstens 56 px hoog, knoppen en velden 44 px: genoeg
  om te tikken, zonder grote elementen. Op een breed scherm wordt niets
  groter, alleen de shell is begrensd.
- Kleuren alleen via de `vs`-tokens (`bg-vs-surface`, `text-vs-fg-2`,
  `border-vs-line`, `text-vs-danger`, ...): licht en donker gaan dan vanzelf
  goed. Geen losse `slate`/`dark:`-kleuren in profielpagina's.
- Geen marges, vaste hoogtes of spacers om iets op een plek te duwen; de
  shell en `gap` regelen de ruimte.
- Alle zichtbare tekst via i18n, in elke taal (zie CLAUDE.md, "Talen").
- Getest met `npm run test:profile` (toegankelijkheid van de bouwstenen).
