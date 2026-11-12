// Alleen bestaande Distribution-middelen; geen netwerk, certificaataanmaak of automatische fallback.
import { X509Certificate, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute, basename, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { APP_ID } from './profiles.cjs';
import { distributionProblems, distributionDiagnostics } from './ios-release-guard.mjs';

const PROJECT = 'ios/App/App.xcodeproj/project.pbxproj';
const UUID = /^[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}$/i;
class SigningError extends Error {}
const fail = message => { throw new SigningError(message); };
function saveState(path, state) {
  writeFileSync(path + '.new', JSON.stringify(state), { mode: 0o600 });
  renameSync(path + '.new', path);
}

// Geen commandoregel, stdout/stderr of native Error-object doorgeven: kan geheimen bevatten.
function command(name, args, options = {}) {
  const r = spawnSync(name, args, { encoding: 'utf8', timeout: 30000, ...options });
  if (r.error || r.status !== 0) fail('Lokale signingcontrole mislukt.');
  return r.stdout;
}
export function protectedContext(env, platform = process.platform) {
  if (platform !== 'darwin' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/develop' ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) fail('Signingmiddelen alleen handmatig op macOS vanaf develop.');
}
function decode(value) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/=\r\n]+$/.test(value)) fail('Signingbestand ontbreekt of base64 is ongeldig.');
  const compact = value.replace(/[\r\n]/g, '');
  const bytes = Buffer.from(compact, 'base64');
  if (!bytes.length || bytes.toString('base64') !== compact) fail('Signingbestand ontbreekt of base64 is ongeldig.');
  return bytes;
}
export function certificateProblems(cert, team, identities, now = Date.now()) {
  const errors = [];
  if (!/^[A-Z0-9]{10}$/.test(team ?? '')) errors.push('Verwacht Apple-team ontbreekt of is ongeldig.');
  if (!/^CN=Apple Distribution: .+$/m.test(cert.subject) || !/^CN=Apple Worldwide Developer Relations Certification Authority$/m.test(cert.issuer)) errors.push('Geen Apple Distribution-certificaat.');
  if (!cert.subject.split('\n').includes('OU=' + team)) errors.push('Certificaatteam wijkt af.');
  if (!(Date.parse(cert.validFrom) <= now && Date.parse(cert.validTo) > now)) errors.push('Certificaat is nog niet geldig, verlopen of onleesbaar.');
  const fingerprint = cert.fingerprint.replace(/:/g, '').toUpperCase();
  if (!/^[A-F0-9]{40}$/.test(fingerprint) || identities.length !== 1 || identities[0] !== fingerprint) errors.push('Geen unieke geldige Distribution-identiteit; controleer privésleutel en Apple-certificaatketen.');
  return errors;
}
export function profileProblems(profile, certificate, team, now = Date.now()) {
  // Verwachte identiteit voor profiel-preflight; dit vervangt NOOIT de echte app-/IPA-validatie.
  const entitlements = { 'application-identifier': team + '.' + APP_ID, 'com.apple.developer.team-identifier': team, 'get-task-allow': false };
  const signing = { entitlements, profile, authorities: ['Apple Distribution: preflight'], team, identifier: APP_ID };
  const errors = distributionProblems(signing, team).map(p => p.replace(/onverwacht entitlement .+$/, 'onverwacht entitlement [onbekende sleutel]'));
  if (profile?.ApplicationIdentifierPrefix !== undefined && JSON.stringify(profile.ApplicationIdentifierPrefix) !== JSON.stringify([team])) errors.push('Profiel-App ID Prefix wijkt af; geen automatische uitzondering.');
  if (!UUID.test(profile?.UUID ?? '')) errors.push('Profiel-UUID ontbreekt of is ongeldig.');
  if (!Array.isArray(profile?.Platform) || !profile.Platform.includes('iOS')) errors.push('Geen iOS-profiel.');
  if (profile?.CreationDate !== undefined && !(Date.parse(profile.CreationDate) <= now)) errors.push('Profiel is nog niet geldig.');
  const certs = profile?.DeveloperCertificates;
  if (!Array.isArray(certs) || certs.length !== 1 || typeof certs[0] !== 'string' || !Buffer.from(certs[0] ?? '', 'base64').equals(certificate)) errors.push('Profiel bevat niet uitsluitend het gekozen certificaat.');
  if (errors.length) errors.push('Signingdiagnose (geschoond; geen acceptatiebesluit): ' + JSON.stringify(distributionDiagnostics(signing, team)));
  return errors;
}

// Alleen App/Release tijdelijk aanpassen. De andere targets en Debug blijven exact gelijk.
function closingBrace(text, start) {
  let depth = 0, quoted = false, comment = false, line = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (comment) { if (c === '*' && next === '/') { comment = false; i++; } continue; }
    if (quoted) { if (c === '\\') i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; continue; }
    if (c === '/' && next === '*') { comment = true; i++; continue; }
    if (c === '/' && next === '/') { line = true; i++; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return i;
  }
  fail('Xcode-project heeft een onverwachte structuur.');
}
function pbx(value) {
  if (typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return value.length ? '(' + value.map(pbx).join(', ') + ',)' : '()';
  if (value && typeof value === 'object') return '{\n' + Object.entries(value).map(([k, v]) => JSON.stringify(k) + ' = ' + pbx(v) + ';').join('\n') + '\n}';
  fail('Onverwachte Xcode-buildinstelling.');
}
export function patchReleaseProject(text, model, settings) {
  const copy = structuredClone(model), objects = copy.objects;
  const targets = Object.values(objects).filter(o => o.isa === 'PBXNativeTarget' && o.productType === 'com.apple.product-type.application' && o.name === 'App');
  if (targets.length !== 1) fail('Geen uniek Versado-app-target.');
  const configs = objects[targets[0].buildConfigurationList]?.buildConfigurations ?? [];
  const releases = configs.filter(id => objects[id]?.name === 'Release' && objects[id]?.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER === APP_ID);
  if (releases.length !== 1 || !/^[A-F0-9]{24}$/.test(releases[0])) fail('Geen unieke App Release-configuratie.');
  const id = releases[0];
  Object.assign(objects[id].buildSettings, settings);
  const matches = [...text.matchAll(new RegExp('\\b' + id + '\\b[^\\n=]*=\\s*\\{', 'g'))];
  if (matches.length !== 1) fail('Onverwachte Release-projectnotatie.');
  const objectStart = text.indexOf('{', matches[0].index), objectEnd = closingBrace(text, objectStart);
  const section = text.slice(objectStart, objectEnd + 1), match = /\bbuildSettings\s*=\s*\{/.exec(section);
  if (!match) fail('Release-buildinstellingen ontbreken.');
  const start = objectStart + section.indexOf('{', match.index), end = closingBrace(text, start);
  return { text: text.slice(0, start) + pbx(objects[id].buildSettings) + text.slice(end + 1), model: copy };
}
export function exportOptions(team, fingerprint, uuid) {
  if (!/^[A-Z0-9]{10}$/.test(team) || !/^[A-F0-9]{40}$/.test(fingerprint) || !UUID.test(uuid)) fail('Ongeldige exportselectie.');
  return '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>' +
    '<key>method</key><string>app-store-connect</string><key>destination</key><string>export</string>' +
    '<key>teamID</key><string>' + team + '</string><key>signingStyle</key><string>manual</string>' +
    '<key>signingCertificate</key><string>' + fingerprint + '</string>' +
    '<key>provisioningProfiles</key><dict><key>' + APP_ID + '</key><string>' + uuid + '</string></dict>' +
    '<key>manageAppVersionAndBuildNumber</key><false/><key>uploadSymbols</key><true/></dict></plist>';
}
function privateDirectory(directory, env) {
  const base = resolve(env.RUNNER_TEMP ?? '');
  const path = resolve(directory), inside = relative(base, path);
  if (!env.RUNNER_TEMP || !inside || inside.startsWith('..') || isAbsolute(inside) || basename(path) !== 'signing' || !/^versado-(?:asc|import)\./.test(basename(dirname(path)))) fail('Signingmap moet onder RUNNER_TEMP liggen.');
  return path;
}
function nativePlist(xml, run) {
  return JSON.parse(run('python3', ['-I', '-c', 'import plistlib,json,sys,base64,datetime;print(json.dumps(plistlib.loads(sys.stdin.buffer.read()),default=lambda x:base64.b64encode(x).decode() if isinstance(x,bytes) else x.replace(tzinfo=datetime.timezone.utc).isoformat()))'], { input: xml }));
}
export function prepare(directory, { env = process.env, root = process.cwd(), run = command, configureProject = true, report = () => {} } = {}) {
  const dir = privateDirectory(directory, env);
  if (!env.IOS_DISTRIBUTION_P12_PASSWORD) fail('IOS_DISTRIBUTION_P12_PASSWORD ontbreekt.');
  if (!/^[A-Z0-9]{10}$/.test(env.IOS_TEAM_ID ?? '')) fail('IOS_TEAM_ID ontbreekt of is ongeldig.');
  const p12 = decode(env.IOS_DISTRIBUTION_P12_BASE64), profileBytes = decode(env.IOS_PROVISIONING_PROFILE_BASE64);
  mkdirSync(dir, { mode: 0o700 });
  const statePath = join(dir, 'state.json'), keychain = join(dir, 'distribution.keychain-db');
  const state = { keychain: false, searchChanged: false, profile: null, projectChanged: false, originalKeychains: [], root: resolve(root) };
  const save = () => saveState(statePath, state);
  try {
    save();
    writeFileSync(join(dir, 'identity.p12'), p12, { mode: 0o600 });
    writeFileSync(join(dir, 'profile.mobileprovision'), profileBytes, { mode: 0o600 });
    const password = randomBytes(32).toString('hex');
    state.originalKeychains = [...run('security', ['list-keychains', '-d', 'user']).matchAll(/"(?:\\.|[^"\\])*"/g)].map(m => JSON.parse(m[0]));
    state.keychain = true; state.searchChanged = true; save(); // Aanmaak kan de zoeklijst wijzigen; ook gedeeltelijke aanmaak opruimen.
    run('security', ['create-keychain', '-p', password, keychain]);
    run('security', ['set-keychain-settings', '-lut', '3600', keychain]);
    run('security', ['unlock-keychain', '-p', password, keychain]);
    try { run('security', ['import', join(dir, 'identity.p12'), '-P', env.IOS_DISTRIBUTION_P12_PASSWORD, '-k', keychain, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']); }
    catch { fail('PKCS#12-import mislukt; controleer wachtwoord en AES256-SHA256-compatibiliteit met macOS. Geen automatische conversie.'); }
    rmSync(join(dir, 'identity.p12'));
    report('PKCS#12-import op macOS geslaagd; geen signingmiddelen gelogd.');
    run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain]);
    const pem = run('security', ['find-certificate', '-a', '-p', keychain]);
    const certificates = [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map(m => new X509Certificate(m[0]));
    const candidates = certificates.filter(c => /^CN=Apple Distribution: .+$/m.test(c.subject));
    if (candidates.length !== 1) fail('PKCS#12 bevat geen unieke Apple Distribution-identiteit.');
    const cert = candidates[0], fingerprint = cert.fingerprint.replace(/:/g, '').toUpperCase();
    const identities = [...run('security', ['find-identity', '-v', '-p', 'codesigning', keychain]).matchAll(/\b[A-Fa-f0-9]{40}\b/g)].map(m => m[0].toUpperCase());
    const certificateErrors = certificateProblems(cert, env.IOS_TEAM_ID, identities);
    if (certificateErrors.length) fail(certificateErrors.join('\n'));
    report('Geldige Apple Distribution-identiteit met privésleutel en verwacht team bevestigd.');
    const profile = nativePlist(run('security', ['cms', '-D', '-i', join(dir, 'profile.mobileprovision')]), run);
    const profileErrors = profileProblems(profile, cert.raw, env.IOS_TEAM_ID);
    if (profileErrors.length) fail(profileErrors.join('\n'));
    report('Bestaand App Store-profiel voor Versado en gekozen certificaat gecontroleerd.');
    const profileDirectory = join(env.HOME ?? homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles');
    mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
    const installed = join(profileDirectory, profile.UUID + '.mobileprovision');
    if (existsSync(installed)) fail('Het gekozen profiel bestaat al op de runner; niet overschrijven.');
    state.profile = profile.UUID; save();
    writeFileSync(installed, profileBytes, { mode: 0o600, flag: 'wx' });
    rmSync(join(dir, 'profile.mobileprovision'));
    state.searchChanged = true; save();
    run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...state.originalKeychains]);
    writeFileSync(join(dir, 'ExportOptions.plist'), exportOptions(env.IOS_TEAM_ID, fingerprint, profile.UUID), { mode: 0o600 });
    if (configureProject) {
      const projectPath = resolve(root, PROJECT), original = readFileSync(projectPath, 'utf8');
      const model = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', projectPath]));
      const patch = patchReleaseProject(original, model, { CODE_SIGN_STYLE: 'Manual', CODE_SIGN_IDENTITY: fingerprint, DEVELOPMENT_TEAM: env.IOS_TEAM_ID, PROVISIONING_PROFILE_SPECIFIER: profile.UUID, PROVISIONING_PROFILE: profile.UUID });
      writeFileSync(join(dir, 'original-project.pbxproj'), original, { mode: 0o600 });
      state.projectChanged = true; save();
      writeFileSync(projectPath, patch.text);
      const actual = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', projectPath]));
      if (!isDeepStrictEqual(actual, patch.model)) fail('De Xcode-projectaanpassing wijkt af van uitsluitend App/Release-signing.');
    }
  } catch (error) {
    cleanup(dir, { env, run });
    throw error;
  }
}
export function cleanup(directory, { env = process.env, run = command } = {}) {
  const dir = privateDirectory(directory, env), statePath = join(dir, 'state.json');
  if (!existsSync(dir)) return;
  if (!existsSync(statePath)) { rmSync(dir, { recursive: true, force: true }); return; }
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  let failed = false;
  const attempt = fn => { try { fn(); } catch { failed = true; } };
  if (state.projectChanged) attempt(() => {
    writeFileSync(resolve(state.root, PROJECT), readFileSync(join(dir, 'original-project.pbxproj')));
    state.projectChanged = false;
  });
  if (state.profile) attempt(() => {
    if (!UUID.test(state.profile)) fail('Ongeldige cleanupstatus.');
    rmSync(join(env.HOME ?? homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles', state.profile + '.mobileprovision'), { force: true });
    state.profile = null;
  });
  if (state.searchChanged) attempt(() => { run('security', ['list-keychains', '-d', 'user', '-s', ...state.originalKeychains]); state.searchChanged = false; });
  if (state.keychain) attempt(() => {
    const path = join(dir, 'distribution.keychain-db');
    if (existsSync(path)) run('security', ['delete-keychain', path]);
    state.keychain = false;
  });
  if (failed) {
    saveState(statePath, state);
    fail('Signingcleanup niet volledig; always-cleanup moet opnieuw worden uitgevoerd.');
  }
  rmSync(dir, { recursive: true, force: true });
}

export function xcodeFailureSummary(text) {
  return {
    certificateLimit: /maximum number of certificates/i.test(text),
    missingProfile: /No profiles for|requires a provisioning profile/i.test(text),
    missingIdentity: /No signing certificate|signing identity.*not found/i.test(text),
    signingFailure: /CodeSign.*failed|codesign.*failed/i.test(text),
    reportedBuildError: /\berror:/i.test(text),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [mode, directory] = process.argv.slice(2);
  try {
    if (!directory) fail('Signingmap ontbreekt.');
    if (mode === 'report') console.error('Xcode-opdracht afgekeurd (geschoonde categorieën): ' + JSON.stringify(xcodeFailureSummary(readFileSync(directory, 'utf8'))));
    else if (mode === 'cleanup') cleanup(directory);
    else {
      protectedContext(process.env);
      if (command('git', ['rev-parse', 'HEAD']).trim() !== process.env.GITHUB_SHA) fail('Broncommit wijkt af.');
      if (mode === 'prepare') prepare(directory, { report: message => console.log(message) });
      else if (mode === 'probe') {
        try { prepare(directory, { configureProject: false, report: message => console.log(message) }); }
        finally { cleanup(directory); }
      } else fail('Gebruik prepare, probe of cleanup.');
      console.log(mode === 'probe' ? 'macOS-import en Distribution-profiel gecontroleerd; geen archive, Apple-API of upload.' : 'Bestaande Distribution-identiteit en Versado-profiel gecontroleerd; uitsluitend App/Release expliciet ingesteld.');
    }
  } catch (error) {
    // Alleen zelf gemaakte, geschoonde meldingen doorlaten; native fouten bevatten mogelijk brondata.
    const safe = error instanceof SigningError ? error.message : 'Signingcontrole mislukt; geen signingmiddelen gelogd.';
    console.error('::error::' + safe);
    process.exitCode = 1;
  }
}
