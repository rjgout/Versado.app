// Browsertest: leerpad van Stap voor stap (Chromium-emulatie, geen echt toestel).
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… PROMOTE_DB_URL=… AUDIT_BASE_URL=http://localhost:3130 SHOTS_DIR=/tmp/shots \
//     node scripts/reading-path/e2e-path.mjs
// Vereist een geïsoleerde database met het Boek van Mormon en de cursus "Stap voor stap" (nooit productie).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3130";
const DB = process.env.PROMOTE_DB_URL;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/shots-path";
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "OK  " : "FAIL", name, detail); };
const sql = (q) => execFileSync("psql", [DB, "-At", "-c", q]).toString().trim();
const COURSE = sql(`select id from "Course" where type='READING_LESSONS' limit 1`);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });

async function account(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  await ctx.request.post(`${BASE}/api/auth/register`, { data: { email, handle: `${label} ${Math.random().toString(36).slice(2, 6)}`, password: "Wachtwoord-123!" } });
  sql(`update "User" set "onboardingSeenAt"=now(), "avatarCharacterId"='sariah', "isAdmin"=true where email='${email}'`);
  await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: email, password: "Wachtwoord-123!" } });
  return { ctx, email, id: sql(`select id from "User" where email='${email}'`) };
}
/** Alle stappen vóór (book, chapter) zijn af, plus de eerste `extra` stappen van dat hoofdstuk. */
function progressTo(userId, book, chapter, extra = 0) {
  sql(`delete from "UserCourseLessonProgress" where "userId"='${userId}'`);
  const target = sql(`select min(l."order") from "CourseLesson" l join "Chapter" c on c.id=l."chapterId" join "Book" b on b.id=c."bookId" where l."courseId"='${COURSE}' and b.name='${book}' and c.number=${chapter}`);
  sql(`insert into "UserCourseLessonProgress"(id,"userId","lessonId",completed,"bestScore","xpEarned","completedAt") select gen_random_uuid()::text,'${userId}',l.id,true,100,0,now() from "CourseLesson" l where l."courseId"='${COURSE}' and l."order" < ${target} + ${extra}`);
}
const doneAll = (userId) => {
  sql(`delete from "UserCourseLessonProgress" where "userId"='${userId}'`);
  sql(`insert into "UserCourseLessonProgress"(id,"userId","lessonId",completed,"bestScore","xpEarned","completedAt") select gen_random_uuid()::text,'${userId}',l.id,true,100,0,now() from "CourseLesson" l where l."courseId"='${COURSE}'`);
};
async function open(ctx, w = 390, h = 844, extra = {}) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}/courses/${COURSE}`);
  await page.waitForSelector("[data-reading-path]");
  await page.waitForTimeout(900); // het scrollen naar de actieve stap stabiliseert per frame
  return page;
}
const bars = (page) => page.evaluate(() => {
  const css = (n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
  return { header: css("--header-offset"), nav: css("--nav-height"), vh: innerHeight };
});
async function stepVisible(page) {
  const b = await bars(page);
  const r = await page.locator("[data-current-step]").first().boundingBox();
  return r && r.y >= b.header - 1 && r.y + r.height <= b.vh - b.nav + 1 ? { ok: true, r, b } : { ok: false, r, b };
}
try {
  const u = await account("pad");

  // 1. begin van de cursus: eerste hoofdstuk open, eerste stap actief en direct zichtbaar, rest vergrendeld
  progressTo(u.id, "1 Nephi", 1, 0);
  let page = await open(u.ctx);
  check("begin: het huidige hoofdstuk (1 Nephi 1) is open met de echte stappen", (await page.locator('[data-chapter-state="current"] [data-current-step]').count()) === 1);
  check("begin: de volgende stap is direct zichtbaar", (await stepVisible(page)).ok);
  const hrefs = await page.locator('a[href^="/reading-lesson/"]').count();
  const openSteps = await page.locator('[data-chapter-state="current"] ol li:not(:has([aria-disabled="true"]))').count();
  check("begin: alleen open stappen van het huidige hoofdstuk zijn links (toekomstige hoofdstukken en stappen geven geen toegang)", hrefs === openSteps && hrefs === 1, `${hrefs}/${openSteps}`);
  check("begin: toekomstige hoofdstukken zijn vergrendeld en geen link", (await page.locator('[data-chapter-state="locked"][data-path-chapter] a').count()) === 0 && (await page.locator('[data-chapter-state="locked"]').count()) > 200);
  await page.close();

  // 2. voorbeeld 1 Nephi 11: vier stappen, één af, stap 2 actief
  progressTo(u.id, "1 Nephi", 11, 1);
  const parts = Number(sql(`select count(*) from "CourseLesson" l join "Chapter" c on c.id=l."chapterId" join "Book" b on b.id=c."bookId" where l."courseId"='${COURSE}' and b.name='1 Nephi' and c.number=11`));
  page = await open(u.ctx);
  const title = (await page.locator('[data-chapter-state="current"] h2').innerText()).trim();
  check("1 Nephi 11 is het huidige hoofdstuk", title === "1 Nephi 11", title);
  check(`stap 2 van ${parts} is de volgende stap`, (await page.locator("[data-current-step]").innerText()).includes("Stap 2"));
  check("afgeronde hoofdstukken zijn compact (ingeklapt)", (await page.locator('[data-chapter-state="done"] button[aria-expanded="true"]').count()) === 0 && (await page.locator('[data-chapter-state="done"]').count()) >= 10);
  check("de volgende stap is zichtbaar", (await stepVisible(page)).ok);
  const prev = await page.locator('[data-chapter-state="done"]').last().boundingBox();
  const b = await bars(page);
  check("het hoofdstuk ervoor (1 Nephi 10) staat boven de actieve kaart in beeld als de hoogte dat toelaat", prev && prev.y >= b.header - 1 && prev.y < 400, JSON.stringify(prev));
  const art = await page.locator('[data-chapter-state="current"] [data-artwork]').first().getAttribute("data-artwork");
  check("1 Nephi 11 krijgt het boekbeeld, niet het verhaal met nummer 11", art === "/images/book-of-mormon/1-nephi.png", String(art));
  const doneStepTile = await page.locator('[data-chapter-state="current"] ol li a').count();
  check("stap 1 (af) blijft openbaar om opnieuw te lezen; vergrendelde stappen zijn geen link", doneStepTile === 2 && (await page.locator('[data-chapter-state="current"] [aria-disabled="true"]').count()) === parts - 2);
  await page.screenshot({ path: `${SHOTS}/pad-390-nephi11.png` });

  // 3. handmatig scrollen wordt niet overschreven; "Mijn stap" brengt je terug
  const y0 = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -1200); await page.waitForTimeout(900);
  const y1 = await page.evaluate(() => scrollY);
  check("handmatig omhoog scrollen blijft staan (geen terugspringen)", y1 < y0 - 400 && Math.abs((await page.evaluate(() => scrollY)) - y1) < 2, `${y0}->${y1}`);
  await page.waitForSelector("[data-my-step]", { timeout: 4000 });
  check("'Mijn stap' verschijnt alleen buiten de actieve stap", (await page.locator("[data-my-step]").count()) === 1);
  const myStep = await page.locator("[data-my-step]").boundingBox(); const bb = await bars(page);
  check("'Mijn stap' overlapt de onderste navigatie niet", myStep && myStep.y + myStep.height <= bb.vh - bb.nav + 1, JSON.stringify(myStep));
  await page.locator("[data-my-step]").click(); await page.waitForTimeout(1200);
  check("'Mijn stap' brengt de actieve stap in beeld en verdwijnt dan", (await stepVisible(page)).ok && (await page.locator("[data-my-step]").count()) === 0);

  // 4. hoofdstuk handmatig uitklappen zonder de voortgang te veranderen
  const before = sql(`select count(*) from "UserCourseLessonProgress" where "userId"='${u.id}'`);
  const toggle = page.locator('[data-chapter-state="done"]').last().locator("button");
  await toggle.click();
  check("een afgerond hoofdstuk klapt open en toont zijn stappen", (await toggle.getAttribute("aria-expanded")) === "true" && (await page.locator('[data-chapter-state="done"] [id^="path-"] a').count()) >= 1);
  check("uitklappen verandert geen voortgang", sql(`select count(*) from "UserCourseLessonProgress" where "userId"='${u.id}'`) === before);
  await toggle.click();

  // 5. terug na een leesactiviteit: browser-back herstelt de positie, geen ongevraagde sprong
  await page.locator("[data-current-step]").scrollIntoViewIfNeeded();
  const yBefore = await page.evaluate(() => scrollY);
  await page.locator("[data-current-step]").click(); await page.waitForURL(/\/reading-lesson\//);
  await page.goBack(); await page.waitForSelector("[data-reading-path]"); await page.waitForTimeout(1200);
  check("terug uit een les herstelt de scrollpositie en toont de actieve stap", Math.abs((await page.evaluate(() => scrollY)) - yBefore) < 40 && (await stepVisible(page)).ok, `${yBefore} -> ${await page.evaluate(() => scrollY)}`);

  // 6. stap afgerond (via de server-voortgang): de pagina toont de nieuwe actieve stap
  const nextLesson = sql(`select l.id from "CourseLesson" l where l."courseId"='${COURSE}' and l.id not in (select "lessonId" from "UserCourseLessonProgress" where "userId"='${u.id}') order by l."order" limit 1`);
  sql(`insert into "UserCourseLessonProgress"(id,"userId","lessonId",completed,"bestScore","xpEarned","completedAt") values(gen_random_uuid()::text,'${u.id}','${nextLesson}',true,100,0,now())`);
  await page.close();
  page = await open(u.ctx);
  check("na een afgeronde stap is stap 3 de actieve stap", (await page.locator("[data-current-step]").innerText()).includes("Stap 3"));
  await page.close();

  // 7. illustratie: 1 Nephi 2 krijgt de scène van Lehi's vertrek; bij een fout beeld een rustige terugval
  progressTo(u.id, "1 Nephi", 2, 0);
  page = await open(u.ctx);
  check("1 Nephi 2 toont de scène van het verhaal 'Lehi gaat weg uit Jeruzalem'", (await page.locator('[data-chapter-state="current"] [data-artwork]').first().getAttribute("data-artwork")) === "/kids/images/story-3-0.jpg");
  await page.close();
  const brokenCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await brokenCtx.addCookies(await u.ctx.cookies());
  await brokenCtx.route(/kids%2Fimages|\/kids\/images/, (r) => r.abort());
  page = await brokenCtx.newPage(); await page.goto(`${BASE}/courses/${COURSE}`); await page.waitForSelector("[data-reading-path]"); await page.waitForTimeout(1200);
  check("een ontbrekend beeld valt netjes terug op de neutrale kaart (geen kapot beeld)", (await page.locator('[data-chapter-state="current"] [data-artwork]').first().getAttribute("data-artwork")) === "placeholder" && (await stepVisible(page)).ok);
  await brokenCtx.close();

  // 8. alles af: voltooiing, geen actieve stap, geen 'Mijn stap'
  doneAll(u.id);
  page = await open(u.ctx);
  check("volledig afgerond: voltooiingsweergave, geen actieve stap", (await page.locator("[data-current-step]").count()) === 0 && (await page.locator("text=helemaal voltooid").count()) === 1 && (await page.locator('[data-chapter-state="done"]').count()) === 239);
  await page.close();

  // 9. formaten, thema's en grote tekst
  progressTo(u.id, "1 Nephi", 11, 1);
  for (const [w, h, scheme, big, name] of [[320, 640, "light", true, "320-200"], [390, 844, "dark", false, "390-dark"], [768, 1024, "light", false, "tablet"], [1280, 800, "light", false, "desktop"], [390, 560, "light", false, "kort"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: w < 500 });
    await ctx.addCookies(await u.ctx.cookies());
    if (big) await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = "200%"; }); });
    const pg = await ctx.newPage(); await pg.goto(`${BASE}/courses/${COURSE}`); await pg.waitForSelector("[data-reading-path]"); await pg.waitForTimeout(1500);
    const ov = await pg.evaluate(() => ({ w: innerWidth, s: document.documentElement.scrollWidth }));
    check(`${name}: geen horizontale overflow`, ov.s <= ov.w + 1, JSON.stringify(ov));
    const sv = await stepVisible(pg);
    check(`${name}: de actieve stap staat tussen de vaste balken`, sv.ok, JSON.stringify(sv));
    await pg.screenshot({ path: `${SHOTS}/pad-${name}.png` });
    await ctx.close();
  }
  // 10. de bestaande hoofdstukdetailroute en lesroute blijven werken (compatibele directe links)
  progressTo(u.id, "1 Nephi", 11, 1);
  const chapterId = sql(`select c.id from "Chapter" c join "Book" b on b.id=c."bookId" where b.name='1 Nephi' and c.number=11 limit 1`);
  const direct = await u.ctx.newPage();
  const resp = await direct.goto(`${BASE}/courses/${COURSE}/chapter/${chapterId}`);
  check("de hoofdstukdetailroute blijft bestaan en toont de stappen", resp.status() === 200 && (await direct.locator('a[href^="/reading-lesson/"]').count()) === 2);
  const lessonId = sql(`select l.id from "CourseLesson" l where l."courseId"='${COURSE}' and l."chapterId"='${chapterId}' order by l."order" limit 1`);
  const lr = await direct.goto(`${BASE}/reading-lesson/${lessonId}`);
  check("een directe leslink (afgeronde stap) opent de bestaande leesflow", lr.status() === 200 && (await direct.url()).includes("/reading-lesson/"));
  const lockedLesson = sql(`select l.id from "CourseLesson" l where l."courseId"='${COURSE}' and l."chapterId"='${chapterId}' order by l."order" desc limit 1`);
  await direct.goto(`${BASE}/reading-lesson/${lockedLesson}`);
  check("een vergrendelde stap via een directe link stuurt terug (serverregel ongewijzigd)", (await direct.url()).includes(`/chapter/${chapterId}`));
  await direct.close();
} catch (e) { check("onverwachte fout", false, String(e)); }
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} geslaagd`);
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
process.exit(bad ? 1 : 0);
