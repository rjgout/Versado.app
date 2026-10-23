#!/usr/bin/env bash
# Installeert Chromium met systeemafhankelijkheden voor de browsertests in CI: `bash scripts/ci/install-browser.sh <playwright-cli...>`.
# `playwright install --with-deps` draait apt en een download; die stap bleef soms bijna 30 minuten hangen en liet een verder
# geslaagde run mislukken. Elke poging heeft daarom een tijdslimiet en een mislukte of trage poging wordt herhaald.
set -uo pipefail
if [ "$#" -eq 0 ]; then echo "Gebruik: install-browser.sh <playwright-cli...>" >&2; exit 2; fi
limit="${BROWSER_INSTALL_TIMEOUT:-6m}"
for attempt in 1 2 3; do
  if timeout "$limit" "$@" install --with-deps chromium; then exit 0; fi
  echo "Browserinstallatie: poging ${attempt} van 3 mislukt of langer dan ${limit}." >&2
  sleep $((attempt * 15))
done
exit 1
