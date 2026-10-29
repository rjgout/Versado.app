// Verificatiecontract voor de native bundel per buildprofiel (docs/NATIVE-STORE-RELEASE-PLAN.md, WP1).
// Gebruik: node scripts/native/verify-distribution.mjs <android|ios> [map met capacitor.config.json en public/]
// De omgeving is dezelfde als bij `npm run native:build` (CAPACITOR_BUILD_PROFILE, NATIVE_API_BASE_URL, ...);
// zonder profiel geldt local-development. Alle profielregels komen uit scripts/native/profiles.cjs.
// Geen signing, upload, netwerk of apparaatacceptatie: dit controleert uitsluitend verpakte bestanden.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { APP_ID, bundleDirectory, contentSecurityPolicy, findSecrets, hashBundleFiles, metadataProblems, resolveBuildProfile, internalAccessEnabled, INTERNAL_ACCESS_FILE } from "./profiles.cjs";

const KNOWN_PLATFORM_FILES = new Set(["cordova.js", "cordova_plugins.js", "build.json"]);
const TEXT_FILE = /\.(html|js|css|json|txt|map)$/;

export function verifyBundle({ platform, root: rootArgument, env = process.env, repoRoot = process.cwd() }) {
  const problems = [];
  if (!["android", "ios"].includes(platform)) return ["Kies android of ios"];
  const resolved = resolveBuildProfile(env, { stage: "build", defaultProfile: "local-development" });
  const access = internalAccessEnabled(resolved, env);
  const root = resolve(rootArgument ?? (platform === "android" ? "android/app/src/main/assets" : "ios/App/App"));
  const sourceDirectory = resolve(repoRoot, bundleDirectory(env, repoRoot));
  const read = (path) => readFileSync(path, "utf8");
  const publicDirectory = join(root, "public");
  const accessPath = join(publicDirectory, INTERNAL_ACCESS_FILE);
  if (existsSync(accessPath) !== access || (access && read(accessPath) !== '{"enabled":true}\n')) problems.push("interne Access-configuratie wijkt af van het gekozen profiel");

  // 1. Metadata: bron en verpakte kopie zijn identiek en horen exact bij dit profiel.
  let metadata;
  try { metadata = JSON.parse(read(join(sourceDirectory, "build.json"))); } catch { return [`${join(sourceDirectory, "build.json")} ontbreekt of is ongeldig; bouw eerst met npm run native:build`]; }
  if (!existsSync(join(publicDirectory, "build.json"))) problems.push(`${platform}: public/build.json ontbreekt in de verpakte assets`);
  else if (read(join(publicDirectory, "build.json")) !== read(join(sourceDirectory, "build.json"))) problems.push(`${platform}: build.json wijkt af van de lokale bundel`);
  problems.push(...metadataProblems(metadata, resolved, platform).map((problem) => `metadata: ${problem}`));

  // 2. Bestanden: elk bestand van de bron is ongewijzigd verpakt en er is niets bijgekomen.
  const sourceHashes = hashBundleFiles(sourceDirectory);
  if (JSON.stringify(sourceHashes) !== JSON.stringify(metadata.files)) problems.push("de bundel in dist wijkt af van de hashes in build.json");
  if (!existsSync(publicDirectory)) problems.push(`${platform}: ${publicDirectory} bestaat niet`);
  else {
    const packagedHashes = hashBundleFiles(publicDirectory);
    for (const [name, hash] of Object.entries(metadata.files ?? {})) {
      if (packagedHashes[name] !== hash) problems.push(`${platform}: ${name} ontbreekt of wijkt af van de lokale bundel`);
    }
    for (const name of Object.keys(packagedHashes)) {
      if (!(name in (metadata.files ?? {})) && !KNOWN_PLATFORM_FILES.has(name)) problems.push(`${platform}: onverwacht bestand in de verpakte assets: ${name}`);
    }

    // 3. CSP en bestemmingen: de API-origin is de enige externe bestemming, er zijn geen remote scripts of stylesheets.
    const html = existsSync(join(publicDirectory, "index.html")) ? read(join(publicDirectory, "index.html")) : "";
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1];
    if (resolved.apiOrigin && csp !== contentSecurityPolicy(resolved.apiOrigin)) problems.push("de Content-Security-Policy in index.html wijkt af van het contract");
    if (/(?:src|href)="(?:https?:)?\/\//.test(html)) problems.push("index.html verwijst naar een externe bron");
    const script = existsSync(join(publicDirectory, "index.js")) ? read(join(publicDirectory, "index.js")) : "";
    if (resolved.apiOrigin && !script.includes(JSON.stringify(resolved.apiOrigin).slice(1, -1))) problems.push("de backend-origin staat niet in de verpakte client");

    // 4. Geheimen in verpakte bestanden.
    const scan = (directory) => {
      for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);
        if (statSync(full).isDirectory()) scan(full);
        else if (TEXT_FILE.test(entry)) {
          const found = findSecrets(read(full));
          if (found.length > 0) problems.push(`mogelijk geheim (${found.join(", ")}) in ${relative(root, full).split(sep).join("/")}`);
        }
      }
    };
    scan(publicDirectory);
  }

  // 5. Capacitor-configuratie in het native project: lokaal, zonder remote server en zonder ontwikkelinstellingen.
  const configPath = join(root, "capacitor.config.json");
  if (!existsSync(configPath)) problems.push(`${platform}: capacitor.config.json ontbreekt`);
  else {
    const config = JSON.parse(read(configPath));
    if ((config.plugins?.VersadoNative?.internalAccessEnabled === true) !== access) problems.push("native Access-configuratie wijkt af van het gekozen profiel");
    if (config.appId !== APP_ID) problems.push(`appId is ${config.appId}, verwacht ${APP_ID}`);
    if (config.server?.url !== undefined) problems.push("server.url is gezet: alle clientcode moet lokaal gebundeld zijn");
    const expectedWebDir = bundleDirectory(env, repoRoot);
    if (config.webDir !== "public" && config.webDir !== expectedWebDir) problems.push(`webDir is ${config.webDir}, verwacht ${expectedWebDir}`);
    const allowedServerKeys = ["androidScheme", "iosScheme", "cleartext"];
    for (const key of Object.keys(config.server ?? {})) if (!allowedServerKeys.includes(key)) problems.push(`server.${key} is niet toegestaan in een lokale bundel`);
    if (config.server?.androidScheme !== "https" || config.server?.iosScheme !== "capacitor") problems.push("server-schema's wijken af (android https, ios capacitor)");
    const cleartextAllowed = !resolved.distribution && env.NATIVE_ALLOW_LOCAL_HTTP_API === "1";
    if (Boolean(config.server?.cleartext) !== cleartextAllowed) problems.push(`server.cleartext is ${Boolean(config.server?.cleartext)}, verwacht ${cleartextAllowed}`);
    if (resolved.distribution && /"allowNavigation"|"webContentsDebuggingEnabled"\s*:\s*true|"loggingBehavior"\s*:\s*"debug"/.test(JSON.stringify(config))) problems.push("onbedoelde development-instelling in capacitor.config.json");
  }

  // 6. Distributie: geen ontwikkelinstellingen in de native projectbestanden.
  if (resolved.distribution) {
    const manifest = resolve(repoRoot, "android/app/src/main/AndroidManifest.xml");
    if (existsSync(manifest) && /android:usesCleartextTraffic="true"|android:debuggable="true"/.test(read(manifest))) problems.push("AndroidManifest.xml staat cleartext-verkeer of debuggable toe");
    const plist = resolve(repoRoot, "ios/App/App/Info.plist");
    if (existsSync(plist) && /NSAllowsArbitraryLoads/.test(read(plist))) problems.push("Info.plist staat willekeurige netwerkverbindingen toe (NSAllowsArbitraryLoads)");
    const packagedPlist = join(root, "Info.plist");
    if (existsSync(packagedPlist) && /<key>CAPACITOR_DEBUG<\/key>\s*<string>true<\/string>/.test(read(packagedPlist))) problems.push("CAPACITOR_DEBUG staat aan in de verpakte app");
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [platform, root] = process.argv.slice(2);
  let problems;
  try { problems = verifyBundle({ platform, root }); } catch (error) { problems = [error.message]; }
  if (problems.length > 0) {
    console.error(`Verificatie van ${platform ?? "?"} mislukt:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  const resolved = resolveBuildProfile(process.env, { stage: "build", defaultProfile: "local-development" });
  console.log(`${platform}: verpakte assets kloppen met profiel ${resolved.profile} (kanaal ${resolved.channel}, origin ${resolved.apiOrigin}); release niet goedgekeurd.`);
}
