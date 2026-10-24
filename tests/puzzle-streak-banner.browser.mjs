// De banner tijdens een echte gezamenlijke puzzel, met serverafronding en twee spelers.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createCoopSession, respondToCoopInvite, acquireCoopLock, releaseCoopLocks, commitCoopAction } from "../src/lib/puzzle/coop.ts";
import { addDays } from "../src/lib/dates.ts";
import { dayKeyInZone } from "../src/lib/timeZone.ts";

const url = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Alleen de eigen wegwerpdatabase");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const output = process.env.SHOTS ?? "/tmp/versado-puzzle-browser/streak-banner";
mkdirSync(output, { recursive: true });
const users = [];
const today = dayKeyInZone(new Date(), "Europe/Amsterdam");
async function waitFor(predicate, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
}
async function person(language = "nl") {
  const user = await prisma.user.create({ data: {
    email: `banner-${randomUUID()}@test.invalid`, handle: `Banner${randomUUID().slice(0,8)}`, discriminator: "00", passwordHash: "synthetic",
    currentStreak: 41, longestStreak: 41, timeZone: "Europe/Amsterdam", lastStudyDate: addDays(today, -1), lastStudyTimeZone: "Europe/Amsterdam",
    uiLanguage: language, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), kompasOffersEnabled: false,
  } }); users.push(user.id); return user;
}
async function context(user, width, scale = 100) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: "Europe/Amsterdam", colorScheme: "dark", serviceWorkers: "block", reducedMotion: "reduce" });
  await ctx.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
  if (scale !== 100) await ctx.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = "200%"; });
  });
  return ctx;
}
async function post(page, sessionId, body) {
  const response = await page.request.post(`${base}/api/puzzle/coop`, { headers: { Origin: base }, data: { sessionId, ...body } });
  assert.equal(response.status(), 200, await response.text()); return response.json();
}
async function move(userId, sessionId, piece, x) {
  const lock = await acquireCoopLock(userId, sessionId, `p${piece}`); assert.ok(lock.ok);
  await commitCoopAction(userId, sessionId, { actionId: randomUUID(), lockToken: lock.token, operation: { kind: "move", groupId: `p${piece}`, x, y: 4 } });
  await releaseCoopLocks(userId, sessionId);
}
try {
  for (const [width, scale, language, dismiss] of [[320,100,"nl","swipe"],[320,200,"de","close"],[1280,100,"nl","auto"]]) {
    const [a,b] = await Promise.all([person(language),person()]);
    await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
    const sessionId = await createCoopSession(a.id, 0, 24, "ADVENTURER", [b.id]);
    const invite = await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId, toUserId: b.id } });
    await respondToCoopInvite(b.id, invite.id, true);
    await move(a.id, sessionId, 0, 4); await move(a.id, sessionId, 1, 5);
    const [ca,cb] = await Promise.all([context(a,width,scale),context(b,width)]);
    const [pa,pb] = await Promise.all([ca.newPage(),cb.newPage()]);
    const errors=[]; pa.on("pageerror", error=>errors.push(error.message)); pb.on("pageerror", error=>errors.push(error.message));
    const initial=pa.waitForResponse(response=>response.url().includes("/api/streak/continuation") && response.request().method()==="POST");
    await Promise.all([pa.goto(`${base}/jigsaw/samen/${sessionId}`),pb.goto(`${base}/jigsaw/samen/${sessionId}`)]); await initial;
    await pa.locator("canvas").first().waitFor(); await pb.locator("canvas").first().waitFor();
    await waitFor(async()=> (await prisma.user.findUniqueOrThrow({where:{id:a.id}})).onlineSocketCount>0,"socket moet verbonden zijn");
    assert.equal(await pa.locator("[data-streak-earned-banner]").count(),0,"openen verdient niets");
    await pa.locator("canvas").first().focus();
    const lock=await post(pa,sessionId,{action:"lock",groupId:"p1"}); assert.ok(lock.ok);
    const body={action:"commit",actionId:randomUUID(),lockToken:lock.token,operation:{kind:"connect",a:1,b:0}};
    const result=await post(pa,sessionId,body); assert.equal(result.contribution.dayEarned,true);
    const banner=pa.locator("[data-streak-earned-banner]"); await banner.waitFor();
    assert.match(await banner.innerText(),/42/);
    assert.equal(await pa.evaluate(()=>document.activeElement?.tagName),"CANVAS","banner neemt geen focus over");
    await banner.hover();
    const bounds=await banner.boundingBox(); assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
    assert.ok(bounds.height<422,"de banner laat ook bij 200% tekst het speelveld zichtbaar");
    assert.equal(await pa.locator("#streak-celebration-title").count(),0,"geen fullscreen onderbreking tijdens spelen");
    assert.equal(await pb.locator("[data-streak-earned-banner]").count(),0,"de ander krijgt geen viering voor jouw bijdrage");
    const day=await prisma.streakDay.findUniqueOrThrow({where:{userId_dayKey:{userId:a.id,dayKey:today}}});
    assert.equal(day.celebrationShownAt,null,"de banner claimt de fullscreen viering niet");
    const version=(await prisma.puzzleSession.findUniqueOrThrow({where:{id:sessionId}})).version;
    await pa.screenshot({path:`${output}/banner-${width}-${scale}.png`});
    if(dismiss==="swipe") {
      const box=await banner.locator("section").boundingBox(); const touch=await ca.newCDPSession(pa);
      await touch.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x+30,y:box.y+box.height-12,id:0}]});
      await touch.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:box.x+30,y:1,id:0}]});
      await touch.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    } else if(dismiss==="close") await banner.getByRole("button").click();
    else await pa.mouse.move(width-2,800);
    await banner.waitFor({state:"hidden",timeout:9000});
    assert.equal(await pa.evaluate(()=>document.activeElement?.tagName),"CANVAS","de spelbediening blijft na sluiten gefocust");
    assert.equal((await prisma.puzzleSession.findUniqueOrThrow({where:{id:sessionId}})).version,version,"wegvegen/sluiten speelt geen zet");
    assert.equal((await prisma.puzzleSession.findUniqueOrThrow({where:{id:sessionId}})).status,"ACTIVE");
    assert.equal(await pb.locator("canvas").count(),1,"de ander blijft spelen");
    await post(pa,sessionId,body); // Dezelfde serverafronding/retry geeft geen tweede banner.
    await pa.reload(); await pa.locator("canvas").first().waitFor();
    await pa.waitForTimeout(300); assert.equal(await banner.count(),0,"refresh herhaalt de banner niet");
    await pa.addInitScript((mode) => {
      window.__streakShared = null; window.__streakCopied = null;
      Object.defineProperty(navigator, "share", { configurable: true, value: mode === "auto" ? undefined : async (content) => {
        window.__streakShared = content;
        if (mode === "close") throw new DOMException("Cancelled", "AbortError");
      } });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { window.__streakCopied = text; } } });
    }, dismiss);
    await pa.goto(`${base}/dashboard`); await pa.locator("#streak-celebration-title").waitFor();
    assert.ok((await prisma.streakDay.findUniqueOrThrow({where:{userId_dayKey:{userId:a.id,dayKey:today}}})).celebrationShownAt);
    const shareButton = pa.locator("[data-streak-share]");
    await shareButton.waitFor();
    await shareButton.scrollIntoViewIfNeeded();
    const shareBounds = await shareButton.boundingBox();
    assert.ok(shareBounds.x >= 0 && shareBounds.x + shareBounds.width <= width + 1);
    if (dismiss === "auto") {
      await pa.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("clipboard denied"); }; });
      await shareButton.click();
      await pa.getByRole("status").filter({ hasText: "Kopiëren is niet gelukt" }).waitFor();
      await pa.evaluate(() => { navigator.clipboard.writeText = async text => { window.__streakCopied = text; }; });
    }
    await shareButton.click();
    await waitFor(async () => pa.evaluate(() => Boolean(window.__streakShared || window.__streakCopied)), "deelactie uitgevoerd");
    const shared = await pa.evaluate(() => ({ shared: window.__streakShared, copied: window.__streakCopied }));
    if (dismiss === "auto") assert.match(shared.copied, /42.*Versado![\s\S]*https:\/\/versado.app/);
    else { assert.equal(shared.shared.title, "Versado"); assert.match(shared.shared.text, /42/); assert.equal(shared.shared.url, "https://versado.app"); assert.equal(shared.copied, null, "annuleren kopieert niets"); }
    assert.equal(await pa.locator("#streak-celebration-title").count(), 1, "delen of annuleren sluit de viering niet");
    await pa.screenshot({ path: `${output}/share-${width}-${scale}.png` });
    assert.deepEqual(errors,[]);
    await ca.close(); await cb.close();
  }
  console.log("Reeksbanner: direct bij eigen bijdrage, wegvegen/sluiten/automatisch verdwijnen, geen herhaling of spelonderbreking, fullscreen pas daarna; 320px en 200% tekst slagen.");
} finally {
  await browser.close(); await prisma.user.deleteMany({where:{id:{in:users}}}); await prisma.$disconnect();
}
