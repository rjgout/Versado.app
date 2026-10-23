# Accountverwijdering met herauthenticatie (WP4, deel 1)

Status: **technisch geïmplementeerd voor accounts met wachtwoord, op web en native.** Juridische bewaartermijnen, de
publieke pagina, het native scherm en Apple-tokenintrekking zijn bewust nog niet gedaan (zie §7). Ontwerpachtergrond:
`docs/NATIVE-WP4-ACCOUNTVERWIJDERING.md` (PR #199).

## 1. Wat er is veranderd

| Onderdeel | Voor | Nu |
|---|---|---|
| Web `DELETE /api/account` | Alleen een sessiecookie volstond | Vers bewijs vereist: wachtwoord, plus TOTP- of herstelcode bij 2FA; expliciete bevestiging `confirm: "DELETE"`; origin/same-site/JSON-controle; `authBudget` (5 per 15 min per account) |
| Native | Geen verwijdercontract | `DELETE /api/v1/native/account` (capability `account-deletion-v1`), zelfde service en regels |
| `src/lib/accountDeletion.ts` | `deleteUserAccount(userId)` | Ongewijzigd gedrag voor beheer en opschoning; optioneel `expectedSessionVersion` voor zelf wissen (`AccountDeletionConflict`) |
| Gedeelde service | — | `src/lib/account/deletion.ts` `deleteAccountWithReauthentication`; contract `accountDeletionSchema` in `src/lib/account/contracts.ts` |
| Web-UI | Knop met bevestigingsdialoog | Knop opent `/account-verwijderen` (ingelogd) met `AccountDeletionForm`; hetzelfde formulier is bruikbaar in native via `AccountActionsProvider` |

## 2. Beveiligingsontwerp

- **Bewijs en lock:** controle onder `SELECT … FOR UPDATE` op de User-rij (zoals wachtwoordwijziging en native refresh). Het bewijs is
  gebonden aan `actor.id` én `actor.sessionVersion`; een andere sessieversie of een onbekend account geeft `session_changed` en wist niets.
- **Geen accountverwisseling:** het wachtwoord van account A kan nooit account B verwijderen (de actor komt uit de sessie, niet uit de invoer).
- **Eenmalig en idempotent:** na verwijdering bestaat de User niet meer; een herhaling geeft 401 (cookie/Bearer ongeldig). Gelijktijdige
  verzoeken: precies één verwijdert; de overigen krijgen `session_changed` of een no-op. Een herstelcode wordt atomair (compare-and-set) verbruikt, dus
  door twee gelijktijdige verzoeken maximaal één keer.
- **Mislukte poging heeft geen bijwerkingen:** geen groepen verlaten, geen sockets gesloten, geen wijziging van het account.
- **Begrenzing:** `authBudget("account-delete")` per account, plus de bestaande 2FA-foutenteller (5 per 15 min, daarna `too_many_attempts` ook met de juiste code).
- **CSRF/origin:** `server.ts` past `requestSecurityError` toe op elke API-mutatie; de route doet dezelfde controle nogmaals (defense in depth).
  Bij native geldt de bestaande Bearer-sessie plus de native origin/clientcontrole.
- **Sessies en sockets:** `NativeSession` en `ExternalIdentity` cascaderen mee; `disconnectUserSockets` sluit de verbindingen van het account (alleen na een geslaagde verwijdering).
  De web-cookie wordt gewist; een oude cookie verwijst naar een niet-bestaande User.
- **Beheer:** de laatste beheerder kan zichzelf niet verwijderen (`last_admin`, 409). Dit is nieuw gedrag; eerder kon dat wel en bleef er geen beheerder over.
- **Native client:** na succes wist `client.logout` de lokale sessie in Keychain/Keystore; er is geen automatische herhaling van het verwijderverzoek
  (alleen de bestaande token-refresh bij een verlopen toegangstoken vóór uitvoering).

## 3. Foutcodes

| Code | HTTP | Betekenis |
|---|---|---|
| `wrong_password` / `wrong_code` | 401 | Bewijs onjuist (native: beide `wrong_credentials`) |
| `two_factor_required` | 400 | 2FA staat aan en er is geen code meegestuurd |
| `too_many_attempts` | 429 | Budget of 2FA-teller bereikt |
| `session_changed` | 401 (web: `session_expired`) / 409 (native) | Sessieversie of account veranderd of al verwijderd |
| `last_admin` | 409 | Enige beheerder |
| `reauthentication_unavailable` | 409 | Account zonder wachtwoord (alleen Apple): zie §4 |

## 4. Accounts zonder wachtwoord (alleen Apple): specificatie, nog niet geïmplementeerd

**Waarom niet nu:** zo'n account heeft geen wachtwoord; een veilig bewijs vraagt een verse Apple-identiteit, en Apple verlangt bij
verwijdering intrekking van het token. Beide hangen af van Apple-configuratie van de eigenaar. De service weigert daarom met
`reauthentication_unavailable` en wijzigt niets. **Dit sluit niemand buiten die nu kon verwijderen:** een Apple-only account heeft geen
webinlog (`passwordLoginEnabled=false`) en had geen native verwijderroute. Beheerderverwijdering (`/api/admin/users/[userId]`) blijft bestaan.

**Voorgestelde route (na D4 en Apple-gegevens):**
1. *Verse identiteit:* nieuwe challenge-intentie `reauth` in `NativeAuthChallenge` (`intent` is een vrij tekstveld, dus geen migratie). De client doet Sign in with Apple;
   de server verifieert met `verifyAppleIdentity` (nonce, audience, issuer), eist dat `subject` gelijk is aan de bestaande `ExternalIdentity` van dit account en claimt de challenge atomair en eenmalig.
2. *Intrekking zonder opgeslagen token:* de client stuurt ook de `authorizationCode` mee. De server wisselt die bij `POST https://appleid.apple.com/auth/token` voor een refresh-token en roept
   direct `POST https://appleid.apple.com/auth/revoke` aan, met een client secret (ES256-JWT) uit het Team ID, de Key ID en de `.p8`-sleutel van de eigenaar. Er hoeft dus geen Apple-token versleuteld bewaard te worden en er is geen schemawijziging nodig.
3. *Volgorde:* eerst intrekken (korte tijdslimiet, herhaling), daarna verwijderen. Mislukt de intrekking, dan blijft het account bestaan en krijgt de gebruiker een duidelijke melding; er is geen halve verwijdering.
4. *Bewijs:* het Apple-bewijs vervangt het wachtwoord in hetzelfde contract (`appleProof` i.p.v. `password`), gebonden aan gebruiker, sessieversie en doel `delete`, maximaal 5 minuten geldig, eenmalig.
5. *Server-to-server-meldingen* (consent ingetrokken, account verwijderd) op een aparte, ondertekende route.

**Ook voor accounts met wachtwoord én Apple-koppeling** ontbreekt nu de Apple-intrekking (zoals vóór deze wijziging). Zodra de route bestaat, wordt intrekking daar verplicht gesteld. Eigenaarsbesluit D4 bepaalt of Sign in with Apple in 1.0 zit.

## 5. Tests (geïsoleerde database, synthetische accounts)

`tests/account-deletion.integration.test.ts` (opgenomen in `npm run test:native:integration`, ook lokaal draaibaar tegen een eigen testdatabase en een lokale server):
verkeerd wachtwoord, verlopen/gewijzigde sessie, accountverwisseling, verouderde sessieversie in de gedeelde procedure, TOTP (zonder, fout, geldig), herstelcode (eenmalig, gelijktijdig),
blokkade na vijf foute codes, gelijktijdige verzoeken, Apple-only, laatste beheerder, cascade van sessies en identiteiten, sluiten van sockets, beheer/opruimen ongewijzigd, web (cookie-only geweigerd,
cross-origin/same-site/niet-JSON geweigerd, cookie gewist, herhaling 401, TOTP, 409's) en native (401/400/409/429, ongeldige sessie na verwijdering).
`tests/security-policy.test.ts` bewaakt de origin-/JSON-grenzen voor `DELETE /api/account`. `tests/native-store-readiness.test.mjs` bewaakt dat het blokkade pas sluit met een native scherm en een openbare webpagina.

## 6. Technisch veilig versus openstaand

| Technisch veilig geïmplementeerd (deze PR) | Nog openstaand |
|---|---|
| Herauthenticatie op web en native, budgetten, idempotentie, lock, sessie-/socketintrekking, laatste-beheerderbeveiliging | Juridische bewaartermijnen en wat bij verwijdering bewust blijft (D8, eigenaar) |
| Gedeelde service en formulier voor web én native | Publieke pagina `/account-verwijderen` (zonder login), native scherm, `/voorwaarden` |
| Duidelijke weigering voor Apple-only (niets beschadigd) | Apple-bewijs en tokenintrekking (D4, Team ID, Key ID, `.p8`) |
| Geen schemawijziging, geen migratie, geen productiegegevens | Inventaris van persoonsgegevens, logs en back-ups (feitelijk, apart) |

## 7. Wat niet is veranderd

Registratie, e-mailbevestiging, admin-verwijdering, periodieke opschoning, privacyverklaring en alle bewaartermijnen. De cascade-regels in `prisma/schema.prisma` zijn ongewijzigd.
