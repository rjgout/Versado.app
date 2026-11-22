#!/bin/sh
# Alleen lezen. Voer uit op de NAS met de TWEE bestaande DEV-containernamen.
# Gebruik: sh scripts/native/check-dev-backend-readonly.sh DEV_APP_CONTAINER DEV_PROXY_CONTAINER
# Geen inspect van .Config.Env, geen raw logs, geen pull, restart of deployment.
set -eu
[ "$#" -eq 2 ] || { echo "Geef de bestaande DEV-app en DEV-proxy als twee argumenten."; exit 2; }
app="$1"
proxy="$2"
for container in "$app" "$proxy"; do
  case "$container" in ""|-*|*[!A-Za-z0-9_.-]*) echo "Ongeldige containernaam"; exit 2 ;; esac
  project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")
  stack=$(docker inspect --format '{{index .Config.Labels "com.docker.stack.namespace"}}' "$container")
  case "$container $project $stack" in
    *[Dd][Ee][Vv]*|*[Tt][Ee][Ss][Tt]*) ;;
    *) echo "Geen herkenbare DEV/test-identiteit; controle afgebroken: $container"; exit 2 ;;
  esac
  image=$(docker inspect --format '{{.Image}}' "$container")
  echo "Container: $container"
  docker inspect --format 'Image-reference: {{.Config.Image}}' "$container"
  docker image inspect --format 'RepoDigests: {{json .RepoDigests}}' "$image"
  docker image inspect --format 'OCI-revisie: {{index .Config.Labels "org.opencontainers.image.revision"}}' "$image"
done
echo "Audiomount op /data/audio (geen bronpad):"
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data/audio"}}aanwezig, schrijfbaar={{.RW}}{{end}}{{end}}' "$app"
echo "Alleen aantallen van geschoonde audio-redencategorieen (laatste 24 uur, maximaal 5000 logregels):"
docker logs --since 24h --tail 5000 "$app" 2>&1 | docker exec -i "$app" node -e '
let input="";
process.stdin.setEncoding("utf8");
process.stdin.on("data",chunk=>input+=chunk);
process.stdin.on("end",()=>{
 const blocks=input.match(/\[native-audio\] bron weggelaten\s+\{[\s\S]*?\}/g)||[];
 const known=new Set(["bestand_ontbreekt_op_server","oude_audio_niet_gespiegeld_naar_server","geen_audiocontrole_vastgelegd","tekst_wijkt_af_van_audiocontrole","tekst_gewijzigd_audio_ter_controle","opname_niet_gepubliceerd","opname_niet_toegankelijk","opname_hoort_bij_ander_hoofdstuk","versmarkeringen_ontbreken","versmarkeringen_onvolledig","ongeldige_gegevens","opslag_niet_beschikbaar","onveilig_pad","bestand_komt_niet_overeen","gespiegeld_bestand_komt_niet_overeen"]);
 const counts={};
 for(const block of blocks){
  const match=/\breden["\x27]?\s*:\s*["\x27]([a-z_]+)["\x27]/.exec(block);
  const reason=match&&known.has(match[1])?match[1]:"niet_herkend";
  counts[reason]=(counts[reason]||0)+1;
 }
 console.log(JSON.stringify({diagnosemeldingen:blocks.length,redenen:counts}));
 if(!blocks.length)console.log("Geen meldingen is geen bewijs dat opnames beschikbaar zijn; er kan nog geen audio-opvraag zijn gedaan.");
});'
