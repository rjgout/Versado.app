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
const bundle = await build({ entryPoints: ['tests/fixtures/native-foundation-client.tsx'], bundle: true, write: false, platform: 'browser', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
const stylesheet = readFileSync('dist/native/index.css');
const saved = new Map(), calls = [], errors = [], results = [];
const account = { id: 'focus-user', handle: 'Langetoegankelijkegebruikersnaam', uiLanguage: 'nl', onboardingRequired: false, appleLinked: false, passwordLoginEnabled: true };
const chapter = { id: 'focus-chapter', title: 'Lang synthetisch leeshoofdstuk', state: { read: 'READING' }, verses: Array.from({ length: 90 }, (_, i) => ({ number: i + 1, text: 'Selecteerbare synthetische schrifttekst om de bewaarde leespositie en kopfocus te controleren.' })) };
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
      const answer = path === 'capabilities' ? { apiVersion: 1, apple: false, registration: true, features: [] }
        : ['login', 'refresh'].includes(path) ? { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresIn: 300 }
        : path === 'logout' ? { ok: true } : path === 'me' ? account
        : path === 'today' ? { activity: { id: chapter.id, title: chapter.title } }
        : path === `chapters/${chapter.id}` ? chapter : null;
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
    // Een DOM-klik schuift de footerlink niet eerst in beeld en behoudt de leespositie.
    await page.locator('a[href="#/privacy"]').evaluate(a => a.click()); await page.getByRole('heading', { level: 1, name: 'Privacybeleid' }).waitFor();
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
  assert.deepEqual(errors, []);
  assert.ok(calls.every(c => c.method === 'GET' || ['login', 'logout', 'refresh'].includes(c.path)), 'Geen lees-/XP-mutaties');
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log(`Native routefocus: ${results.length} combinaties; echte h1-focus, geen outline, tabfocus, selectie, terug/herstel en login/logout. Chromium bewijst geen WKWebView/VoiceOver/TalkBack.`);
} finally { await browser.close(); await new Promise(resolve => front.close(resolve)); }
