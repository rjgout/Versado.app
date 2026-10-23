#!/usr/bin/env bash
# Installeert Chromium met systeemafhankelijkheden voor de browsertests in CI: `bash scripts/ci/install-browser.sh <playwright-cli...>`.
# `playwright install --with-deps` draait apt en een download; die stap bleef soms bijna 30 minuten hangen en liet een verder
# geslaagde run mislukken. Elke poging heeft daarom een tijdslimiet en een mislukte of trage poging wordt herhaald.
set -uo pipefail
if [ "$#" -eq 0 ]; then echo "Gebruik: install-browser.sh <playwright-cli...>" >&2; exit 2; fi
limit="${BROWSER_INSTALL_TIMEOUT:-8m}"

# `timeout` stopt alleen de Playwright-CLI; het apt-get-proces dat die als root startte loopt door en houdt het dpkg-slot vast.
# Een nieuwe poging direct erna faalt dan op dat slot, dus eerst wachten tot apt klaar is (het afmaken is veiliger dan afbreken).
wait_for_apt() {
  local waited=0
  while pgrep -x apt-get >/dev/null || pgrep -x apt >/dev/null || pgrep -x dpkg >/dev/null; do
    if [ "$waited" -ge 600 ]; then echo "Browserinstallatie: apt is na 10 minuten nog bezig." >&2; return 1; fi
    sleep 10; waited=$((waited + 10))
  done
}

for attempt in 1 2 3; do
  if timeout "$limit" "$@" install --with-deps chromium; then exit 0; fi
  echo "Browserinstallatie: poging ${attempt} van 3 mislukt of langer dan ${limit}." >&2
  wait_for_apt || true
  sleep $((attempt * 15))
done
exit 1
