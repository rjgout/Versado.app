# TestFlight CI-herstel — 10 november 2026

## Audio / #267

Run 42831721588 faalde in de originele vijf-talencollectietest met PostgreSQL
55P03. `officialJobs.ts` en de oorspronkelijke integratietest waren bytegelijk
aan develop e1c47081; de nieuwe proxy veroorzaakt dus geen gewijzigde audiocode.
De originele volledige keten slaagde lokaal (65 tests); de natuurlijke
CI-mislukking is niet bij iedere uitvoering reproduceerbaar.

Een lokale pg_stat_activity/pg_blocking_pids-opname toont concurrente aanvragen
achter dezelfde transactionele policy-advisorylock (726540108), onder andere
terwijl de eigenaar COMMIT/WALSync uitvoert. Dit bewijst lockcontentie, geen
bewezen deadlock of exacte oorzaak van de vertraging op de GitHub-runner.

Een echte PostgreSQL-barrière reproduceert de ontbrekende afhandeling: laat de
eerste lockpoging afbreken, geef de lock vrij en probeer dezelfde opdracht.
De nieuwe gerichte proef faalt op originele develop met 55P03 en slaagt met de
reparatie. Alleen een bewezen teruggedraaide voorbereidings-transactie mag
precies eenmaal opnieuw beginnen (55P03/40P01, of Prisma P2034). Onbekende commit-
uitkomsten, netwerkfouten en Prisma P2028 worden niet herhaald. Beide pogingen
controleren beheerrol, sessieversie, policy en taak opnieuw. De proef trekt de
beheerrol tussen pogingen in en controleert dat de tweede poging wordt geweigerd.

Alle locks, SQL-/Prisma-time-outs, bestaande asserties en parallelle aanvragen
blijven intact. De langdurig bezette policylock blijft DATABASE_BUSY geven,
zonder taak en binnen de bestaande testgrens. Geen download/publicatie/registratie
wordt door deze retry opnieuw uitgevoerd. De volledige gerepareerde keten slaagt:
30 library-, 24 official- en 12 legacy-integratietests (66 totaal).

## Totale CI-looptijd / #268

GitHub-check 129879423613 meldt letterlijk:
`The job has exceeded the maximum execution time of 30m0s`.
Run 42830588168 had de reader-/annotatieketen voltooid en werd tijdens de laatste
Audio V2-stap afgebroken. Alleen het budget van de gehele CI-job wordt 40 minuten;
geen database-, transactie-, browser- of beveiligingsdeadline verandert daardoor.

## Bewijsgrenzen

Dit is lokaal en synthetisch bewijs; geen live Cloudflare/NAS-acceptatie,
Apple-signing, upload of iPhone-acceptatie. Actuele checks moeten aan de nieuwe
headcommits worden gekoppeld; historische groene runs zijn geen vervanging.
