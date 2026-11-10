import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BLOCKERS, GUARDS, evaluate } from "../scripts/native/store-readiness.mjs";

// In-memory bestandssysteem: de controles lezen uitsluitend bestanden, dus dit maakt "alles
// opgelost" en "niets aanwezig" deterministisch testbaar zonder de repository te wijzigen.
const memoryFs = (files) => ({
  read: (path) => files[path] ?? "",
  exists: (path) => path in files,
  list: (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/")).map((path) => path.slice(dir.length + 1)),
  tree: (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
});

const completeFiles = () => ({
  "capacitor.config.ts": "import { APP_ID, resolveBuildProfile } from './scripts/native/profiles.cjs';",
  "scripts/native/profiles.cjs": 'const APP_ID = "app.versado.app"; const PROFILE_IDS = ["remote-preview", "local-development", "local-internal", "local-store-test"]; DISTRIBUTION_PROFILES local-internal local-store-test releaseApproved: false; "Het releaseprofiel blijft geblokkeerd"; ',
  "scripts/native/distribution-origins.json": JSON.stringify({ internal: ["https://intern.example.test"], "store-test": ["https://test.example.test"] }),
  "scripts/native/build.ts": "releaseApproved: false",
  ".github/workflows/native-android-release.yml": "on:\n  workflow_dispatch:\njobs:\n  x:\n    if: github.ref == 'refs/heads/main'\n    environment: android-play-test\n    steps: gradlew :app:bundleRelease",
  "scripts/native/android-release-guard.mjs": 'metadata.compileProbe !== false local-store-test',
  "android/variables.gradle": "targetSdkVersion = 36",
  "android/app/build.gradle": 'applicationId "app.versado.app"\nVERSADO_VERSION_CODE VERSADO_VERSION_NAME\nsigningConfigs {\nVERSADO_UPLOAD_KEYSTORE_PATH\nmetadata.compileProbe != false local-store-test play-test GradleException',
  "android/app/src/main/AndroidManifest.xml": '<intent-filter android:autoVerify="true"/>',
  "android/app/src/main/java/app/versado/app/MainActivity.java": "ActivityInfo.SCREEN_ORIENTATION_PORTRAIT",
  "ios/App/App.xcodeproj/project.pbxproj": "PrivacyInfo.xcprivacy in Resources\nPRODUCT_BUNDLE_IDENTIFIER = app.versado.app;\nIPHONEOS_DEPLOYMENT_TARGET = 15.0;\nCODE_SIGN_ENTITLEMENTS = App/App.entitlements;",
  "ios/App/App/Info.plist": "<key>UISupportedInterfaceOrientations</key>\n<array><string>UIInterfaceOrientationPortrait</string></array>\n<key>ITSAppUsesNonExemptEncryption</key><false/>",
  "ios/App/App/PrivacyInfo.xcprivacy": "<plist/>",
  ".github/workflows/native.yml": "xcodebuild -scheme App archive\n./gradlew :app:bundleRelease",
  ".github/workflows/native-ios-release.yml": "on:\n  workflow_dispatch:\njobs:\n  x:\n    if: github.ref == 'refs/heads/main'\n    environment: ios-testflight\n    steps: xcodebuild -exportArchive <key>destination</key><string>export</string>",
  "scripts/native/ios-release-guard.mjs": "metadata.compileProbe !== false local-store-test testflight",
  "public/.well-known/apple-app-site-association": "{}",
  "public/.well-known/assetlinks.json": "[]",
  "src/lib/native/api.ts": 'req.method === "DELETE" && path === "account"; minimumNativeVersion',
  "src/app/account-verwijderen/page.tsx": "export default function Page() { return null; }",
  "src/components/native/NativeFoundation.tsx": "<AccountDeletionForm />",
  "src/app/voorwaarden/page.tsx": "",
  "src/lib/legal/terms.ts": "export const TERMS = { title: 'x', updated: '2026-01-01', sections: [] };",
  "src/lib/appleRevoke.ts": "https://appleid.apple.com/auth/revoke",
  "package.json": '{"dependencies":{"@capacitor/push-notifications":"8"}}',
  "docs/NATIVE-DEVICE-TEST-REPORT.md": "",
});

test("de echte repository houdt alle guards waar (releaseprofiel dicht, geen credentials, targetSdk, portrait)", () => {
  const report = evaluate();
  assert.deepEqual(report.guards.filter((guard) => !guard.ok).map((guard) => guard.id), []);
});

test("ids zijn uniek en elk id staat in het stuurdocument, zodat code en plan niet uiteenlopen", () => {
  const ids = [...GUARDS, ...BLOCKERS].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  const plan = readFileSync("docs/NATIVE-STORE-RELEASE-PLAN.md", "utf8");
  for (const id of ids) assert.ok(plan.includes(`\`${id}\``), `docs/NATIVE-STORE-RELEASE-PLAN.md noemt \`${id}\` niet`);
  for (const blocker of BLOCKERS) assert.match(blocker.wp, /^WP\d+$/);
});

test("met alle voorwaarden aanwezig is er geen openstaande blokkade en geen falende guard", () => {
  const report = evaluate(memoryFs(completeFiles()));
  assert.deepEqual(report.blockers.filter((item) => !item.ok).map((item) => item.id), []);
  assert.equal(report.openBlockers, 0);
  assert.equal(report.guardsFailed, 0);
});

test("zonder bestanden blijven alle blokkades open en is er geen enkele 'gereed'-uitkomst", () => {
  const report = evaluate(memoryFs({}));
  assert.equal(report.blockers.every((item) => !item.ok), true);
  assert.equal(report.openBlockers, BLOCKERS.length);
  assert.ok(report.guardsFailed > 0);
});

test("een conditionele blokkade kan alleen via zijn voorwaarde of id worden gewaiveerd", () => {
  const empty = memoryFs({});
  assert.equal(evaluate(empty, ["push"]).blockers.find((item) => item.id === "native-push").waived, true);
  assert.equal(evaluate(empty, ["push"]).blockers.find((item) => item.id === "native-account-deletion").waived, false);
  assert.equal(evaluate(empty, ["apple-signin"]).blockers.find((item) => item.id === "apple-token-revocation").waived, true);
  assert.equal(evaluate(empty, ["device-test-report"]).blockers.find((item) => item.id === "device-test-report").waived, true);
});

test("credentials in de native mappen laten de guard falen; een voorbeeldbestand is toegestaan", () => {
  const files = completeFiles();
  assert.equal(evaluate(memoryFs(files)).guards.find((guard) => guard.id === "no-credentials-in-git").ok, true);
  files["ios/App/App/SignInWithApple.entitlements.example"] = "<plist/>";
  assert.equal(evaluate(memoryFs(files)).guards.find((guard) => guard.id === "no-credentials-in-git").ok, true);
  for (const path of ["ios/App/dist.p12", "android/app/upload.jks", "android/app/google-services.json", "ios/App/AuthKey_ABC.p8"]) {
    const result = evaluate(memoryFs({ ...files, [path]: "geheim" })).guards.find((guard) => guard.id === "no-credentials-in-git");
    assert.equal(result.ok, false, path);
  }
});

test("een geopend releaseprofiel of een goedgekeurde bundel is een regressie", () => {
  const files = completeFiles();
  assert.equal(evaluate(memoryFs({ ...files, "scripts/native/build.ts": "releaseApproved: true" })).guards.find((g) => g.id === "bundle-never-release-approved").ok, false);
  assert.equal(evaluate(memoryFs({ ...files, "scripts/native/profiles.cjs": files["scripts/native/profiles.cjs"] + 'if (profile === "release") {}' })).guards.find((g) => g.id === "release-profile-blocked").ok, false);
  assert.equal(evaluate(memoryFs({ ...files, "scripts/native/profiles.cjs": files["scripts/native/profiles.cjs"].replace('"local-store-test"]', '"local-store-test", "release"]') })).guards.find((g) => g.id === "release-profile-blocked").ok, false);
});

test("zonder vastgelegde origins blijft de eigenaarsblokkade open, ook als de code compleet is", () => {
  const files = completeFiles();
  for (const origins of [{ internal: [], "store-test": [] }, { internal: ["https://a.example.test"], "store-test": [] }]) {
    const report = evaluate(memoryFs({ ...files, "scripts/native/distribution-origins.json": JSON.stringify(origins) }));
    assert.equal(report.blockers.find((item) => item.id === "distribution-origins-configured").ok, false);
  }
  assert.equal(evaluate(memoryFs({ ...files, "scripts/native/distribution-origins.json": "{kapot" })).blockers.find((item) => item.id === "distribution-origins-configured").ok, false);
});

test("de signingpoort-guard faalt zodra Gradle compileproeven doorlaat of de workflow automatisch uploadt of op een PR draait", () => {
  const files = completeFiles();
  const guard = (patch) => evaluate(memoryFs({ ...files, ...patch })).guards.find((item) => item.id === "android-signing-refuses-probe").ok;
  assert.equal(guard({}), true);
  assert.equal(guard({ "android/app/build.gradle": files["android/app/build.gradle"].replace("compileProbe != false", "") }), false);
  assert.equal(guard({ ".github/workflows/native-android-release.yml": files[".github/workflows/native-android-release.yml"] + "\n      - uses: r0adkll/upload-google-play@v1" }), false);
  assert.equal(guard({ ".github/workflows/native-android-release.yml": files[".github/workflows/native-android-release.yml"].replace("on:\n", "on:\n  pull_request:\n") }), false);
});

test("de iOS-poort-guard faalt zodra de poort compileproeven doorlaat of de workflow uploadt of op een PR draait", () => {
  const files = completeFiles();
  const guard = (patch) => evaluate(memoryFs({ ...files, ...patch })).guards.find((item) => item.id === "ios-signing-refuses-probe").ok;
  assert.equal(guard({}), true);
  assert.equal(guard({ "scripts/native/ios-release-guard.mjs": "" }), false);
  assert.equal(guard({ ".github/workflows/native-ios-release.yml": files[".github/workflows/native-ios-release.yml"] + "\n xcrun altool --upload-app" }), false);
  assert.equal(guard({ ".github/workflows/native-ios-release.yml": files[".github/workflows/native-ios-release.yml"].replace("on:\n", "on:\n  pull_request:\n") }), false);
});

test("het privacy manifest telt pas als opgelost als het ook in het app-target is opgenomen", () => {
  const files = completeFiles();
  const manifest = (patch) => evaluate(memoryFs({ ...files, ...patch })).blockers.find((item) => item.id === "ios-privacy-manifest").ok;
  assert.equal(manifest({ "ios/App/App/PrivacyInfo.xcprivacy": "<plist/>" }), true);
  assert.equal(manifest({ "ios/App/App.xcodeproj/project.pbxproj": "PRODUCT_BUNDLE_IDENTIFIER = app.versado.app;" }), false);
});

test("accountverwijdering telt pas als opgelost met een native scherm en een openbare webpagina (niet de ingelogde variant)", () => {
  const files = completeFiles();
  const blocker = (id, patch) => evaluate(memoryFs({ ...files, ...patch })).blockers.find((item) => item.id === id).ok;
  assert.equal(blocker("native-account-deletion", {}), true);
  assert.equal(blocker("native-account-deletion", { "src/components/native/NativeFoundation.tsx": "" }), false, "alleen een API-contract is geen scherm");
  assert.equal(blocker("web-account-deletion", {}), true);
  assert.equal(blocker("web-account-deletion", { "src/app/account-verwijderen/page.tsx": 'if (!user) redirect("/login");' }), false, "een ingelogde pagina is niet publiek");
});

test("voorwaarden tellen pas als opgelost met een door de eigenaar aangeleverde tekst, niet met een lege pagina", () => {
  const files = completeFiles();
  const terms = (patch) => evaluate(memoryFs({ ...files, ...patch })).blockers.find((item) => item.id === "terms-of-use").ok;
  assert.equal(terms({}), true);
  assert.equal(terms({ "src/lib/legal/terms.ts": "export const TERMS: LegalDocument | null = null;" }), false);
  assert.equal(terms({ "src/lib/legal/terms.ts": "" }), false, "een leeg bestand telt niet");
});
