// Echte Foundation-React/shell/CSS met uitsluitend synthetische HTTP-contractantwoorden.
// Backendauthenticatie wordt afzonderlijk door test:native:integration bewezen.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const out = '/tmp/versado-focus-browser'; mkdirSync(out, { recursive: true });
const platformBoundary = { name: 'native-os-events-only', setup(api) { api.onLoad({ filter: /src\/lib\/platform\.ts$/ }, async args => {
  const source = readFileSync(args.path, 'utf8'), start = source.indexOf('export async function startNativeFoundationRuntime(');
  assert.ok(start > 0);
  return { contents: source.slice(0, start) + `export async function startNativeFoundationRuntime(options){const open=event=>options.onUrl(event.detail,'open'),resume=()=>options.onResume();window.addEventListener('focus:test-open',open);window.addEventListener('focus:test-resume',resume);return()=>{window.removeEventListener('focus:test-open',open);window.removeEventListener('focus:test-resume',resume);};}`, loader: 'ts' };
}); } };
const bundle = await build({ plugins: [platformBoundary], entryPoints: ['tests/fixtures/native-foundation-client.tsx'], bundle: true, write: false, platform: 'browser', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
const stylesheet = readFileSync('dist/native/index.css');
const saved = new Map(), calls = [], errors = [], results = [];
const account = { id: 'focus-user', handle: 'Langetoegankelijkegebruikersnaam', uiLanguage: 'nl', onboardingRequired: false, appleLinked: false, passwordLoginEnabled: true };
const chapter = { id: 'focus-chapter', title: 'Lang synthetisch leeshoofdstuk', state: { read: 'READING' }, verses: Array.from({ length: 90 }, (_, i) => ({ number: i + 1, text: 'Selecteerbare synthetische schrifttekst om de bewaarde leespositie en kopfocus te controleren.' })) };
let advertised = [], expired = false, version = 1, language = 'nl';
const editions = ['nl', 'en'].map(language => ({ id: `focus-source-${language}`, slug: `focus-source-${language}`, name: `Schriften ${language}`, icon: 'book', order: 0, visibleToUsers: true, work: 'bofm', editionKey: 'focus-edition', language, sourceName: null, sourceUrl: null, licenseName: null, licenseUrl: null, selectable: true, previewHref: null }));
const contentState = () => ({ version: 1, userId: account.id, switcherEnabled: true, picker: { activeCollectionId: `focus-source-${language}`, selectionVersion: version, selection: { activeContentCollectionId: `focus-source-${language}`, contentLanguage: language }, works: [{ key: 'bofm', kind: 'SCRIPTURE', editions }] } });
const front = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/test-keychain/')) {
      if (req.method === 'PUT') { const chunks = []; for await (const c of req) chunks.push(c); saved.set(url.pathname, Buffer.concat(chunks).toString()); }
      if (req.method === 'DELETE') saved.delete(url.pathname);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value: saved.get(url.pathname) ?? null })); return;
    }
    if (url.pathname.startsWith('/api/v1/native/')) {
      const path = url.pathname.slice('/api/v1/native/'.length); calls.push({ path, method: req.method });
      if (expired && ['refresh', 'me', 'today', 'content-context'].includes(path)) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'session_expired' })); return; }
      if (path === 'content-context' && req.method === 'POST') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk); const input = JSON.parse(Buffer.concat(chunks));
        assert.equal(input.expectedSelectionVersion, version); assert.ok(editions.some(e => e.id === input.contentCollectionId));
        language = editions.find(e => e.id === input.contentCollectionId).language; version++;
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ state: contentState(), destination: '/lesson/focus-chapter-en', changed: true })); return;
      }
      const answer = path === 'capabilities' ? { apiVersion: 1, apple: false, registration: true, features: advertised }
        : ['login', 'refresh'].includes(path) ? { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresIn: 300 }
        : path === 'logout' ? { ok: true } : path === 'me' ? account
        : path === 'today' ? { selectionVersion: version, activity: { id: chapter.id, title: chapter.title } }
        : path === 'content-context' ? contentState() : path === `chapters/${chapter.id}` ? { ...chapter, contentCollectionId: 'focus-source-nl', selectionVersion: version } : path === 'chapters/focus-chapter-en' ? { ...chapter, id: 'focus-chapter-en', title: 'English chapter', contentCollectionId: 'focus-source-en', selectionVersion: version } : null;
      assert.ok(answer, `Onverwacht contract ${path}`);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(answer)); return;
    }
    if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === '/index.css') { res.setHeader('Content-Type', 'text/css'); res.end(stylesheet); return; }
    if (/^\/(icons|mascots|scripture)\//.test(url.pathname) && !url.pathname.includes('..')) { res.setHeader('Content-Type', url.pathname.endsWith('.png') ? 'image/png' : 'image/webp'); res.end(readFileSync(`public${url.pathname}`)); return; }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="nl"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  } catch (error) { errors.push(String(error)); res.writeHead(500); res.end(); }
});
await new Promise(resolve => front.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${front.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
async function headingFocused(page, name) {
  const heading = page.getByRole('heading', { level: 1, name }); await heading.waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('.native-foundation h1[data-native-route-focus]'));
  assert.equal(await heading.evaluate(h => document.activeElement === h && h.tabIndex === -1), true);
  assert.equal(await heading.evaluate(h => getComputedStyle(h).outlineStyle), 'none');
  return heading;
}
async function keyboardFocus(page, locator) {
  // De toetsenbordmodaliteit bepaalt :focus-visible; daarna zonder muisklik focussen.
  await page.keyboard.press('Tab'); await locator.evaluate(el => el.focus({ preventScroll: true }));
  assert.equal(await locator.evaluate(el => el === document.activeElement && el.matches(':focus-visible')), true);
  assert.equal(await locator.evaluate(el => { const s = getComputedStyle(el); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'; }), true, 'Zichtbare toetsenbordfocus ontbreekt');
  assert.equal(await locator.getAttribute('data-native-route-focus'), null);
}
try {
  for (const width of [320, 375, 390, 400]) for (const scale of [1, 2]) for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: scheme, locale: 'nl-NL' });
    await context.addInitScript(scale => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${scale * 100}%`; }); }, scale);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?device=${width}-${scale}-${scheme}`);
    await headingFocused(page, 'Welkom bij Versado');
    assert.deepEqual(await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.innerHTML = '<span class="hidden min-[380px]:flex"></span><span class="flex gap-3 min-[390px]:gap-4"></span><span class="hidden min-[400px]:inline"></span>';
      document.body.append(probe);
      const [badge, greeting, action] = [...probe.children].map(el => getComputedStyle(el));
      const result = [badge.display, greeting.gap, action.display]; probe.remove(); return result;
    }), [width >= 380 ? 'flex' : 'none', `${(width >= 390 ? 16 : 12) * scale}px`, width >= 400 ? 'inline' : 'none'], 'Mobiele utilities werken in de echte native CSS, ook bij grote tekst');
    const email = page.getByLabel('E-mail of gebruikerstag'); await keyboardFocus(page, email);
    assert.equal(await page.locator('h1').getAttribute('data-native-route-focus'), null, 'Marker verdwijnt na blur');
    await email.fill('focus@example.invalid'); await page.getByLabel('Wachtwoord', { exact: true }).fill('Synthetisch-42');
    const submit = page.getByRole('button', { name: 'Inloggen', exact: true });
    await submit.scrollIntoViewIfNeeded();
    if (scale === 2) assert.ok(await page.evaluate(() => scrollY > 100), 'Koude login heeft bij 200% echt een oude formulier-scrollpositie');
    await submit.click();
    await headingFocused(page, /Vandaag/);
    await page.waitForFunction(() => scrollY === 0, undefined, { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `${out}/today-${width}-${scale}-${scheme}.png`, fullPage: true });
    await keyboardFocus(page, page.locator('a[data-kompas-target="profile"]'));
    await page.locator('a[data-kompas-target="profile"]').click(); await headingFocused(page, 'Accountinstellingen');
    await page.screenshot({ path: `${out}/profile-${width}-${scale}-${scheme}.png`, fullPage: true });
    await keyboardFocus(page, page.locator('[data-subpage-back-bar] button'));
    await page.locator('[data-subpage-back-bar] button').click(); await headingFocused(page, /Vandaag/);
    await page.getByRole('button', { name: /Lang synthetisch leeshoofdstuk/ }).click(); await headingFocused(page, chapter.title);
    const verse = page.locator('.native-foundation p').filter({ hasText: chapter.verses[0].text }).first();
    assert.notEqual(await verse.evaluate(p => getComputedStyle(p).userSelect), 'none');
    assert.equal(await verse.evaluate(p => { const selection = getSelection(), range = document.createRange(); range.selectNodeContents(p); selection.removeAllRanges(); selection.addRange(range); return selection.toString().includes('Selecteerbare synthetische schrifttekst'); }), true);
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.mouse.wheel(0, 1450); // Echte gebruikersinvoer beëindigt eventueel nog lopend routeherstel.
    await page.waitForFunction(() => scrollY > 1000);
    const position = await page.evaluate(() => scrollY); assert.ok(position > 1000);
    // Een echte lokale route via de gesimuleerde OS-eventgrens behoudt de leespositie.
    await page.evaluate(origin => window.dispatchEvent(new CustomEvent('focus:test-open', { detail: origin + '/privacy' })), origin); await page.getByRole('heading', { level: 1, name: 'Privacybeleid' }).waitFor();
    assert.equal(await page.evaluate(async () => {
      scrollTo(0, 300); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return scrollY;
    }), 300, 'Een nieuwe route mag volgende programmatische pagina-/ankerscroll niet terugzetten');
    await page.goBack(); await headingFocused(page, chapter.title);
    await page.waitForFunction(position => Math.abs(scrollY - position) < 2, position, { timeout: 3000 }).catch(async error => { console.error('Leespositie', { expected: position, actual: await page.evaluate(() => ({ scroll: scrollY, history: history.state })) }); throw error; });
    await page.screenshot({ path: `${out}/reader-${width}-${scale}-${scheme}.png` });
    // Hervatten mag dezelfde route/scroll niet naar h1 trekken.
    await page.evaluate(() => window.dispatchEvent(new Event('versado:app-resumed')));
    await page.waitForTimeout(50); assert.ok(Math.abs(await page.evaluate(() => scrollY) - position) < 2);
    await keyboardFocus(page, page.getByRole('button', { name: 'Markeer als gelezen', exact: true }));
    await page.locator('[data-subpage-back-bar] button').click(); await page.locator('a[data-kompas-target="profile"]').click();
    await page.getByRole('button', { name: 'Uitloggen', exact: true }).click(); await headingFocused(page, 'Welkom bij Versado');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `${out}/login-${width}-${scale}-${scheme}.png`, fullPage: true });
    // De native uitzondering raakt ook losse dialogbedieningen niet.
    await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.innerHTML = '<h1 tabindex="-1">Dialoogkop</h1><button>Dialoogactie</button><a href="#">Dialooglink</a><input aria-label="Dialoogveld">'; document.body.append(dialog); dialog.showModal(); });
    for (const selector of ['button', 'a', 'input']) await keyboardFocus(page, page.locator(`dialog ${selector}`));
    assert.equal(await page.locator('dialog h1').getAttribute('data-native-route-focus'), null);
    results.push({ width, scale, scheme, scrollRestored: position }); await context.close();
  }
  // Een expliciete login vanuit een private deeplink behoudt juist die bestemming.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'nl-NL' });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/?device=private-deeplink#/lesson/${chapter.id}`);
  await headingFocused(page, 'Welkom bij Versado');
  await page.getByLabel('E-mail of gebruikerstag').fill('focus@example.invalid');
  await page.getByLabel('Wachtwoord', { exact: true }).fill('Synthetisch-42');
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  await headingFocused(page, chapter.title);
  assert.equal(await page.evaluate(() => location.hash), `#/lesson/${chapter.id}`);
  await context.close();
  // Oude/ontbrekende capability: directe route, heropening, veilige bestemming en verlopen sessie.
  for (const capabilities of [[], undefined, ['security-setup-v1']]) {
    advertised = capabilities; expired = false;
    const context = await browser.newContext({ viewport: { width: 320, height: 844 }, locale: 'nl-NL' }); let page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message)); const device = `fallback-${JSON.stringify(capabilities)}`;
    const url = `${origin}/?device=${encodeURIComponent(device)}#/content`, before = calls.filter(c => c.path === 'content-context').length;
    await page.goto(url); await headingFocused(page, 'Kies je content');
    await page.getByText('Log in om je content te kiezen.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-content-picker], [data-content-work]').count(), 0);
    await page.locator('[data-native-content-unavailable] a[href="#/login"]').click();
    await page.getByLabel('E-mail of gebruikerstag').fill('focus@example.invalid'); await page.getByLabel('Wachtwoord', { exact: true }).fill('Synthetisch-42');
    await page.getByRole('button', { name: 'Inloggen', exact: true }).click(); await headingFocused(page, /Vandaag/);
    await page.evaluate(origin => window.dispatchEvent(new CustomEvent('focus:test-open', { detail: origin + '/content' })), origin);
    await page.getByText('Deze backend ondersteunt de contentkiezer in de app nog niet. Je kunt terug naar Vandaag.', { exact: true }).waitFor();
    await headingFocused(page, 'Kies je content'); assert.equal(await page.getByRole('heading', { name: /Vandaag/ }).count(), 0);
    await page.close(); page = await context.newPage(); await page.goto(url);
    await page.getByText('Deze backend ondersteunt de contentkiezer in de app nog niet. Je kunt terug naar Vandaag.', { exact: true }).waitFor();
    await page.locator('[data-native-content-unavailable] a[href="#/dashboard"]').click(); await headingFocused(page, /Vandaag/);
    await page.evaluate(origin => window.dispatchEvent(new CustomEvent('focus:test-open', { detail: origin + '/content' })), origin);
    await headingFocused(page, 'Kies je content'); expired = true; await page.reload();
    await page.getByText('Log in om je content te kiezen.', { exact: true }).waitFor().catch(async error => { console.error('Verlopen contentroute', await page.locator('body').innerText(), calls.slice(-12)); throw error; });
    assert.equal(await page.getByText(account.handle, { exact: false }).count(), 0);
    assert.equal(calls.filter(c => c.path === 'content-context').length, before, 'Geen aanvragen naar niet-ondersteund contentcontract');
    await page.screenshot({ path: `${out}/content-fallback-${capabilities?.length ?? 'missing'}.png`, fullPage: true });
    await context.close(); expired = false;
  }
  // Gecombineerde #241/#242-flow: één routefocus, lange leespositie, bronwissel en sessie-intrekking.
  advertised = ['content-picker-v1'];
  for (const width of [320, 375, 390, 400]) for (const scheme of ['light', 'dark']) {
    version = 1; language = 'nl';
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: scheme, locale: 'nl-NL' });
    await context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%'; });
      window.contentHeadingFocus = []; const focus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function(options) { focus.call(this, options); if (this.matches('[data-content-picker] h1')) window.contentHeadingFocus.push({ marker: this.hasAttribute('data-native-route-focus'), preventScroll: options?.preventScroll, outline: getComputedStyle(this).outlineStyle }); };
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?device=combined-${width}-${scheme}`);
    await page.getByLabel('E-mail of gebruikerstag').fill('focus@example.invalid'); await page.getByLabel('Wachtwoord', { exact: true }).fill('Synthetisch-42');
    await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
    await page.getByRole('button', { name: /Lang synthetisch leeshoofdstuk/ }).click(); await headingFocused(page, chapter.title);
    await page.mouse.wheel(0, 1450); await page.waitForFunction(() => scrollY > 1000); const position = await page.evaluate(() => scrollY);
    const openPicker = () => page.evaluate(origin => window.dispatchEvent(new CustomEvent('focus:test-open', { detail: origin + '/content' })), origin);
    await openPicker(); await headingFocused(page, 'Kies je content'); await page.locator('[data-content-work="bofm"]').waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert.deepEqual(await page.evaluate(() => window.contentHeadingFocus), [{ marker: true, preventScroll: true, outline: 'none' }], 'Exact één focus-eigenaar, vóór de eerste focus gemarkeerd');
    await keyboardFocus(page, page.locator('[data-content-language] button').first());
    await page.locator('[data-subpage-back-bar] button').click(); await headingFocused(page, chapter.title);
    await page.waitForFunction(position => Math.abs(scrollY - position) < 2, position, { timeout: 3000 });
    await openPicker(); await headingFocused(page, 'Kies je content');
    assert.equal(await page.evaluate(() => window.contentHeadingFocus.length), 2);
    await page.locator('[data-content-language]').getByRole('button', { name: 'English', exact: true }).click();
    await headingFocused(page, 'English chapter'); await page.waitForFunction(() => scrollY === 0);
    await openPicker(); await headingFocused(page, 'Kies je content');
    await page.screenshot({ path: `${out}/content-combined-${width}-${scheme}.png`, fullPage: true });
    expired = true; await page.evaluate(() => window.dispatchEvent(new Event('focus:test-resume')));
    await page.getByText('Log in om je content te kiezen.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-content-work]').count(), 0, 'Ingetrokken sessie verwijdert de geautoriseerde kiezer');
    await context.close(); expired = false;
  }
  assert.deepEqual(errors, []);
  assert.ok(calls.every(c => c.method === 'GET' || ['login', 'logout', 'refresh', 'content-context'].includes(c.path)), 'Geen lees-/XP-mutaties');
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log(`Native routefocus: ${results.length} bestaande combinaties + 3 backendfallbacks + 8 gecombineerde content-/focusflows; echte h1-focus, geen outline, tabfocus, selectie, terug/herstel, bronwissel en sessieverloop. Chromium bewijst geen WKWebView/VoiceOver/TalkBack.`);
} finally { await browser.close(); await new Promise(resolve => front.close(resolve)); }
