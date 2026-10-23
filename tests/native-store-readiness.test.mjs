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
  "capacitor.config.ts": 'const DISTRIBUTION_PROFILES = {}; appId: "app.versado.app", buildProfile !== "remote-preview" && buildProfile !== "local-development"',
  "scripts/native/build.ts": "releaseApproved: false",
  "android/variables.gradle": "targetSdkVersion = 36",
  "android/app/build.gradle": 'applicationId "app.versado.app"\nVERSADO_VERSION_CODE VERSADO_VERSION_NAME\nsigningConfigs {\nVERSADO_UPLOAD_KEYSTORE_PATH',
  "android/app/src/main/AndroidManifest.xml": '<intent-filter android:autoVerify="true"/>',
  "android/app/src/main/java/app/versado/app/MainActivity.java": "ActivityInfo.SCREEN_ORIENTATION_PORTRAIT",
  "ios/App/App.xcodeproj/project.pbxproj": "PRODUCT_BUNDLE_IDENTIFIER = app.versado.app;\nIPHONEOS_DEPLOYMENT_TARGET = 15.0;\nCODE_SIGN_ENTITLEMENTS = App/App.entitlements;",
  "ios/App/App/Info.plist": "<key>UISupportedInterfaceOrientations</key>\n<array><string>UIInterfaceOrientationPortrait</string></array>\n<key>ITSAppUsesNonExemptEncryption</key><false/>",
  "ios/App/App/PrivacyInfo.xcprivacy": "<plist/>",
  ".github/workflows/native.yml": "xcodebuild -scheme App archive\n./gradlew :app:bundleRelease",
  "public/.well-known/apple-app-site-association": "{}",
  "public/.well-known/assetlinks.json": "[]",
  "src/lib/native/api.ts": 'req.method === "DELETE" && path === "account"; minimumNativeVersion',
  "src/app/account-verwijderen/page.tsx": "",
  "src/app/voorwaarden/page.tsx": "",
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
  assert.equal(evaluate(memoryFs({ ...files, "capacitor.config.ts": 'appId: "app.versado.app"; if (buildProfile === "release") {}' })).guards.find((g) => g.id === "release-profile-blocked").ok, false);
});
