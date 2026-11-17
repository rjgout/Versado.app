#!/usr/bin/env bash
# Maakt de wegwerp-mediamap met de vereiste markering voor synthetische studielessen (alleen in het bestaande testprofiel:
# STUDY_PUBLICATION_PROFILE=synthetic-test, database versado_content_access_test op 127.0.0.1). De beveiligingscontroles van
# de studieopslag worden niet omzeild: de map voldoet gewoon aan dezelfde eisen (eigen map, geen symlink, markering).
set -euo pipefail
: "${STUDY_MEDIA_DIR:?STUDY_MEDIA_DIR ontbreekt}"
mkdir -p "$STUDY_MEDIA_DIR"
chmod 700 "$STUDY_MEDIA_DIR"
[ -f "$STUDY_MEDIA_DIR/.versado-study-volume.json" ] || printf '{"version":1,"purpose":"versado-study-media","volumeId":"%s"}' "$(python3 -c 'import uuid;print(uuid.uuid4())')" > "$STUDY_MEDIA_DIR/.versado-study-volume.json"
