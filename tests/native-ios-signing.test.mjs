import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { findOpenSsl3, validatePkcs12, contentReference, opensslResult, securityImportCategory, macImportFailure, diagnosticMessage } from '../scripts/native/ios-p12-diagnostics.mjs';
import { protectedContext, certificateProblems, profileProblems, patchReleaseProject, exportOptions, prepare, cleanup, xcodeFailureSummary } from '../scripts/native/ios-signing-assets.mjs';

const team = 'ABCDEFGHIJ', uuid = '12345678-1234-1234-1234-123456789ABC';
const appId = 'app.versado.app', project = 'ios/App/App.xcodeproj/project.pbxproj', release = 'AAAAAAAAAAAAAAAAAAAAAAAA';
const model = { objects: {
  target: { isa:'PBXNativeTarget', name:'App', productType:'com.apple.product-type.application', buildConfigurationList:'list' },
  list: { buildConfigurations:['debug', release] },
  debug: { name:'Debug', buildSettings:{ CODE_SIGN_STYLE:'Automatic', PRODUCT_BUNDLE_IDENTIFIER:appId } },
  [release]: { name:'Release', buildSettings:{ CODE_SIGN_STYLE:'Automatic', PRODUCT_BUNDLE_IDENTIFIER:appId } },
} };
const projectText = '// !$*UTF8*$!\n{\n' + release + ' /* Release */ = {\nisa = XCBuildConfiguration;\nbuildSettings = { CODE_SIGN_STYLE = Automatic; PRODUCT_BUNDLE_IDENTIFIER = app.versado.app; };\nname = Release;\n};\n}\n';
const probeEnv = { GITHUB_EVENT_NAME:'workflow_dispatch', GITHUB_REF:'refs/heads/develop', GITHUB_SHA:'a'.repeat(40) };

test('signingmiddelen zijn uitsluitend voor handmatige develop-runs op macOS', () => {
  assert.doesNotThrow(() => protectedContext(probeEnv, 'darwin'));
  for (const patch of [{ GITHUB_REF:'refs/heads/main' }, { GITHUB_REF:'refs/pull/1/merge' }, { GITHUB_EVENT_NAME:'pull_request' }, { GITHUB_EVENT_NAME:'pull_request_target' }, { GITHUB_SHA:'short' }]) assert.throws(() => protectedContext({ ...probeEnv, ...patch }, 'darwin'));
  assert.throws(() => protectedContext(probeEnv, 'linux'));
});
const descriptor = { subject:'CN=Apple Distribution: Synthetic Only\nOU=' + team, issuer:'CN=Apple Worldwide Developer Relations Certification Authority', validFrom:'2020-01-01', validTo:'2099-01-01', fingerprint:'AB'.repeat(20) };
test('certificaatcontrole weigert ontbrekende sleutel, verkeerd type/team en ongeldige datum', () => {
  assert.deepEqual(certificateProblems(descriptor, team, [descriptor.fingerprint]), []);
  for (const patch of [{ subject:'CN=Apple Development: Synthetic Only\nOU=' + team }, { subject:'CN=Apple Distribution: Synthetic Only\nOU=OTHERTEAM1' }, { issuer:'CN=Untrusted issuer' }, { validTo:'2000-01-01' }, { validFrom:'2099-01-01' }, { validTo:'invalid' }]) assert.ok(certificateProblems({ ...descriptor, ...patch }, team, [descriptor.fingerprint]).length);
  for (const identities of [[], ['CD'.repeat(20)], [descriptor.fingerprint, 'CD'.repeat(20)]]) assert.ok(certificateProblems(descriptor, team, identities).length);
  assert.ok(certificateProblems(descriptor, '', [descriptor.fingerprint]).length);
});
const profileFor = der => ({ UUID:uuid, Platform:['iOS'], CreationDate:'2020-01-01', ExpirationDate:'2099-01-01', TeamIdentifier:[team], ApplicationIdentifierPrefix:[team], DeveloperCertificates:[der.toString('base64')], Entitlements:{
  'application-identifier':team + '.' + appId, 'com.apple.developer.team-identifier':team,
  'get-task-allow':false, 'beta-reports-active':true, 'keychain-access-groups':[team + '.*'],
} });
test('App Store-profiel moet exact bij certificaat, team en Versado horen; bestaande entitlementpolicy blijft gelden', () => {
  const der = Buffer.from('synthetic certificate only');
  assert.deepEqual(profileProblems(profileFor(der), der, team), []);
  const mutations = [
    p => p.ApplicationIdentifierPrefix = ['OTHERTEAM1'], p => p.UUID = '../other', p => p.Platform = ['macOS'], p => p.TeamIdentifier = ['OTHERTEAM1'],
    p => p.ExpirationDate = '2000-01-01', p => p.CreationDate = '2099-01-01',
    p => p.ProvisionedDevices = [], p => p.ProvisionsAllDevices = true,
    p => p.DeveloperCertificates = [], p => p.DeveloperCertificates.push(p.DeveloperCertificates[0]),
    p => p.DeveloperCertificates = [Buffer.from('wrong').toString('base64')],
    p => p.Entitlements['application-identifier'] = team + '.app.other',
    p => p.Entitlements['get-task-allow'] = true, p => delete p.Entitlements['beta-reports-active'],
    p => p.Entitlements['aps-environment'] = 'production',
  ];
  for (const mutate of mutations) { const p = profileFor(der); mutate(p); assert.ok(profileProblems(p, der, team).length, mutate.toString()); }
  const p = profileFor(der); p.Entitlements['keychain-access-groups'].push('com.apple.token');
  const errors = profileProblems(p, der, team);
  assert.ok(errors.includes('profiel: onverwachte keychain-groep'));
  assert.ok(errors.some(e => e.startsWith('Signingdiagnose (geschoond;')));
  assert.ok(!errors.join('\n').includes(team));
  const malformed = profileFor(der);
  malformed.Entitlements['unknown\nSECRET-ENTITLEMENT'] = true;
  assert.ok(!profileProblems(malformed, der, team).join('\n').includes('SECRET'));

});
test('expliciete export selecteert één profiel en identiteit; versiehernummering en upload blijven uit', () => {
  const xml = exportOptions(team, descriptor.fingerprint, uuid);
  const r = spawnSync('python3', ['-I', '-c', 'import sys,plistlib,json;print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))'], { input:xml, encoding:'utf8' });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { method:'app-store-connect', destination:'export', teamID:team, signingStyle:'manual', signingCertificate:descriptor.fingerprint, provisioningProfiles:{ [appId]:uuid }, manageAppVersionAndBuildNumber:false, uploadSymbols:true });
  for (const args of [['bad', descriptor.fingerprint, uuid], [team, 'bad', uuid], [team, descriptor.fingerprint, '../bad']]) assert.throws(() => exportOptions(...args));
});
test('projectpatch raakt alleen App/Release en weigert onduidelijke targetselectie', () => {
  const settings = { CODE_SIGN_STYLE:'Manual', CODE_SIGN_IDENTITY:descriptor.fingerprint, DEVELOPMENT_TEAM:team, PROVISIONING_PROFILE_SPECIFIER:uuid };
  const result = patchReleaseProject(projectText, model, settings);
  assert.deepEqual(result.model.objects.debug, model.objects.debug);
  assert.deepEqual(result.model.objects[release].buildSettings, { ...model.objects[release].buildSettings, ...settings });
  assert.equal(model.objects[release].buildSettings.CODE_SIGN_STYLE, 'Automatic');
  assert.match(result.text, /"CODE_SIGN_STYLE" = "Manual"/);
  assert.throws(() => patchReleaseProject(projectText, { objects:{} }, settings));
  const wrong = structuredClone(model); wrong.objects[release].buildSettings.PRODUCT_BUNDLE_IDENTIFIER = 'app.other';
  assert.throws(() => patchReleaseProject(projectText, wrong, settings));
});
// Alleen de OpenStep-projectparser op macOS. Geen keychain, signingmiddelen of archive nodig.
test('macOS plutil kan de echte App/Release-patch lezen; alle andere projectdata blijven gelijk', { skip:process.platform !== 'darwin' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'versado-project-test-'));
  try {
    const path = join(dir, 'project.pbxproj'), text = readFileSync(project, 'utf8');
    writeFileSync(path, text);
    const parse = () => {
      const r = spawnSync('plutil', ['-convert', 'json', '-o', '-', path], { encoding:'utf8' });
      assert.equal(r.status, 0, 'plutil moet het project kunnen lezen');
      return JSON.parse(r.stdout);
    };
    const original = parse(), patch = patchReleaseProject(text, original, { CODE_SIGN_STYLE:'Manual', CODE_SIGN_IDENTITY:descriptor.fingerprint, DEVELOPMENT_TEAM:team, PROVISIONING_PROFILE_SPECIFIER:uuid });
    writeFileSync(path, patch.text);
    assert.deepEqual(parse(), patch.model);
    assert.equal(readFileSync(project, 'utf8'), text);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});
// Zelfondertekende test-CA en testcertificaat: nooit door Apple uitgegeven, geen Apple-accountverkeer.
const cryptoRoot = mkdtempSync(join(tmpdir(), 'versado-synthetic-cert-'));
let synthetic;
test.before(() => {
  const binary = findOpenSsl3();
  assert.ok(binary, 'OpenSSL 3 moet beschikbaar zijn voor de synthetische AES256-fixture');
  const run = (args, options = {}) => { const r = spawnSync(binary, args, { cwd:cryptoRoot, encoding:'utf8', ...options }); assert.equal(r.status, 0, 'synthetische OpenSSL-fixture moet slagen'); };
  run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','2','-subj','/CN=Apple Worldwide Developer Relations Certification Authority/OU=Synthetic test only']);
  run(['req','-new','-newkey','rsa:2048','-nodes','-keyout','leaf.key','-out','leaf.csr','-subj','/CN=Apple Distribution: Synthetic Only/OU=' + team]);
  run(['x509','-req','-in','leaf.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','leaf.pem','-days','1']);
  synthetic = new X509Certificate(readFileSync(join(cryptoRoot, 'leaf.pem')));
  run(['pkcs12','-export','-inkey','leaf.key','-in','leaf.pem','-out','aes256.p12','-passout','env:P12_TEST_PASSWORD','-keypbe','AES-256-CBC','-certpbe','AES-256-CBC','-macalg','sha256','-iter','2048'], { env:{ ...process.env, P12_TEST_PASSWORD:'synthetic-password' } });

});
test.after(() => rmSync(cryptoRoot, { recursive:true, force:true }));

function fixture({ failAt = -1, importError = false, identityMissing = false, certificateMismatch = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'versado-asc.')), dir = join(root, 'signing'), home = join(root, 'home');
  mkdirSync(join(root, 'ios/App/App.xcodeproj'), { recursive:true });
  writeFileSync(join(root, project), projectText);
  const env = { RUNNER_TEMP:root, HOME:home, IOS_TEAM_ID:team, IOS_DISTRIBUTION_P12_PASSWORD:'synthetic-password', IOS_DISTRIBUTION_P12_BASE64:Buffer.from('synthetic-p12').toString('base64'), IOS_PROVISIONING_PROFILE_BASE64:Buffer.from('synthetic-profile').toString('base64') };
  const calls = [], fp = synthetic.fingerprint.replace(/:/g, ''), profile = profileFor(synthetic.raw);
  if (certificateMismatch) profile.DeveloperCertificates = [Buffer.from('wrong').toString('base64')];
  const run = (name, args) => {
    calls.push([name, ...args]);
    if (calls.length === failAt) throw new Error('SECRET-native-error');
    if (name === 'python3') return JSON.stringify(profile);
    if (name === 'plutil') {
      const patched = structuredClone(model);
      Object.assign(patched.objects[release].buildSettings, { CODE_SIGN_STYLE:'Manual', CODE_SIGN_IDENTITY:fp, DEVELOPMENT_TEAM:team, PROVISIONING_PROFILE_SPECIFIER:uuid, PROVISIONING_PROFILE:uuid });
      return JSON.stringify(readFileSync(join(root, project), 'utf8') === projectText ? model : patched);
    }
    assert.equal(name, 'security');
    if (args[0] === 'list-keychains' && !args.includes('-s')) return '"/original/login.keychain-db"\n';
    if (args[0] === 'create-keychain') writeFileSync(args.at(-1), 'synthetic-keychain');
    if (args[0] === 'import') assert.equal(statSync(args[1]).mode & 0o777, 0o600);
    if (args[0] === 'import' && importError) throw new Error('SECRET-import-error');
    if (args[0] === 'find-certificate') return synthetic.toString();
    if (args[0] === 'find-identity') return identityMissing ? '0 valid identities found' : '1) ' + fp + ' "Synthetic only"\n1 valid identities found';
    if (args[0] === 'delete-keychain') rmSync(args.at(-1), { force:true });
    return '';
  };
  const profilePath = join(home, 'Library/Developer/Xcode/UserData/Provisioning Profiles', uuid + '.mobileprovision');
  return { root, dir, home, env, calls, run, profilePath, options:{ env, root, run }, remove:() => rmSync(root, { recursive:true, force:true }) };
}
test('voorbereiding importeert uitsluitend bestaande middelen; cleanup herstelt project, profiel en keychain', () => {
  const f = fixture();
  try {
    prepare(f.dir, f.options);
    assert.ok(existsSync(f.profilePath));
    assert.notEqual(readFileSync(join(f.root, project), 'utf8'), projectText);
    assert.equal(existsSync(join(f.dir, 'identity.p12')), false);
    assert.equal(statSync(f.dir).mode & 0o777, 0o700);
    assert.ok(!f.calls.some(c => c.includes('-A')));
    assert.ok(f.calls.some(c => c[1] === 'import' && c.includes('/usr/bin/codesign')));
    cleanup(f.dir, f.options);
    assert.equal(readFileSync(join(f.root, project), 'utf8'), projectText);
    assert.equal(existsSync(f.profilePath), false);
    assert.equal(existsSync(f.dir), false);
    assert.ok(f.calls.some(c => c[1] === 'list-keychains' && c.includes('-s') && c.at(-1) === '/original/login.keychain-db'));
    cleanup(f.dir, f.options);
  } finally { f.remove(); }
});
test('importcontrole configureert geen project en gebruikt geen xcodebuild, codesign of account-API', () => {
  const f = fixture();
  try {
    prepare(f.dir, { ...f.options, configureProject:false });
    assert.equal(readFileSync(join(f.root, project), 'utf8'), projectText);
    assert.ok(f.calls.every(c => ['security', 'python3'].includes(c[0])));
    cleanup(f.dir, f.options);
    assert.equal(existsSync(f.dir), false);
  } finally { f.remove(); }
});
test('fouten in elke native voorbereidingsfase ruimen gedeeltelijke middelen op', () => {
  const good = fixture(); let count;
  try { prepare(good.dir, good.options); count = good.calls.length; cleanup(good.dir, good.options); } finally { good.remove(); }
  for (let i = 1; i <= count; i++) {
    const f = fixture({ failAt:i });
    try {
      assert.throws(() => prepare(f.dir, f.options), 'foutinjectie in fase ' + i);
      assert.equal(existsSync(f.dir), false, 'geen tijdelijke sleutels in fase ' + i);
      assert.equal(existsSync(f.profilePath), false);
      assert.equal(readFileSync(join(f.root, project), 'utf8'), projectText);
    } finally { f.remove(); }
  }
});
test('ontbrekende privésleutel, verkeerd profiel en PKCS12-importfout keuren veilig af', () => {
  for (const failure of [{ importError:true }, { identityMissing:true }, { certificateMismatch:true }]) {
    const f = fixture(failure);
    try {
      assert.throws(() => prepare(f.dir, f.options), error => !error.message.includes('SECRET'));
      assert.equal(existsSync(f.dir), false);
      assert.equal(existsSync(f.profilePath), false);
    } finally { f.remove(); }
  }
  const f = fixture();
  try {
    for (const patch of [{ IOS_DISTRIBUTION_P12_PASSWORD:'' }, { IOS_DISTRIBUTION_P12_BASE64:'not!base64' }, { IOS_PROVISIONING_PROFILE_BASE64:'' }]) {
      assert.throws(() => prepare(f.dir, { ...f.options, env:{ ...f.env, ...patch } }));
      assert.equal(f.calls.length, 0);
      assert.equal(existsSync(f.dir), false);
    }
    assert.throws(() => prepare(join(f.root, '..', 'outside'), f.options));
  } finally { f.remove(); }
});
test('bestaand profiel wordt niet overschreven of verwijderd; falende cleanup kan worden herhaald', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.home, 'Library/Developer/Xcode/UserData/Provisioning Profiles'), { recursive:true });
    writeFileSync(f.profilePath, 'existing-owner-file');
    assert.throws(() => prepare(f.dir, f.options));
    assert.equal(readFileSync(f.profilePath, 'utf8'), 'existing-owner-file');
  } finally { f.remove(); }
  const g = fixture();
  try {
    prepare(g.dir, g.options);
    assert.throws(() => cleanup(g.dir, { ...g.options, run:(name, args) => { if (args[0] === 'delete-keychain') throw new Error('SECRET'); return g.run(name, args); } }));
    assert.ok(existsSync(join(g.dir, 'state.json')));
    cleanup(g.dir, g.options);
    assert.equal(existsSync(g.dir), false);
    assert.equal(existsSync(g.profilePath), false);
  } finally { g.remove(); }
});
test('Xcode-logs worden alleen als vaste foutcategorieën uitgegeven', () => {
  const text = 'SECRET-KEY TEAM123456 profile SECRET-UUID No profiles for app error: maximum number of certificates';
  assert.deepEqual(xcodeFailureSummary(text), { certificateLimit:true, missingProfile:true, missingIdentity:false, signingFailure:false, reportedBuildError:true });
  assert.equal(xcodeFailureSummary('CompileSwift completed').reportedBuildError, false);
  const path = join(cryptoRoot, 'private.log'); writeFileSync(path, text);
  const r = spawnSync(process.execPath, ['scripts/native/ios-signing-assets.mjs','report',path], { encoding:'utf8' });
  assert.equal(r.status, 0);
  assert.ok(!r.stderr.includes('SECRET'));
  assert.ok(!r.stderr.includes('TEAM123456'));
});
test('workflow heeft twee strikt gescheiden modi met environment- en branchbescherming', () => {
  const require = createRequire(import.meta.url);
  const workflow = require('yaml').parse(readFileSync('.github/workflows/native-ios-release.yml','utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.signing_import_only.default, false);
  assert.equal(workflow.on.workflow_dispatch.inputs.upload.default, false);
  const archive = workflow.jobs['testflight-archive'], probe = workflow.jobs['signing-import-check'];
  for (const job of [archive, probe]) {
    assert.equal(job.environment, 'testflight');
    assert.equal(job.needs, 'branch-check');
    assert.match(job.if, /workflow_dispatch/);
    assert.match(job.if, /refs\/heads\/develop/);
    const checkout = job.steps.find(s => s.uses?.startsWith('actions/checkout'));
    assert.equal(checkout.with.ref, '$' + '{{ github.sha }}');
    assert.equal(checkout.with['persist-credentials'], false);
    assert.ok(job.steps.some(s => s.if === 'always()'));
  }
  assert.match(archive.if, /inputs.signing_import_only != true/);
  assert.match(probe.if, /inputs.signing_import_only == true/);
  assert.match(probe.if, /inputs.upload != true/);
  assert.doesNotMatch(JSON.stringify(probe), /ASC_API_KEY|ASC_KEY_ID|ASC_ISSUER|xcodebuild|altool|upload-artifact/);
  const step = archive.steps.find(s => s.id === 'distribution');
  assert.doesNotMatch(step.run, /allowProvisioning|authenticationKey|CODE_SIGN_STYLE=Automatic/);
  assert.ok(step.run.indexOf('ios-signing-assets.mjs prepare') < step.run.indexOf('xcodebuild -project'));
  assert.ok(step.run.indexOf('ios-release-guard.mjs ipa') < step.run.indexOf('if [ "$UPLOAD" = true ]'));
  assert.match(step.run, /-exportOptionsPlist "\$signing\/ExportOptions.plist"/);
  assert.doesNotMatch(JSON.stringify(archive.steps.find(s => s.uses?.startsWith('actions/upload-artifact'))), /keychain|\.p12|mobileprovision|archive.log|export.log/);
  const branch = workflow.jobs['branch-check'].steps[0];
  for (const [only, upload, ok] of [['true','true',false],['true','false',true],['false','false',true]]) {
    const r = spawnSync('bash',['-c',branch.run],{ env:{ ...process.env, EVENT_NAME:'workflow_dispatch', SELECTED_REF:'refs/heads/develop', SIGNING_IMPORT_ONLY:only, UPLOAD:upload } });
    assert.equal(r.status === 0, ok);
  }
});

test('werkelijke import-shell behoudt foutstatus en ruimt ook via always op', () => {
  const require = createRequire(import.meta.url);
  const workflow = require('yaml').parse(readFileSync('.github/workflows/native-ios-release.yml','utf8'));
  const job = workflow.jobs['signing-import-check'];
  const body = job.steps.find(s => s.env?.IOS_DISTRIBUTION_P12_BASE64).run;
  const always = job.steps.find(s => s.if === 'always()').run;
  const stub = 'node() { if [ "$2" = probe ]; then mkdir -p "$3"; printf synthetic > "$3/identity.p12"; return "$FIXTURE_STATUS"; else if [ "$FIXTURE_CLEANUP_FAIL" = true ]; then return 1; fi; rm -rf "$3"; fi; };\n';
  for (const [status, cleanupFail] of [['0','false'], ['7','false'], ['7','true']]) {
    const root = mkdtempSync(join(tmpdir(), 'versado-shell-cleanup-'));
    try {
      const env = { ...process.env, RUNNER_TEMP:root, FIXTURE_STATUS:status, FIXTURE_CLEANUP_FAIL:cleanupFail };
      const run = spawnSync('bash',['-c',stub + body], { env, encoding:'utf8' });
      assert.equal(run.status, cleanupFail === 'true' ? 1 : Number(status));
      const last = spawnSync('bash',['-c',stub + always], { env:{ ...env, FIXTURE_CLEANUP_FAIL:'false' }, encoding:'utf8' });
      assert.equal(last.status,0);
      assert.equal(spawnSync('bash',['-c','find "$RUNNER_TEMP" -mindepth 1 -print'],{ env,encoding:'utf8' }).stdout,'');
    } finally { rmSync(root, { recursive:true, force:true }); }
  }
});

test('onafhankelijke OpenSSL-controle leest AES256/SHA256 zonder sleutelextractie of wijziging', () => {
  const path = join(cryptoRoot, 'aes256.p12'), before = readFileSync(path);
  const reference = createHash('sha256').update(before).digest('hex');
  const env = { ...process.env, IOS_DISTRIBUTION_P12_PASSWORD:'synthetic-password', IOS_DISTRIBUTION_P12_SHA256:reference };
  const calls = [];
  const run = (name, args, options) => { calls.push([name,args]); return spawnSync(name,args,options); };
  const receipt = validatePkcs12(path, { env, run });
  assert.equal(receipt.canImport,true);
  assert.equal(receipt.contentReference,'match');
  assert.equal(receipt.openssl,'valid_mac');
  assert.equal(receipt.aes256Observed,true);
  assert.equal(receipt.sha256MacObserved,true);
  assert.deepEqual(readFileSync(path), before);
  const args = calls.find(([,args]) => args[0] === 'pkcs12')[1];
  for (const required of ['-info','-noout','env:IOS_DISTRIBUTION_P12_PASSWORD']) assert.ok(args.includes(required));
  for (const forbidden of ['-nodes','-noenc','-nomacver','-legacy','-export','-out','synthetic-password']) assert.ok(!args.includes(forbidden));
  const serialized = diagnosticMessage(receipt);
  assert.ok(!serialized.includes(reference));
  assert.ok(!serialized.includes('synthetic-password'));
});
test('verkeerde inhoud en referentie worden vóór native import onderscheiden; geen parser bij mismatch', () => {
  const path = join(cryptoRoot,'aes256.p12'), bytes = readFileSync(path);
  const noTool = () => { throw new Error('parser mag niet gestart worden'); };
  for (const [reference, category] of [['00'.repeat(32),'p12_content_reference_mismatch'], ['invalid','p12_source_reference_invalid']]) {
    const receipt = validatePkcs12(path,{ env:{ IOS_DISTRIBUTION_P12_SHA256:reference },run:noTool });
    assert.equal(receipt.category,category);
    assert.equal(receipt.canImport,false);
  }
  assert.equal(contentReference(bytes,undefined),'not_provided');
  assert.equal(contentReference(bytes,'  '),'invalid_reference');
});
test('MAC-fout is zonder bronreferentie geen bewezen verkeerd wachtwoord', () => {
  const path = join(cryptoRoot,'aes256.p12'), reference = createHash('sha256').update(readFileSync(path)).digest('hex');
  const wrong = { ...process.env, IOS_DISTRIBUTION_P12_PASSWORD:'wrong-synthetic-password' };
  const without = validatePkcs12(path,{ env:wrong });
  assert.equal(without.category,'password_or_integrity_unresolved');
  const withReference = validatePkcs12(path,{ env:{ ...wrong, IOS_DISTRIBUTION_P12_SHA256:reference } });
  assert.equal(withReference.category,'password_or_encoding_rejected');
  assert.equal(withReference.canImport,false);
  assert.equal(withReference.openssl,'mac_rejected');
});
test('gewijzigde versleutelde inhoud met dezelfde structuur kan ook een MAC-fout geven', () => {
  const original = readFileSync(join(cryptoRoot,'aes256.p12'));
  const changed = Buffer.from(original);
  // Wijzig inhoud in de container; behoud de DER-lengtes en MAC-structuur.
  changed[Math.floor(changed.length / 2)] ^= 1;
  const path = join(cryptoRoot,'changed.p12'); writeFileSync(path,changed);
  const env = { ...process.env, IOS_DISTRIBUTION_P12_PASSWORD:'synthetic-password' };
  const without = validatePkcs12(path,{ env });
  assert.equal(without.openssl,'mac_rejected');
  assert.equal(without.category,'password_or_integrity_unresolved');
  const withReference = validatePkcs12(path,{ env:{ ...env, IOS_DISTRIBUTION_P12_SHA256:createHash('sha256').update(original).digest('hex') } });
  assert.equal(withReference.category,'p12_content_reference_mismatch');
  assert.equal(withReference.canImport,false);
});
test('misvormde container, ontbrekende validator en onbekende algoritmen blijven afzonderlijk herkenbaar', () => {
  const path = join(cryptoRoot,'not-a-pfx');writeFileSync(path,'synthetic invalid PKCS12');
  assert.equal(validatePkcs12(path,{ env:{ ...process.env, IOS_DISTRIBUTION_P12_PASSWORD:'synthetic' } }).category,'invalid_pkcs12_container');
  const receipt = validatePkcs12(path,{ env:{}, run:() => ({ status:1,stderr:'SECRET',stdout:'LibreSSL 3.3.6' }) });
  assert.equal(receipt.category,'independent_validator_unavailable');
  assert.equal(opensslResult({ status:1,stderr:'error: unsupported algorithm SECRET' }).state,'algorithm_unavailable');
  assert.equal(opensslResult({ status:0,stderr:'Warning: MAC is absent! SECRET' }).state,'no_verified_mac');
  assert.equal(opensslResult({ status:null,error:{ code:'ETIMEDOUT' },stderr:'SECRET' }).state,'tool_error');
});
test('native foutdetails worden alleen in vaste categorieën omgezet', () => {
  for (const [stderr, expected] of [
    ['MAC verification failed during PKCS12 import SECRET','pkcs12_mac_rejected'],
    ['Unknown format in import SECRET','format_rejected'],
    ['User interaction is not allowed SECRET','keychain_access'],
    ['specified item already exists SECRET','duplicate_item'],
    ['unknown error SECRET','other'],
  ]) {
    const category = securityImportCategory({ status:1,stderr });
    assert.equal(category, expected);
    const message = diagnosticMessage(macImportFailure({ category:'independent_mac_valid',openssl:'valid_mac',contentReference:'match' },category));
    assert.ok(!message.includes('SECRET'));
    if (expected === 'pkcs12_mac_rejected') assert.match(message,/macos_p12_or_password_encoding_rejected/);
    if (expected === 'keychain_access') assert.match(message,/keychain_or_other_import_error/);
  }
  assert.equal(securityImportCategory({ error:{ code:'ETIMEDOUT' } }),'tool_timeout');
});
test('importdiagnose stopt vóór keychainaanmaak of meldt macOS-afkeuring en ruimt volledig op', () => {
  const f = fixture();
  try {
    const reports = [];
    const validate = () => ({ category:'password_or_integrity_unresolved',contentReference:'not_provided',openssl:'mac_rejected',canImport:false });
    assert.throws(() => prepare(f.dir,{ ...f.options,configureProject:false,diagnoseImport:true,validate,report:message => reports.push(message) }));
    assert.equal(f.calls.length,0);
    assert.equal(existsSync(f.dir),false);
    assert.match(reports[0],/password_or_integrity_unresolved/);
  } finally { f.remove(); }
  const g = fixture({ importError:true });
  try {
    assert.throws(() => prepare(g.dir,{ ...g.options,configureProject:false,diagnoseImport:true,validate:() => ({ category:'independent_mac_valid',contentReference:'match',openssl:'valid_mac',canImport:true }) }), error => error.message.includes('keychain_or_other_import_error') && !error.message.includes('SECRET'));
    assert.equal(existsSync(g.dir),false);
  } finally { g.remove(); }
});
test('ongeldige Base64 wordt geschoond vóór enig toolgebruik afgewezen', () => {
  const f = fixture();
  try {
    f.env.IOS_DISTRIBUTION_P12_BASE64 = 'SECRET-invalid-base64!';
    assert.throws(() => prepare(f.dir,{ ...f.options,configureProject:false,diagnoseImport:true }), error => error.message.includes('p12_secret_invalid_base64') && !error.message.includes('SECRET'));
    assert.equal(f.calls.length,0);
    assert.equal(existsSync(f.dir),false);
  } finally { f.remove(); }
});
test('alleen import-only krijgt de optionele bronreferentie en onafhankelijke diagnose', () => {
  const require = createRequire(import.meta.url);
  const workflow = require('yaml').parse(readFileSync('.github/workflows/native-ios-release.yml','utf8'));
  const probe = workflow.jobs['signing-import-check'].steps.find(s => s.env?.IOS_DISTRIBUTION_P12_BASE64);
  const archive = workflow.jobs['testflight-archive'].steps.find(s => s.id === 'distribution');
  assert.equal(probe.env.IOS_DISTRIBUTION_P12_SHA256, '$' + '{{ secrets.IOS_DISTRIBUTION_P12_SHA256 }}');
  assert.equal(archive.env.IOS_DISTRIBUTION_P12_SHA256, undefined);
  assert.match(readFileSync('scripts/native/ios-signing-assets.mjs','utf8'),/configureProject: false, diagnoseImport: true/);
});
