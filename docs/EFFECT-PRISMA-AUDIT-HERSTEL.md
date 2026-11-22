# Effect/Prisma: herstel GHSA-7589-6fvf-x4pw

Basis: develop `ce2830aa6018dfc83da4c7993d6069d4779804b5`.
Deze correctie staat los van #295 en #297. Prisma CLI, Client en pg-adapter blijven
7.10.0; schema, migraties, CFM, signing en distributievoorwaarden veranderen niet.

## Oorzaak en keuze

Schone `npm ci`, `npm ls effect @prisma/config prisma --all` en
`npm audit --omit=dev --audit-level=high` reproduceren:

```text
prisma@7.10.0 → @prisma/config@7.10.0 → effect@3.20.0
3 high meldingen uit deze ene afhankelijkheidsketen
```

De [Effect-advisory](https://github.com/Effect-TS/effect/security/advisories/GHSA-7589-6fvf-x4pw)
beschrijft polynomiale regex-backtracking bij `Schema.TemplateLiteral` met meerdere
stringdelen. [Effect 3.22.1](https://github.com/Effect-TS/effect/releases/tag/effect%403.22.1)
bevat de officiële reparatie: een lineaire matcher voor deze stringdelen
([upstreamwijziging #6761](https://github.com/Effect-TS/effect/pull/6761)).

Gecontroleerd op 21 november 2026: de laatste stabiele Prisma 7-versie is 7.10.1.
`npm view prisma@7.10.1 dependencies --json` en
`npm view @prisma/config@7.10.1 dependencies --json` tonen nog steeds Effect 3.20.0.
Prisma's `latest`-tag wijst naar 8.0.0-rc.34, geen compatibele stabiele patch voor
onze Prisma 7-installatie. Npm stelt als automatische auditfix een downgrade naar
Prisma 6.12.0 voor; die wordt niet uitgevoerd.

We gebruiken de [gedocumenteerde npm-override](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides),
uitsluitend voor Effect onder de bestaande configversie:

```json
"@prisma/config@7.10.0": { "effect": "3.22.1" }
```

Dit gebruikt de officiële Effect-patch binnen dezelfde majorversie. Het is een
geteste tijdelijke override, geen door Prisma uitgebrachte dependencyfix.
Zodra een compatibele Prisma-release de gepatchte dependency zelf bevat, kan de
override na dezelfde verificatie vervallen. Andere Effect-consumenten en toekomstige
Prisma-configversies worden niet stilzwijgend overschreven.

Het lockbestand wijzigt uitsluitend de versie, tarball-URL en integriteit van
`node_modules/effect`. De oorspronkelijke dependencydeclaratie `effect: 3.20.0`
bij `@prisma/config` blijft upstreammetadata; de geïnstalleerde code is 3.22.1.
Daarom controleren we de werkelijk door Prisma opgeloste module en alle opgeloste
Effect-kopieën, in plaats van tekstueel op dat versienummer te zoeken.

## Controleerbaar bewijs

Na schone volledige én productie-installatie (`npm ci --omit=dev`):

```sh
npm ls effect @prisma/config prisma --all
npm audit --omit=dev --audit-level=high
node --test tests/prisma-effect-security.test.mjs
```

Uitkomst: uitsluitend `effect@3.22.1 overridden`; productie-audit nul kwetsbaarheden.
De volledige audit inclusief development-dependencies meldt nul high/critical en
9 moderate meldingen buiten deze Effect-keten, identiek aan de ongewijzigde
develop-basis; die worden niet als nul voorgesteld.
De nieuwe regressietest draait mee in het bestaande `npm run test:security`:

- de werkelijk door Prisma geladen module en het lockbestand bevatten de patch;
- geldige template-invoer blijft geldig, de gedocumenteerde aanval met 100.000
  dubbele punten wordt afgewezen in een eigen proces met begrensde testduur;
- Prisma laadt geldige schema-/migratiepaden en weigert een onjuist schematype.

De testdeadline verandert geen database-, server- of productielimiet. De bestaande
auditopdracht, auditdrempel en workflows blijven ongewijzigd. Aanvullende resultaten
van generate, Client/pg-databaseservices, build, TypeScript, native contracten en
beveiligingsintegratie staan met de exacte CI-head in de PR-beschrijving.

## Samenloop en veilige integratie

Het [picomatch-advies achter #295](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
is officieel ingetrokken op 18 november 2026. #295 is niet nodig voor de huidige
auditvrijgave. De OSMD-update en verwijdering van de optionele native `gl`-keten
kunnen nog zinvol dependencyonderhoud zijn, met eigen review en renderacceptatie.
Die wijzigingen worden hier niet overgenomen. Controleer bij latere integratie
beide lockfilewijzigingen inhoudelijk; kies niet blind één volledige lockfilekant.

Laat deze security-PR eerst onafhankelijk reviewen, alle relevante CI op zijn
laatste commit afronden en alleen met eigenaarstoestemming naar develop mergen.
Daarna kan actuele develop met een gewone merge in de bestaande featurebranch van
#297 worden opgenomen, zonder cherry-pick van deze correctie of force-push.
Dat is nog geen merge van #297 naar develop.

Controleer de nieuwe #297-head opnieuw: schone `npm ci`, audit, generate, TypeScript,
productiebuild, cursusvolgorde via echte dispatch/handlers, de 60 mobiele
progressiegevallen en de bestaande Native Foundation/iOS/Android-controles.
Eerdere groene resultaten gelden niet automatisch voor die nieuwe commit.
Pas na onafhankelijke GO-review, groene actuele CI en eigenaarstoestemming kan
#297 naar develop worden gemerged. NAS-uitrol, signing en TestFlight-upload blijven
afzonderlijke eigenaarsbesluiten. CFM blijft gepauzeerd; integriteitscontroles intact.
