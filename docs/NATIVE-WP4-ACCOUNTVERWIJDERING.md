# WP4 — Accountverwijdering en juridische toegang (ontwerp ter goedkeuring)

Status: **ontwerp, nog geen code.** Het raakt authenticatie, gegevensverwijdering en juridische teksten; CLAUDE.md vraagt
dan eerst om voorlegging van de ontwerpbesluiten. Alle bevindingen hieronder zijn uit de huidige code gelezen.

## 1. Waarom (store-eisen)

- Apple (richtlijn 5.1.1(v)): wie een account in de app kan aanmaken, moet het ook in de app kunnen laten verwijderen; bij Sign in with Apple moet de
  tokenintrekking bij Apple volgen.
- Google Play: accountverwijdering vanuit de app én een publieke weblink buiten de app (Data safety).
- Beide stores: bereikbare privacyverklaring (bestaat: `/privacy`) en voorwaarden (ontbreekt).

## 2. Huidige stand (gelezen uit de code)

| Onderdeel | Stand |
|---|---|
| `src/lib/accountDeletion.ts` `deleteUserAccount(userId)` | Verlaat alle groepen, wist in één transactie met rijvergrendeling, sluit sockets. Eén gedeelde procedure voor zelf wissen, beheer en periodieke opschoning. Goed uitgangspunt. |
| Web `DELETE /api/account` | **Geen herauthenticatie**: een geldige sessiecookie volstaat; alleen een bevestigingsdialoog in `ProfileClient`. Voor stores en veiligheid te zwak. |
| Native API | Geen `DELETE account`; wel `DELETE apple` (ontkoppelen) en `POST account/password` met herauthenticatie-patroon (wachtwoord/TOTP). |
| `ExternalIdentity` (Apple) | Wordt bij verwijdering mee gecascade, maar er is geen REST-intrekking bij Apple (`appleRevoke.ts` bestaat niet). |
| `NativeSession` | `onDelete: Cascade`; sockets worden gesloten via `disconnectUserSockets`. |
| Publieke pagina's | `/privacy` bestaat; `/account-verwijderen` en `/voorwaarden` ontbreken. |
| E-mailbevestiging | Er is geen "account verwijderd"-bevestigingsmail. |

## 3. Voorgesteld ontwerp

### 3.1 Eén domeinservice, twee ingangen
Nieuwe `requestAccountDeletion({ userId, credential, source })` in `src/lib/account/` (geen Next-API-imports; ook bruikbaar
vanuit de eager-keten) die: herauthenticeert, `deleteUserAccount` aanroept en na succes sessies/sockets intrekt. Web en native
gebruiken dezelfde service; de bestaande web-route krijgt dezelfde herauthenticatie (geen tweede, zwakkere variant).

### 3.2 Herauthenticatie
- Wachtwoord (en TOTP-code als TOTP aan staat, herstelcode toegestaan), begrensd met `authBudget` zoals de andere
  wachtwoord-/TOTP-routes; fout geeft dezelfde foutcodes als `account/password`.
- Accounts zonder wachtwoord (alleen Apple): verse Apple-identiteitsbevestiging met nonce (bestaand `apple.ts`-patroon).
- Beheerders: de laatste beheerder kan zich niet zelf verwijderen (geen vergrendeling van het beheer).
- Geen sessie van een ander account of een verlopen sessie; native: `NativeSession`-versie controleren (zoals `account/password`).

### 3.3 Native contract
`DELETE /api/v1/native/account` (nieuw, versieerbaar, bestaande appversies ongewijzigd), body: herauthenticatiebewijs +
`confirm: "DELETE"`. Respons: `{ ok: true }`. Daarna wist de client Keychain/Keystore-sessie, lokale cache en luisteraars vóór
netwerkbevestiging van een accountwissel (bestaande regel in CLAUDE.md). Fouten: dezelfde codetabel als bij wachtwoordwijziging.

### 3.4 Apple-tokenintrekking (alleen als Sign in with Apple in 1.0 zit — D4)
Bij verwijdering van een account met `ExternalIdentity` (provider Apple): intrekken via Apple REST (`/auth/revoke`) met een
client secret uit de Team-gegevens van de eigenaar. Mislukt de intrekking, dan wordt het account **niet** half verwijderd:
eerst intrekken (met korte tijdslimiet en herhaling), daarna wissen; bij blijvende storing een duidelijke melding en een
herstelbare wachtrij zonder persoonsgegevens. Server-to-server-meldingen van Apple (consent revoked / account deleted) worden
verwerkt op een eigen, ondertekende route. Dit vereist het Team ID en een sleutel van de eigenaar.

### 3.5 Publieke pagina's
- `/account-verwijderen`: uitleg wat verwijderd wordt en wat niet (bewaartermijnen), hoe in de app, en een webformulier voor wie
  de app niet meer heeft: inloggen + herauthenticatie, of een verzoek per e-mail met bevestigingslink (geen enumeratie van
  accounts, altijd dezelfde melding). Toegankelijk zonder login, Nederlands bron, i18n in alle `uiReady`-talen.
- `/voorwaarden`: de **juridische tekst is een eigenaarsproduct**. Code levert alleen de pagina en de links (instellingen,
  registratie, storemetadata); `NATIVE_TERMS_URL` verwijst naar de echte pagina (bestaand mechanisme).

### 3.6 Wat verwijderd wordt
Alles wat nu cascadeert (voortgang, XP, vriendschappen, annotaties, quizresultaten, sessies, identiteiten). Voorstel om vast te
leggen wat bewust blijft (bijv. anoniem aggregaat, beheerlogregels zonder persoonsgegevens) en dat in de privacyverklaring op
te nemen. **Beslispunt voor de eigenaar** (zie §5).

### 3.7 Tests (verplicht, geïsoleerde database)
Herauthenticatie goed/fout/begrensd; TOTP aan; alleen-Apple-account; laatste beheerder; cascade-volledigheid (alle relaties
met `userId`); sockets en sessies gesloten; idempotentie bij dubbele aanroep; native contract (versie, foutcodes, geen
oplopende sessie na verwijdering); publieke pagina zonder login en zonder accountenumeratie; regressie op `ProfileClient`.

## 4. Volgorde
1. Domeinservice en herauthenticatie voor web **en** native (grootste gemene deler, geen eigenaarsdata nodig).
2. Publieke pagina `/account-verwijderen` (tekst-conform §3.6) en koppeling in profiel/instellingen.
3. Native scherm "Account verwijderen" (WP6-shell vereist; kan met de bestaande Foundation-schermen).
4. `/voorwaarden`-pagina met de tekst van de eigenaar.
5. Apple-intrekking pas na D4 en Team ID.

## 5. Beslissingen die alleen de eigenaar kan nemen
- D4: zit Sign in with Apple in 1.0? (bepaalt §3.4)
- D8: bewaartermijnen en wat bij verwijdering bewust blijft; tekst voor privacyverklaring.
- Juridische tekst van de voorwaarden, supportcontact en verantwoordelijke partij.
- Bevestiging dat het verwijderen **direct** gebeurt (huidig gedrag), niet na een bedenktijd (Apple staat een korte
  bedenktijd toe, Google verlangt een duidelijke route).
