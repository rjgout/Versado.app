// Alleen lezen: geen sleutelextractie, conversie, keychain-import of netwerk.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function securityImportCategory(result) {
  const text = String(result.stderr ?? '') + '\n' + String(result.stdout ?? '');
  if (result.error?.code === 'ETIMEDOUT') return 'tool_timeout';
  if (/MAC verification failed|MAC verify error/i.test(text)) return 'pkcs12_mac_rejected';
  if (/unknown format|unsupported (?:format|algorithm)|format.*not supported/i.test(text)) return 'format_rejected';
  if (/interaction.*not allowed|keychain.*(?:locked|not found)|specified keychain could not be found/i.test(text)) return 'keychain_access';
  if (/already exists|duplicate item/i.test(text)) return 'duplicate_item';
  return 'other';
}
export function contentReference(bytes, expected) {
  if (expected === undefined || expected === '') return 'not_provided';
  const value = expected.trim();
  if (!/^[a-f0-9]{64}$/i.test(value)) return 'invalid_reference';
  return timingSafeEqual(createHash('sha256').update(bytes).digest(), Buffer.from(value, 'hex')) ? 'match' : 'mismatch';
}
export function opensslResult(result) {
  const text = String(result.stderr ?? '');
  const facts = { aes256Observed:/AES-256-CBC/i.test(text), sha256MacObserved:/^MAC:\s*sha256\b/im.test(text) };
  if (result.error || result.status === null) return { state:'tool_error', ...facts };
  if (result.status === 0) {
    // -noout zonder MAC kan geen correct wachtwoord bewijzen.
    return { state:/^MAC:\s*\S+/im.test(text) && !/MAC is absent/i.test(text) ? 'valid_mac' : 'no_verified_mac', ...facts };
  }
  if (/mac verify error|mac verification (?:error|failed)/i.test(text)) return { state:'mac_rejected', ...facts };
  if (/unable to load (?:provider )?legacy\b/i.test(text)) return { state:'legacy_provider_unavailable', ...facts };
  if (/asn1|wrong tag|header too long|not enough data|bad object header|decode error|no start line/i.test(text)) return { state:'invalid_container', ...facts };
  if (/unsupported|unknown (?:cipher|digest|algorithm)|unable to fetch/i.test(text)) return { state:'algorithm_unavailable', ...facts };
  return { state:'validation_error', ...facts };
}
export function findOpenSsl3(run = spawnSync, env = process.env, platform = process.platform) {
  const paths = platform === 'darwin'
    ? ['/opt/homebrew/opt/openssl@3/bin/openssl', '/usr/local/opt/openssl@3/bin/openssl', 'openssl']
    : ['openssl'];
  for (const binary of paths) {
    const result = run(binary, ['version'], { encoding:'utf8', timeout:10000, env:{ ...env, LC_ALL:'C' } });
    const version = /^OpenSSL\s+(\d+)\./.exec(String(result.stdout ?? ''));
    if (!result.error && result.status === 0 && version && Number(version[1]) >= 3) return binary;
  }
  return null;
}
export function validatePkcs12(path, { env = process.env, run = spawnSync, platform = process.platform } = {}) {
  const reference = contentReference(readFileSync(path), env.IOS_DISTRIBUTION_P12_SHA256);
  const base = { contentReference:reference, openssl:'not_run', legacyRead:'not_attempted', aes256Observed:false, sha256MacObserved:false };
  if (reference === 'mismatch' || reference === 'invalid_reference') return { ...base, category:reference === 'mismatch' ? 'p12_content_reference_mismatch' : 'p12_source_reference_invalid', canImport:false };
  const binary = findOpenSsl3(run, env, platform);
  if (!binary) return { ...base, category:'independent_validator_unavailable', openssl:'tool_unavailable', canImport:false };
  // Beide pogingen lezen alleen: geen -out, -nodes, -noenc, -nomacver of export/conversie.
  // Het wachtwoord staat alleen in de omgeving, nooit in argv of uitvoer.
  const args = ['pkcs12', '-in', path, '-info', '-noout', '-passin', 'env:IOS_DISTRIBUTION_P12_PASSWORD'];
  const options = { encoding:'utf8', timeout:30000, env:{ ...env, LC_ALL:'C' } };
  let parsed = opensslResult(run(binary, args, options)), legacyRead = 'not_attempted';
  if (parsed.state === 'algorithm_unavailable') {
    // Alleen een ontbrekend algoritme rechtvaardigt één legacy-leespoging.
    // Ook hier blijft MAC-verificatie verplicht; het P12-bestand wordt niet gewijzigd.
    parsed = opensslResult(run(binary, [...args, '-legacy'], options));
    legacyRead = parsed.state === 'valid_mac' ? 'verified' : 'failed';
  }
  const receipt = { ...base, openssl:parsed.state, legacyRead, aes256Observed:parsed.aes256Observed, sha256MacObserved:parsed.sha256MacObserved };
  const categories = {
    valid_mac:'independent_mac_valid',
    no_verified_mac:'password_validation_inconclusive',
    invalid_container:'invalid_pkcs12_container',
    algorithm_unavailable:'independent_algorithm_unavailable',
    legacy_provider_unavailable:'independent_legacy_provider_unavailable',
    tool_error:'independent_validator_error',
    validation_error:'independent_validation_inconclusive',
    mac_rejected:reference === 'match' ? 'password_or_encoding_rejected' : 'password_or_integrity_unresolved',
  };
  return { ...receipt, category:categories[parsed.state], canImport:parsed.state === 'valid_mac' };
}
export function macImportFailure(receipt, category) {
  const security = ['pkcs12_mac_rejected','format_rejected','keychain_access','duplicate_item','tool_timeout','other'].includes(category) ? category : 'other';
  return { ...receipt, security, category:security === 'format_rejected' ? 'macos_format_rejected'
    : security === 'pkcs12_mac_rejected' ? 'macos_p12_or_password_encoding_rejected'
    : 'keychain_or_other_import_error', canImport:false };
}
export function diagnosticMessage(receipt) {
  // Expliciete uitvoerallowlist: geen binarypad, digest, native uitvoer of inputgegevens.
  return 'PKCS#12-diagnose (geschoond): ' + JSON.stringify({
    category:receipt.category,
    contentReference:receipt.contentReference,
    openssl:receipt.openssl,
    legacyRead:['verified', 'failed'].includes(receipt.legacyRead) ? receipt.legacyRead : 'not_attempted',
    security:receipt.security ?? 'not_attempted',
    aes256Observed:receipt.aes256Observed === true,
    sha256MacObserved:receipt.sha256MacObserved === true,
  });
}
