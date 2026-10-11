// Werkelijke productie-interface, API en wegwerpdatabase; touch en desktop.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { boardPosition, groupFor } from "../src/lib/puzzle/engine.ts";
import { puzzleWorktable } from "../src/lib/puzzle/worktable.ts";
import { fitCamera } from "../src/lib/puzzle/viewport.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { nl } from "../src/lib/i18n/messages/nl.ts";
import { de } from "../src/lib/i18n/messages/de.ts";

const url = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const output = "/tmp/versado-puzzle-browser"; mkdirSync(output, { recursive: true });
const users = []; const results = [];
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { jigsawEnabled: true }, update: { jigsawEnabled: true } });
  for (const mobile of [false, true]) {
    const user = await prisma.user.create({ data: { email: `rules-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Rules${randomUUID().slice(0,6)}`, discriminator: "00", hintBalance: 2, activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } }); users.push(user.id);
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1, serviceWorkers: "block" });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const canvas = page.locator("canvas"); const menu = page.getByRole("button", { name: nl.jigsaw.boardMenu, exact: true });
    const api = async (body) => { const response = await context.request.post(`${base}/api/jigsaw-v2`, { data: body }); assert.equal(response.status(), 200, await response.text()); return response.json(); };
    const act = (state, operation) => api({ action: "act", sessionId: state.id, version: state.version, actionId: randomUUID(), operation });
    const resume = (state) => api({ action: "resume", sessionId: state.id });
    const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const fingerprint = async () => { await frames(); return createHash("sha256").update(await canvas.evaluate((c) => c.toDataURL())).digest("hex"); };
    await page.goto(`${base}/jigsaw`);
    async function open(state) {
      await page.evaluate((id) => localStorage.setItem("versado:jigsaw-v2-session", id), state.id);
      await page.goto(`${base}/jigsaw`); await canvas.waitFor(); await canvas.press("0");
      await page.evaluate(async (src) => { const image = new Image(); image.src = src; await image.decode(); }, state.image); await frames();
      return canvas.boundingBox();
    }
    async function drag(from, to) {
      if (mobile) {
        const touch = await context.newCDPSession(page);
        await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 0 }] });
        for (let i=1;i<=8;i++) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x+(to.x-from.x)*i/8, y: from.y+(to.y-from.y)*i/8, id: 0 }] });
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await touch.detach();
      } else { await page.mouse.move(from.x,from.y); await page.mouse.down(); await page.mouse.move(to.x,to.y,{ steps: 8 }); await page.mouse.up(); }
    }
    // Elke policy heeft daadwerkelijk het juiste canvas en gedrag bij loslaten.
    for (const difficulty of ["DISCOVERER","ADVENTURER","EXPERT","MASTER"]) {
      let state = await api({ action: "start", imageId: jigsawCatalog[160].url, pieceCount: 12, difficulty });
      const geometry = createPuzzleGeometry(12,state.seed,state.geometryVersion); const table = puzzleWorktable(geometry);
      const to = boardPosition(geometry,groupFor(state.snapshot,0));
      const box = await open(state); const camera = fitCamera(box,table.bounds);
      const policyPixel = await canvas.evaluate((c,{ camera,to }) => { const ratio=Math.min(devicePixelRatio,2); return [...c.getContext("2d").getImageData(Math.round((camera.x+(to.x+.5)*camera.scale)*ratio),Math.round((camera.y+(to.y+.5)*camera.scale)*ratio),1,1).data]; }, { camera,to });
      if (difficulty === "EXPERT" || difficulty === "MASTER") assert.deepEqual(policyPixel,[219,230,230,255], "vrij puzzelen toont geen oplossingsvlak");
      else assert.notDeepEqual(policyPixel,[219,230,230,255]);
      state = await act(state,{ kind: "move",groupId:"p0",x:to.x+.7,y:to.y+.1 });
      const bounds = await open(state); const cam=fitCamera(bounds,table.bounds);
      const point = (x,y) => ({ x:bounds.x+cam.x+x*cam.scale,y:bounds.y+cam.y+y*cam.scale });
      const dropKind = difficulty === "DISCOVERER" || difficulty === "ADVENTURER" ? "anchor" : "move";
      const response = page.waitForResponse((r) => r.request().postDataJSON()?.operation?.kind===dropKind);
      await drag(point(to.x+1.2,to.y+.6),point(to.x+.7,to.y+.6)); state=await(await response).json();
      const placed=groupFor(state.snapshot,0);
      if(dropKind==="anchor") {
        assert.ok(placed.anchored); assert.equal(placed.x,to.x); assert.equal(placed.y,to.y);
        const before=await resume(state); await open(before); await drag(point(to.x+.5,to.y+.5),point(to.x+1,to.y+1));
        assert.deepEqual((await resume(before)).snapshot,before.snapshot,"verankerde touch/mousedrag wijzigt niets");
      } else { assert.ok(!placed.anchored); assert.ok(Math.abs(placed.x-(to.x+.2))<1e-5); }
      if(difficulty==="MASTER") {
        const rotate=page.getByRole("button",{ name:nl.jigsaw.rotate,exact:true });
        const rect=await rotate.boundingBox(); const menuRect=await menu.boundingBox(); assert.ok(rect.width>=60&&rect.height>=60&&menuRect.width>=60&&menuRect.height>=60);
        assert.ok(rect.x+rect.width<=menuRect.x);
        const reply=page.waitForResponse((r)=>r.request().postDataJSON()?.operation?.kind==="rotate"); await rotate.click();
        assert.equal(groupFor((await(await reply).json()).snapshot,0).rotation,90);
      }
      await page.screenshot({ path:`${output}/rules-${mobile?"mobile":"desktop"}-${difficulty}.png` });
      results.push({ mobile,difficulty,anchored:!!placed.anchored,policyPixel });
    }
    // Vier hints, echte markers, budgetwaarschuwing vooraf en verlopen weergave.
    // Oude Meester-support blijft zichtbaar; geen stille beleidswisseling.
    const legacy = await api({ action:"start",imageId:jigsawCatalog[162].url,pieceCount:12,difficulty:"MASTER" });
    const row = await prisma.puzzleSession.findUniqueOrThrow({where:{id:legacy.id},include:{variant:true}});
    const key = {definitionId:row.variant.definitionId,pieceCount:12,difficulty:"MASTER",rulesVersion:1};
    const oldVariant = await prisma.puzzleVariant.upsert({where:{definitionId_pieceCount_difficulty_rulesVersion:key},create:key,update:{}});
    await prisma.puzzleSession.update({where:{id:legacy.id},data:{variantId:oldVariant.id}});
    const old = await resume(legacy); assert.equal(old.rulesVersion,1); const oldBounds=await open(old);
    const oldGeometry=createPuzzleGeometry(12,old.seed,old.geometryVersion); const oldTable=puzzleWorktable(oldGeometry); const oldCamera=fitCamera(oldBounds,oldTable.bounds);
    const oldPixel=await canvas.evaluate((c,{camera,board})=>{const ratio=Math.min(devicePixelRatio,2);return [...c.getContext("2d").getImageData(Math.round((camera.x+(board.x+.5)*camera.scale)*ratio),Math.round((camera.y+(board.y+.5)*camera.scale)*ratio),1,1).data];},{camera:oldCamera,board:oldTable.puzzle});
    assert.notDeepEqual(oldPixel,[219,230,230,255],"rules 1 behoudt de oude centrale bordweergave");
    await menu.click(); assert.ok(await page.getByText(nl.jigsaw.legacyRules,{exact:true}).isVisible()); await menu.click();
    let state=await api({ action:"start",imageId:jigsawCatalog[161].url,pieceCount:12,difficulty:"ADVENTURER" });
    const hintGeometry=createPuzzleGeometry(12,state.seed,state.geometryVersion);
    for(const id of [0,1]) { const to=boardPosition(hintGeometry,groupFor(state.snapshot,id)); state=await act(state,{kind:"move",groupId:`p${id}`,x:to.x-.8,y:to.y-.8}); }
    state=await act(state,{kind:"connect",a:0,b:1});
    await open(state); await canvas.press("Enter");
    const original=structuredClone(state.snapshot);
    const names=[nl.jigsaw.hintPreview,nl.jigsaw.hintLocation,nl.jigsaw.hintConnection,nl.jigsaw.hintCorners];
    for(const [index,name] of names.entries()) {
      const before=await fingerprint(); await canvas.screenshot({ path:`${output}/hint-before-${index}.png` }); await menu.click(); await page.getByRole("button",{ name:nl.jigsaw.useHint,exact:true }).click();
      const panel=page.getByRole("dialog",{ name:nl.jigsaw.hintPanel }); await panel.waitFor();
      assert.ok(await panel.getByText(nl.jigsaw.hintsRemaining.replace("{n}",String(3-index))).isVisible());
      if(index===3) assert.ok(await panel.getByText(nl.jigsaw.extraHintNotice).isVisible());
      await page.screenshot({path:`${output}/hint-pane-${mobile?"mobile":"desktop"}-${index}.png`});
      const reply=page.waitForResponse((r)=>r.request().postDataJSON()?.operation?.kind==="hint"); if(index===3) await panel.getByRole("button",{name:nl.jigsaw.hintFilter,exact:true}).click(); await panel.getByRole("button",{ name,exact:true }).click(); if(index===3) await panel.getByRole("button",{name:nl.jigsaw.hintConfirmUse,exact:true}).click(); state=await(await reply).json();
      const hint=state.snapshot.hints.at(-1); assert.equal(hint.extra,index===3); assert.ok(hint.expiresAt);
      if(hint.type==="CONNECTION") assert.ok(!groupFor(state.snapshot,0).pieceIds.includes(hint.target.neighborId));
      await page.waitForFunction((type)=>document.querySelector("canvas")?.dataset.activeHint===type,hint.type);
      if(index===0) {
        assert.ok(await page.getByRole("img",{ name:nl.jigsaw.hintPreview,exact:true }).isVisible());
        await page.reload(); await canvas.waitFor(); await page.getByRole("img",{ name:nl.jigsaw.hintPreview,exact:true }).waitFor();
        assert.equal((await resume(state)).snapshot.hints.length,1,"herladen schrijft niets opnieuw af");
      } else assert.notEqual(await fingerprint(),before,"marker/filter verandert echte canvaspixels");
      await page.waitForFunction(()=>document.querySelector("canvas")?.dataset.activeHint==="",null,{ timeout:6500 });
      assert.ok(Date.now()-Date.parse(hint.at)<6200,"hervatten verlengt vijfsecondenhint niet");
      assert.deepEqual(state.snapshot.groups,original.groups); assert.deepEqual(state.snapshot.connections,original.connections); assert.equal(state.snapshot.filter,null); assert.equal(state.status,"ACTIVE");
      await canvas.press("0"); if(index===0) await canvas.press("Enter");
      if(index>0) { await canvas.screenshot({ path:`${output}/hint-after-${index}.png` }); assert.equal(await fingerprint(),before,`tijdelijke canvasmarkering ${hint.type} verdwijnt volledig`); }
    }
    // Selectie en paneel blijven bereikbaar op klein/landscape/200%/safe areas.
    for(const size of [{width:320,height:568},{width:844,height:390}]) {
      await page.setViewportSize(size); await page.evaluate(()=>{ document.documentElement.style.fontSize="200%"; for(const [side,value] of Object.entries({left:20,right:20,bottom:34})) document.documentElement.style.setProperty(`--safe-area-inset-${side}`,`${value}px`); });
      await menu.click(); await page.getByRole("button",{ name:nl.jigsaw.useHint,exact:true }).click();
      const panel=page.getByRole("dialog",{ name:nl.jigsaw.hintPanel }); const box=await panel.boundingBox(); const button=await menu.boundingBox();
      assert.ok(button.width>=60&&button.height>=60); assert.ok(box.x>=19&&box.x+box.width<=size.width-19); assert.ok(box.y>=0&&box.y+box.height<=size.height,JSON.stringify({size,box,button})); assert.ok(box.height>40);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1),true);
      await page.screenshot({ path:`${output}/hints-${mobile?"mobile":"desktop"}-${size.width}-200.png` });
      await panel.getByRole("button",{ name:nl.jigsaw.closeHints,exact:true }).click(); assert.equal(await menu.evaluate((button)=>button===document.activeElement),true);
      await page.evaluate(()=>{document.documentElement.style.removeProperty("font-size");for(const side of ["left","right","bottom"]) document.documentElement.style.removeProperty(`--safe-area-inset-${side}`);});
    }
    // De API blijft streng op hintinput en kent geen clientclaim van anchoring.
    for(const operation of [{kind:"hint",hint:"LOCATION"},{kind:"hint",hint:"FILTER"},{kind:"hint",hint:"INVALID"},{kind:"anchor",groupId:""}]) {
      const response=await context.request.post(`${base}/api/jigsaw-v2`,{data:{action:"act",sessionId:state.id,version:state.version,actionId:randomUUID(),operation}}); assert.equal(response.status(),400);
    }
    await prisma.user.update({where:{id:user.id},data:{uiLanguage:"de"}}); await page.reload(); await canvas.waitFor();
    await page.getByRole("button",{name:de.jigsaw.boardMenu,exact:true}).click(); await page.getByRole("button",{name:de.jigsaw.useHint,exact:true}).click(); await page.getByRole("dialog",{name:de.jigsaw.hintPanel}).waitFor();
    assert.deepEqual(errors,[]); await context.close();
  }
  writeFileSync(`${output}/difficulty-hints-results.json`,JSON.stringify(results,null,2));
  console.log("Productiebrowser: vier policies, bordverankering, vier tijdelijke hints, reload/budget, 60px, safe areas, 200%, Duits en touch/desktop geslaagd.");
} finally { await browser.close(); await prisma.user.deleteMany({where:{id:{in:users}}}); await prisma.$disconnect(); }
