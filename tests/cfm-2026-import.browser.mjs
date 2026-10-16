import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/db.ts";
import sharp from "sharp";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import { assertReferenceTestEnvironment } from "./fixtures/reference-content.mjs";
const base = assertReferenceTestEnvironment();
const flow = JSON.parse(
  await fs.readFile(
    path.join(
      path.dirname(process.env.CONTENT_MIGRATION_TEST_STATE),
      "cfm-flow.json",
    ),
    "utf8",
  ),
);
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.CHROMIUM_PATH,
});
const output = "/tmp/versado-cfm-import-browser";
await fs.mkdir(output, { recursive: true });
const before = await prisma.user.findUniqueOrThrow({
  where: { id: flow.userId },
});
const rewardCounts = () =>
  Promise.all([
    prisma.readingSession.count({ where: { userId: flow.userId } }),
    prisma.contentProgress.count({ where: { userId: flow.userId } }),
    prisma.activityFeedItem.count({ where: { userId: flow.userId } }),
  ]);
const counts = await rewardCounts(),
  results = [];
try {
  // Alleen het legacy-seedverzoek wordt onderschept; de echte CFM-import/publicatie is hierboven via PostgreSQL getest.
  for(const [width,scheme,scale] of [[320,"light",200],[390,"dark",100],[1280,"light",100]]){
    const c=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,hasTouch:width<500});await c.addCookies([{name:SESSION_COOKIE,value:flow.adminToken,url:base}]);const page=await c.newPage();
    const proposal=await (await c.request.get(base+"/api/admin/reseed")).json();let posted=[];
    await page.route("**/api/admin/**",async route=>{const r=route.request(),pathname=new URL(r.url()).pathname;if(pathname === "/api/admin/reseed" && r.method()==="POST"){posted.push(r.postDataJSON());await route.fulfill({json:{started:false,job:{status:"idle",logs:[],error:null,startedAt:null,finishedAt:null,progress:null}}});}else if(pathname === "/api/admin/reseed")await route.continue();else await route.fulfill({status:503,json:{error:"Isolated unrelated admin panel"}});});
    await page.goto(base+"/adminbackend/systeem");const run=page.getByRole("button",{name:"Content opnieuw laden",exact:true,includeHidden:true});await run.waitFor({state:"attached"});await page.locator("details").filter({has:run}).locator("summary").first().click();
    await page.getByLabel("CFM 2026 als concept bijwerken").waitFor();if(scale===200)await page.addStyleTag({content:"html{font-size:200% !important}"});
    await run.click();await page.getByRole("dialog").getByRole("button",{name:"Annuleren",exact:true}).click();assert.equal(posted.length,0);
    await run.click();await page.getByRole("dialog").getByRole("button",{name:"Content opnieuw laden",exact:true}).click();await page.locator("dialog[open]").getByText(proposal.studySource.snapshot,{exact:false}).waitFor();await page.keyboard.press("Escape");assert.equal(posted.length,0);
    await run.click();await page.getByRole("dialog").getByRole("button",{name:"Content opnieuw laden",exact:true}).click();const modal=page.locator("dialog[open]");await modal.getByText(proposal.studySource.snapshot,{exact:false}).waitFor();const box=await modal.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=900);for(const button of await modal.getByRole("button").all()){const b=await button.boundingBox();assert.ok(b.y>=box.y&&b.y+b.height<=box.y+box.height,"Bevestigingsacties blijven zichtbaar bij grote tekst");assert.equal(await button.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);}assert.equal(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await page.screenshot({path:`${output}/cfm-snapshot-confirm-${width}-${scheme}.png`});
    const sent=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/admin/reseed"&&r.request().method()==="POST");await modal.getByRole("button",{name:"Bevestigen",exact:true}).click();await sent;assert.deepEqual(posted,[{approvedSnapshot:proposal.studySource.snapshot,confirmDraftsOnly:true}]);results.push({width,scheme,text:scale,reloadApprovalUi:true,cancelAndEscapeNoPost:true,legacySeedNotExecuted:true});await c.close();
  }
  // Echte verborgen concepten via bestaande beheerpagina; publieke reader blijft dicht.
  const originalCollection = await prisma.contentCollection.findUniqueOrThrow({ where: { id: flow.collectionId } });
  await prisma.contentCollection.update({ where: { id: flow.collectionId }, data: { publicationState: "DRAFT", visibleToUsers: false } });
  try {
    const editions = await prisma.studyLessonEdition.findMany({ where: { collectionId: flow.collectionId }, orderBy: { lesson: { order: "asc" } }, include: { draftRevision: true, publishedRevision: true } });
    assert.equal(editions.length, 52);
    for (const [width, scheme, text] of [[320, "light", 200], [390, "dark", 100], [1280, "light", 100]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
      await context.addCookies([{ name: SESSION_COOKIE, value: flow.adminToken, url: base }]);
      const page = await context.newPage();
      await page.goto(`${base}/adminbackend/content/study-publications`);
      await page.locator("[data-study-publications]").waitFor();
      if (text === 200) await page.addStyleTag({ content: "html{font-size:200% !important}" });
      const ids = await page.locator("[data-study-edition]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-study-edition")));
      assert.ok(editions.every((e) => ids.includes(e.id)), "Alle 52 verborgen concepten staan in beheer");
      for (const edition of [editions[40], editions[0]]) {
        const card=page.locator(`[data-study-edition="${edition.id}"]`);
        if(edition.draftRevision) await card.getByRole("button",{name:"Concept bekijken",exact:true}).click();
        else {await card.locator("details summary").click();await card.getByRole("button",{name:`#${edition.publishedRevision.revisionNumber} · ${edition.publishedRevision.title}`,exact:true}).click();}
        const article = page.locator("[data-study-revision-content]");
        await article.getByRole("heading", { level: 2, name: (edition.draftRevision ?? edition.publishedRevision).title, exact: true }).waitFor();
        if (edition === editions[40]) assert.ok(await article.locator("table").count() > 0);
        else {
          await page.locator('[data-reference-diagnosis="UNRESOLVED"]').first().waitFor();
          assert.ok(await page.locator('[data-study-reference] code').count() > 0);
          assert.ok(await page.getByRole("link", { name: "Open de officiële bron", exact: true }).count() > 0);
          const img = article.locator("img").first();
          await img.scrollIntoViewIfNeeded();
          await page.waitForFunction((selector) => { const image = document.querySelector(selector); return image?.complete && image.naturalWidth > 0; }, "[data-study-revision-content] img", { timeout: 10000 });
          assert.ok(await img.getAttribute("src"));
        }
      }
      const denied = await context.request.get(base + flow.href);
      assert.equal(denied.status(), 404, "Ook een admin leest verborgen content niet publiek");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: `${output}/cfm-admin-${width}-${scheme}.png` });
      results.push({ width, scheme, text, hiddenAdminConcepts: 52, tableAndImages: true, referenceDiagnostics: true, publicReaderDenied: true });
      await context.close();
    }
  } finally {
    await prisma.contentCollection.update({ where: { id: flow.collectionId }, data: { publicationState: originalCollection.publicationState, visibleToUsers: originalCollection.visibleToUsers } });
  }
  for(const [width,scheme,scale] of [[320,"light",200],[390,"dark",100],[1280,"light",100]]){
    await prisma.contentCollection.update({where:{id:flow.collectionId},data:{visibleToUsers:false}});
    await prisma.user.update({where:{id:flow.adminId},data:{activeContentCollectionId:"content_bom",contentLanguage:"nl"}});
    const admin=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,hasTouch:width<500});await admin.addCookies([{name:SESSION_COOKIE,value:flow.adminToken,url:base}]);const a=await admin.newPage();
    await a.goto(base+"/courses");await a.locator('[data-kompas-target="content-switcher"] a').click();await a.waitForURL(base+"/content");
    const card=a.locator('[data-content-work="cfm-old-testament-2026"]');await card.waitFor();if(scale===200)await a.addStyleTag({content:"html{font-size:200% !important}"});
    await card.getByRole("button").first().click();await a.waitForURL(base+"/courses");await a.locator('[data-study-catalogue]').waitFor();assert.equal(await a.locator('[data-study-lesson]').count(),52);if(scale===200)await a.addStyleTag({content:"html{font-size:200% !important}"});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await a.screenshot({path:`${output}/cfm-catalogue-${width}-${scheme}.png`});
    await a.locator('[data-study-lesson]').first().click();await a.locator('[data-study-reader]').waitFor();await a.goBack();await a.locator('[data-study-catalogue]').waitFor();
    const user=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,hasTouch:width<500});await user.addCookies([{name:SESSION_COOKIE,value:flow.token,url:base}]);assert.equal((await user.request.get(base+flow.href)).status(),404);
    await a.goto(base+"/adminbackend/content");const row=a.locator("label").filter({hasText:"Kom dan en volg Mij 2026 — Oude Testament"});await row.waitFor({state:"attached"});await a.locator("details").filter({has:row}).locator("summary").first().click();
    const enabled=a.waitForResponse(r=>r.url().endsWith("/api/admin/content-switcher")&&r.request().method()==="PUT");await row.click();assert.equal((await enabled).status(),200);
    const u=await user.newPage();await u.goto(base+"/courses");await u.locator('[data-study-catalogue]').waitFor();assert.equal(await u.locator('[data-study-lesson]').count(),52);if(scale===200)await u.addStyleTag({content:"html{font-size:200% !important}"});assert.equal(await u.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await u.locator('[data-study-lesson]').last().click();await u.locator('[data-study-reader]').waitFor();await u.goBack();await u.locator('[data-study-catalogue]').waitFor();
    const disabled=a.waitForResponse(r=>r.url().endsWith("/api/admin/content-switcher")&&r.request().method()==="PUT");await row.click();assert.equal((await disabled).status(),200);assert.equal((await user.request.get(base+flow.href)).status(),404);assert.equal((await admin.request.get(base+flow.href)).status(),200);
    results.push({width,scheme,text:scale,adminHiddenCatalogue:52,publicToggle:true,normalReader:true,back:true});await user.close();await admin.close();
  }
  await prisma.contentCollection.update({where:{id:flow.collectionId},data:{visibleToUsers:true}});
  for (const [width, height, scheme, text] of [
    [320, 844, "light", 200],
    [390, 844, "dark", 100],
    [1280, 900, "light", 100],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: scheme,
      hasTouch: width < 500,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + flow.href);
    await page.locator("[data-study-reader]").waitFor();
    if (text === 200)
      await page.addStyleTag({ content: "html{font-size:200% !important}" });
    const button = page.locator('[data-reference-key="ref-b-p1-1"]');
    await button.scrollIntoViewIfNeeded();
    await delay(1200);
    await button.evaluate((el) =>
      el.addEventListener(
        "click",
        () => {
          window.__cfmPreviewY = scrollY;
        },
        { once: true, capture: true },
      ),
    );
    await button.click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByText(/De aarde nu was woest/).waitFor();
    assert.ok(await dialog.evaluate((d) => d.contains(document.activeElement)));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `${output}/cfm-preview-${width}-${scheme}.png`,
    });
    const y = await page.evaluate(() => window.__cfmPreviewY);
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    assert.ok(Math.abs((await page.evaluate(() => scrollY)) - y) <= 2);
    await button.click();
    await dialog.getByText(/De aarde nu was woest/).waitFor();
    await dialog
      .getByRole("button", { name: "Meer lezen", exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    assert.match(page.url(), /\/scripture\/.*returnKey=/);
    await page
      .getByRole("button", { name: "Terug naar les", exact: true })
      .click();
    await page.locator("[data-study-reader]").waitFor();
    assert.ok(page.url().includes(flow.href));
    await page.screenshot({
      path: `${output}/cfm-return-${width}-${scheme}.png`,
    });
    // De echte hoofdtitel van les 03 verwijst naar beide hoofdstukken.
    await page.locator('[data-reference-key="ref-b-title1-0"]').click();
    await dialog.locator("[data-reference-passages] button").first().waitFor();
    assert.equal(
      await dialog.locator("[data-reference-passages] button").count(),
      2,
    );
    await dialog.locator("[data-reference-passages] button").nth(1).click();
    await dialog.getByText("Genesis 2 · nl · otb", { exact: true }).waitFor();
    assert.ok(
      await dialog.evaluate((d) => d.contains(document.activeElement)),
      "Passagekeuze behoudt focus in de modal",
    );
    await page.screenshot({
      path: `${output}/cfm-compound-${width}-${scheme}.png`,
    });
    await dialog
      .getByRole("button", { name: "Meer lezen", exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    assert.ok(page.url().includes(`/scripture/${flow.secondChapterId}`));
    await page.locator("#vers-25").waitFor({ state: "attached" });
    await page
      .getByRole("button", { name: "Terug naar les", exact: true })
      .click();
    await page.locator("[data-study-reader]").waitFor();
    assert.ok(page.url().includes(flow.href));

    assert.deepEqual(errors, []);
    results.push({
      width,
      scheme,
      text,
      realImportedLesson: true,
      internalOtbPreview: true,
      moreAndReturn: true,
      compoundSecondChapterAndReturn: true,
      noOverflow: true,
    });
    await context.close();
  }
  {
    const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      hasTouch: true,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + flow.tableHref);
    await page.locator("[data-study-reader]").waitFor();
    await page.addStyleTag({ content: "html{font-size:200% !important}" });
    const table = page.locator("table").first();
    // Een echte gebruikersscroll beëindigt het initiële leeshervatten.
    // Alleen scrollIntoView kan daarmee racen en vervolgens worden teruggezet.
    await page.keyboard.press("PageDown");
    const cell = table.locator("td").first();
    await cell.click({ trial: true });
    // Wacht op de daadwerkelijke compositie na tekstvergroting en de lange
    // scrollsprong; DOM-aanwezigheid alleen bewijst geen zichtbare tabel.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.ok(
      await cell.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const x = (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2;
        const header =
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--header-height",
            ),
          ) || 0;
        const y =
          (Math.max(header + 1, r.top) + Math.min(innerHeight, r.bottom)) / 2;
        return (
          r.bottom > 0 &&
          r.top < innerHeight &&
          el.contains(document.elementFromPoint(x, y))
        );
      }),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.ok((await page.locator("table td").count()) > 0);
    const screenshot = await page.screenshot({
      path: `${output}/cfm-table-320-large.png`,
    });
    const pixels = await sharp(screenshot).stats();
    assert.ok(
      pixels.channels.some((c) => c.stdev > 5),
      "De tabelopname mag geen leeg achtergrondvlak zijn",
    );
    results.push({
      width: 320,
      text: 200,
      realSourceTable: true,
      noOverflow: true,
    });
    await context.close();
  }
  for (const lesson of flow.longLessons) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + lesson.href);
    await page.locator("[data-study-reader]").waitFor();
    await delay(1200);
    await page.locator(`[data-reference-key="${lesson.reference}"]`).click();
    const dialog = page.locator("dialog[open]");
    await dialog.locator("[data-reference-preview-truncated]").waitFor();
    assert.equal(
      await dialog.locator("[data-reference-preview] sup").count(),
      40,
    );
    await page.screenshot({ path: `${output}/cfm-long-${lesson.verses}.png` });
    await dialog
      .getByRole("button", { name: "Meer lezen", exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    await page.locator(`#vers-${lesson.verses}`).waitFor({ state: "attached" });
    await page
      .getByRole("button", { name: "Terug naar les", exact: true })
      .click();
    await page.locator("[data-study-reader]").waitFor();
    assert.ok(page.url().includes(lesson.href));
    results.push({
      width: 390,
      longChapter: lesson.verses,
      previewVerses: 40,
      fullChapterAndReturn: true,
    });
    await context.close();
  }
  for (const selection of flow.selections) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + selection.href);
    await page.locator("[data-study-reader]").waitFor();
    await page.locator(`[data-reference-key="${selection.reference}"]`).click();
    const dialog = page.locator("dialog[open]");
    await dialog.locator("[data-reference-passages] button").first().waitFor();
    assert.equal(
      await dialog.locator("[data-reference-passages] button").count(),
      selection.choices,
    );
    await dialog
      .locator("[data-reference-passages] button")
      .nth(selection.index)
      .click();
    await dialog
      .locator('[data-reference-passages] button[aria-pressed="true"]')
      .nth(0)
      .waitFor();
    await page.waitForFunction(
      ({ i }) =>
        document
          .querySelectorAll("[data-reference-passages] button")
          [i]?.getAttribute("aria-pressed") === "true",
      { i: selection.index },
    );
    await dialog
      .getByRole("button", { name: "Meer lezen", exact: true })
      .waitFor();
    if (selection.previewNumbers)
      assert.deepEqual(
        await dialog.locator("[data-reference-preview] sup").allTextContents(),
        selection.previewNumbers.map(String),
      );
    await page.screenshot({
      path: `${output}/cfm-selection-${selection.book}-${selection.chapter}.png`,
    });
    await dialog
      .getByRole("button", { name: "Meer lezen", exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    assert.ok(page.url().includes(`/scripture/${selection.chapterId}`));
    await page
      .locator(`#vers-${selection.verses}`)
      .waitFor({ state: "attached" });
    await page
      .getByRole("button", { name: "Terug naar les", exact: true })
      .click();
    await page.locator("[data-study-reader]").waitFor();
    assert.ok(page.url().includes(selection.href));
    results.push({
      width: 390,
      wholeBookOrLargeRange: true,
      choices: selection.choices,
      selected: selection.index,
      moreAndReturn: true,
    });
    await context.close();
  }
  for (const external of flow.externals) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + external.href);
    await page.locator("[data-study-reader]").waitFor();
    await page.locator(`[data-reference-key="${external.anchor}"]`).click();
    const link = page.locator('dialog[open] a[target="_blank"]');
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), external.url);
    if (external.language === "en")
      await page.locator('[data-reference-source-language="en"]').waitFor();
    if (external.label)
      assert.ok(
        (await page.getByAltText(external.label, { exact: true }).count()) > 0,
        "Oorspronkelijke videoposter blijft zichtbaar in de les",
      );
    assert.match(await link.getAttribute("rel"), /noopener/);
    await page.screenshot({
      path: `${output}/cfm-external-${external.url.endsWith(".pdf") ? "pdf" : external.language === "en" ? "video-en" : "video-nl"}.png`,
    });
    // Test de echte nieuwe-tabactie, met alleen de externe response onderschept
    // zodat de browser geen videobestand of PDF volledig downloadt.
    const originalLocation=page.url();
    await context.route(external.url,route=>route.fulfill({status:200,contentType:"text/plain",body:"Gecontroleerde externe navigatietest"}));
    const opened=page.waitForEvent("popup");await link.click();const popup=await opened;
    await popup.waitForLoadState();assert.equal(popup.url(),external.url);
    assert.ok(await popup.evaluate(()=>window.opener===null));await popup.close();
    assert.equal(page.url(),originalLocation);
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    const banner = page.getByAltText(
      "Meer voor onderwijs aan kinderen — Nu bekijken.",
    );
    await banner.scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      Array.from(document.images).some(
        (i) =>
          i.alt === "Meer voor onderwijs aan kinderen — Nu bekijken." &&
          i.complete &&
          i.naturalWidth > 0,
      ),
    );
    assert.equal(await banner.count(), 1);
    results.push({
      width: 390,
      externalOriginalUrl: true,
      kind: external.url.endsWith(".pdf") ? "PDF" : "VIDEO",
      accessibleBanner: true,
      explicitSourceLanguage: external.language ?? (external.url.endsWith("-nl.mp4") ? "nl" : "und"),
    });
    await context.close();
  }
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + flow.ntHref);
    await page.locator("[data-study-reader]").waitFor();
    assert.equal(await page.locator('[data-reference-key="ref-b-p2-1"]').count(),0,"Geblokkeerde verwijzing is geen knop");
    const label=page.getByText("Johannes 6:48",{exact:true}).first();await label.waitFor();assert.equal(await label.evaluate(e=>e.closest("a,button")===null),true);
    results.push({ width: 390, newTestamentNoOtbFallback: true });
    await context.close();
  }
  const after = await prisma.user.findUniqueOrThrow({
    where: { id: flow.userId },
  });
  for (const key of ["xpTotal", "hintBalance", "activeCourseId"])
    assert.equal(after[key], before[key]);
  assert.equal(after.activeContentCollectionId, flow.collectionId);
  assert.deepEqual(await rewardCounts(), counts);
  console.log(
    JSON.stringify({
      cases: results.length,
      results,
      noRewards: true,
      realDevicesTested: false,
    }),
  );
} finally {
  await fs.writeFile(
    output + "/browser-results.json",
    JSON.stringify(results, null, 2),
  );
  await browser.close();
  await prisma.$disconnect();
}
