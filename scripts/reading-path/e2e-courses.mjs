// Browsertest: Hoofdstuk voor hoofdstuk (FRONT_TO_BACK) en Vrije keuze (FREE_CHOICE) in het gedeelde leespad (Chromium-emulatie).
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… PROMOTE_DB_URL=… AUDIT_BASE_URL=http://localhost:3130 SHOTS_DIR=/tmp/shots \
//     node scripts/reading-path/e2e-courses.mjs
// Vereist een geïsoleerde database met het Boek van Mormon en de cursussen (nooit productie).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3130";
const DB = process.env.PROMOTE_DB_URL;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/shots-courses";
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "OK  " : "FAIL", name, detail); };
const sql = (q) => execFileSync("psql", [DB, "-At", "-c", q]).toString().trim();
const F2B = sql(`select id from "Course" where type='FRONT_TO_BACK' limit 1`);
const FREE = sql(`select id from "Course" where type='FREE_CHOICE' limit 1`);
const STEPS = sql(`select id from "Course" where type='READING_LESSONS' limit 1`);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });

async function account(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  await ctx.request.post(`${BASE}/api/auth/register`, { data: { email, handle: `${label} ${Math.random().toString(36).slice(2, 6)}`, password: "Wachtwoord-123!" } });
  sql(`update "User" set "onboardingSeenAt"=now(), "avatarCharacterId"='sariah', "isAdmin"=true where email='${email}'`);
  await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: email, password: "Wachtwoord-123!" } });
  return { ctx, id: sql(`select id from "User" where email='${email}'`) };
}
/** De eerste `n` hoofdstukken van de cursus (in cursusvolgorde) zijn gelezen en geoefend, via de gedeelde inhoudsvoortgang. */
function completeFirst(userId, courseId, n) {
  sql(`delete from "ContentProgress" where "userId"='${userId}'`);
  sql(`insert into "ContentProgress"(id,"userId","contentKey","lastChapterId","readStatus","exerciseAnswered","createdAt","updatedAt")
       select gen_random_uuid()::text,'${userId}',b.key||'#'||c.number,c.id,'READ',999,now(),now()
       from "CourseChapter" cc join "Chapter" c on c.id=cc."chapterId" join "Book" b on b.id=c."bookId"
       where cc."courseId"='${courseId}' and cc."order" < ${n}`);
}
const chapterOrder = (courseId, book, number) => Number(sql(`select cc."order" from "CourseChapter" cc join "Chapter" c on c.id=cc."chapterId" join "Book" b on b.id=c."bookId" where cc."courseId"='${courseId}' and b.name='${book}' and c.number=${number}`));
const bars = (page) => page.evaluate(() => { const css = (n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0; return { header: css("--header-offset"), nav: css("--nav-height"), vh: innerHeight }; });
async function visible(page, selector) {
  const b = await bars(page); const r = await page.locator(selector).first().boundingBox();
  return !!r && r.y >= b.header - 1 && r.y + r.height <= b.vh - b.nav + 1;
}
async function open(ctx, courseId, w = 390, h = 844) {
  const page = await ctx.newPage(); await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}/courses/${courseId}`); await page.waitForSelector("[data-reading-path]"); await page.waitForTimeout(1000);
  return page;
}
const openBooks = (page) => page.locator("li[data-book][data-book-open]").evaluateAll((els) => els.map((e) => e.getAttribute("data-book")));

try {
  const u = await account("cursus");

  // ===== Hoofdstuk voor hoofdstuk =====
  completeFirst(u.id, F2B, 0);
  let page = await open(u.ctx, F2B);
  check("F2B: /courses/<id> stuurt door naar het Focus-leespad (geen lus)", page.url() === `${BASE}/courses/${F2B}/pad`, page.url());
  check("F2B: Focusmodus: geen globale header en onderbalk, wel de terugbalk", !(await page.locator("[data-main-nav]").first().isVisible()) && (await page.locator("[data-subpage-back-bar]").isVisible()));
  check("F2B: begin: alleen het boek van het eerste hoofdstuk is open (1 Nephi), de rest ingeklapt", JSON.stringify(await openBooks(page)) === '["bofm/1-ne"]', JSON.stringify(await openBooks(page)));
  check("F2B: 15 boekkaarten onder hun echte boeken", (await page.locator("li[data-book]").count()) === 15);
  check("F2B: het actieve hoofdstuk (1 Nephi 1) is direct zichtbaar", (await page.locator('[data-chapter-state="current"] h2').innerText()).trim() === "1 Nephi 1" && (await visible(page, "[data-current-step]")));
  const art = page.locator('[data-chapter-state="current"] article');
  check("F2B: 1 Nephi 1 (geen eigen scène) toont het beeld van 1 Nephi op de actieve kaart", (await page.locator('[data-chapter-state="current"] [data-artwork]').first().getAttribute("data-artwork").catch(() => "")) === "/images/book-of-mormon/1-nephi.png");
  check("F2B: geen kunstmatige leesgedeelten (geen stappen) in de actieve kaart", (await art.locator("ol").count()) === 0 && !/Stap \d/.test(await art.innerText()));
  const link = await page.locator("[data-current-step]").getAttribute("href");
  check("F2B: de actie opent de bestaande hoofdstukles met de cursus als context", link?.startsWith("/lesson/") && link.endsWith(`?cursus=${F2B}`), String(link));
  const locked = page.locator('[data-chapter-state="locked"]');
  check("F2B: volgordevergrendeling: de rest van het boek is vergrendeld en geen link", (await locked.count()) === 21 && (await locked.locator("a,button").count()) === 0 && (await locked.first().locator('[aria-disabled="true"]').count()) === 1);
  const before = sql(`select count(*) from "ContentProgress" where "userId"='${u.id}'`);
  await page.screenshot({ path: `${SHOTS}/f2b-390-begin.png` });
  // ontgrendelde hoofdstukken zonder gedeelde klik: een slot reageert niet
  const url0 = page.url(); await locked.first().click({ force: true }); await page.waitForTimeout(300);
  check("F2B: een klik op een vergrendeld hoofdstuk doet niets", page.url() === url0);
  await page.close();

  // midden in de cursus: Alma 10 aan de beurt
  const n = chapterOrder(F2B, "Alma", 10);
  completeFirst(u.id, F2B, n);
  page = await open(u.ctx, F2B);
  check("F2B: mid-cursus: precies het boek Alma is open en Alma 10 is actief", JSON.stringify(await openBooks(page)) === '["bofm/alma"]' && (await page.locator('[data-chapter-state="current"] h2').innerText()).trim() === "Alma 10", JSON.stringify(await openBooks(page)));
  const almaArt = await page.locator('[data-chapter-state="current"] [data-artwork]').first().getAttribute("data-artwork").catch(() => null);
  check("F2B: Alma 10 heeft geen eigen scène: de actieve kaart toont het bestaande beeld van Alma", /\/images\/book-of-mormon\/alma/.test(String(almaArt)), String(almaArt));
  check("F2B: het actieve hoofdstuk staat direct in beeld, zonder door tientallen hoofdstukken te scrollen", await visible(page, "[data-current-step]"));
  check("F2B: voltooide hoofdstukken tellen mee in de voortgang (niet de positie)", /104 \/ 239/.test(await page.locator("main").first().innerText()), (await page.locator("main").first().innerText()).match(/\d+ \/ \d+/)?.[0]);
  check("F2B: eerdere hoofdstukken in het open boek zijn af (compact met vinkje)", (await page.locator('[data-chapter-state="done"]').count()) === 9);
  await page.screenshot({ path: `${SHOTS}/f2b-390-alma10.png` });
  // handmatige keuze blijft staan bij een refresh-signaal (focus) en er klapt niets anders open
  await page.locator('li[data-book="bofm/mosiah"] button').first().click(); await page.waitForTimeout(200);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); }); await page.waitForTimeout(1500);
  check("F2B: een handmatig geopend boek blijft open na een refresh en er opent geen ander boek", JSON.stringify((await openBooks(page)).sort()) === '["bofm/alma","bofm/mosiah"]', JSON.stringify(await openBooks(page)));
  await page.locator('li[data-book="bofm/mosiah"] button').first().click(); await page.waitForTimeout(200);
  check("F2B: een boek is zelf weer te sluiten", JSON.stringify(await openBooks(page)) === '["bofm/alma"]');
  await page.close();

  // overgang naar een nieuw boek: Alma helemaal af → Helaman
  completeFirst(u.id, F2B, chapterOrder(F2B, "Helaman", 1));
  page = await open(u.ctx, F2B);
  check("F2B: bij de overgang naar een nieuw boek opent het juiste boek (Helaman 1 actief)", JSON.stringify(await openBooks(page)) === '["bofm/hel"]' && (await page.locator('[data-chapter-state="current"] h2').innerText()).trim() === "Helaman 1", JSON.stringify(await openBooks(page)));
  check("F2B: geopend en weer zonder nieuwe voortgangsrijen", sql(`select count(*) from "ContentProgress" where "userId"='${u.id}'`) !== "" && before !== undefined);
  await page.close();

  // een hoofdstuk met een gecontroleerde scène krijgt zijn beeld; zonder scène een neutrale kop
  completeFirst(u.id, F2B, chapterOrder(F2B, "1 Nephi", 2));
  page = await open(u.ctx, F2B);
  const withArt = await page.locator('[data-chapter-state="current"] [data-artwork]').first().getAttribute("data-artwork").catch(() => null);
  check("F2B: een hoofdstuk met een gecontroleerde scène (1 Nephi 2) toont die op de actieve kaart", !!withArt && withArt !== "placeholder", String(withArt));
  await page.screenshot({ path: `${SHOTS}/f2b-390-met-beeld.png` });
  await page.close();

  // formaten en thema's
  completeFirst(u.id, F2B, n);
  for (const [w, h, scheme, big, name] of [[320, 640, "light", true, "f2b-320-200"], [390, 844, "dark", false, "f2b-390-dark"], [768, 1024, "light", false, "f2b-tablet"], [1280, 800, "light", false, "f2b-desktop"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: w < 500 });
    await ctx.addCookies(await u.ctx.cookies());
    if (big) await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = "200%"; }); });
    const pg = await ctx.newPage(); await pg.goto(`${BASE}/courses/${F2B}`); await pg.waitForSelector("[data-reading-path]"); await pg.waitForTimeout(1500);
    const ov = await pg.evaluate(() => ({ w: innerWidth, s: document.documentElement.scrollWidth }));
    check(`${name}: geen horizontale overflow`, ov.s <= ov.w + 1, JSON.stringify(ov));
    check(`${name}: het actieve hoofdstuk staat tussen de vaste balken`, await visible(pg, "[data-current-step]"));
    await pg.screenshot({ path: `${SHOTS}/${name}.png` });
    await ctx.close();
  }

  // ===== Vrije keuze =====
  const v = await account("vrij");
  const progressBefore = () => sql(`select count(*) from "UserCourseProgress" where "userId"='${v.id}'`);
  const contentBefore = () => sql(`select count(*) from "ContentProgress" where "userId"='${v.id}'`);
  const stepProgressBefore = () => sql(`select count(*) from "UserCourseLessonProgress" where "userId"='${v.id}'`);
  const snapshot = () => [progressBefore(), contentBefore(), stepProgressBefore(), sql(`select count(*) from "UserCourseProgress" where "userId"='${v.id}' and "courseId"='${STEPS}'`)].join("/");
  const snap0 = snapshot();
  page = await open(v.ctx, FREE);
  check("FREE: /courses/<id> stuurt door naar hetzelfde Focus-leespad", page.url() === `${BASE}/courses/${FREE}/pad`);
  check("FREE: Focusmodus: geen globale header en onderbalk, wel de terugbalk", !(await page.locator("[data-main-nav]").first().isVisible()) && (await page.locator("[data-subpage-back-bar]").isVisible()));
  check("FREE: zonder bruikbare positie blijven alle 15 boeken ingeklapt en is de kiezer bruikbaar", (await openBooks(page)).length === 0 && (await page.locator("li[data-book]").count()) === 15);
  check("FREE: geen verplichte volgende stap, geen hoofdstuk aan de beurt, geen Naar-mijn-knop", (await page.locator("[data-current-step], [data-path-current], [data-my-step]").count()) === 0);
  check("FREE: boekkaarten tonen voortgang als voltooide hoofdstukken (0/22)", /0\/22/.test(await page.locator('li[data-book="bofm/1-ne"]').innerText()));
  await page.screenshot({ path: `${SHOTS}/free-390-ingeklapt.png` });
  await page.locator('li[data-book="bofm/1-ne"] button').first().click(); await page.waitForTimeout(300);
  const cards = page.locator('li[data-book="bofm/1-ne"] [data-path-chapter]');
  check("FREE: alle 22 hoofdstukken van 1 Nephi zijn vrij te kiezen: geen slot, allemaal een link", (await cards.count()) === 22 && (await page.locator('li[data-book="bofm/1-ne"] [aria-disabled="true"]').count()) === 0 && (await cards.locator("a").count()) === 22);
  const href = await cards.nth(20).locator("a").getAttribute("href");
  check("FREE: een klik opent de bestaande volledige hoofdstukles met de cursus als context", href?.startsWith("/lesson/") && href.endsWith(`?cursus=${FREE}`), String(href));
  const thumbSrc = await cards.nth(0).locator("[data-chapter-thumb] [data-artwork]").getAttribute("data-artwork").catch(() => null);
  check("FREE: een hoofdstuk zonder eigen scène (1 Nephi 1) toont het beeld van zijn eigen boek, een hoofdstuk met scène (1 Nephi 2) zijn scène", thumbSrc === "/images/book-of-mormon/1-nephi.png" && (await cards.nth(1).locator("[data-chapter-thumb] [data-artwork]").getAttribute("data-artwork")) === "/kids/images/story-3-0.jpg", String(thumbSrc));
  check("FREE: geen verbindingen door boeken of hoofdstukken (vrije keuze heeft geen volgorde)", (await page.locator("[data-connector]").count()) === 0);
  await page.screenshot({ path: `${SHOTS}/free-390-open.png` });
  check("FREE: het openen en bladeren schrijft niets weg (voortgang, cursussen, stappen)", snapshot() === snap0, `${snap0} -> ${snapshot()}`);
  await page.close();

  // beginboek volgt de Stap-voor-stappositie (read-only), zonder iets te starten of te synchroniseren
  sql(`delete from "UserCourseLessonProgress" where "userId"='${v.id}'`);
  const stepOrder = (book, ch) => Number(sql(`select min(l."order") from "CourseLesson" l join "Chapter" c on c.id=l."chapterId" join "Book" b on b.id=c."bookId" where l."courseId"='${STEPS}' and b.name='${book}' and c.number=${ch}`));
  const stepsDoneBefore = (order) => sql(`insert into "UserCourseLessonProgress"(id,"userId","lessonId",completed,"bestScore","xpEarned","completedAt") select gen_random_uuid()::text,'${v.id}',l.id,true,100,0,now() from "CourseLesson" l where l."courseId"='${STEPS}' and l."order" < ${order}`);
  stepsDoneBefore(stepOrder("1 Nephi", 11));
  const snap1 = snapshot();
  page = await open(v.ctx, FREE);
  check("FREE: Stap voor stap bij 1 Nephi 11 → Vrije keuze opent standaard 1 Nephi (en alleen dat boek)", JSON.stringify(await openBooks(page)) === '["bofm/1-ne"]', JSON.stringify(await openBooks(page)));
  check("FREE: geen Stap-voor-stapcursor of voortgang aangemaakt door het openen", snapshot() === snap1, `${snap1} -> ${snapshot()}`);
  await page.close();
  sql(`delete from "UserCourseLessonProgress" where "userId"='${v.id}'`);
  stepsDoneBefore(stepOrder("Alma", 10));
  page = await open(v.ctx, FREE);
  check("FREE: later bij Alma 10 → Vrije keuze opent standaard Alma, zonder hardcoded boeknamen", JSON.stringify(await openBooks(page)) === '["bofm/alma"]', JSON.stringify(await openBooks(page)));
  // handmatig geopend boek blijft open bij een refresh-signaal
  await page.locator('li[data-book="bofm/mosiah"] button').first().click(); await page.waitForTimeout(200);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); }); await page.waitForTimeout(1500);
  check("FREE: een handmatig geopend boek blijft open na een refresh", JSON.stringify((await openBooks(page)).sort()) === '["bofm/alma","bofm/mosiah"]', JSON.stringify(await openBooks(page)));
  await page.close();

  // zonder Stap-voor-stappositie: het boek van een eerder gekozen hoofdstuk
  sql(`delete from "UserCourseLessonProgress" where "userId"='${v.id}'`);
  sql(`delete from "ContentProgress" where "userId"='${v.id}'`);
  const helChapter = sql(`select c.id from "Chapter" c join "Book" b on b.id=c."bookId" where b.name='Helaman' and c.number=3`);
  sql(`insert into "ContentProgress"(id,"userId","contentKey","lastChapterId","readStatus","createdAt","updatedAt") values(gen_random_uuid()::text,'${v.id}','bofm/hel#3','${helChapter}','READING',now(),now())`);
  page = await open(v.ctx, FREE);
  // Stap voor stap ziet deze voortgang als gedeelde inhoudsvoortgang, dus de positie kan bij een ander boek liggen: de test eist alleen dat precies één boek openstaat en bruikbaar is
  const books = await openBooks(page);
  check("FREE: met alleen een eerder gekozen hoofdstuk opent precies één boek (dat van de positie of dat hoofdstuk)", books.length === 1, JSON.stringify(books));
  await page.locator('li[data-book="bofm/hel"] button').first().click().catch(() => {}); await page.waitForTimeout(200);
  if (!(await openBooks(page)).includes("bofm/hel")) await page.locator('li[data-book="bofm/hel"] button').first().click();
  const started = page.locator('li[data-book="bofm/hel"] [data-chapter-card-state="started"]');
  check("FREE: een begonnen hoofdstuk heeft een herkenbare accentstijl en blijft gewoon te kiezen", (await started.count()) === 1 && (await started.locator("a").count()) === 1);
  await page.close();
  sql(`insert into "ContentProgress"(id,"userId","contentKey","lastChapterId","readStatus","exerciseAnswered","createdAt","updatedAt") values(gen_random_uuid()::text,'${v.id}','bofm/hel#4','${helChapter}','READ',999,now(),now()) on conflict do nothing`);
  page = await open(v.ctx, FREE);
  await page.locator('li[data-book="bofm/hel"] button').first().click().catch(() => {}); await page.waitForTimeout(200);
  if (!(await openBooks(page)).includes("bofm/hel")) await page.locator('li[data-book="bofm/hel"] button').first().click();
  check("FREE: een via een andere route afgerond hoofdstuk toont de juiste status (vinkje, voltooid)", (await page.locator('li[data-book="bofm/hel"] [data-chapter-card-state="done"]').count()) === 1);
  await page.close();

  // een collectie met maar één boek: één lijst zonder boekkaart
  const single = "e2e-single-book";
  sql(`delete from "Course" where id='${single}'`);
  sql(`create table tmp_e2e_course as select * from "Course" where id='${FREE}'`);
  sql(`update tmp_e2e_course set id='${single}', slug=slug||'-eenboek', name='Eén boek'`);
  sql(`insert into "Course" select * from tmp_e2e_course`);
  sql(`drop table tmp_e2e_course`);
  sql(`insert into "CourseChapter"(id,"courseId","chapterId","order") select gen_random_uuid()::text,'${single}',c.id,c.number from "Chapter" c join "Book" b on b.id=c."bookId" where b.name='Enos'`);
  page = await open(v.ctx, single);
  check("FREE: een collectie met één boek toont één eenvoudige lijst zonder boekkaart", (await page.locator("li[data-book]").count()) === 0 && (await page.locator("[data-path-chapter]").count()) === 1, String(await page.locator("[data-path-chapter]").count()));
  await page.close();
  sql(`delete from "CourseChapter" where "courseId"='${single}'`);
  sql(`delete from "Course" where id='${single}'`);

  // formaten en thema's voor Vrije keuze
  for (const [w, h, scheme, big, name] of [[320, 640, "light", true, "free-320-200"], [390, 844, "dark", false, "free-390-dark"], [1280, 800, "light", false, "free-desktop"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: w < 500 });
    await ctx.addCookies(await v.ctx.cookies());
    if (big) await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = "200%"; }); });
    const pg = await ctx.newPage(); await pg.goto(`${BASE}/courses/${FREE}`); await pg.waitForSelector("[data-reading-path]"); await pg.waitForTimeout(1200);
    await pg.locator('li[data-book="bofm/1-ne"] button').first().click().catch(() => {}); await pg.waitForTimeout(300);
    const ov = await pg.evaluate(() => ({ w: innerWidth, s: document.documentElement.scrollWidth }));
    check(`${name}: geen horizontale overflow`, ov.s <= ov.w + 1, JSON.stringify(ov));
    await pg.screenshot({ path: `${SHOTS}/${name}.png` });
    await ctx.close();
  }
} catch (e) { check("onverwachte fout", false, String(e)); }
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} geslaagd`);
fs.writeFileSync(`${SHOTS}/results-courses.json`, JSON.stringify(results, null, 2));
process.exit(bad ? 1 : 0);
