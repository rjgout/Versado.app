// Poort voor iOS-testdistributie (WP2, docs/NATIVE-STORE-RELEASE-PLAN.md): bepaalt of een bundel gearchiveerd en
// geëxporteerd mag worden en of het archief klopt. Geen netwerk, geen upload, geen geheimen in de uitvoer.
// Gebruik: node scripts/native/ios-release-guard.mjs before             (vóór xcodebuild archive)
//          node scripts/native/ios-release-guard.mjs after <App.app-map> (na het archiveren)
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { APP_ID } from "./profiles.cjs";

const BUILD_JSON = "dist/native/build.json";

// Zelfde regels als scripts/native/android-release-guard.mjs, met kanaal testflight en NATIVE_*-versies.
export function signingProblems(metadata, env) {
  const problems = [];
  if (!metadata || typeof metadata !== "object") return ["build.json ontbreekt of is ongeldig"];
  if (metadata.profile !== "local-store-test") problems.push(`profiel is ${metadata.profile}, verwacht local-store-test`);
  if (metadata.channel !== "testflight") problems.push(`kanaal is ${metadata.channel}, verwacht testflight`);
  if (metadata.compileProbe !== false) problems.push("compileproef-bundels worden nooit gearchiveerd voor distributie of geüpload");
  if (metadata.releaseApproved !== false) problems.push("releaseApproved moet false zijn");
  if (metadata.appId !== APP_ID) problems.push(`appId is ${metadata.appId}, verwacht ${APP_ID}`);
  if (typeof metadata.apiOrigin !== "string" || !/^https:\/\/[^/\s*@?#]+$/.test(metadata.apiOrigin) || metadata.apiOrigin.endsWith(".invalid")) problems.push("apiOrigin is geen exacte, echte HTTPS-origin");
  if (String(metadata.buildNumber) !== String(env.NATIVE_BUILD_NUMBER ?? "")) problems.push(`buildNumber ${metadata.buildNumber} wijkt af van NATIVE_BUILD_NUMBER ${env.NATIVE_BUILD_NUMBER ?? "(leeg)"}`);
  if (metadata.version !== env.NATIVE_APP_VERSION) problems.push(`version ${metadata.version} wijkt af van NATIVE_APP_VERSION ${env.NATIVE_APP_VERSION ?? "(leeg)"}`);
  if (env.GITHUB_SHA && metadata.sourceCommit !== env.GITHUB_SHA) problems.push("sourceCommit wijkt af van de gebouwde commit (GITHUB_SHA)");
  return problems;
}

export function beforeProblems({ env = process.env, root = process.cwd() } = {}) {
  const sourcePath = resolve(root, BUILD_JSON);
  const assetPath = resolve(root, "ios/App/App/public/build.json");
  if (!existsSync(sourcePath)) return [`${sourcePath} ontbreekt; bouw eerst met npm run native:build`];
  if (!existsSync(assetPath)) return [`${assetPath} ontbreekt; draai npx cap sync ios`];
  if (readFileSync(sourcePath, "utf8") !== readFileSync(assetPath, "utf8")) return ["build.json in de iOS-assets wijkt af van dist/native (verouderde sync)"];
  let metadata;
  try { metadata = JSON.parse(readFileSync(sourcePath, "utf8")); } catch { return ["build.json is geen geldige JSON"]; }
  return signingProblems(metadata, env);
}

// Info.plist in een archief is binair; python3 (plistlib) leest zowel XML als binair en is op elke runner aanwezig.
function readPlist(path) {
  const run = spawnSync("python3", ["-I", "-c", "import plistlib,json,sys;print(json.dumps(plistlib.load(open(sys.argv[1],'rb'))))", path], { encoding: "utf8" });
  if (run.status !== 0) return null;
  try { return JSON.parse(run.stdout); } catch { return null; }
}

export function afterProblems(appDirectory, { root = process.cwd() } = {}) {
  const problems = [];
  const plist = readPlist(join(appDirectory, "Info.plist"));
  const metadataPath = join(appDirectory, "public/build.json");
  if (!plist) return ["Info.plist van de app ontbreekt of is onleesbaar"];
  if (!existsSync(metadataPath)) return ["public/build.json ontbreekt in de app"];
  let metadata;
  try { metadata = JSON.parse(readFileSync(metadataPath, "utf8")); } catch { return ["public/build.json in de app is ongeldig"]; }
  problems.push(...signingProblems(metadata, { NATIVE_BUILD_NUMBER: String(plist.CFBundleVersion), NATIVE_APP_VERSION: plist.CFBundleShortVersionString }));
  if (plist.CFBundleIdentifier !== APP_ID) problems.push(`CFBundleIdentifier is ${plist.CFBundleIdentifier}, verwacht ${APP_ID}`);
  if (!existsSync(join(appDirectory, "PrivacyInfo.xcprivacy"))) problems.push("PrivacyInfo.xcprivacy ontbreekt in de app");
  const source = resolve(root, BUILD_JSON);
  if (existsSync(source) && readFileSync(source, "utf8") !== readFileSync(metadataPath, "utf8")) problems.push("build.json in de app wijkt af van dist/native");
  if (plist.CAPACITOR_DEBUG === "true") problems.push("CAPACITOR_DEBUG staat aan in de app");
  return problems;
}

function main() {
  const [mode, target] = process.argv.slice(2);
  if (mode === "before") {
    const problems = beforeProblems();
    if (problems.length > 0) { console.error(`Archiveren en distributie geweigerd:\n- ${problems.join("\n- ")}`); process.exit(1); }
    console.log("iOS-poort: bundel is een niet-compileproef local-store-test/testflight-build; archiveren toegestaan. Geen upload.");
  } else if (mode === "after") {
    const problems = afterProblems(target);
    if (problems.length > 0) { console.error(`Archief afgekeurd:\n- ${problems.join("\n- ")}`); process.exit(1); }
    console.log("iOS-archief gecontroleerd (versie, buildnummer, bundel, privacy manifest). Niet geüpload.");
  } else {
    console.error("Gebruik: ios-release-guard.mjs before | after <App.app-map>");
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main();
