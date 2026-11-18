// Alleen-lezen Apple-controle; sleutel en JWT blijven buiten uitvoer en buildbestanden.
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';

try {
  const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env;
  if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH) throw new Error('Apple-sleutelconfiguratie ontbreekt');
  const key = createPrivateKey(readFileSync(ASC_KEY_PATH));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('API-sleutel moet een geldige P-256 private key zijn');
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })}.${encode({ iss: ASC_ISSUER_ID, iat: now, exp: now + 120, aud: 'appstoreconnect-v1' })}`;
  const token = `${content}.${sign('sha256', Buffer.from(content), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  const response = await fetch('https://api.appstoreconnect.apple.com/v1/apps?filter%5BbundleId%5D=app.versado.app', {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`App Store Connect-toegang geweigerd (HTTP ${response.status}); controleer sleutel, rol en apprechten`);
  const data = await response.json();
  if (data.data?.length !== 1 || data.data[0].attributes?.bundleId !== 'app.versado.app' || data.data[0].attributes?.name !== 'Versado') throw new Error('Apple-appidentiteit is niet exact Versado / app.versado.app');
  console.log('App Store Connect: sleutel geaccepteerd en bestaande Versado-appidentiteit bevestigd. Signing-/uploadrechten worden pas bij die afzonderlijke acties bewezen.');
} catch {
  // Geen upstream fouttekst: die kan API-inhoud of sleutelmateriaal bevatten.
  console.error('::error::Apple-preflight mislukt: controleer P-256-sleutel, Key/Issuer ID, apprechten en bestaande Versado-appregistratie. Er is niets aangemaakt.');
  process.exit(1);
}
