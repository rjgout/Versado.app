// Enige bron van waarheid voor de native buildprofielen (docs/NATIVE-STORE-RELEASE-PLAN.md, WP1).
// CommonJS, zodat de Capacitor-CLI (die capacitor.config.ts als CJS evalueert), tsx en node dezelfde module laden.
// Gebruikt door capacitor.config.ts, scripts/native/build.ts, scripts/native/verify-distribution.mjs en
// scripts/native/store-readiness.mjs. Er is bewust geen tweede plek waar een profielinstelling staat.
//
// Profielen:
//   remote-preview     ontwikkeling; WebView op een remote server.url (geen lokale bundel)
//   local-development  ontwikkeling; lokaal gebundelde client
//   local-internal     interne toesteltests; lokaal gebundeld, strikt toegestane HTTPS-backend
//   local-store-test   TestFlight / Google Play-testtrack; lokaal gebundeld, strikte allowlist, versie en kanaal
//   release            GEBLOKKEERD. Geen enkele omgevingsvariabele opent dit profiel.
//
// Geen enkel profiel levert een releasegoedkeuring op: releaseApproved is altijd false.
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { isAbsolute, join, relative, resolve, sep } = require("node:path");

const APP_ID = "app.versado.app";
const SCHEMA_VERSION = 2;
const API_VERSION = 1;
// Alleen voor CI-compileproeven zonder echte backend. De gereserveerde .invalid-TLD (RFC 2606) bestaat nooit
// in DNS; een build met deze origin is gemarkeerd als compileProbe en nooit geschikt voor upload.
const COMPILE_PROBE_ORIGIN = "https://example.invalid";
const DEFAULT_BUNDLE_DIR = "dist/native";
const ORIGINS_FILE = "scripts/native/distribution-origins.json";

const PROFILE_IDS = ["remote-preview", "local-development", "local-internal", "local-store-test"];
const DISTRIBUTION_PROFILE_IDS = ["local-internal", "local-store-test"];
// Kanaal per profiel. Een store-testbuild kiest bewust één van de twee kanalen; het kanaal bepaalt het platform.
const STORE_TEST_CHANNELS = { testflight: ["ios"], "play-test": ["android"] };
const DISTRIBUTION_PROFILES = {
  "local-internal": { channels: ["internal"], originsKey: "internal", label: "Interne testbuild", versionRequired: false },
  "local-store-test": { channels: Object.keys(STORE_TEST_CHANNELS), originsKey: "store-test", label: "Testversie (store-test)", versionRequired: true },
};

class ProfileError extends Error {
  constructor(message) { super(message); this.name = "ProfileError"; }
}

const value = (env, key) => { const raw = env[key]; return raw === undefined || raw.trim() === "" ? undefined : raw.trim(); };
const RESERVED_TLDS = new Set(["invalid", "test", "example", "localhost", "local", "localdomain", "internal", "lan", "home", "corp", "arpa"]);
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "10.0.2.2"];

// Exacte HTTPS-origin voor distributie: geen pad, query, fragment, credentials, wildcard, IP-adres,
// gereserveerd of niet-publiek domein, en de invoer moet gelijk zijn aan de genormaliseerde origin.
function parseDistributionOrigin(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 253 + 16) throw new ProfileError("Backend-origin ontbreekt of is te lang.");
  if (/[\s*]/.test(raw)) throw new ProfileError("Backend-origin mag geen spaties of wildcards bevatten.");
  let url;
  try { url = new URL(raw); } catch { throw new ProfileError("Backend-origin is geen geldige URL."); }
  if (url.protocol !== "https:") throw new ProfileError("Distributieprofielen staan uitsluitend een HTTPS-backend toe (geen HTTP, geen cleartext).");
  if (url.username || url.password) throw new ProfileError("Backend-origin mag geen credentials bevatten.");
  if (url.search || url.hash || url.pathname !== "/") throw new ProfileError("Backend-origin mag geen pad, query of fragment bevatten.");
  if (raw !== url.origin) throw new ProfileError("Backend-origin moet exact de genormaliseerde origin zijn (kleine letters, geen slash aan het einde).");
  const host = url.hostname;
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) throw new ProfileError("Backend-origin mag geen IP-adres zijn.");
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => label.length === 0)) throw new ProfileError("Backend-origin moet een volledig gekwalificeerd publiek domein zijn.");
  if (RESERVED_TLDS.has(labels.at(-1))) throw new ProfileError(`Backend-origin gebruikt een gereserveerd of niet-publiek domein (.${labels.at(-1)}).`);
  if (RESERVED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) throw new ProfileError("Backend-origin gebruikt een gereserveerd voorbeelddomein.");
  return url.origin;
}

// Bestaande development-regels (ongewijzigd): HTTPS, of een expliciete loopback-HTTP-backend voor lokale tests.
function parseDevelopmentOrigin(raw, env) {
  let url;
  try { url = new URL(raw); } catch { throw new ProfileError("NATIVE_API_BASE_URL is geen geldige URL."); }
  const local = env.NATIVE_ALLOW_LOCAL_HTTP_API === "1" && LOOPBACK_HOSTS.includes(url.hostname) && url.protocol === "http:";
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ProfileError("Een HTTPS backend-origin is vereist (alleen expliciete loopback-ontwikkeling mag HTTP).");
  }
  return url.origin;
}

function loadAllowedOrigins(root = process.cwd()) {
  const path = join(root, ORIGINS_FILE);
  if (!existsSync(path)) throw new ProfileError(`${ORIGINS_FILE} ontbreekt.`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  const lists = {};
  for (const key of ["internal", "store-test"]) {
    if (!Array.isArray(data[key])) throw new ProfileError(`${ORIGINS_FILE}: lijst "${key}" ontbreekt.`);
    lists[key] = data[key].map((origin) => parseDistributionOrigin(origin));
    if (new Set(lists[key]).size !== lists[key].length) throw new ProfileError(`${ORIGINS_FILE}: dubbele origin in "${key}".`);
  }
  return lists;
}

function packageVersion(root = process.cwd()) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
}

function sourceCommit(env, root = process.cwd()) {
  const fromEnv = value(env, "GITHUB_SHA");
  if (fromEnv) return /^[0-9a-f]{40}$/.test(fromEnv) ? fromEnv : null;
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

const VERSION = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const BUILD_NUMBER = /^[1-9]\d{0,9}$/;
const MAX_BUILD_NUMBER = 2_100_000_000; // bovengrens voor een Android-versionCode

function bundleDirectory(env = process.env, root = process.cwd()) {
  const raw = value(env, "NATIVE_BUILD_OUTDIR");
  if (!raw) return DEFAULT_BUNDLE_DIR;
  const absolute = resolve(root, raw);
  const inside = (base) => { const rel = relative(base, absolute); return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel); };
  if (!inside(resolve(root, "dist")) && !inside(tmpdir())) throw new ProfileError("NATIVE_BUILD_OUTDIR moet binnen dist/ of de tijdelijke map liggen.");
  return isAbsolute(raw) ? raw : raw.replaceAll("\\", "/");
}

// Valideert het gekozen profiel. stage "build" vraagt alle bundelgegevens, stage "config" (Capacitor) alleen wat
// het native project nodig heeft; distributieprofielen vragen in beide stappen dezelfde volledige set.
function resolveBuildProfile(env = process.env, options = {}) {
  const { stage = "build", defaultProfile, allowlist, root = process.cwd() } = options;
  const profile = value(env, "CAPACITOR_BUILD_PROFILE") ?? defaultProfile;
  if (!profile) {
    throw new ProfileError("CAPACITOR_BUILD_PROFILE ontbreekt. Kies remote-preview, local-development, local-internal of local-store-test; het releaseprofiel is geblokkeerd.");
  }
  if (!PROFILE_IDS.includes(profile)) {
    throw new ProfileError(`CAPACITOR_BUILD_PROFILE=${profile} wordt niet ondersteund. Het releaseprofiel blijft geblokkeerd totdat alle blokkades uit npm run native:store-readiness -- --strict zijn opgelost en de eigenaar dat uitdrukkelijk goedkeurt.`);
  }
  const serverUrl = value(env, "CAPACITOR_SERVER_URL")?.replace(/\/+$/, "");
  const cleartextFlag = env.CAPACITOR_ALLOW_CLEARTEXT === "true";

  if (profile === "remote-preview") {
    if (stage === "build") throw new ProfileError("remote-preview bouwt geen lokale bundel; gebruik CAPACITOR_BUILD_PROFILE=local-development voor npm run native:build.");
    if (!serverUrl) throw new ProfileError("CAPACITOR_SERVER_URL ontbreekt. Geef voor remote-preview expliciet een HTTPS Versado-adres op, of een HTTP LAN-adres met CAPACITOR_ALLOW_CLEARTEXT=true voor lokale ontwikkeling.");
    const isLocalServer = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(serverUrl);
    return {
      profile, kind: "remote", distribution: false, channel: "remote-preview", label: "Remote preview", compileProbe: false,
      serverUrl, cleartext: isLocalServer || cleartextFlag, apiOrigin: null, version: null, buildNumber: null, sourceCommit: null,
    };
  }

  // Alle lokale profielen: nooit een remote server.url.
  if (serverUrl) throw new ProfileError("Een lokale client mag geen remote server.url krijgen (CAPACITOR_SERVER_URL is gezet).");
  const apiRaw = value(env, "NATIVE_API_BASE_URL");
  const common = { kind: "local", serverUrl: null, cleartext: false };

  if (profile === "local-development") {
    if (stage === "build" && !apiRaw) throw new ProfileError("NATIVE_API_BASE_URL ontbreekt; geen impliciete productiebackend.");
    return {
      ...common, profile, distribution: false, channel: "development", label: "Development", compileProbe: false,
      cleartext: env.NATIVE_ALLOW_LOCAL_HTTP_API === "1",
      apiOrigin: apiRaw ? parseDevelopmentOrigin(apiRaw, env) : undefined, // onbekend in de configstap zonder NATIVE_API_BASE_URL
      version: packageVersion(root), buildNumber: null, sourceCommit: sourceCommit(env, root),
    };
  }

  // Distributieprofielen.
  const definition = DISTRIBUTION_PROFILES[profile];
  if (env.NATIVE_ALLOW_LOCAL_HTTP_API === "1" || cleartextFlag) throw new ProfileError("Distributieprofielen staan geen HTTP-cleartext of lokale HTTP-backend toe.");
  if (!apiRaw) {
    throw new ProfileError(`NATIVE_API_BASE_URL ontbreekt voor ${profile}. Eigenaartaak: kies de HTTPS-origin van de testbackend en voeg die toe aan ${ORIGINS_FILE}; er is geen standaardwaarde.`);
  }
  const compileProbe = env.NATIVE_COMPILE_PROBE === "1";
  let apiOrigin;
  if (compileProbe) {
    if (apiRaw !== COMPILE_PROBE_ORIGIN) throw new ProfileError(`NATIVE_COMPILE_PROBE=1 accepteert uitsluitend ${COMPILE_PROBE_ORIGIN}.`);
    apiOrigin = COMPILE_PROBE_ORIGIN;
  } else {
    apiOrigin = parseDistributionOrigin(apiRaw);
    const allowed = (allowlist ?? loadAllowedOrigins(root))[definition.originsKey];
    if (allowed.length === 0) {
      throw new ProfileError(`De allowlist "${definition.originsKey}" in ${ORIGINS_FILE} is leeg. Eigenaartaak: voeg de HTTPS-origin van de testbackend toe via een reviewbare wijziging; er is geen onveilige standaardwaarde.`);
    }
    if (!allowed.includes(apiOrigin)) throw new ProfileError(`Backend-origin staat niet in de allowlist "${definition.originsKey}" van ${ORIGINS_FILE}.`);
  }

  const requestedChannel = value(env, "NATIVE_DISTRIBUTION_CHANNEL");
  let channel;
  if (definition.channels.length === 1) {
    if (requestedChannel && requestedChannel !== definition.channels[0]) throw new ProfileError(`${profile} heeft uitsluitend kanaal ${definition.channels[0]}.`);
    channel = definition.channels[0];
  } else {
    if (!requestedChannel) throw new ProfileError(`NATIVE_DISTRIBUTION_CHANNEL ontbreekt voor ${profile} (${definition.channels.join(" of ")}).`);
    if (!definition.channels.includes(requestedChannel)) throw new ProfileError(`NATIVE_DISTRIBUTION_CHANNEL=${requestedChannel} is onbekend voor ${profile} (${definition.channels.join(" of ")}).`);
    channel = requestedChannel;
  }

  const versionRaw = value(env, "NATIVE_APP_VERSION") ?? (definition.versionRequired ? undefined : packageVersion(root));
  if (!versionRaw) throw new ProfileError(`NATIVE_APP_VERSION ontbreekt voor ${profile} (formaat x.y.z).`);
  if (!VERSION.test(versionRaw)) throw new ProfileError("NATIVE_APP_VERSION moet drie getallen zijn (x.y.z).");
  const buildRaw = value(env, "NATIVE_BUILD_NUMBER") ?? (definition.versionRequired ? undefined : "1");
  if (!buildRaw) throw new ProfileError(`NATIVE_BUILD_NUMBER ontbreekt voor ${profile}.`);
  if (!BUILD_NUMBER.test(buildRaw) || Number(buildRaw) > MAX_BUILD_NUMBER) throw new ProfileError(`NATIVE_BUILD_NUMBER moet een geheel getal tussen 1 en ${MAX_BUILD_NUMBER} zijn.`);
  const commit = sourceCommit(env, root);
  if (!commit) throw new ProfileError("De broncommit is niet vast te stellen (GITHUB_SHA of een git-checkout is vereist voor een distributiebuild).");

  return {
    ...common, profile, distribution: true, channel, label: definition.label, compileProbe,
    apiOrigin, version: versionRaw, buildNumber: Number(buildRaw), sourceCommit: commit,
  };
}

// Dezelfde instellingen die Capacitor nodig heeft; capacitor.config.ts bevat zelf geen profiellogica meer.
function capacitorSettings(resolved, env = process.env) {
  if (resolved.kind === "remote") {
    return { webDir: "public", server: { url: resolved.serverUrl, cleartext: resolved.cleartext, errorPath: "native-error.html" } };
  }
  const server = { androidScheme: "https", iosScheme: "capacitor", cleartext: resolved.cleartext };
  return { webDir: bundleDirectory(env), server };
}

// Eén CSP-definitie voor build en verificatie: de API-origin is de enige externe bestemming (dus ook geen
// redirect naar een andere host: connect-src blokkeert dat in de WebView).
function contentSecurityPolicy(apiOrigin) {
  const url = new URL(apiOrigin);
  return `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${url.origin} ${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'`;
}

// Weergave in de app: alleen distributieprofielen tonen een testbanner.
function bannerDefinitions(resolved) {
  return { distribution: resolved.distribution, channel: resolved.channel, version: resolved.version ?? "", buildNumber: resolved.buildNumber ?? 0 };
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

// Alle bestanden van de bundel (behalve build.json zelf), gesorteerd, met hun SHA-256.
function hashBundleFiles(directory) {
  const files = {};
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const name = relative(directory, full).split(sep).join("/");
        if (name !== "build.json") files[name] = sha256(readFileSync(full));
      }
    }
  };
  walk(directory);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function buildMetadata(resolved, files) {
  return {
    schemaVersion: SCHEMA_VERSION,
    apiVersion: API_VERSION,
    appId: APP_ID,
    profile: resolved.profile,
    channel: resolved.channel,
    distribution: resolved.distribution,
    compileProbe: resolved.compileProbe,
    apiOrigin: resolved.apiOrigin,
    version: resolved.version,
    buildNumber: resolved.buildNumber,
    sourceCommit: resolved.sourceCommit,
    releaseApproved: false,
    files,
  };
}

const METADATA_KEYS = ["schemaVersion", "apiVersion", "appId", "profile", "channel", "distribution", "compileProbe", "apiOrigin", "version", "buildNumber", "sourceCommit", "releaseApproved", "files"];

// Eén controle voor de metadata, gebruikt door verify-distribution en door capacitor.config.ts (sync).
// Geeft alle problemen terug; een lege lijst betekent dat de metadata exact bij het gekozen profiel hoort.
function metadataProblems(metadata, resolved, platform) {
  const problems = [];
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return ["build.json is geen object"];
  const keys = Object.keys(metadata).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...METADATA_KEYS].sort())) problems.push(`build.json bevat andere sleutels dan het contract (${keys.join(", ")})`);
  // Een onbekende (undefined) verwachting wordt niet vergeleken; alleen development kent dat bij cap sync.
  const expect = (key, expected) => { if (expected !== undefined && metadata[key] !== expected) problems.push(`${key}: verwacht ${JSON.stringify(expected)}, gevonden ${JSON.stringify(metadata[key])}`); };
  expect("schemaVersion", SCHEMA_VERSION);
  expect("apiVersion", API_VERSION);
  expect("appId", APP_ID);
  expect("profile", resolved.profile);
  expect("channel", resolved.channel);
  expect("distribution", resolved.distribution);
  expect("compileProbe", resolved.compileProbe);
  expect("apiOrigin", resolved.apiOrigin);
  expect("version", resolved.version);
  expect("buildNumber", resolved.buildNumber);
  if (resolved.sourceCommit) expect("sourceCommit", resolved.sourceCommit);
  if (metadata.releaseApproved !== false) problems.push("releaseApproved moet exact false zijn");
  if (platform && resolved.distribution) {
    const allowed = STORE_TEST_CHANNELS[resolved.channel];
    if (allowed && !allowed.includes(platform)) problems.push(`kanaal ${resolved.channel} hoort niet bij platform ${platform}`);
  }
  if (resolved.distribution && !/^[0-9a-f]{40}$/.test(metadata.sourceCommit ?? "")) problems.push("sourceCommit ontbreekt of is geen volledige commit-SHA");
  if (typeof metadata.files !== "object" || metadata.files === null || Object.keys(metadata.files).length === 0) problems.push("files ontbreekt of is leeg");
  return problems;
}

// Geheimen mogen nooit in een verpakt bestand of buildlog terechtkomen. Bewust gericht op herkenbare vormen.
const SECRET_PATTERNS = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["GitHub-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["AWS-sleutel", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API-sleutel", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["service-account", /"type"\s*:\s*"service_account"/],
  ["naam van een geheim", /\b(?:NATIVE_SESSION_SECRET|SESSION_SECRET|APPLE_PRIVATE_KEY|ASC_KEY_P8|PLAY_SERVICE_ACCOUNT_JSON|(?:ANDROID|VERSADO)_UPLOAD_KEY(?:STORE)?_[A-Z_]*)\b/],
  ["credentials in URL", /https?:\/\/[^\s/"'`:@]+:[^\s/"'`@]+@/],
];
function findSecrets(text) {
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

module.exports = {
  APP_ID,
  SCHEMA_VERSION,
  API_VERSION,
  COMPILE_PROBE_ORIGIN,
  DEFAULT_BUNDLE_DIR,
  ORIGINS_FILE,
  PROFILE_IDS,
  DISTRIBUTION_PROFILE_IDS,
  STORE_TEST_CHANNELS,
  DISTRIBUTION_PROFILES,
  ProfileError,
  parseDistributionOrigin,
  parseDevelopmentOrigin,
  loadAllowedOrigins,
  packageVersion,
  sourceCommit,
  bundleDirectory,
  resolveBuildProfile,
  capacitorSettings,
  contentSecurityPolicy,
  bannerDefinitions,
  sha256,
  hashBundleFiles,
  buildMetadata,
  metadataProblems,
  SECRET_PATTERNS,
  findSecrets,
};
