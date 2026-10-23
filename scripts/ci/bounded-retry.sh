#!/usr/bin/env bash
# Voert een commando uit met een tijdslimiet per poging en hoogstens drie pogingen.
# Bedoeld voor stappen die van een externe mirror afhangen (bv. de browserinstallatie met apt): normaal ~25 s,
# maar een trage mirror liet die stap eerder 11 minuten duren en de hele job in de jobtimeout lopen.
# Gebruik: bounded-retry.sh <commando> [argumenten...]
set -u
limit="${BOUNDED_RETRY_SECONDS:-240}"
for attempt in 1 2 3; do
  if timeout "$limit" "$@"; then exit 0; fi
  echo "Poging $attempt van 3 mislukte of duurde langer dan ${limit} s: $*" >&2
done
exit 1
