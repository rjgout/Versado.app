// Controleert een opgegeven testbackend-origin voor native testbuilds (docs/NAS-TESTSTACK-PLAN.md). Alleen lezen: geen
// accounts, geen schrijfacties, geen geheimen. De origin wordt NOOIT afgeleid of aangevuld: geef hem expliciet op.
// Gebruik: node scripts/native/check-test-backend.mjs <https-origin> [--profile internal|store-test] [--expect-capability naam]...
//   VERSADO_PRODUCTION_ORIGIN (optioneel): weigert die origin als testbackend (vangnet tegen verwarring met productie).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseDistributionOrigin, loadAllowedOrigins } = require("./profiles.cjs");

const NATIVE_HEADERS = { Origin: "capacitor://localhost", "X-Versado-Client": "native-v1" };
const DEFAULT_CAPABILITIES = ["security-setup-v1", "account-password-v1", "password-reset-v1", "email-confirmation-v1"];

/** Pure beoordeling van de antwoorden; los testbaar zonder netwerk. */
export function evaluate({ origin, production, allowlist, profile, capabilities, native, cross, root, expectCapabilities = DEFAULT_CAPABILITIES }) {
  const problems = [], notes = [];
  if (production && origin === production) problems.push("Dit is de productie-origin; een testbuild mag daar nooit naartoe wijzen.");
  if (profile) {
    if (!allowlist?.[profile]?.length) notes.push(`De allowlist "${profile}" in scripts/native/distribution-origins.json is nog leeg: er zijn nog geen distributiebuilds mogelijk (eigenaartaak).`);
    else if (!allowlist[profile].includes(origin)) problems.push(`De origin staat niet in de allowlist "${profile}".`);
  }
  if (capabilities.status !== 200) problems.push(`GET /api/v1/native/capabilities gaf ${capabilities.status} (verwacht 200; NATIVE_API_ENABLED=1 en NATIVE_SESSION_SECRET gezet?).`);
  else {
    if (capabilities.body?.apiVersion !== 1) problems.push(`apiVersion is ${capabilities.body?.apiVersion}, verwacht 1.`);
    const features = Array.isArray(capabilities.body?.features) ? capabilities.body.features : [];
    for (const name of expectCapabilities) if (!features.includes(name)) problems.push(`Capability ontbreekt: ${name}.`);
  }
  if (capabilities.redirected) problems.push("De backend stuurt door (redirect); een native build volgt nooit redirects.");
  if (native.allowOrigin !== "capacitor://localhost") problems.push(`De backend staat de native origin niet toe (Access-Control-Allow-Origin: ${native.allowOrigin ?? "geen"}).`);
  if (cross.allowOrigin) problems.push(`Een vreemde origin krijgt CORS-toegang tot de native API (${cross.allowOrigin}).`);
  if (root.status >= 500) problems.push(`De startpagina geeft ${root.status}.`);
  const policy = root.permissionsPolicy ?? "";
  if (!/microphone=\(self\)/.test(policy)) problems.push("Permissions-Policy bevat geen microphone=(self) (Lofzangen en de proxy-afspraak uit CLAUDE.md).");
  if (!root.hsts) notes.push("Geen Strict-Transport-Security gezien; overweeg HSTS op de reverse proxy van de teststack.");
  return { ok: problems.length === 0, problems, notes };
}

async function probe(origin, path, headers, fetchImpl) {
  const response = await fetchImpl(`${origin}${path}`, { method: "GET", headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const redirected = response.status >= 300 && response.status < 400;
  let body = null;
  if ((response.headers.get("content-type") ?? "").includes("json")) body = await response.json().catch(() => null);
  return { status: response.status, redirected, body, headers: response.headers };
}

export async function check(origin, { fetchImpl = fetch, profile, expectCapabilities, env = process.env, allowlist } = {}) {
  const normalized = parseDistributionOrigin(origin); // exact HTTPS, geen pad/poortgoochelarij/credentials; geldig certificaat via fetch
  const cap = await probe(normalized, "/api/v1/native/capabilities", NATIVE_HEADERS, fetchImpl);
  const cross = await probe(normalized, "/api/v1/native/capabilities", { ...NATIVE_HEADERS, Origin: "https://aanvaller.example" }, fetchImpl);
  const root = await probe(normalized, "/", {}, fetchImpl);
  return evaluate({
    origin: normalized, production: env.VERSADO_PRODUCTION_ORIGIN, allowlist: allowlist ?? loadAllowedOrigins(process.cwd()), profile, expectCapabilities,
    capabilities: { status: cap.status, redirected: cap.redirected, body: cap.body },
    native: { allowOrigin: cap.headers.get("access-control-allow-origin") },
    cross: { allowOrigin: cross.headers.get("access-control-allow-origin") },
    root: { status: root.status, permissionsPolicy: root.headers.get("permissions-policy"), hsts: root.headers.get("strict-transport-security") },
  });
}

if (process.argv[1] && process.argv[1].endsWith("check-test-backend.mjs")) {
  const args = process.argv.slice(2);
  let origin, profile; const expected = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--profile") profile = args[++index];
    else if (args[index] === "--expect-capability") expected.push(args[++index]);
    else if (!args[index].startsWith("--") && origin === undefined) origin = args[index];
    else { console.error(`Onbekend argument: ${args[index]}`); process.exit(2); }
  }
  if (!origin) { console.error("Gebruik: node scripts/native/check-test-backend.mjs <https-origin> [--profile internal|store-test]"); process.exit(2); }
  if (profile && !["internal", "store-test"].includes(profile)) { console.error("--profile is internal of store-test."); process.exit(2); }
  check(origin, { profile, expectCapabilities: expected.length ? expected : undefined }).then((result) => {
    for (const note of result.notes) console.log(`Let op: ${note}`);
    if (!result.ok) { console.error(`Testbackend afgekeurd:\n- ${result.problems.join("\n- ")}`); process.exit(1); }
    console.log("Testbackend voldoet aan de gecontroleerde voorwaarden (alleen leesverzoeken; geen accounts aangemaakt).");
  }).catch((error) => { console.error(`Controle mislukt: ${error.message}`); process.exit(1); });
}
