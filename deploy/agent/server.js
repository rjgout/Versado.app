// Kleine, bewust afgeschermde hulpdienst die namens de adminbackend van
// jehova-app (zie src/lib/deployAgent.ts) de daadwerkelijke Docker-acties
// uitvoert: onderhoudsmodus aan/uit, en de veilige deploy-pijplijn (vlag aan
// -> nieuwe image pullen -> jehova-app vervangen -> healthcheck -> vlag uit
// of terugrollen). Draait apart van jehova-app omdat jehova-app zelf tijdens
// een deploy net vervangen wordt — dat proces kan dus niet zichzelf
// aansturen, dit moet in een ander, ondertussen ongemoeid blijvend proces
// gebeuren (zie CLAUDE.md-sectie "Deploymentproces").
//
// Bewust geen npm-dependencies: alleen Node's eigen http/fs/child_process,
// en de "docker"-CLI (zie Dockerfile) tegen de gemounte Docker-socket.
//
// Veiligheid: deze dienst heeft via de gemounte socket effectief
// rootrechten over de hele Docker-daemon van de NAS. Daarom:
//  - geen host-poort gepubliceerd, alleen bereikbaar op het interne
//    Docker-netwerk;
//  - elk verzoek moet een gedeeld geheim meesturen (AGENT_TOKEN), hetzelfde
//    geheim dat jehova-app gebruikt (zie DEPLOY_AGENT_TOKEN);
//  - er is maar een vast, klein aantal acties mogelijk (geen generieke
//    shell/exec-doorgeefluis).
import { createServer } from "http";
import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { timingSafeEqual } from "crypto";

const PORT = Number(process.env.PORT || 4000);
const AGENT_TOKEN = process.env.AGENT_TOKEN || "";
const APP_CONTAINER_NAME = process.env.APP_CONTAINER_NAME || "jehova-app";
const APP_IMAGE_FALLBACK = process.env.APP_IMAGE || "ghcr.io/rjgout/jehova-app:latest";
const APP_BRANDING_VOLUME = process.env.APP_BRANDING_VOLUME || "";
const APP_BRANDING_DESTINATION = process.env.APP_BRANDING_DESTINATION || "/data/branding";
const FLAG_DIR = "/flag";
const FLAG_PATH = `${FLAG_DIR}/maintenance.on`;
const DEPLOY_FLAG_PATH = `${FLAG_DIR}/maintenance.deploy`;
const MANUAL_FLAG_PATH = `${FLAG_DIR}/maintenance.manual`;
const STATE_DIR = "/state";
const LAST_GOOD_IMAGE_PATH = `${STATE_DIR}/last-good-image`;

// Ruim genoeg voor een trage NAS-internetverbinding; ver boven de normale
// paar seconden/minuten die een pull in de praktijk kost.
const PULL_TIMEOUT_MS = 10 * 60 * 1000;
// Dekt de Docker-HEALTHCHECK van jehova-app zelf (start_period 20s +
// interval 30s * retries 3 = ~110s) met ruime marge voor een trage opstart.
const HEALTH_TIMEOUT_MS = 5 * 60 * 1000;
const HEALTH_POLL_INTERVAL_MS = 3000;
const MAINTENANCE_RECOVERY_INTERVAL_MS = 30 * 1000;

if (!AGENT_TOKEN) {
  console.error("AGENT_TOKEN ontbreekt — de agent weigert zonder dit geheim te starten.");
  process.exit(1);
}
for (const dir of [FLAG_DIR, STATE_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- Kleine, in-memory statusweergave voor de adminbackend (zie
// AdminDeployClient.tsx) — bewust niet gepersisteerd; na een herstart van
// de agent zelf (zeldzaam, en gebeurt nooit tijdens een lopende deploy van
// jehova-app) begint de weergave gewoon weer bij "idle". ---
const state = {
  phase: "idle", // idle | pulling | stopping | starting | healthchecking | success | failed_rolled_back | failed_critical
  message: "Niets aan de hand.",
  updatedAt: new Date().toISOString(),
  logs: [],
};
let busy = false;

function log(message) {
  state.logs.push({ ts: new Date().toISOString(), message });
  if (state.logs.length > 200) state.logs.shift();
  console.log(message);
}

function setPhase(phase, message) {
  state.phase = phase;
  state.message = message;
  state.updatedAt = new Date().toISOString();
  log(message);
}

function readLastGoodImage() {
  try {
    return readFileSync(LAST_GOOD_IMAGE_PATH, "utf8").trim() || null;
  } catch {
    return null;
  }
}
function writeLastGoodImage(id) {
  writeFileSync(LAST_GOOD_IMAGE_PATH, id);
}

function touchMaintenanceFlag() {
  writeFileSync(FLAG_PATH, "");
  rmSync(MANUAL_FLAG_PATH, { force: true });
  writeFileSync(DEPLOY_FLAG_PATH, "");
}
function touchManualMaintenanceFlag() {
  writeFileSync(FLAG_PATH, "");
  rmSync(DEPLOY_FLAG_PATH, { force: true });
  writeFileSync(MANUAL_FLAG_PATH, "");
}
function clearMaintenanceFlag() {
  rmSync(FLAG_PATH, { force: true });
  rmSync(DEPLOY_FLAG_PATH, { force: true });
  rmSync(MANUAL_FLAG_PATH, { force: true });
}
function maintenanceIsOn() {
  return existsSync(FLAG_PATH);
}

/**
 * Een eerdere agentversie kende geen eigenaarsbestand. Zo'n oude vlag wordt
 * bewust als deployvlag behandeld: zodra de app gezond is, mag de site niet
 * onnodig in onderhoud blijven staan.
 */
async function recoverMaintenanceIfHealthy() {
  if (!maintenanceIsOn() || busy || existsSync(MANUAL_FLAG_PATH)) return;
  const healthy = await getHealthStatus(APP_CONTAINER_NAME).catch(() => null);
  if (healthy !== "healthy") return;
  clearMaintenanceFlag();
  log("Achtergebleven onderhoudsvlag automatisch verwijderd: de app is gezond.");
}

function safeDockerArgs(args) {
  let redactNext = false;
  return args.map((arg) => {
    if (redactNext) {
      redactNext = false;
      return `${arg.split("=", 1)[0]}=<redacted>`;
    }
    if (arg === "-e" || arg === "--env") redactNext = true;
    return arg;
  });
}

function runDocker(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: opts.timeout || 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`docker ${safeDockerArgs(args).join(" ")} mislukt: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function inspectContainer(name) {
  const out = await runDocker(["inspect", "--format", "{{json .}}", name]);
  return JSON.parse(out);
}

async function containerExists(name) {
  try {
    await inspectContainer(name);
    return true;
  } catch {
    return false;
  }
}

async function getHealthStatus(name) {
  const info = await inspectContainer(name);
  return info?.State?.Health?.Status || null;
}

function mountArgs(mounts) {
  const args = [];
  for (const mount of mounts || []) {
    const source = mount.Type === "volume" ? mount.Name : mount.Source;
    if (!mount.Type || !source || !mount.Destination) continue;
    const spec = [`type=${mount.Type}`, `source=${source}`, `destination=${mount.Destination}`];
    if (mount.RW === false) spec.push("readonly");
    if (mount.Type === "bind" && mount.Propagation) spec.push(`bind-propagation=${mount.Propagation}`);
    args.push("--mount", spec.join(","));
  }
  return args;
}

function hasMountAt(mounts, destination) {
  return (mounts || []).some((mount) => mount.Destination === destination);
}

// Herbouwt de container met een (mogelijk nieuwe) image, maar verder
// identiek aan wat er al draaide (omgeving, mounts, netwerken,
// herstartbeleid en labels) — zodat we niet hoeven te gokken naar de
// oorspronkelijke compose-configuratie die niet altijd als bestand op de NAS
// staat.
async function recreateContainer(name, image, templateFrom) {
  await runDocker(["rm", "-f", name]).catch(() => {});

  const args = ["create", "--name", name];
  for (const env of templateFrom?.Config?.Env || []) args.push("-e", env);
  for (const [key, value] of Object.entries(templateFrom?.Config?.Labels || {})) {
    args.push("--label", `${key}=${value}`);
  }
  const restartName = templateFrom?.HostConfig?.RestartPolicy?.Name;
  if (restartName && restartName !== "no") {
    const retries = templateFrom.HostConfig.RestartPolicy.MaximumRetryCount;
    args.push("--restart", restartName === "on-failure" && retries ? `on-failure:${retries}` : restartName);
  } else {
    args.push("--restart", "unless-stopped");
  }
  const networks = Object.keys(templateFrom?.NetworkSettings?.Networks || {});
  if (networks[0]) args.push("--network", networks[0]);
  const mounts = templateFrom?.Mounts || [];
  args.push(...mountArgs(mounts));
  if (APP_BRANDING_VOLUME && !hasMountAt(mounts, APP_BRANDING_DESTINATION)) {
    args.push("--mount", `type=volume,source=${APP_BRANDING_VOLUME},destination=${APP_BRANDING_DESTINATION}`);
  }
  args.push(image);

  await runDocker(args);
  for (const net of networks.slice(1)) {
    await runDocker(["network", "connect", net, name]).catch(() => {});
  }
  await runDocker(["start", name]);
}

async function waitForHealthy(name, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getHealthStatus(name).catch(() => null);
    if (status === "healthy") return true;
    if (status === "unhealthy") {
      // Nog niet meteen opgeven: retries lopen soms nog, maar we loggen dit
      // wel zodat het zichtbaar is in de statuslog.
      log(`${name}: Docker meldt "unhealthy", blijft pollen tot de timeout...`);
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

async function runDeploy() {
  if (busy) throw Object.assign(new Error("Er loopt al een deploy."), { code: "BUSY" });
  busy = true;
  try {
    const existed = await containerExists(APP_CONTAINER_NAME);
    if (!existed) {
      // Zonder een al draaiende container is er niets om de configuratie
      // (env-vars, netwerk, restartbeleid) van te klonen — deze knop is voor
      // het updaten van een al draaiende installatie, niet voor de allereerste
      // keer opstarten (dat gaat via Portainer/`docker compose up`, zie
      // docs/DEPLOY-SYNOLOGY.md Stap 2). Niets aangeraakt, dus geen
      // onderhoudsmodus nodig.
      setPhase("failed_critical", `${APP_CONTAINER_NAME} bestaat nog niet — start de stack eerst één keer via Portainer/docker compose.`);
      return;
    }

    setPhase("pulling", "Vorige versie vastleggen en nieuwe image ophalen...");
    const current = await inspectContainer(APP_CONTAINER_NAME);
    const previousImageId = current.Image;
    const imageRef = current.Config?.Image || APP_IMAGE_FALLBACK;

    touchMaintenanceFlag();

    await runDocker(["pull", imageRef], { timeout: PULL_TIMEOUT_MS });

    setPhase("stopping", `${APP_CONTAINER_NAME} stoppen en vervangen door de nieuwe versie...`);
    await runDocker(["stop", APP_CONTAINER_NAME]).catch(() => {});

    setPhase("starting", "Nieuwe container starten...");
    await recreateContainer(APP_CONTAINER_NAME, imageRef, current);

    setPhase("healthchecking", "Wachten tot de nieuwe versie zichzelf gezond meldt...");
    const healthy = await waitForHealthy(APP_CONTAINER_NAME, HEALTH_TIMEOUT_MS);

    if (healthy) {
      const newImageId = (await inspectContainer(APP_CONTAINER_NAME)).Image;
      writeLastGoodImage(newImageId);
      clearMaintenanceFlag();
      setPhase("success", "Nieuwe versie is gezond en live. Onderhoudsmodus staat weer uit.");
      return;
    }

    setPhase("stopping", "Nieuwe versie werd niet gezond — terugzetten naar de vorige versie...");
    const rollbackTarget = previousImageId || readLastGoodImage();
    if (!rollbackTarget) {
      setPhase("failed_critical", "Nieuwe versie faalt en er is geen vorige versie bekend om naar terug te vallen. Onderhoudsmodus blijft aan — handmatig ingrijpen nodig.");
      return;
    }

    await recreateContainer(APP_CONTAINER_NAME, rollbackTarget, current);
    const rolledBackHealthy = await waitForHealthy(APP_CONTAINER_NAME, HEALTH_TIMEOUT_MS);
    if (rolledBackHealthy) {
      clearMaintenanceFlag();
      setPhase("failed_rolled_back", "Nieuwe versie faalde de healthcheck; de vorige (werkende) versie is teruggezet en weer live. Onderhoudsmodus staat weer uit.");
    } else {
      setPhase("failed_critical", "Nieuwe versie faalde, en ook het terugzetten van de vorige versie werd niet gezond. Onderhoudsmodus blijft aan — handmatig ingrijpen nodig.");
    }
  } catch (err) {
    setPhase("failed_critical", `Onverwachte fout tijdens deployen: ${err.message}. Onderhoudsmodus blijft aan totdat dit is opgelost.`);
  } finally {
    busy = false;
  }
}

async function runRollback() {
  if (busy) throw Object.assign(new Error("Er loopt al een deploy."), { code: "BUSY" });
  const target = readLastGoodImage();
  if (!target) throw new Error("Geen eerder bekende goede versie om naar terug te gaan.");
  busy = true;
  try {
    const existed = await containerExists(APP_CONTAINER_NAME);
    if (!existed) {
      setPhase("failed_critical", `${APP_CONTAINER_NAME} bestaat nog niet — er is niets om de configuratie van te klonen voor een rollback.`);
      return;
    }

    setPhase("stopping", "Handmatige rollback: vorige versie terugzetten...");
    touchMaintenanceFlag();
    const current = await inspectContainer(APP_CONTAINER_NAME);
    await runDocker(["stop", APP_CONTAINER_NAME]).catch(() => {});
    setPhase("starting", "Vorige versie starten...");
    await recreateContainer(APP_CONTAINER_NAME, target, current);
    setPhase("healthchecking", "Wachten tot de teruggezette versie gezond is...");
    const healthy = await waitForHealthy(APP_CONTAINER_NAME, HEALTH_TIMEOUT_MS);
    if (healthy) {
      clearMaintenanceFlag();
      setPhase("success", "Rollback voltooid — de vorige versie draait weer en is gezond.");
    } else {
      setPhase("failed_critical", "Rollback-versie werd niet gezond. Onderhoudsmodus blijft aan — handmatig ingrijpen nodig.");
    }
  } catch (err) {
    setPhase("failed_critical", `Onverwachte fout tijdens rollback: ${err.message}.`);
  } finally {
    busy = false;
  }
}

function authorized(req) {
  const header = req.headers["authorization"] || "";
  const expected = `Bearer ${AGENT_TOKEN}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

const server = createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!authorized(req)) {
    sendJson(res, 401, { error: "Niet geautoriseerd" });
    return;
  }

  try {
    if (req.url === "/status" && req.method === "GET") {
      sendJson(res, 200, { ...state, maintenanceOn: maintenanceIsOn(), busy, hasRollbackTarget: Boolean(readLastGoodImage()) });
      return;
    }

    if (req.url === "/deploy" && req.method === "POST") {
      if (busy) {
        sendJson(res, 409, { error: "Er loopt al een deploy." });
        return;
      }
      runDeploy().catch((err) => log(`Onafgevangen fout in runDeploy: ${err.message}`));
      sendJson(res, 202, { status: "started" });
      return;
    }

    if (req.url === "/rollback" && req.method === "POST") {
      if (busy) {
        sendJson(res, 409, { error: "Er loopt al een deploy." });
        return;
      }
      runRollback().catch((err) => log(`Onafgevangen fout in runRollback: ${err.message}`));
      sendJson(res, 202, { status: "started" });
      return;
    }

    if (req.url === "/maintenance/on" && req.method === "POST") {
      if (busy) {
        sendJson(res, 409, { error: "Er loopt een deploy — die bestuurt de onderhoudsmodus zelf al." });
        return;
      }
      touchManualMaintenanceFlag();
      log("Onderhoudsmodus handmatig aangezet.");
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.url === "/maintenance/off" && req.method === "POST") {
      if (busy) {
        sendJson(res, 409, { error: "Er loopt een deploy — die bestuurt de onderhoudsmodus zelf al." });
        return;
      }
      clearMaintenanceFlag();
      log("Onderhoudsmodus handmatig uitgezet.");
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "Onbekend endpoint" });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Deploy-agent luistert intern op poort ${PORT}.`);
  // Herstelt een vlag die bleef staan na een agentcrash of een deployfout,
  // maar laat bewust door een beheerder aangezette onderhoudsmodus staan.
  recoverMaintenanceIfHealthy().catch((err) => log(`Onderhoudsherstel mislukt: ${err.message}`));
});

// De app kan gezond worden nadat de agent al is gestart. Daarom is één check
// bij startup niet genoeg; deze lichte controle voorkomt een permanente
// onderhoudspagina na een tijdelijke Docker- of databasehapering.
setInterval(() => {
  recoverMaintenanceIfHealthy().catch((err) => log(`Onderhoudsherstel mislukt: ${err.message}`));
}, MAINTENANCE_RECOVERY_INTERVAL_MS).unref();
