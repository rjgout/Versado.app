// Echte HTTP-route en gerenderd beheer, uitsluitend op de eigen wegwerpdatabase.
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { getT } from "../src/lib/i18n/index.ts";
import { collectInventory } from "../scripts/content-architecture/inventory.mjs";

const url = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL || url.hostname !== "127.0.0.1" || url.pathname !== "/versado_inventory_test") throw new Error("Gebruik uitsluitend de inventaris-wegwerpdatabase");
const base = process.env.INVENTORY_TEST_BASE_URL ?? "http://localhost:3140";
const endpoint = `${base}/api/admin/content-inventory`;
const output = process.env.INVENTORY_TEST_OUTPUT ?? "/tmp/versado-content-inventory-browser";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const t = getT("nl");
let browser;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
async function account(admin = true, lang = "nl") {
  return prisma.user.create({ data: { email: `inventory-${randomUUID()}@private.invalid`, passwordHash: "PRIVATE_HASH", handle: randomUUID().slice(0, 8), discriminator: "00", isAdmin: admin, uiLanguage: lang, contentLanguage: "nl", onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), activeContentCollectionId: "content_bom" } });
}
async function post(user, origin = base, extra = {}) {
  const headers = { ...extra };
  if (user) headers.cookie = `${SESSION_COOKIE}=${await createSessionToken(user.id)}`;
  if (origin !== null) headers.origin = origin;
  return fetch(endpoint, { method: "POST", headers });
}
async function recordSnapshot() {
  // Uitsluitend eigen testrecords; private velden blijven in het testproces.
  return { collections: await prisma.contentCollection.findMany({ orderBy: { id: "asc" } }), users: await prisma.user.findMany({ orderBy: { id: "asc" } }), notes: await prisma.note.findMany(), bookmarks: await prisma.bookmark.findMany(), highlights: await prisma.highlight.findMany(), legacyProgress: await prisma.chapterProgress.findMany(), progress: await prisma.contentProgress.findMany(), sessions: await prisma.readingSession.findMany(), fsy: await prisma.fsyLesson.findMany(), migration: (await client.query('SELECT * FROM "_prisma_migrations" ORDER BY migration_name')).rows };
}
try {
  const anonymous = await post(); assert.equal(anonymous.status, 401); assert.match(anonymous.headers.get("cache-control"), /no-store/);
  const normal = await account(false), admin = await account();
  const denied = await post(normal); assert.equal(denied.status, 403); assert.match(denied.headers.get("cache-control"), /no-store/);
  assert.equal((await post(admin, "https://evil.invalid")).status, 403);
  assert.equal((await post(admin, null)).status, 403);
  assert.equal((await post(admin, "null")).status, 403);
  assert.equal((await post(admin, base, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await fetch(endpoint)).status, 405);

  await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { enabled: true, visibleToUsers: true } });
  await prisma.contentWork.create({ data: { key: "inventory-null", kind: "OTHER" } });
  await prisma.contentCollection.createMany({ data: [
    { id: "inventory-en", slug: "inventory-en", name: "Inventory English", icon: "", work: "bofm", editionKey: "default", language: "en", visibleToUsers: false },
    { id: "inventory-edition", slug: "inventory-edition", name: "Inventory edition", icon: "", work: "bofm", editionKey: "alternate", language: "nl", enabled: false },
    { id: "inventory-null", slug: "inventory-null", name: "Inventory null", icon: "", work: null },
    { id: "inventory-conflict", slug: "inventory-conflict", name: "Inventory conflict", icon: "", work: "inventory-null", editionKey: "other" },
  ] });
  const book = await prisma.book.create({ data: { slug: "inventory-book", name: "Test", order: 0, contentCollectionId: "content_bom" } });
  const chapter = await prisma.chapter.create({ data: { bookId: book.id, number: 1, order: 0 } });
  const verse = await prisma.verse.create({ data: { chapterId: chapter.id, number: 1, text: "PRIVATE_VERSE_TEXT" } });
  await prisma.note.create({ data: { userId: admin.id, verseId: verse.id, text: "PRIVATE_NOTE_TEXT" } });
  await prisma.bookmark.create({ data: { userId: admin.id, verseId: verse.id } });
  await prisma.highlight.create({ data: { userId: admin.id, verseId: verse.id } });
  await prisma.contentProgress.create({ data: { userId: admin.id, contentKey: "inventory:chapter", readVerse: 1 } });
  await prisma.chapterProgress.create({ data: { userId: admin.id, chapterId: chapter.id } });
  await prisma.readingSession.create({ data: { userId: admin.id, chapterId: chapter.id } });
  await prisma.fsyLesson.create({ data: { contentCollectionId: "content_bom", year: 2026, month: 1, category: "test", slug: "inventory-fsy", title: "Private draft", content: JSON.stringify([{ type: "paragraph", text: "PRIVATE_DRAFT" }]), images: "[]", sourceUrl: "https://test.invalid/lesson", sourceHash: "test", status: "DRAFT", publishedContent: JSON.stringify([{ type: "paragraph", text: "PRIVATE_PUBLICATION" }]), publishedTitle: "Publication" } });
  const before = await recordSnapshot();
  const response = await post(admin);
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  const report = await response.json(); assert.equal(report.readOnly, true); assert.equal(report.formatVersion, 3);
  assert.equal(report.collections.length, before.collections.length);
  assert.equal(report.fsy.draftWithPublishedCopy, "1"); assert.equal(report.fsy.published, "1");
  assert.equal(report.counts.ChapterProgress, "1");
  assert.equal(report.counts.Note, "1"); assert.equal(report.counts.Bookmark, "1"); assert.equal(report.counts.Highlight, "1"); assert.equal(report.counts.ContentProgress, "1"); assert.equal(report.counts.ReadingSession, "1");
  assert.ok(report.identities.nullWorkCollectionIds.includes("inventory-null")); assert.ok(report.identities.issues.some((i) => i.type === "ambiguous-work-key"));
  for (const forbidden of ["PRIVATE_", "@private.invalid", admin.id, "postgresql://", "passwordHash", "sourceUrl", "logs", "sessionVersion"]) assert.equal(JSON.stringify(report).includes(forbidden), false, forbidden);
  assert.deepEqual(await recordSnapshot(), before, "Inventarisatie wijzigt geen records of migraties");
  assert.equal((await post(admin)).status, 429);
  const parallelUser = await account();
  assert.deepEqual((await Promise.all([post(parallelUser), post(parallelUser)])).map((r) => r.status).sort(), [200, 429]);
  console.log("HTTP: 401, 403, CSRF, 405, rate limit, parallel, privacy en behoud geslaagd");

  // De database zelf blokkeert writes, en de CLI gebruikt dezelfde snapshotqueries.
  await client.query("BEGIN READ ONLY");
  await assert.rejects(client.query('UPDATE "ContentCollection" SET enabled=false'), (error) => error.code === "25006");
  await client.query("ROLLBACK");
  const cli = await collectInventory(client); assert.deepEqual(cli.collections, report.collections); assert.deepEqual(cli.fsy, report.fsy);
  // Instellingen mogen niet doorlekken naar een volgende pooltransactie.
  assert.equal((await client.query("SELECT current_setting('transaction_read_only') AS setting")).rows[0].setting, "off");

  // Ontbrekende tabel: autorisatie faalt vóór inventarisatie; admin krijgt veilige fout.
  const missingAdmin = await account();
  await client.query('ALTER TABLE "Note" RENAME TO "InventoryMissingNote"');
  try {
    assert.equal((await post()).status, 401); assert.equal((await post(normal)).status, 403);
    const failed = await post(missingAdmin); assert.equal(failed.status, 503); assert.match(failed.headers.get("cache-control"), /no-store/); assert.doesNotMatch(await failed.text(), /InventoryMissingNote|SELECT|password|postgresql/);
  } finally { await client.query('ALTER TABLE "InventoryMissingNote" RENAME TO "Note"'); }
  const orphanAdmin = await account();
  // Alleen eigen superuser-testverbinding: een beschadigde relatie simuleren.
  await client.query("BEGIN"); await client.query("SET LOCAL session_replication_role = replica");
  await client.query('INSERT INTO "Bookmark" (id, "userId", "verseId") VALUES ($1,$2,$3)', ["inventory-orphan", admin.id, "missing-verse"]);
  await client.query("COMMIT");
  try {
    const orphan = await post(orphanAdmin); assert.equal(orphan.status, 200);
    assert.equal((await orphan.json()).integrity.bookmarksWithoutVerse, "1");
  } finally { await client.query('DELETE FROM "Bookmark" WHERE id=$1', ["inventory-orphan"]); }
  const timeoutAdmin = await account();
  await client.query('BEGIN'); await client.query('LOCK TABLE "ContentCollection" IN ACCESS EXCLUSIVE MODE');
  try {
    const started = Date.now(); const timed = await post(timeoutAdmin); assert.equal(timed.status, 503); assert.ok(Date.now() - started < 15000); assert.doesNotMatch(await timed.text(), /SELECT|postgresql/);
  } finally { await client.query("ROLLBACK"); }
  const oldSchemaAdmin = await account();
  await client.query('ALTER TABLE "ContentCollection" RENAME COLUMN "editionKey" TO "InventoryOldEdition"');
  try { assert.equal((await post(oldSchemaAdmin)).status, 503); }
  finally { await client.query('ALTER TABLE "ContentCollection" RENAME COLUMN "InventoryOldEdition" TO "editionKey"'); }
  // Echte statement-timeout: alleen in de wegwerpdatabase een trage testview.
  const slowAdmin = await account();
  await client.query('ALTER TABLE "Note" RENAME TO "InventoryStoredNote"');
  await client.query('CREATE VIEW "Note" AS SELECT n.* FROM "InventoryStoredNote" n CROSS JOIN (SELECT pg_sleep(12)) sleepy');
  try {
    const started = Date.now(); const timed = await post(slowAdmin);
    assert.equal(timed.status, 503); assert.ok(Date.now() - started >= 9000 && Date.now() - started < 18000);
  } finally { await client.query('DROP VIEW "Note"'); await client.query('ALTER TABLE "InventoryStoredNote" RENAME TO "Note"'); }
  console.log("Database: read-only enforcement, gedeelde CLI, ontbrekende/verouderde tabel, lock- en statement-timeout geslaagd");

  mkdirSync(output, { recursive: true });
  browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
  const results = [];
  for (const [width, height] of [[320, 844], [390, 844], [844, 390], [768, 1024], [1280, 900]]) for (const dark of [false, true]) for (const font of [100, 200]) {
    const user = await account();
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 1024, colorScheme: dark ? "dark" : "light", serviceWorkers: "block" });
    await context.addInitScript((value) => localStorage.setItem("bom-theme", value), dark ? "dark" : "light");
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text()); });
    await page.goto(`${base}/adminbackend/content`, { waitUntil: "domcontentloaded" });
    await page.locator("#database-inventory > summary").click();
    await page.addStyleTag({ content: `html{font-size:${font}%}` });
    const section = page.locator("[data-content-inventory]");
    await page.route(endpoint, async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({ response });
    }, { times: 1 });
    const completed = page.waitForResponse((r) => r.url() === endpoint && r.request().method() === "POST");
    await section.getByRole("button", { name: t("adminInventory.run"), exact: true }).click();
    assert.equal(await section.getAttribute("aria-busy"), "true");
    assert.equal(await section.getByRole("button", { name: t("adminInventory.loading"), exact: true }).isDisabled(), true);
    const apiResponse = await completed;
    await page.screenshot({ path: `${output}/latest-ui.png` });
    assert.deepEqual(errors, [], "Geen client-renderfout na de echte API-response");
    assert.equal(apiResponse.status(), 200, await apiResponse.text());
    try { await section.getByText(t("adminInventory.success"), { exact: true }).waitFor({ timeout: 5000 }); }
    catch { throw new Error(`Clientstatus: ${JSON.stringify(errors)}`); }
    assert.ok((await section.locator("time").getAttribute("datetime")).endsWith("Z"));
    assert.ok((await section.innerText()).includes("inventory-en")); assert.ok((await section.innerText()).includes("inventory-null"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}/${font}: overflow`);
    const brokenControls = await section.locator("button").evaluateAll((buttons) => buttons.flatMap((button) => {
      const broken = []; const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) for (const word of walker.currentNode.textContent.matchAll(/[\p{L}\p{N}]+/gu)) {
        const range = document.createRange(); range.setStart(walker.currentNode, word.index); range.setEnd(walker.currentNode, word.index + word[0].length);
        if (range.getClientRects().length > 1) broken.push(word[0]);
      }
      if (button.scrollWidth > button.clientWidth + 1) broken.push("overflow");
      return broken;
    }));
    assert.deepEqual(brokenControls, [], `${width}/${font}: leesbare knoplabels`);
    const downloadPromise = page.waitForEvent("download");
    await section.getByRole("button", { name: t("adminInventory.download"), exact: true }).click();
    const download = await downloadPromise; const stream = await download.createReadStream(); let file = "";
    for await (const chunk of stream) file += chunk.toString();
    const exported = JSON.parse(file); assert.equal(exported.counts.Note, "1"); assert.equal(exported.readOnly, true); assert.doesNotMatch(file, /PRIVATE_|@private.invalid|passwordHash|postgresql:\/\//);
    assert.equal(download.suggestedFilename().endsWith(".json"), true);
    // Toetsenbordbediening van echte tabelregio en samenvattingen.
    const region = section.getByRole("region", { name: t("adminInventory.collections"), exact: true }); await region.focus(); assert.equal(await region.evaluate((node) => node === document.activeElement), true);
    await section.getByText(t("adminInventory.migrations") + ` (${exported.migrations.length})`, { exact: true }).click();
    assert.equal(await section.locator("table").count(), 2);
    await section.getByRole("button", { name: t("adminInventory.download"), exact: true }).scrollIntoViewIfNeeded();
    if ((width === 390 && font === 100) || (width === 320 && font === 200 && !dark) || (width === 1280 && font === 100 && dark)) await page.screenshot({ path: `${output}/inventory-${width}-${font}-${dark ? "dark" : "light"}.png` });
    assert.deepEqual(errors, []);
    await section.getByRole("button", { name: t("adminInventory.run"), exact: true }).click();
    await section.getByRole("alert").waitFor(); assert.equal(await section.getByRole("button", { name: t("adminInventory.download"), exact: true }).count(), 0);
    results.push({ width, height, dark, font, export: true, rateLimitRecovery: true, overflow: false });
    await context.close();
  }
  for (const lang of ["en", "de", "fr", "es"]) {
    const user = await account(true, lang); const tr = getT(lang);
    const context = await browser.newContext({ viewport: { width: 320, height: 844 } });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    const page = await context.newPage(); await page.goto(`${base}/adminbackend/content`); await page.locator("#database-inventory > summary").click();
    await page.addStyleTag({ content: "html{font-size:200%}" });
    await page.getByRole("button", { name: tr("adminInventory.run"), exact: true }).click(); await page.getByText(tr("adminInventory.success"), { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, lang); await context.close();
  }
  // Alleen de eigen tijdelijke fixtures leegmaken; geen productie of echte data.
  const emptyAdmin = await account();
  const annotationSnapshot = {
    notes: await prisma.note.findMany({ where: { userId: admin.id } }),
    bookmarks: await prisma.bookmark.findMany({ where: { userId: admin.id } }),
    highlights: await prisma.highlight.findMany({ where: { userId: admin.id } }),
  };
  await assert.rejects(prisma.contentCollection.deleteMany(), (error) => error.code === "P2003");
  assert.deepEqual({
    notes: await prisma.note.findMany({ where: { userId: admin.id } }),
    bookmarks: await prisma.bookmark.findMany({ where: { userId: admin.id } }),
    highlights: await prisma.highlight.findMany({ where: { userId: admin.id } }),
  }, annotationSnapshot, "Bronverwijdering behoudt de annotaties");
  await prisma.note.deleteMany({ where: { userId: admin.id, verseId: verse.id } });
  await prisma.bookmark.deleteMany({ where: { userId: admin.id, verseId: verse.id } });
  await prisma.highlight.deleteMany({ where: { userId: admin.id, verseId: verse.id } });
  await prisma.contentCollection.deleteMany();
  const empty = await post(emptyAdmin); assert.equal(empty.status, 200);
  const emptyReport = await empty.json(); assert.deepEqual(emptyReport.collections, []);
  assert.deepEqual(emptyReport.identities.works, []); assert.equal(emptyReport.counts.ContentCollection, "0");
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(`Browser: ${results.length} combinaties + vier vertalingen; JSON-download, toetsenbord, mobiel/desktop geslaagd`);
} finally { await browser?.close(); await client.end(); await prisma.$disconnect(); }
