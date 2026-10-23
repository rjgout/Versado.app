// Objectieve releasegate voor Versado Mobile 1.0 (zie docs/NATIVE-STORE-RELEASE-PLAN.md).
//
// Twee soorten controles, uitsluitend afgeleid uit bestanden in de repository:
//  - GUARD: moet altijd waar blijven. Een falende guard is een regressie (exit 1).
//  - BLOKKADE: moet waar worden vóór een publieke release. Een openstaande blokkade
//    is geen fout; zij maakt zichtbaar wat er nog ontbreekt. Met --strict faalt het
//    script zolang er een niet-gewaiveerde blokkade openstaat.
// Dit script bewijst nooit dat iets op een toestel werkt en kent geen "gereed"-status.
//
// Gebruik: node scripts/native/store-readiness.mjs [--json] [--strict] [--waive=id,id]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const realFs = (root = ".") => ({
  read: (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : ""),
  exists: (path) => existsSync(join(root, path)),
  list: (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : []),
  tree: (dir) => {
    const found = [];
    const walk = (current) => {
      for (const entry of existsSync(join(root, current)) ? readdirSync(join(root, current), { withFileTypes: true }) : []) {
        const next = `${current}/${entry.name}`;
        if (entry.isDirectory()) { if (entry.name !== "Pods" && entry.name !== "build" && entry.name !== ".gradle") walk(next); }
        else found.push(next);
      }
    };
    walk(dir);
    return found;
  },
});

const APP_ID = "app.versado.app";
const gradleNumber = (text, key) => Number(new RegExp(`${key}\\s*=\\s*(\\d+)`).exec(text)?.[1] ?? 0);
const workflows = (fs) => fs.list(".github/workflows").filter((name) => name.endsWith(".yml")).map((name) => fs.read(`.github/workflows/${name}`));

// Een guard beschrijft een invariant; "evidence" zegt wat er concreet is gecontroleerd.
export const GUARDS = [
  {
    id: "release-profile-blocked",
    title: "Het buildprofiel wordt uitsluitend door scripts/native/profiles.cjs bepaald en kent geen releaseprofiel",
    check: (fs) => {
      const config = fs.read("capacitor.config.ts");
      const profiles = fs.read("scripts/native/profiles.cjs");
      const ids = /PROFILE_IDS\s*=\s*\[([^\]]*)\]/.exec(profiles)?.[1] ?? "release";
      const ok = /resolveBuildProfile/.test(config) && !/"release"/.test(ids) && !/(?:buildProfile|profile)\s*===\s*"release"/.test(config + profiles) && /releaseprofiel blijft geblokkeerd/.test(profiles);
      return { ok, evidence: "capacitor.config.ts, scripts/native/profiles.cjs" };
    },
  },
  {
    id: "bundle-never-release-approved",
    title: "De lokale bundel markeert zichzelf nooit als release-goedgekeurd",
    check: (fs) => {
      const text = fs.read("scripts/native/profiles.cjs") + fs.read("scripts/native/build.ts");
      return { ok: /releaseApproved:\s*false/.test(text) && !/releaseApproved:\s*true/.test(text), evidence: "scripts/native/profiles.cjs, scripts/native/build.ts" };
    },
  },
  {
    id: "bundle-identity-consistent",
    title: `Eén bundle-/applicatie-ID (${APP_ID}) in Capacitor, Android en iOS`,
    check: (fs) => {
      const ids = [
        fs.read("scripts/native/profiles.cjs").includes(`APP_ID = "${APP_ID}"`) && /APP_ID/.test(fs.read("capacitor.config.ts")),
        fs.read("android/app/build.gradle").includes(`applicationId "${APP_ID}"`),
        (fs.read("ios/App/App.xcodeproj/project.pbxproj").match(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g) ?? []).every((line) => line.includes(APP_ID)),
      ];
      return { ok: ids.every(Boolean), evidence: "profiles.cjs, capacitor.config.ts, android/app/build.gradle, project.pbxproj" };
    },
  },
  {
    id: "phones-portrait",
    title: "Telefoons zijn portrait-only (iPhone via Info.plist, Android via MainActivity); tablets ondersteunen beide richtingen",
    check: (fs) => {
      const plist = fs.read("ios/App/App/Info.plist");
      const iphone = /<key>UISupportedInterfaceOrientations<\/key>\s*<array>\s*<string>UIInterfaceOrientationPortrait<\/string>\s*<\/array>/.test(plist);
      return { ok: iphone && fs.read("android/app/src/main/java/app/versado/app/MainActivity.java").includes("SCREEN_ORIENTATION_PORTRAIT"), evidence: "Info.plist, MainActivity.java" };
    },
  },
  {
    id: "android-target-sdk",
    title: "Android targetSdk ≥ 36 (Google Play-eis voor nieuwe apps en updates vanaf 31 augustus 2026)",
    check: (fs) => ({ ok: gradleNumber(fs.read("android/variables.gradle"), "targetSdkVersion") >= 36, evidence: "android/variables.gradle" }),
  },
  {
    id: "ios-deployment-target",
    title: "iOS-deploymentdoel ≥ 13 (Apple-eis vanaf 9 september 2026)",
    check: (fs) => {
      const targets = [...fs.read("ios/App/App.xcodeproj/project.pbxproj").matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map((m) => Number(m[1]));
      return { ok: targets.length > 0 && targets.every((v) => v >= 13), evidence: "project.pbxproj" };
    },
  },
  {
    id: "ios-signing-refuses-probe",
    title: "iOS-archivering voor distributie weigert compileproef-, intern- en niet-testflight-bundels, en er is geen automatische App Store Connect-upload",
    check: (fs) => {
      const guard = fs.read("scripts/native/ios-release-guard.mjs");
      const release = fs.read(".github/workflows/native-ios-release.yml");
      const guardOk = /compileProbe !== false/.test(guard) && /local-store-test/.test(guard) && /testflight/.test(guard);
      const noUpload = /<string>export<\/string>/.test(release) && !/(altool|iTMSTransporter|upload-testflight|testflight-upload|app-store-connect-upload|destination<\/key><string>upload)/i.test(release) && /workflow_dispatch/.test(release) && !/\n\s+(push|pull_request|schedule):/.test(release);
      return { ok: guardOk && noUpload, evidence: "scripts/native/ios-release-guard.mjs, .github/workflows/native-ios-release.yml" };
    },
  },
  {
    id: "no-credentials-in-git",
    title: "Geen certificaten, sleutels, provisioningprofielen of services-bestanden in de native projectmappen",
    check: (fs) => {
      const forbidden = /(\.p8|\.p12|\.mobileprovision|\.keystore|\.jks|\.cer|\.pem)$|(^|\/)(google-services\.json|GoogleService-Info\.plist)$/i;
      const hits = [...fs.tree("ios"), ...fs.tree("android")].filter((path) => forbidden.test(path));
      return { ok: hits.length === 0, evidence: hits.length ? hits.join(", ") : "ios/, android/" };
    },
  },
];

// Blokkades die objectief uit de repository te lezen zijn. "owner" = vereist een handeling of
// beslissing van de eigenaar buiten de code; de code-kant staat dan in de werkpakketten.
export const BLOCKERS = [
  { id: "distribution-profile", area: "beide", wp: "WP1", title: "Gescheiden distributieprofielen local-internal en local-store-test met controleerbare voorwaarden naast de geblokkeerde release",
    check: (fs) => ({ ok: /DISTRIBUTION_PROFILES/.test(fs.read("scripts/native/profiles.cjs")) && /local-internal/.test(fs.read("scripts/native/profiles.cjs")) && /local-store-test/.test(fs.read("scripts/native/profiles.cjs")), evidence: "scripts/native/profiles.cjs" }) },
  { id: "distribution-origins-configured", area: "beide", wp: "WP1", owner: true, title: "Eigenaar heeft de toegestane HTTPS-backend-origins voor intern en store-test vastgelegd in scripts/native/distribution-origins.json",
    check: (fs) => {
      let data = {};
      try { data = JSON.parse(fs.read("scripts/native/distribution-origins.json")); } catch { /* ontbrekend of ongeldig = niet geconfigureerd */ }
      return { ok: Array.isArray(data.internal) && data.internal.length > 0 && Array.isArray(data["store-test"]) && data["store-test"].length > 0, evidence: "scripts/native/distribution-origins.json" };
    } },
  { id: "ios-privacy-manifest", area: "iOS", wp: "WP2", title: "PrivacyInfo.xcprivacy aanwezig en als resource in het app-target opgenomen (dataverzameling/labels beoordeelt de eigenaar in App Store Connect)",
    check: (fs) => ({ ok: fs.tree("ios/App").some((path) => path.endsWith("PrivacyInfo.xcprivacy")) && /PrivacyInfo\.xcprivacy in Resources/.test(fs.read("ios/App/App.xcodeproj/project.pbxproj")), evidence: "ios/App/**/PrivacyInfo.xcprivacy, project.pbxproj" }) },
  { id: "ios-entitlements", area: "iOS", wp: "WP2", title: "Echt entitlements-bestand gekoppeld via CODE_SIGN_ENTITLEMENTS (Sign in with Apple en/of associated domains, alleen indien in scope)",
    check: (fs) => ({ ok: /CODE_SIGN_ENTITLEMENTS/.test(fs.read("ios/App/App.xcodeproj/project.pbxproj")), evidence: "project.pbxproj" }) },
  { id: "ios-export-compliance", area: "iOS", wp: "WP2", title: "ITSAppUsesNonExemptEncryption beantwoord in Info.plist (eigenaar bevestigt het antwoord)",
    check: (fs) => ({ ok: fs.read("ios/App/App/Info.plist").includes("ITSAppUsesNonExemptEncryption"), evidence: "ios/App/App/Info.plist" }) },
  { id: "ios-testflight-workflow", area: "iOS", wp: "WP2", title: "Beschermde handmatige workflow die een ondertekende TestFlight-IPA exporteert (geen upload, alleen vanaf main, omgeving ios-testflight)",
    check: (fs) => { const text = fs.read(".github/workflows/native-ios-release.yml"); return { ok: /workflow_dispatch/.test(text) && /environment:\s*ios-testflight/.test(text) && /refs\/heads\/main/.test(text) && /-exportArchive/.test(text), evidence: ".github/workflows/native-ios-release.yml" }; } },
  { id: "ios-ci-archive", area: "iOS", wp: "WP0", title: "CI bewijst een iOS-archive voor echte apparaten (zonder signing)",
    check: (fs) => ({ ok: workflows(fs).some((text) => /xcodebuild[^\n]*\barchive\b/.test(text)), evidence: ".github/workflows/*.yml" }) },
  { id: "android-version-injectable", area: "Android", wp: "WP0", title: "versionCode en versionName worden per build geïnjecteerd, niet hard gecodeerd",
    check: (fs) => ({ ok: /VERSADO_VERSION_CODE/.test(fs.read("android/app/build.gradle")) && /VERSADO_VERSION_NAME/.test(fs.read("android/app/build.gradle")), evidence: "android/app/build.gradle" }) },
  { id: "android-release-signing", area: "Android", wp: "WP0", title: "Release-signing leest de uploadsleutel uitsluitend uit omgeving/CI-secrets",
    check: (fs) => ({ ok: /signingConfigs\s*\{/.test(fs.read("android/app/build.gradle")) && /VERSADO_UPLOAD_KEYSTORE_PATH/.test(fs.read("android/app/build.gradle")), evidence: "android/app/build.gradle" }) },
  { id: "android-ci-bundle", area: "Android", wp: "WP0", title: "CI bewijst een Android App Bundle-release-build (bundleRelease)",
    check: (fs) => ({ ok: workflows(fs).some((text) => /bundleRelease/.test(text)), evidence: ".github/workflows/*.yml" }) },
  { id: "android-app-links", area: "Android", wp: "WP7", title: "Android App Links: intent-filter met autoVerify voor de Versado-origin",
    check: (fs) => ({ ok: /android:autoVerify="true"/.test(fs.read("android/app/src/main/AndroidManifest.xml")), evidence: "AndroidManifest.xml" }) },
  { id: "well-known-association", area: "beide", wp: "WP7", title: "apple-app-site-association en assetlinks.json worden door de backend geserveerd",
    check: (fs) => {
      const files = [...fs.tree("public/.well-known"), ...fs.tree("src/app/.well-known")].join("\n");
      return { ok: /apple-app-site-association/.test(files) && /assetlinks\.json/.test(files), evidence: "public/.well-known, src/app/.well-known" };
    } },
  { id: "native-account-deletion", area: "beide", wp: "WP4", title: "Accountverwijdering is vanuit de native app te starten (Apple 5.1.1(v), Google Play)",
    check: (fs) => ({ ok: /method === "DELETE" && path === "account"/.test(fs.read("src/lib/native/api.ts")), evidence: "src/lib/native/api.ts" }) },
  { id: "web-account-deletion", area: "beide", wp: "WP4", title: "Publieke webpagina voor het aanvragen van accountverwijdering zonder de app (Google Play Data safety)",
    check: (fs) => ({ ok: ["account-verwijderen", "delete-account", "verwijder-account"].some((name) => fs.exists(`src/app/${name}/page.tsx`)), evidence: "src/app/account-verwijderen/page.tsx" }) },
  { id: "terms-of-use", area: "beide", wp: "WP4", title: "Voorwaarden als publieke pagina (de privacyverklaring bestaat al op /privacy)",
    check: (fs) => ({ ok: fs.exists("src/app/voorwaarden/page.tsx"), evidence: "src/app/voorwaarden/page.tsx" }) },
  { id: "apple-token-revocation", area: "iOS", wp: "WP4", conditional: "apple-signin", title: "Sign in with Apple: tokenintrekking via de Apple REST API en server-to-server-notificaties (alleen vereist als Sign in with Apple in 1.0 zit)",
    check: (fs) => ({ ok: fs.tree("src/lib").some((path) => /apple/i.test(path) && /auth\/revoke/.test(fs.read(path))), evidence: "src/lib/**" }) },
  { id: "min-version-policy", area: "beide", wp: "WP5", title: "Backend meldt een minimaal ondersteunde native versie zodat een te oude app netjes om een update vraagt",
    check: (fs) => ({ ok: /minimumNativeVersion/.test(fs.read("src/lib/native/api.ts")), evidence: "src/lib/native/api.ts (capabilities)" }) },
  { id: "native-push", area: "beide", wp: "WP12", conditional: "push", title: "Native push (APNs/FCM) met eigen tokenmodel (alleen vereist als push in 1.0 zit)",
    check: (fs) => ({ ok: /@capacitor\/push-notifications/.test(fs.read("package.json")), evidence: "package.json" }) },
  { id: "device-test-report", area: "beide", wp: "WP15", title: "Rapport met echte apparaattests (iPhone, iPad, Android-telefoon, Android-tablet) is vastgelegd",
    check: (fs) => ({ ok: fs.exists("docs/NATIVE-DEVICE-TEST-REPORT.md"), evidence: "docs/NATIVE-DEVICE-TEST-REPORT.md" }) },
];

export function evaluate(fs = realFs(), waived = []) {
  const run = (item) => ({ id: item.id, title: item.title, area: item.area, wp: item.wp, conditional: item.conditional, ...item.check(fs) });
  const guards = GUARDS.map(run);
  const blockers = BLOCKERS.map(run).map((item) => ({ ...item, waived: waived.includes(item.id) || (item.conditional ? waived.includes(item.conditional) : false) }));
  const open = blockers.filter((item) => !item.ok && !item.waived);
  return { guards, blockers, openBlockers: open.length, guardsFailed: guards.filter((item) => !item.ok).length };
}

function main() {
  const args = process.argv.slice(2);
  const waived = (args.find((arg) => arg.startsWith("--waive="))?.slice(8) ?? "").split(",").filter(Boolean);
  const report = evaluate(realFs(), waived);
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("Versado Mobile 1.0 — objectieve releasegate (bestandscontroles; geen apparaatbewijs)\n");
    console.log("GUARDS (moeten waar blijven)");
    for (const item of report.guards) console.log(`  [${item.ok ? "ok" : "FOUT"}] ${item.id} — ${item.title}`);
    console.log("\nBLOKKADES (moeten waar worden vóór publieke release)");
    for (const item of report.blockers) {
      const state = item.ok ? "opgelost" : item.waived ? "gewaiveerd" : "OPEN";
      console.log(`  [${state}] ${item.id} (${item.area}, ${item.wp}${item.conditional ? `, alleen bij ${item.conditional}` : ""}) — ${item.title}`);
    }
    console.log(`\n${report.openBlockers} openstaande blokkades, ${report.guardsFailed} falende guards. Dit is geen releasegoedkeuring.`);
  }
  if (report.guardsFailed > 0 || (args.includes("--strict") && report.openBlockers > 0)) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
