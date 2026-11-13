// Poort voor iOS-testdistributie (WP2, docs/NATIVE-STORE-RELEASE-PLAN.md): bepaalt of een bundel gearchiveerd en
// geëxporteerd mag worden en of het archief klopt. Geen netwerk, geen upload, geen geheimen in de uitvoer.
// Gebruik: node scripts/native/ios-release-guard.mjs before             (vóór xcodebuild archive)
//          node scripts/native/ios-release-guard.mjs after <App.app-map> (na het archiveren)
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { verifyBundle } from "./verify-distribution.mjs";
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
  if (!/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.test(metadata.version ?? "")) problems.push("ongeldige appversie");
  if (!/^[1-9]\d{0,3}$/.test(String(metadata.buildNumber ?? ""))) problems.push("ongeldig Apple-buildnummer (1..9999 vereist)");
  if (!/^[0-9a-f]{40}$/.test(metadata.sourceCommit ?? "")) problems.push("ongeldige volledige broncommit");
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
  if ([true, "true", "YES", "1", 1].includes(plist.CAPACITOR_DEBUG)) problems.push("CAPACITOR_DEBUG staat aan in de app");
  return problems;
}

// Strikte allowlist: Versado vraagt nu geen Apple-login, push of Associated Domains aan.
export function distributionProblems({ entitlements: ent = {}, profile, authorities = [], team, identifier }, expectedTeam) {
  const problems = [];
  if (!/^[A-Z0-9]{10}$/.test(expectedTeam ?? "") || team !== expectedTeam) problems.push("signingteam ontbreekt of wijkt af");
  if (identifier !== APP_ID) problems.push("codesign-identiteit wijkt af");
  if (!authorities[0]?.startsWith("Apple Distribution:")) problems.push("Apple Distribution-signing ontbreekt");
  const allowed = ["application-identifier", "com.apple.developer.team-identifier", "keychain-access-groups", "get-task-allow", "beta-reports-active"];
  const check = (values, label, profileValues = false) => {
    for (const key of Object.keys(values)) if (!allowed.includes(key)) problems.push(`${label}: onverwacht entitlement ${key}`);
    if (values["get-task-allow"] !== false) problems.push(`${label}: get-task-allow moet false zijn`);
    if (values["application-identifier"] !== `${expectedTeam}.${APP_ID}`) problems.push(`${label}: application-identifier wijkt af`);
    if (values["com.apple.developer.team-identifier"] !== expectedTeam) problems.push(`${label}: team-entitlement wijkt af`);
    if (values["beta-reports-active"] !== undefined && values["beta-reports-active"] !== true) problems.push(`${label}: beta-reports-active ongeldig`);
    const groups = values["keychain-access-groups"];
    if (groups !== undefined) {
      const appGroup = `${expectedTeam}.${APP_ID}`;
      const wildcard = `${expectedTeam}.*`;
      // Apple TN3125: het profiel is een allowlist, niet de door de app geclaimde rechten.
      // Alleen het profiel mag naast één geldige teamgroep ook com.apple.token bevatten.
      const accepted = profileValues
        ? Array.isArray(groups) && groups.length >= 1 && groups.length <= 2 &&
          groups.filter(group => group === appGroup || group === wildcard).length === 1 &&
          groups.every(group => group === appGroup || group === wildcard || group === 'com.apple.token') &&
          new Set(groups).size === groups.length
        : Array.isArray(groups) && groups.length === 1 && groups[0] === appGroup;
      if (!accepted) problems.push(`${label}: onverwachte keychain-groep`);
    }
  };
  check(ent, "app");
  if (!profile) return [...problems, "App Store-profiel ontbreekt"];
  check(profile.Entitlements ?? {}, "profiel", true);
  if (Object.hasOwn(profile, "ProvisionedDevices") || profile.ProvisionsAllDevices !== undefined) problems.push("geen App Store-distributieprofiel");
  if (JSON.stringify(profile.TeamIdentifier) !== JSON.stringify([expectedTeam])) problems.push("profielteam wijkt af");
  if (!(Date.parse(profile.ExpirationDate) > Date.now())) problems.push("profiel is verlopen of onleesbaar");
  if (profile.Entitlements?.["beta-reports-active"] !== true) problems.push("TestFlight-profiel mist beta-reports-active");
  return problems;
}

// Tijdelijke diagnose bij afkeuring: uitsluitend vaste categorieën, aantallen en
// vergelijkingsresultaten. Geen ruwe groepen, team-/prefixwaarden of profieldata.
// TN3125: profielentitlements zijn een allowlist, geen appclaims. De diagnose
// wijzigt distributionProblems() niet en is nooit een acceptatiebesluit.
export function distributionDiagnostics({ entitlements: ent = {}, profile, team, identifier }, expectedTeam) {
  const profileEnt = profile?.Entitlements ?? {};
  const validPrefix = value => typeof value === "string" && /^[A-Z0-9]{10}$/.test(value);
  const expectedTeamValid = validPrefix(expectedTeam);
  const appPrefix = value => {
    if (typeof value !== "string" || !value.endsWith(`.${APP_ID}`)) return null;
    const prefix = value.slice(0, -APP_ID.length - 1);
    return validPrefix(prefix) ? prefix : null;
  };
  const declared = profile?.ApplicationIdentifierPrefix;
  const declaredPrefix = Array.isArray(declared) && declared.length === 1 && validPrefix(declared[0]) ? declared[0] : null;
  const prefixState = declared === undefined ? "absent"
    : !Array.isArray(declared) || !declared.every(validPrefix) ? "malformed"
    : declared.length === 0 ? "empty" : declared.length === 1 ? "single" : "multiple";
  const app = ent["application-identifier"];
  const provisionedApp = profileEnt["application-identifier"];
  const comparePrefix = prefix => prefix !== null && expectedTeamValid ? prefix === expectedTeam : null;
  const groupsSummary = groups => {
    if (groups === undefined) return { state: "absent" };
    if (!Array.isArray(groups)) return { state: "malformed" };
    const counts = {};
    for (const group of groups) {
      const category = typeof group !== "string" ? "malformed"
        : expectedTeamValid && group === `${expectedTeam}.${APP_ID}` ? "expected-app"
        : expectedTeamValid && group === `${expectedTeam}.*` ? "expected-wildcard"
        : group === "com.apple.token" ? "apple-token"
        : declaredPrefix !== null && group === `${declaredPrefix}.${APP_ID}` ? "profile-prefix-app"
        : declaredPrefix !== null && group === `${declaredPrefix}.*` ? "profile-prefix-wildcard"
        : "other";
      counts[category] = (counts[category] ?? 0) + 1;
    }
    return { state: "array", count: groups.length, duplicateCount: groups.length - new Set(groups).size, categories: counts };
  };
  const appGroups = ent["keychain-access-groups"];
  const profileGroups = profileEnt["keychain-access-groups"];
  // Beschrijft alleen profieldekking, niet of een claim volgens ons beleid mag.
  const covered = appGroups === undefined ? null : Array.isArray(appGroups) && appGroups.length > 0 && Array.isArray(profileGroups) && appGroups.every(group =>
    typeof group === "string" && profileGroups.some(allowed => allowed === group ||
      (typeof allowed === "string" && /^[A-Z0-9]{10}\.\*$/.test(allowed) && group.startsWith(allowed.slice(0, -1)))));
  return {
    expectedTeamValid,
    signingTeamMatchesExpected: expectedTeamValid && team === expectedTeam,
    bundleIdentifierMatchesExpected: identifier === APP_ID,
    appIdentifierMatchesExpected: expectedTeamValid && app === `${expectedTeam}.${APP_ID}`,
    profileIdentifierMatchesExpected: expectedTeamValid && provisionedApp === `${expectedTeam}.${APP_ID}`,
    appPrefixMatchesExpectedTeam: comparePrefix(appPrefix(app)),
    profileAppPrefixMatchesExpectedTeam: comparePrefix(appPrefix(provisionedApp)),
    declaredPrefixState: prefixState,
    declaredPrefixCount: Array.isArray(declared) ? declared.length : null,
    declaredPrefixMatchesExpectedTeam: comparePrefix(declaredPrefix),
    declaredPrefixMatchesAppPrefix: declaredPrefix !== null && appPrefix(app) !== null ? declaredPrefix === appPrefix(app) : null,
    appKeychain: groupsSummary(appGroups),
    profileKeychain: groupsSummary(profileGroups),
    appKeychainCoveredByProfile: covered,
  };
}

export function ipaProblems(appDirectory, { env = process.env, root = process.cwd() } = {}) {
  const problems = afterProblems(appDirectory, { root });
  const command = (name, args) => {
    const result = spawnSync(name, args, { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${name}: controle mislukt`);
    return result;
  };
  try {
    problems.push(...verifyBundle({ platform: "ios", root: appDirectory, env, repoRoot: root }));
    const plist = readPlist(join(appDirectory, "Info.plist"));
    if (plist?.CFBundleDisplayName !== "Versado") problems.push("appnaam wijkt af van Versado");
    const privacy = readPlist(join(appDirectory, "PrivacyInfo.xcprivacy"));
    if (!privacy || privacy.NSPrivacyTracking !== false || !Array.isArray(privacy.NSPrivacyTrackingDomains) || privacy.NSPrivacyTrackingDomains.length !== 0 || !Array.isArray(privacy.NSPrivacyAccessedAPITypes)) problems.push("privacymanifest is ongeldig of activeert tracking");
    const expectedPrivacy = readPlist(resolve(root, "ios/App/App/PrivacyInfo.xcprivacy"));
    if (!expectedPrivacy || JSON.stringify(privacy) !== JSON.stringify(expectedPrivacy)) problems.push("privacymanifest wijkt af van de beoordeelde bron");
    command("codesign", ["--verify", "--deep", "--strict", appDirectory]);
    const details = command("codesign", ["-dvv", appDirectory]).stderr;
    const parseOutput = (output) => {
      const result = spawnSync("python3", ["-I", "-c", "import plistlib,json,sys;print(json.dumps(plistlib.loads(sys.stdin.buffer.read()),default=str))"], { input: output, encoding: "utf8" });
      if (result.status !== 0) throw new Error("plist-controle mislukt");
      return JSON.parse(result.stdout);
    };
    const entitlements = parseOutput(command("codesign", ["-d", "--entitlements", ":-", appDirectory]).stdout);
    const profile = parseOutput(command("security", ["cms", "-D", "-i", join(appDirectory, "embedded.mobileprovision")]).stdout);
    const signing = { entitlements, profile, authorities: [...details.matchAll(/^Authority=(.+)$/gm)].map((m) => m[1]), team: /^TeamIdentifier=(.+)$/m.exec(details)?.[1], identifier: /^Identifier=(.+)$/m.exec(details)?.[1] };
    const distribution = distributionProblems(signing, env.IOS_TEAM_ID);
    problems.push(...distribution);
    if (distribution.length > 0) problems.push(`Signingdiagnose (geschoond; geen acceptatiebesluit): ${JSON.stringify(distributionDiagnostics(signing, env.IOS_TEAM_ID))}`);
  } catch { problems.push("onafhankelijke IPA-/signingcontrole mislukt (geen profiel- of sleutelmateriaal gelogd)"); }
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
  } else if (mode === "ipa" && target) {
    const problems = ipaProblems(target);
    if (problems.length) { console.error(`IPA afgekeurd:\n- ${problems.join("\n- ")}`); process.exit(1); }
    console.log("IPA onafhankelijk gecontroleerd: signing, profiel, identiteit, versie, backend, assets en privacy.");
  } else {
    console.error("Gebruik: ios-release-guard.mjs before | after <App.app-map> | ipa <App.app-map>");
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main();
