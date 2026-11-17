# Ringtools als referentie

Doel: dezelfde eenvoud, geen letterlijke kopie. Bron: `rjgout/Ringtools` (`AGENTS.md`,
`mobile/`, en `docs/MOBILE.md` in die repository).

## Wat Ringtools doet

- Eén Vite-React-SPA, lokaal gebundeld in Capacitor.
- Dunne getypte `ApiClient` plus één gedeeld contractbestand.
- Versioned mobiele API; hetzelfde client-pakket draait ook als web-app (`/app`,
  cookietransport met CSRF-header).
- Lokale `UITabBar`-plugin; `buildTabs` wordt gedeeld door de native en de React-balk.
- Beveiligde opslag, app-lock, deeplink-inbox, push.
- `check:native-config` bewaakt de native configuratie.

## Wat Versado al heeft

| Ringtools | Versado |
|---|---|
| Vite-bundel | esbuild `scripts/native/build.ts`, entry `src/components/native/entry.tsx` |
| ApiClient + contract | `NativeSessionClient` + zod-contracten `src/lib/native/*Contract.ts` |
| Versioned API | `/api/v1/native/*` |
| UITabBar + buildTabs | `src/lib/native/tabBar.ts`, `shell.ts` (Liquid Glass) |
| Beveiligde opslag | Keychain/Keystore via platformadapter |
| check:native-config | `native:store-readiness`, `native:parity:check` |

## Verschillen die we bewust houden

- Versado deelt de client met Next-pagina's via adapters in plaats van één SPA, omdat de
  website bestaande SSR-pagina's en beheer heeft.
- Expliciete route-allowlists in TS, Swift en Java (strikter dan Ringtools).

## Wat we overnemen

- Eén set tabs, gedeeld door native en React (`nativePrimaryNav`).
- Een optionele web-build van dezelfde bundel (later, niet nu).
- Eenvoud: geen per-tab backendarchitectuur.
