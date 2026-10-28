// Poort voor Android-testdistributie (WP3, docs/NATIVE-STORE-RELEASE-PLAN.md): bepaalt of een bundel
// getekend mag worden en of het getekende resultaat klopt. Geen netwerk, geen upload, geen geheimen in de uitvoer.
// Gebruik: node scripts/native/android-release-guard.mjs before            (vóór bundleRelease)
//          node scripts/native/android-release-guard.mjs after <bestand.aab> (na bundleRelease)
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { APP_ID, DEFAULT_BUNDLE_DIR } from "./profiles.cjs";

const ASSET_BUILD_JSON = "android/app/src/main/assets/public/build.json";

// Zelfde regels als de Gradle-poort in android/app/build.gradle; ze mogen niet uiteenlopen.
export function signingProblems(metadata, env) {
  const problems = [];
  if (!metadata || typeof metadata !== "object") return ["build.json ontbreekt of is ongeldig"];
  if (metadata.profile !== "local-store-test") problems.push(`profiel is ${metadata.profile}, verwacht local-store-test`);
  if (metadata.channel !== "play-test") problems.push(`kanaal is ${metadata.channel}, verwacht play-test`);
  if (metadata.compileProbe !== false) problems.push("compileproef-bundels worden nooit getekend of geüpload");
  if (metadata.releaseApproved !== false) problems.push("releaseApproved moet false zijn");
  if (metadata.appId !== APP_ID) problems.push(`appId is ${metadata.appId}, verwacht ${APP_ID}`);
  if (typeof metadata.apiOrigin !== "string" || !/^https:\/\/[^/\s*@?#]+$/.test(metadata.apiOrigin) || metadata.apiOrigin.endsWith(".invalid")) problems.push("apiOrigin is geen exacte, echte HTTPS-origin");
  if (String(metadata.buildNumber) !== String(env.VERSADO_VERSION_CODE ?? "")) problems.push(`buildNumber ${metadata.buildNumber} wijkt af van VERSADO_VERSION_CODE ${env.VERSADO_VERSION_CODE ?? "(leeg)"}`);
  if (metadata.version !== env.VERSADO_VERSION_NAME) problems.push(`version ${metadata.version} wijkt af van VERSADO_VERSION_NAME ${env.VERSADO_VERSION_NAME ?? "(leeg)"}`);
  if (env.GITHUB_SHA && metadata.sourceCommit !== env.GITHUB_SHA) problems.push("sourceCommit wijkt af van de gebouwde commit (GITHUB_SHA)");
  return problems;
}

export function beforeProblems({ env = process.env, root = process.cwd() } = {}) {
  const sourcePath = resolve(root, DEFAULT_BUNDLE_DIR, "build.json");
  const assetPath = resolve(root, ASSET_BUILD_JSON);
  if (!existsSync(sourcePath)) return [`${sourcePath} ontbreekt; bouw eerst met npm run native:build`];
  if (!existsSync(assetPath)) return [`${assetPath} ontbreekt; draai npx cap sync android`];
  if (readFileSync(sourcePath, "utf8") !== readFileSync(assetPath, "utf8")) return ["build.json in de Android-assets wijkt af van dist/native (verouderde sync)"];
  let metadata;
  try { metadata = JSON.parse(readFileSync(sourcePath, "utf8")); } catch { return ["build.json is geen geldige JSON"]; }
  return signingProblems(metadata, env);
}

export function afterProblems(bundlePath, { jarsigner = "jarsigner" } = {}) {
  if (!bundlePath || !existsSync(bundlePath)) return { problems: [`bundel ${bundlePath ?? "(geen pad)"} bestaat niet`] };
  const bytes = readFileSync(bundlePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const run = spawnSync(jarsigner, ["-verify", "-verbose", "-certs", bundlePath], { encoding: "utf8" });
  if (run.error) return { problems: [`jarsigner is niet beschikbaar: ${run.error.message}`], sha256 };
  const output = `${run.stdout}\n${run.stderr}`;
  const problems = [];
  if (run.status !== 0 || !/jar verified/i.test(output)) problems.push("de bundel is niet (geldig) getekend");
  if (/CN=Android Debug/i.test(output)) problems.push("de bundel is met de Android-debugsleutel getekend");
  if (/Application_ID|jar is unsigned/i.test(output)) problems.push("de bundel is ongetekend");
  return { problems, sha256 };
}

function main() {
  const [mode, bundle] = process.argv.slice(2);
  if (mode === "before") {
    const problems = beforeProblems();
    if (problems.length > 0) { console.error(`Ondertekenen en distributie geweigerd:\n- ${problems.join("\n- ")}`); process.exit(1); }
    console.log("Android-signingpoort: bundel is een niet-compileproef local-store-test/play-test-build; ondertekenen toegestaan. Geen upload.");
  } else if (mode === "after") {
    const { problems, sha256 } = afterProblems(bundle);
    if (problems.length > 0) { console.error(`Getekende bundel afgekeurd:\n- ${problems.join("\n- ")}`); process.exit(1); }
    console.log(`Getekende bundel gecontroleerd. sha256 ${sha256}. Niet geüpload; plaatsing in Play is een handeling van de eigenaar.`);
  } else {
    console.error("Gebruik: android-release-guard.mjs before | after <bestand.aab>");
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main();
