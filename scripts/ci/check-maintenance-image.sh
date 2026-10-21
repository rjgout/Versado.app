#!/usr/bin/env bash
# Controleert een gebouwde onderhoudsimage (Dockerfile --target maintenance) zonder productie of geheimen:
#   check-maintenance-image.sh <image> <postgres-url-van-een-wegwerpdatabase>
# De database is uitsluitend een wegwerpdatabase van de CI-run (host 127.0.0.1); het script weigert elke andere doel.
set -euo pipefail

IMAGE="${1:?image ontbreekt}"
DB_URL="${2:?wegwerpdatabase-URL ontbreekt}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo "Weigering: alleen een lokale wegwerpdatabase is toegestaan." >&2; exit 2 ;;
esac

run() { docker run --rm --network host "$@"; }
fail() { echo "MISLUKT: $*" >&2; exit 1; }

echo "== 1. De onderhoudsscripts en de productiecode zitten in de image"
run "$IMAGE" sh -c 'for f in scripts/courses/audit-duplicates.ts scripts/courses/repair-duplicates.ts scripts/courses/target.ts src/lib/courseRepair.ts src/lib/courseIntegrity.ts src/generated/prisma/client.ts prisma.config.ts; do test -f "$f" || { echo "ontbreekt: $f"; exit 1; }; done'

echo "== 2. De standaard-CMD start niets (geen migraties, geen server)"
OUT="$(run "$IMAGE" 2>&1)"; echo "$OUT"
echo "$OUT" | grep -q "start niets zelf" || fail "onverwachte standaarduitvoer"
echo "$OUT" | grep -qi "migrat" && fail "de standaard-CMD mag geen migraties noemen of draaien"

echo "== 3. Zonder DATABASE_URL: duidelijke fout, geen ERR_MODULE_NOT_FOUND"
for script in courses:audit courses:repair; do
  set +e; OUT="$(run "$IMAGE" npm run "$script" 2>&1)"; CODE=$?; set -e
  [ "$CODE" -ne 0 ] || fail "$script zonder DATABASE_URL moet falen"
  echo "$OUT" | grep -q "ERR_MODULE_NOT_FOUND" && fail "$script: module niet gevonden"
  echo "$OUT" | grep -q "DATABASE_URL is niet gezet" || fail "$script: verwachte melding ontbreekt: $OUT"
done

echo "== 4. --apply weigert zonder bevestiging, vóór er een databaseverbinding wordt gemaakt"
set +e; OUT="$(run -e DATABASE_URL="$DB_URL" "$IMAGE" npm run courses:repair -- --apply --backup-gemaakt 2>&1)"; CODE=$?; set -e
[ "$CODE" -eq 2 ] || fail "--apply zonder database-identiteit moet met exitcode 2 weigeren (was $CODE): $OUT"
echo "$OUT" | grep -q "Weigering" || fail "weigering ontbreekt"
echo "$OUT" | grep -q "Doeldatabase" || fail "doeldatabase wordt niet getoond"
SECRET="$(printf '%s' "$DB_URL" | sed -E 's#^postgresql://[^:]+:([^@]*)@.*#\1#')"
[ -z "$SECRET" ] || ! echo "$OUT" | grep -qF "$SECRET" || fail "het wachtwoord staat in de uitvoer"

echo "== 5. Migraties op de wegwerpdatabase, daarna audit en dry-run met dezelfde Prisma-client"
run -e DATABASE_URL="$DB_URL" "$IMAGE" npx prisma migrate deploy >/dev/null
run -e DATABASE_URL="$DB_URL" "$IMAGE" npm run courses:audit >/dev/null 2>&1 || fail "audit zonder duplicaten moet slagen"

echo "== 6. Met een gesimuleerd duplicaat: audit meldt het (exitcode 1), de dry-run wijzigt niets"
psql_run() { docker run --rm --network host -e PGPASSWORD="$SECRET" postgres:16-alpine psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt "$@"; }
psql_run -c "INSERT INTO \"Course\"(id,slug,type,name,\"order\",\"contentCollectionId\") VALUES ('ci_a','vrije-keuze','FREE_CHOICE','Vrije keuze',0,'content_bom'),('ci_b','vrije-keuze-boek-van-mormon','FREE_CHOICE','Vrije keuze',0,'content_bom')"
FINGERPRINT='SELECT count(*) || md5(coalesce(string_agg(t::text, $$|$$ ORDER BY t::text), $$$$)) FROM "Course" t'
BEFORE="$(psql_run -c "$FINGERPRINT")"
set +e; run -e DATABASE_URL="$DB_URL" "$IMAGE" npm run courses:audit >/dev/null 2>&1; CODE=$?; set -e
[ "$CODE" -eq 1 ] || fail "audit moet duplicaten melden met exitcode 1 (was $CODE)"
OUT="$(run -e DATABASE_URL="$DB_URL" "$IMAGE" npm run courses:repair 2>&1)"
echo "$OUT" | grep -q "Dry-run: er is niets gewijzigd" || fail "dry-run meldt zichzelf niet als dry-run"
[ "$(psql_run -c "$FINGERPRINT")" = "$BEFORE" ] || fail "audit of dry-run heeft databasegegevens gewijzigd"

echo "== 7. Met een aparte alleen-lezen databasegebruiker (scripts/courses/readonly-role.sql): audit en dry-run werken, schrijven faalt"
DB_NAME="${DB_URL##*/}"; HOST_PART="${DB_URL#*@}"; RO_PASSWORD="ro-ci-wachtwoord-$RANDOM$RANDOM"
RO_URL="postgresql://courses_ro_ci:${RO_PASSWORD}@${HOST_PART}"
docker run --rm --network host -e PGPASSWORD="$SECRET" -v "$(pwd)/scripts/courses/readonly-role.sql:/readonly-role.sql:ro" postgres:16-alpine \
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -v rolnaam=courses_ro_ci -v database="$DB_NAME" -f /readonly-role.sql
# Het SQL-bestand maakt de rol zonder wachtwoord en zonder inlogrecht (NOLOGIN); inloggen kan pas na wachtwoord + LOGIN (in de documentatie via \password).
set +e; OUT="$(docker run --rm --network host postgres:16-alpine psql "postgresql://courses_ro_ci:geenwachtwoord@${HOST_PART}" -c 'select 1' 2>&1)"; CODE=$?; set -e
[ "$CODE" -ne 0 ] || fail "de rol mag niet kunnen inloggen vóór wachtwoord en LOGIN"
psql_run -c "ALTER ROLE courses_ro_ci LOGIN PASSWORD '$RO_PASSWORD'"
BEFORE_RO="$(psql_run -c "$FINGERPRINT")"
# Bewust zonder DATABASE_URL: alleen de alleen-lezen verbinding is aanwezig, zoals in de onderhoudsstack.
set +e; OUT="$(run -e COURSES_READONLY_DATABASE_URL="$RO_URL" "$IMAGE" npm run courses:audit 2>&1)"; CODE=$?; set -e
[ "$CODE" -eq 1 ] || fail "audit met alleen-lezen gebruiker moet duplicaten melden met exitcode 1 (was $CODE): $OUT"
echo "$OUT" | grep -q "via COURSES_READONLY_DATABASE_URL" || fail "audit toont niet via welke verbinding hij draait"
OUT="$(run -e COURSES_READONLY_DATABASE_URL="$RO_URL" "$IMAGE" npm run courses:repair 2>&1)" || fail "dry-run met alleen-lezen gebruiker moet slagen: $OUT"
echo "$OUT" | grep -q "Dry-run: er is niets gewijzigd" || fail "dry-run met alleen-lezen gebruiker meldt zichzelf niet als dry-run"
echo "$OUT" | grep -qF "$RO_PASSWORD" && fail "het alleen-lezen wachtwoord staat in de uitvoer"
set +e; OUT="$(run -e COURSES_READONLY_DATABASE_URL="$RO_URL" "$IMAGE" npm run courses:repair -- --apply --backup-gemaakt --verwacht-database="127.0.0.1:${HOST_PART##*:}" 2>&1)"; CODE=$?; set -e
[ "$CODE" -ne 0 ] || fail "--apply met alleen een alleen-lezen verbinding moet falen"
echo "$OUT" | grep -q "Geen schrijfverbinding" || fail "--apply gebruikt de alleen-lezen verbinding niet als schrijfverbinding: $OUT"
for statement in "UPDATE \"Course\" SET name = 'x'" "DELETE FROM \"Course\"" "SELECT \"passwordHash\" FROM \"User\""; do
  set +e; OUT="$(docker run --rm --network host postgres:16-alpine psql "$RO_URL" -v ON_ERROR_STOP=1 -c "$statement" 2>&1)"; CODE=$?; set -e
  [ "$CODE" -ne 0 ] || fail "PostgreSQL liet de alleen-lezen gebruiker toe: $statement"
  echo "$OUT" | grep -qE "read-only transaction|permission denied" || fail "onverwachte fout voor $statement: $OUT"
done
[ "$(psql_run -c "$FINGERPRINT")" = "$BEFORE_RO" ] || fail "de alleen-lezen controles hebben databasegegevens gewijzigd"

echo "Onderhoudsimage in orde."
