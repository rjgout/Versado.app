import {logoutNativeProfile,serveNativeProfileAsset} from "./fixtures/native-profile-browser-actions.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { seedNativeCourses } from "./fixtures/native-courses.ts";
import { prisma } from "../src/lib/db.ts";
import { legacyVerseAnnotation } from "../src/lib/annotations/service.ts";
import { issueNativeSession } from "../src/lib/native/sessions.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { getT } from "../src/lib/i18n/index.ts";
const db = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid"),
  backend = process.env.NATIVE_TEST_BASE_URL;
if (
  db.hostname !== "127.0.0.1" ||
  db.pathname !== "/versado_content_access_test" ||
  db.href !== process.env.DATABASE_URL
)
  throw Error("Eigen geïsoleerde database vereist");
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright"),
  out = "/tmp/versado-native-browser/reader";
mkdirSync(out, { recursive: true });
const inputs = JSON.parse(readFileSync("dist/native.inputs.json", "utf8"));
assert.ok(
  inputs.some((f) => f.endsWith("reading/ScriptureReaderView.tsx")),
  "De echte gedeelde leescomponent ontbreekt",
);
assert.equal(
  inputs.some((f) =>
    /node_modules\/(?:next|@prisma)\/|\.server\.ts$|components\/LessonFlow\.tsx$/.test(
      f,
    ),
  ),
  false,
  "Web-/serveradapters mogen niet in de lokale bundel",
);
const osBoundary = {
  name: "reader-os-events-only",
  setup(api) {
    api.onLoad({filter:/src\/lib\/data\/native\.ts$/},args=>({loader:"ts",contents:readFileSync(args.path,"utf8").replace("const input=readerPositionInput.parse(raw);","const input=readerPositionInput.parse(raw); globalThis.__positionInputs.push({...input});").replace("this.store = new LiveDataStore(environment);","this.store = new LiveDataStore(environment); globalThis.__readerRuntime = this; globalThis.__positionInputs=[];")}));
    api.onLoad({ filter: /src\/lib\/platform\.ts$/ }, (args) => {
      const source = readFileSync(args.path, "utf8"),
        start = source.indexOf(
          "export async function startNativeFoundationRuntime(",
        );
      assert.ok(start > 0);
      return {
        loader: "ts",
        contents:
          source.slice(0, start) +
          `export async function startNativeFoundationRuntime(options){const back=()=>options.onBack(),resume=()=>options.onResume(),open=e=>options.onUrl(e.detail,'open');window.addEventListener('reader:test-open',open);window.addEventListener('reader:test-back',back);window.addEventListener('reader:test-resume',resume);return()=>{window.removeEventListener('reader:test-open',open);window.removeEventListener('reader:test-back',back);window.removeEventListener('reader:test-resume',resume);};}`,
      };
    });
  },
};
const bundle = await build({
    plugins: [osBoundary],
    entryPoints: ["tests/fixtures/native-foundation-client.tsx"],
    bundle: true,
    write: false,
    minify: true,
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  css = readFileSync("dist/native/index.css");
const secrets = new Map(),
  calls = [],
  held = [];
let noPositionBackend = false, noAnnotationsBackend=false, oldBackend = false,
  readFailure = 0,
  holdReader = false, proxyFailure = false, holdLearning = false, learningFailure = 0;
const heldLearning=[],heldAnnotations=[];
let holdAnnotations=false,loseAnnotation=false;
const front = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
 if(serveNativeProfileAsset(url.pathname,res))return;
    if (url.pathname.startsWith("/api/v1/native/")) {
      const record={ path: url.pathname, method: req.method };calls.push(record);
      const isReader = /\/courses\/[^/]+\/read\//.test(url.pathname) && !url.pathname.includes("/annotations");
      const isLearning=req.method === "GET" && (url.pathname.endsWith("/courses") || url.pathname.endsWith("/path"));
      if(isLearning && learningFailure){res.writeHead(learningFailure,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"content_unavailable"}));return;}
      if (isReader && readFailure) {
        res.writeHead(readFailure, { "Content-Type": proxyFailure ? "text/html" : "application/json" });
        res.end(proxyFailure ? "<html>Temporary upstream failure</html>" : JSON.stringify({ error: "native_request_failed" }));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if(req.method==="POST"&&url.pathname.endsWith("/annotations"))record.body=JSON.parse(Buffer.concat(chunks).toString());
      const response = await fetch(`${backend}${req.url}`, {
        method: req.method,
        headers: {
          Origin: "capacitor://localhost",
          "X-Versado-Client": "native-v1",
          "x-real-ip": "127.0.0.65",
          ...(req.headers.authorization
            ? { Authorization: req.headers.authorization }
            : {}),
          ...(req.headers["content-type"]
            ? { "Content-Type": req.headers["content-type"] }
            : {}),
        },
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(chunks),
      });
      record.status=response.status;
      let body = await response.text();
      if(url.pathname.endsWith("/position")){const value=JSON.parse(body);record.outcome=value.error??value.version;}
      if (url.pathname.endsWith("/capabilities") && (oldBackend || noPositionBackend || noAnnotationsBackend)) {
        const value = JSON.parse(body);
        value.features = value.features.filter(
          (f) => !(oldBackend && f === "scripture-reader-v1") && !(noPositionBackend && f === "scripture-reading-position-v1") && !(noAnnotationsBackend && f === "scripture-annotations-v1"),
        );
        body = JSON.stringify(value);
      }
      if(record.body&&loseAnnotation){
        // Een kale socket-close wordt door Chromium zelf transparant herhaald
        // (bewezen: twee POSTs met dezelfde UUID). Een afgekapt JSON-antwoord
        // ná echte commit is deterministisch onzeker, zonder browserretry.
        loseAnnotation=false;assert.equal(response.status,200);
        res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end('{"');return;
      }
      const finish = () => {
        if (!res.destroyed) {
          res.writeHead(response.status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(body);
        }
      };
      if(url.pathname.endsWith("/annotations")&&req.method==="GET"&&holdAnnotations){holdAnnotations=false;record.privateMarker=body.includes("PRIVE ACCOUNT A ANNOTATIE");heldAnnotations.push(finish);return;}
      if(isLearning && holdLearning){heldLearning.push(finish);return;}
      if (isReader && holdReader) {
        holdReader = false;
        held.push(finish);
      } else finish();
      return;
    }
    if (url.pathname.startsWith("/test-keychain/")) {
      if (req.method === "PUT") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        secrets.set(url.pathname, Buffer.concat(chunks).toString());
      }
      if (req.method === "DELETE") secrets.delete(url.pathname);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ value: secrets.get(url.pathname) ?? null }));
      return;
    }
    if (url.pathname === "/app.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].text);
      return;
    }
    if (url.pathname === "/index.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
      return;
    }
    if (
      [
        "/native-artwork/",
        "/images/",
        "/icons/",
        "/mascots/",
        "/scripture/",
      ].some((prefix) => url.pathname.startsWith(prefix)) &&
      !url.pathname.includes("..")
    ) {
      res.setHeader(
        "Content-Type",
        url.pathname.endsWith(".png")
          ? "image/png"
          : url.pathname.endsWith(".svg")
            ? "image/svg+xml"
            : "image/webp",
      );
      res.end(
        readFileSync(
          url.pathname.startsWith("/native-artwork/")
            ? `dist/native${url.pathname}`
            : `public${url.pathname}`,
        ),
      );
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  } catch (e) {
    res.writeHead(500);
    res.end("synthetic front failure");
    console.error(e);
  }
});
await new Promise((resolve) => front.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${front.address().port}`;
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox"],
  }),
  fixtures = [],
  results = [];
try {
  for (const [language, width, scheme, scale] of [
    ["nl", 320, "light", 200],
    ["en", 390, "dark", 100],
    ["de", 390, "light", 200],
    ["fr", 768, "dark", 100],
    ["es", 390, "light", 100],
  ]) {
    const f = await seedNativeCourses(language),
      user = await f.account(language),
      t = getT(language);
    fixtures.push(f);
    const free = f.courses.find((c) => c.type === "FREE_CHOICE");
    const extraBook = await prisma.book.create({
      data: {
        slug: `reader-extra-${user.id}`,
        key: "bofm/mosiah",
        name: "Mosiah",
        order: 2,
        contentCollectionId: f.collection.id,
      },
    });
    const extraChapter = await prisma.chapter.create({
      data: {
        bookId: extraBook.id,
        number: 1,
        order: 1,
        verses: {
          create: [1, 2, 3].map((number) => ({
            number,
            text: `Synthetische extra passage ${number}.`,
          })),
        },
      },
    });
    await prisma.courseChapter.create({
      data: { courseId: free.id, chapterId: extraChapter.id, order: 2 },
    });
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      locale: language,
      colorScheme: scheme,
      hasTouch: true,
    });
    await context.addInitScript(
      ({ scale }) => {
        const apply = () => {
          document.documentElement.style.fontSize = `${scale}%`;
          for (const [edge, size] of Object.entries({
            top: 24,
            bottom: 18,
            left: 12,
            right: 12,
          }))
            document.documentElement.style.setProperty(
              `--safe-area-inset-${edge}`,
              `${size}px`,
            );
        };
        if (document.documentElement) apply();
        else
          document.addEventListener("DOMContentLoaded", apply, { once: true });
      },
      { scale },
    );
    const page = await context.newPage(),
      web = await context.newPage(),
      errors = [];
    if (language === "nl") await page.clock.install();
    page.on("pageerror", (e) => errors.push(e.message));
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: await createSessionToken(user.id),
        url: backend,
      },
    ]);
    const waitReader = async () =>
      page
        .locator("[data-native-reader]")
        .waitFor()
        .catch(async (e) => {
          console.error(
            "Readerdiagnose",
            await page.locator("body").innerText(),
            calls.slice(-10),
          );
          throw e;
        });
    const showVerse = async number => page.locator(`#vers-${number}`).evaluate(element=>{
      const header=document.querySelector("[data-sticky-header]")?.getBoundingClientRect().bottom??0;
      const anchor=header+(innerHeight-header)*0.4,rect=element.getBoundingClientRect();
      window.scrollTo({top:Math.max(0,scrollY+rect.top+rect.height/2-anchor),behavior:"instant"});
    });
    const wheelAndWait = async (delta, milliseconds) => {
      // Playwright wheel keert terug vóór de compositor het event verwerkt.
      // Eerst echte delivery bevestigen, daarna de virtuele rusttimer doorlopen.
      await page.evaluate(()=>{window.__readerWheelDelivered=false;window.addEventListener("wheel",()=>{window.__readerWheelDelivered=true;},{once:true});});
      await page.mouse.wheel(0,delta);
      await page.waitForFunction(()=>window.__readerWheelDelivered);
      // Ook compositor-scroll en React-effecten krijgen tussen de klokstappen
      // een echte eventloopbeurt; één grote sprong kan scroll pas erna leveren.
      for(let elapsed=0;elapsed<milliseconds;elapsed+=250){await page.clock.runFor(Math.min(250,milliseconds-elapsed));await page.waitForTimeout(10);}
    };
    const go = (path) =>
      page.evaluate(
        (path) =>
          window.dispatchEvent(
            new CustomEvent("reader:test-open", {
              detail: location.origin + path,
            }),
          ),
        path,
      );
    const route = (course, kind, target) =>
      `/courses/${course}/read/${kind}/${target}`;
    const stepRoute = route(f.steps.id, "steps", f.steps.lessons[1].id),
      device = `reader-${user.id}`;
    await page.goto(
      `${origin}/?accountLanguage=1&device=${device}#${stepRoute}`,
    );
    await page.getByLabel(t("nativeFoundation.email")).fill(user.email);
    await page
      .getByLabel(t("nativeFoundation.password"), { exact: true })
      .fill(f.password);
    await page
      .getByRole("button", { name: t("nativeFoundation.login"), exact: true })
      .click();
    await waitReader();
    assert.equal(
      new URL(page.url()).hash,
      `#${stepRoute}`,
      "Inloggen behoudt de expliciete leesbestemming",
    );
    assert.equal(
      await page.locator("[data-native-reader] .reader-text").count(),
      2,
    );
    assert.equal(await page.locator("#vers-3").count(), 0);
    assert.equal(await page.locator("#vers-4").count(), 0);
    assert.ok(
      (await page.locator("[data-reader-source]").innerText()).includes(
        f.collection.name,
      ),
    );
    await page.waitForFunction(() =>
      document.activeElement?.matches('h1[tabindex="-1"]'),
    );
    assert.equal(
      await page.evaluate(() => !!document.activeElement?.closest("[hidden]")),
      false,
      "Focus mag niet in het verborgen leerpad belanden",
    );
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.activeElement).outlineStyle,
      ),
      "none",
      "Geen blauwe routefocusrand",
    );
    await page.evaluate(() => {
      const node = document.querySelector(
          "[data-native-reader] .reader-text p",
        ),
        range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    assert.ok(
      (await page.evaluate(() => getSelection().toString())).includes(
        "Synthetisch vers 32:1.",
      ),
    );
    await page.evaluate(() => getSelection().removeAllRanges());
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    if(language === "nl") {
      const writes=()=>calls.filter(c=>c.method==="POST"&&c.path.endsWith("/position")).length;
      const untouched=writes();
      await page.clock.runFor(6000);
      await page.evaluate(()=>window.scrollTo(0,100));
      await page.clock.runFor(6000);
      assert.equal(writes(),untouched,"openen en programmatisch scrollen bewaren niets");
      await wheelAndWait(30,3000);
      await page.getByText(t("nativeReader.saved"),{exact:true}).waitFor();
      assert.equal(writes(),untouched+1,"stabiele echte leesinteractie bewaart precies eenmaal");
      await page.screenshot({path:`${out}/nl-position-saved-native.png`,fullPage:true});
      const progress=await prisma.contentProgress.findUniqueOrThrow({where:{userId_contentKey:{userId:user.id,contentKey:"bofm/alma#32"}}});
      const saved=Object.values(progress.readerPositions)[0];
      assert.ok(saved.verse>=1&&saved.verse<=2);assert.equal(saved.version,1);
      assert.equal(progress.readStatus,null);assert.equal(progress.readVerse,0);
      await page.reload();await waitReader();
      await page.clock.runFor(6000);
      assert.equal(writes(),untouched+1,"heropenen schrijft niet opnieuw");
      // Een echte mislukte schrijfintentie blijft zichtbaar en wordt bij online
      // herstel niet automatisch opnieuw verzonden.
      await page.waitForTimeout(100);
      await context.setOffline(true);
      await page.locator("#vers-2").scrollIntoViewIfNeeded();
      await wheelAndWait(-1,10000);
      await page.getByText(t("nativeReader.saveFailed"),{exact:true}).waitFor().catch(async error=>{console.error("Positie/offline-diagnose",await page.locator("body").innerText(),await page.evaluate(()=>({visibility:document.visibilityState,online:navigator.onLine,height:innerHeight,scroll:scrollY,verses:[...document.querySelectorAll("[data-native-reader] .reader-text")].map(e=>({id:e.id,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom})),header:document.querySelector("[data-sticky-header]")?.getBoundingClientRect().bottom})),calls.slice(-8));throw error;});
      await page.screenshot({path:`${out}/nl-position-offline-native.png`,fullPage:true});
      await context.setOffline(false);
      await page.evaluate(()=>window.dispatchEvent(new Event("online")));
      await page.clock.runFor(10000);
      assert.equal(writes(),untouched+1,"geen automatische offline schrijfretry");
      await page.locator("[data-reader-save-status] button").click();
      await page.getByText(t("nativeReader.saved"),{exact:true}).waitFor();
      assert.equal(writes(),untouched+2,"expliciete retry slaagt");
      assert.equal(await page.locator("[data-reader-chapter-navigation]").count(),0,"stappen bieden geen hoofdstukoverslag");
      // Werkelijke tweede native sessie schrijft via dezelfde publieke API.
      // De eerste app moet een stale CAS expliciet herstellen, zonder retryloop.
      await page.waitForLoadState("networkidle");
      const second=await issueNativeSession(user.id,user.sessionVersion),apiPath=`courses/${f.steps.id}/read/steps/${f.steps.lessons[1].id}`;
      const apiHeaders={Origin:"capacitor://localhost","X-Versado-Client":"native-v1",Authorization:`Bearer ${second.accessToken}`,"Content-Type":"application/json"};
      const remote=await (await fetch(`${backend}/api/v1/native/${apiPath}/resume`,{headers:apiHeaders})).json();
      assert.equal(remote.positionVersion,2);
      const previousLocal=remote.reader.focusVerse,observed=previousLocal===1?2:1;
      const changed=await fetch(`${backend}/api/v1/native/${apiPath}/position`,{method:"POST",headers:apiHeaders,body:JSON.stringify({chapterId:remote.reader.chapterId,startVerse:remote.reader.startVerse,endVerse:remote.reader.endVerse,activeCollectionId:remote.reader.activeCollectionId,selectionVersion:remote.reader.selectionVersion,language:remote.reader.language,expectedVersion:remote.positionVersion,verse:observed,actionId:crypto.randomUUID()})});
      assert.equal(changed.status,200);
      await showVerse(observed);await wheelAndWait(1,10000);
      await page.getByText(t("nativeReader.conflict"),{exact:true}).waitFor().catch(async error=>{console.error("Positie/conflict-diagnose",await page.locator("body").innerText(),calls.slice(-16));throw error;});
      assert.equal(writes(),untouched+3,"conflict veroorzaakt precies één poging");
      const refreshed=page.waitForResponse(response=>response.url().endsWith("/resume")&&response.status()===200);
      await page.locator("[data-reader-save-status] button").click();await refreshed;
      await page.waitForTimeout(100);
      await showVerse(previousLocal);await wheelAndWait(-1,10000);
      await page.getByText(t("nativeReader.saved"),{exact:true}).waitFor();
      assert.equal(writes(),untouched+4,"na bevestigde GET mag een nieuwe waarneming opslaan");
      noPositionBackend=true;await page.reload();await waitReader();
      await page.getByText(t("nativeLearningFlow.ready"),{exact:true}).waitFor();
      assert.equal(await page.locator("[data-reader-save-status]").count(),0);
      await wheelAndWait(30,10000);
      assert.equal(writes(),untouched+4,"oude backend blijft uitsluitend lezen, zonder nieuwe POST");
      noPositionBackend=false;await page.reload();await waitReader();

    }
    await page.screenshot({
      path: `${out}/${language}-step-native.png`,
      fullPage: true,
    });
    for (const course of f.courses.filter(
      (c) => c.type !== "READING_LESSONS",
    )) {
      const href = route(course.id, "chapters", f.chapters[1].id);
      await go(href);
      await waitReader();
      assert.equal(
        await page.locator("[data-native-reader] .reader-text").count(),
        4,
      );
      const navigation=page.locator("[data-reader-chapter-navigation]");
      await navigation.getByRole("button",{name:t("nativeReader.previous"),exact:true}).waitFor();
      if(course.type === "FREE_CHOICE") {
        await navigation.getByRole("button",{name:t("nativeReader.next"),exact:true}).click();
        await page.waitForFunction(()=>document.querySelector("[data-scripture-reader] h1")?.textContent?.includes("Mosiah"));
        assert.equal(await page.locator("[data-native-reader] .reader-text").count(),3);
        await navigation.getByRole("button",{name:t("nativeReader.previous"),exact:true}).click();
        await page.waitForFunction(()=>document.querySelector("[data-scripture-reader] h1")?.textContent?.includes("Alma 32"));
      } else assert.equal(await navigation.getByRole("button",{name:t("nativeReader.next"),exact:true}).count(),0);
      await web.goto(`${backend}/scripture/${f.chapters[1].id}`);
      await web.locator("[data-scripture-reader]").waitFor();
      assert.deepEqual(
        await page
          .locator("[data-native-reader] .reader-text p")
          .allTextContents(),
        await web
          .locator("[data-scripture-reader] .reader-text p")
          .allTextContents(),
        "Web en native gebruiken dezelfde verzen en nummers",
      );
      for (const [name, p] of [
        ["native", page],
        ["web", web],
      ])
        await p.screenshot({
          path: `${out}/${language}-${course.type}-${name}.png`,
          fullPage: true,
        });
    }
    if(language === "nl") {
      const long=await prisma.chapter.create({data:{bookId:f.book.id,number:71,order:71,verses:{create:Array.from({length:40},(_,i)=>({number:i+1,text:`Lang synthetisch leesvers ${i+1}. `+"Leesbare tekst voor behoud van de zichtbare leespositie. ".repeat(4)}))}}});
      await prisma.courseChapter.create({data:{courseId:free.id,chapterId:long.id,order:3}});
      const longRoute=route(free.id,"chapters",long.id);
      const posts=()=>calls.filter(c=>c.method==="POST"&&c.path.endsWith("/position")).length;
      await go(longRoute);await waitReader();await showVerse(5);await wheelAndWait(1,10000);
      await page.getByText(t("nativeReader.saved"),{exact:true}).waitFor();
      // Deze herstelproef bewaakt de werkelijk bevestigde serverstaat. De
      // compositor kan bij de voorafgaande korte wielbeweging een ander vers
      // kiezen; scrollobservatie zelf wordt hierboven afzonderlijk getest.
      const confirmedPositions=(await prisma.contentProgress.findUniqueOrThrow({where:{userId_contentKey:{userId:user.id,contentKey:"bofm/alma#71"}}})).readerPositions;
      assert.equal(Object.keys(confirmedPositions).length,1);
      assert.notEqual(Object.values(confirmedPositions)[0].verse,20,"serverbaseline verschilt aantoonbaar van de latere offline leespositie");
      // Koude reader mag al leesbaar zijn terwijl het aparte leerpad nog laadt.
      holdLearning=true;await page.reload();await waitReader();await page.waitForTimeout(100);
      assert.ok(heldLearning.length>0,"leerpad/catalogus is aantoonbaar vertraagd");
      const beforePosts=posts();
      await context.setOffline(true);await showVerse(20);await wheelAndWait(1,10000);
      await page.getByText(t("nativeReader.saveFailed"),{exact:true}).waitFor();
      const failedIntent=await page.evaluate(()=>globalThis.__positionInputs.at(-1));
      assert.equal(failedIntent.verse,20);
      const beforeTop=await page.evaluate(()=>{globalThis.__readerNode=document.querySelector("[data-scripture-reader]");return document.getElementById("vers-20").getBoundingClientRect().top;});
      const epoch=await page.evaluate(()=>globalThis.__readerRuntime.getSnapshot());
      const assertStable=async label=>{
        assert.equal(await page.locator("[data-native-reader] .reader-text").count(),40,label+": bevestigde tekst blijft zichtbaar");
        assert.ok(await page.evaluate(()=>globalThis.__readerNode===document.querySelector("[data-scripture-reader]")),label+": dezelfde React DOM-node");
        assert.ok(Math.abs(await page.locator("#vers-20").evaluate(e=>e.getBoundingClientRect().top)-beforeTop)<3,label+": zichtbaar vers blijft op dezelfde schermpositie");
        assert.equal(posts(),beforePosts,label+": geen automatische positie-POST");
      };
      readFailure=502;proxyFailure=true;
      const failedGet=page.waitForResponse(r=>r.url().includes(`/read/chapters/${long.id}/resume`)&&r.status()===502);
      await context.setOffline(false);await failedGet;await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>globalThis.__readerRuntime.getSnapshot()),epoch,"netwerkherstel wisselt geen sessie-epoch");
      const cached=await page.evaluate(({userId,collectionId,courseId,chapterId,epoch})=>{
        const identity=`${userId}:nl:${collectionId}:0:${courseId}:chapters:${chapterId}`;
        const value=globalThis.__readerRuntime.store.getSnapshot(JSON.stringify(["native",epoch,"reader",identity,true]));
        return {chapterId:value.data?.reader.chapterId,error:value.error?.code};
      },{userId:user.id,collectionId:f.collection.id,courseId:free.id,chapterId:long.id,epoch});
      assert.equal(cached.chapterId,long.id,"cache blijft intact ondanks mislukte GET");assert.equal(cached.error,"invalid_response");
      await assertStable("502 tijdens internetherstel");
      holdLearning=false;for(const finish of heldLearning.splice(0))finish();
      await page.waitForLoadState("networkidle");await assertStable("leerpad wordt alsnog geladen");
      // Een volgende, succesvolle maar vertraagde GET mag de onbewaarde lokale
      // vers20 niet terugzetten naar de laatst bevestigde serverpositie.
      readFailure=0;proxyFailure=false;holdReader=true;
      await page.evaluate(()=>window.dispatchEvent(new Event("reader:test-resume")));
      for(let i=0;i<100&&!held.length;i++)await new Promise(r=>setTimeout(r,20));
      assert.equal(held.length,1);await assertStable("GET is nog onderweg");
      for(const finish of held.splice(0))finish();await page.waitForLoadState("networkidle");await assertStable("GET met oudere serverpositie is voltooid");
      const before=await prisma.contentProgress.findUniqueOrThrow({where:{userId_contentKey:{userId:user.id,contentKey:"bofm/alma#71"}}});
      assert.deepEqual(before.readerPositions,confirmedPositions,"fout en herstel wijzigen geen enkel onderdeel van de bevestigde serverpositie");
      // Alleen de bestaande retryhandler uitvoeren; Playwright mag niet eerst
      // zelf naar de knop onderaan het lange hoofdstuk scrollen.
      await page.locator("[data-reader-save-status] button").evaluate(button=>button.click());
      await page.getByText(t("nativeReader.saved"),{exact:true}).waitFor();
      assert.equal(posts(),beforePosts+1);assert.deepEqual(await page.evaluate(()=>globalThis.__positionInputs.at(-1)),failedIntent,"retry behoudt UUID, verwachte versie en vers");
      assert.ok(await page.evaluate(()=>globalThis.__readerNode===document.querySelector("[data-scripture-reader]")));
      assert.ok(Math.abs(await page.locator("#vers-20").evaluate(e=>e.getBoundingClientRect().top)-beforeTop)<3,"schrijfretry reset geen scroll");
      await page.reload();await waitReader();
      await page.waitForFunction(()=>document.getElementById("vers-20")?.classList.contains("ring-2"));
      assert.equal(posts(),beforePosts+1,"heropenen schrijft niets");
      // Een echte expliciete weigering van het leerpad moet eigen readercache
      // blokkeren, ook wanneer die read-only reader-GET zelf nog succesvol is.
      learningFailure=403;
      await page.evaluate(()=>window.dispatchEvent(new Event("reader:test-resume")));
      await page.waitForFunction(()=>!document.querySelector("[data-native-reader] .reader-text"));
      assert.equal(await page.locator("[data-native-reader] .reader-text").count(),0);
      learningFailure=0;
      await page.locator("[data-native-reader-unavailable]").getByRole("button",{name:t("nativeFoundation.retry"),exact:true}).click();await waitReader();
      // Echte backendrechten wijzigen, niet alleen een gemockte HTTP-code.
      try {
        await prisma.contentCollection.update({where:{id:f.collection.id},data:{visibleToUsers:false}});
        await page.evaluate(()=>window.dispatchEvent(new Event("reader:test-resume")));
        await page.waitForFunction(()=>!document.querySelector("[data-native-reader] .reader-text"));
        assert.equal(await page.locator("[data-native-reader] .reader-text").count(),0,"ingetrokken collectierechten verbergen oude tekst");
      }finally{await prisma.contentCollection.update({where:{id:f.collection.id},data:{visibleToUsers:true}});}
      // Deze afzonderlijke heropenproef begint pas na de lopende bootstrap/
      // refresh en HTTP-geëmuleerde Keychain-opslag van reader:test-resume.
      // Alleen verdwenen tekst bewijst de weigering, niet voltooid sessieherstel.
      await page.waitForLoadState("networkidle");
      await page.reload();await waitReader();
    }
    // Werkelijke padlink en terugnavigatie: de React-padpresentatie blijft gemount, geen tweede UI-cache.
    const pathUrl = `/courses/${free.id}/pad`;
    await go(pathUrl);
    await page.locator("[data-chapter-path]").waitFor();
    const chapterLink = page.locator(
      `a[href="#${route(free.id, "chapters", extraChapter.id)}"]`,
    );
    if (!(await chapterLink.isVisible()))
      await page
        .locator("[data-chapter-path] button[aria-expanded]")
        .filter({ hasText: "Mosiah" })
        .click();
    await chapterLink.waitFor({ state: "visible" });
    const expanded = await page
      .locator('[data-chapter-path] button[aria-expanded="true"]')
      .count();
    await chapterLink.click();
    await waitReader();
    await page.waitForFunction(() =>
      document.activeElement?.closest("[data-native-reader]"),
    );
    if (language === "nl") await page.clock.fastForward(6 * 60 * 1000);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("reader:test-back")),
    );
    await page.locator("[data-chapter-path]:visible").waitFor();
    assert.equal(
      await page
        .locator('[data-chapter-path] button[aria-expanded="true"]')
        .count(),
      expanded,
    );
    // De bestaande gedeelde annotatiedialoog op alle drie routes en vijf talen.
    const sheet=()=>page.locator("[data-annotation-dialog]");
    const openMenu=async(number=1)=>{
      await page.getByRole("button",{name:t("annotations.verseActions",{number}),exact:true}).click();
      await sheet().locator("textarea:not([disabled])").waitFor();
      assert.equal(await sheet().locator("[data-annotation-read-aloud]").count(),0,"audio blijft B3b-2c");
    };
    const closeMenu=async()=>{await sheet().getByRole("button",{name:t("annotations.close"),exact:true}).click();await sheet().waitFor({state:"detached"});};
    const saveNote=async()=>{await sheet().getByRole("button",{name:t("annotations.save"),exact:true}).click();await sheet().getByText(`${t("annotations.note")}: ${t("annotations.saved")}`,{exact:true}).waitFor();};
    for(const [index,course]of f.courses.entries()){
      const href=route(course.id,course.type==="READING_LESSONS"?"steps":"chapters",course.type==="READING_LESSONS"?f.steps.lessons[1].id:f.chapters[1].id);
      await go(href);await waitReader();await openMenu();
      await sheet().getByRole("button",{name:t("annotations.bookmarkAdd"),exact:true}).click();
      await sheet().getByRole("button",{name:t("annotations.bookmarkRemove"),exact:true}).waitFor();
      const colors=index===0?["yellow","green","blue","pink","purple"]:["purple"];
      for(const color of colors){await sheet().getByRole("button",{name:t(`annotations.${color}`),exact:true}).click();await sheet().locator('button[aria-pressed="true"]').filter({hasText:t(`annotations.${color}`)}).waitFor();assert.equal(await sheet().getByRole("button",{name:t(`annotations.${color}`),exact:true}).getAttribute("aria-pressed"),"true");}
      const note=`${language}/${course.type} — volledige privénotitie 😀 `+"x".repeat(80);
      await sheet().locator("textarea").fill(note);
      const positions=calls.filter(c=>c.method==="POST"&&c.path.endsWith("/position")).length;
      if(language==="nl"){await sheet().locator("textarea").press("Space");await page.clock.runFor(11000);assert.equal(calls.filter(c=>c.method==="POST"&&c.path.endsWith("/position")).length,positions,"notitietekst/toetsenbord is geen leesinteractie");}
      const stored=await sheet().locator("textarea").inputValue();await saveNote();await closeMenu();
      assert.equal(await page.locator("#vers-1").getAttribute("data-annotation-color"),"purple");
      await web.goto(`${backend}/lesson/${f.chapters[1].id}`);await web.locator("[data-scripture-reader]").waitFor();
      await web.getByRole("button",{name:t("annotations.verseActions",{number:1}),exact:true}).click();
      const webSheet=web.locator("[data-annotation-dialog]");await webSheet.locator("textarea:not([disabled])").waitFor();
      assert.equal(await webSheet.locator("textarea").inputValue(),stored.trim());
      assert.equal(await webSheet.getByRole("button",{name:t("annotations.purple"),exact:true}).getAttribute("aria-pressed"),"true");
      assert.equal(await webSheet.getByRole("button",{name:t("annotations.bookmarkRemove"),exact:true}).count(),1);
      await openMenu();
      await page.screenshot({path:`${out}/${language}-${course.type}-annotations-native.png`,fullPage:true});
      await closeMenu();
      await web.screenshot({path:`${out}/${language}-${course.type}-annotations-web.png`,fullPage:true});
      await webSheet.locator("textarea").fill(stored.trim()+" — WEB");await webSheet.getByRole("button",{name:t("annotations.save"),exact:true}).click();
      await webSheet.getByText(`${t("annotations.note")}: ${t("annotations.saved")}`,{exact:true}).waitFor();
      await webSheet.getByRole("button",{name:t("annotations.close"),exact:true}).click();
      await page.evaluate(()=>window.dispatchEvent(new Event("reader:test-resume")));await openMenu();
      assert.equal(await sheet().locator("textarea").inputValue(),stored.trim()+" — WEB");
      await sheet().getByRole("button",{name:t("annotations.noteRemove"),exact:true}).click();await sheet().getByRole("button",{name:t("annotations.noteRemove"),exact:true}).waitFor({state:"detached"});
      await sheet().getByRole("button",{name:t("annotations.highlightRemove"),exact:true}).click();await sheet().getByRole("button",{name:t("annotations.highlightRemove"),exact:true}).waitFor({state:"detached"});
      await sheet().getByRole("button",{name:t("annotations.bookmarkRemove"),exact:true}).click();await sheet().getByRole("button",{name:t("annotations.bookmarkAdd"),exact:true}).waitFor();await closeMenu();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    }
    if(language==="nl"){
      await go(stepRoute);await waitReader();await openMenu(2);
      await sheet().locator("textarea").fill("Onzekere notitie na verloren respons");loseAnnotation=true;
      await sheet().getByRole("button",{name:t("annotations.save"),exact:true}).click();
      await sheet().getByText(t("annotations.failed"),{exact:true}).waitFor().catch(async error=>{
        console.error("Onzekere annotatie",{view:await page.evaluate(()=>({sheet:document.querySelector("[data-annotation-dialog]")?.textContent,reader:document.querySelector("[data-native-reader-unavailable]")?.textContent})),calls:calls.slice(-8).map(({path,method,status,body})=>({path,method,status,actionId:body?.action?.actionId}))});
        await page.screenshot({path:`${out}/uncertain-annotation-failure.png`,fullPage:true});throw error;
      });
      const writes=()=>calls.filter(c=>c.body&&c.path.endsWith("/annotations"));
      const count=writes().length,last=writes().at(-1).body;
      await page.evaluate(()=>window.dispatchEvent(new Event("reader:test-resume")));await page.waitForLoadState("networkidle");
      assert.equal(writes().length,count,"geen automatische annotatie-POST na resume");
      await sheet().getByRole("button",{name:t("annotations.retry"),exact:true}).click();
      await sheet().getByText(`${t("annotations.note")}: ${t("annotations.saved")}`,{exact:true}).waitFor();
      assert.equal(writes().length,count+1);assert.deepEqual(writes().at(-1).body,last,"handmatige retry bewaart actionId, expectedVersion en operatie");
      // Reviewregressie: een eerder geblokkeerde deep link vervalt na opslaan.
      await sheet().locator("textarea").fill("Concept een");await go("/courses");await sheet().getByText(t("annotations.unsaved"),{exact:true}).waitFor();
      await saveNote();await sheet().getByText(t("annotations.unsaved"),{exact:true}).waitFor({state:"detached"});
      await sheet().locator("textarea").fill("Concept twee");await sheet().getByRole("button",{name:t("annotations.close"),exact:true}).click();
      await sheet().getByRole("button",{name:t("annotations.discard"),exact:true}).click();await sheet().waitFor({state:"detached"});
      assert.equal(new URL(page.url()).hash,"#"+stepRoute,"oude navigatie wordt niet alsnog uitgevoerd");
      await openMenu(2);assert.equal(await sheet().locator("textarea").inputValue(),"Concept een");
      await sheet().locator("textarea").fill("Bewust niet bewaren");await go("/courses");await sheet().getByRole("button",{name:t("annotations.discard"),exact:true}).click();
      await page.waitForFunction(()=>location.hash==="#/courses");
      assert.equal(new URL(page.url()).hash,"#/courses");
    }
    if (language === "nl") {
      // De nieuwe conceptnavigatieproef eindigt bewust op /courses. Herstel
      // de eigen beginsituatie van de bestaande reader-herstelregressies.
      await go(pathUrl);await page.locator("[data-chapter-path]").waitFor();
      if(!(await chapterLink.isVisible()))await page.locator("[data-chapter-path] button[aria-expanded]").filter({hasText:"Mosiah"}).click();
      await chapterLink.click();
      await waitReader();
      readFailure = 503;
      await page.evaluate(() =>
        window.dispatchEvent(new Event("reader:test-resume")),
      );
      await page
        .getByText(t("nativeLearning.refreshFailed"), { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("[data-native-reader] .reader-text").count(),
        3,
        "Tijdelijke GET-fout wist geen geladen tekst",
      );
      readFailure = 0;
      await page.reload();
      await waitReader();
      assert.match(new URL(page.url()).hash, /\/read\/chapters\//);
      await context.setOffline(true);
      await page.evaluate(() =>
        window.dispatchEvent(new Event("reader:test-resume")),
      );
      assert.equal(
        await page.locator("[data-native-reader] .reader-text").count(),
        3,
      );
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await waitReader();
      // Stop de oude document-/storegeneratie vóór de capabilitygrens.
      // Een geldige achtergrond-GET uit die generatie mag niet worden geteld
      // als aanvraag van de hierna koud gestarte oude backend.
      const readerUrl=page.url();await page.goto("about:blank");await page.waitForLoadState("networkidle");
      noAnnotationsBackend=true;
      const annCalls=calls.filter(c=>c.path.includes("/annotations")).length;
      await page.goto(readerUrl);await waitReader();
      await page.getByText(t("nativeLearningFlow.ready"),{exact:true}).waitFor();
      assert.equal(await page.locator("[data-native-reader] [data-annotation-trigger]").count(),0);
      assert.equal(calls.filter(c=>c.path.includes("/annotations")).length,annCalls,"oude backend krijgt geen annotatieverzoeken");
      noAnnotationsBackend=false;await page.reload();await waitReader();
      oldBackend = true;
      const before = calls.filter((c) => /\/read\//.test(c.path)).length;
      await page.reload();
      await page
        .getByText(t("nativeReader.unsupported"), { exact: true })
        .waitFor();
      assert.equal(
        calls.filter((c) => /\/read\//.test(c.path)).length,
        before,
        "Geen nieuwe GET zonder capability",
      );
      oldBackend = false;
      await page.reload();
      await waitReader();
      readFailure = 403;
      await page.evaluate(() =>
        window.dispatchEvent(new Event("reader:test-resume")),
      );
      await page
        .getByText(t("nativeLearning.pathUnavailable"), { exact: true })
        .first()
        .waitFor();
      assert.equal(
        await page.locator("[data-native-reader] .reader-text").count(),
        0,
        "Ingetrokken toegang behoudt geen oude tekst",
      );
      readFailure = 0;
      // Een daadwerkelijk ontvangen A-antwoord blijft achter de netwerkgrens tot B is ingelogd.
      await page.reload();
      await waitReader();
      await page.waitForLoadState("networkidle");
      const b = await seedNativeCourses("nl"),
        other = await b.account("nl");
      fixtures.push(b);
      await prisma.verse.updateMany({
        where: { chapterId: b.chapters[1].id },
        data: { text: "Uitsluitend account B: synthetische passage." },
      });
      const oldVerse=await prisma.verse.findFirstOrThrow({where:{chapterId:extraChapter.id,number:1}});
      // Gebruik hetzelfde annotatiecontract als de webroute, inclusief targetKey,
      // versie en tombstonebehandeling; een kale legacy-rij is geen readerannotatie.
      await legacyVerseAnnotation(user,"note",oldVerse.id,"PRIVE ACCOUNT A ANNOTATIE");
      holdReader = true;holdAnnotations=true;
      await page.evaluate(() =>
        window.dispatchEvent(new Event("reader:test-resume")),
      );
      for (let i = 0; i < 100 && held.length === 0; i++)
        await new Promise((r) => setTimeout(r, 20));
      assert.equal(held.length, 1);
      for(let i=0;i<100&&!heldAnnotations.length;i++)await new Promise(r=>setTimeout(r,20));
      assert.equal(heldAnnotations.length,1);assert.ok(calls.some(c=>c.privateMarker),"vertraagd A-antwoord bevat werkelijk diens privénotitie");
      await go("/profile");
      await logoutNativeProfile(page,t);
      await page.locator("form").waitFor();
      await page.getByLabel(t("nativeFoundation.email")).fill(other.email);
      await page
        .getByLabel(t("nativeFoundation.password"), { exact: true })
        .fill(b.password);
      await page
        .getByRole("button", { name: t("nativeFoundation.login"), exact: true })
        .click();
      await page.locator("[data-today-overview]").waitFor();
      await go(
        route(
          b.courses.find((c) => c.type === "FREE_CHOICE").id,
          "chapters",
          b.chapters[1].id,
        ),
      );
      await waitReader();
      for (const finish of [...held.splice(0),...heldAnnotations.splice(0)]) finish();
      await page.waitForLoadState("networkidle");
      assert.ok(
        (await page.locator("[data-native-reader]").innerText()).includes(
          "Uitsluitend account B",
        ),
      );
      assert.equal(
        await page
          .getByText("Synthetische extra passage 1.", { exact: false })
          .count(),
        0,
        "Laat A-antwoord komt niet bij B in de reader",
      );
      assert.equal(await page.getByText("PRIVE ACCOUNT A ANNOTATIE",{exact:false}).count(),0);
      await openMenu();assert.equal(await sheet().locator("textarea").inputValue(),"");await closeMenu();
    }
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).xpTotal,
      0,
    );
    assert.equal(
      await prisma.userCourseLessonProgress.count({
        where: { userId: user.id },
      }),
      0,
    );
    assert.equal(
      await prisma.streakDay.count({ where: { userId: user.id } }),
      0,
    );
    assert.deepEqual(errors, []);
    results.push({
      language,
      width,
      scheme,
      textPercent: scale,
      exactStepVerses: true,
      threePaths: true,
      sharedWebReader: true,
      sharedAnnotationsThreePaths:true,
      webNativeAnnotationCrud:true,
      uncertainAnnotationRetry:language==="nl"?"PASS":"NOT TESTED",
      staleDraftNavigationCleared:language==="nl"?"PASS":"NOT TESTED",
      lateAnnotationAccountIsolation:language==="nl"?"PASS":"NOT TESTED",
      selectableText: true,
      capabilityFallback: language === "nl" ? "PASS" : "NOT TESTED",
      delayedAccountResponse: language === "nl" ? "PASS" : "NOT TESTED",
      sixMinuteGroupRetention: language === "nl" ? "PASS" : "NOT TESTED",
      durablePosition: language === "nl" ? "PASS" : "SQL TESTED",
      offlineManualRetry: language === "nl" ? "PASS" : "NOT TESTED",
      concurrentPositionConflict: language === "nl" ? "PASS" : "NOT TESTED",
      networkRecoverySameDOMAndViewport: language === "nl" ? "PASS" : "NOT TESTED",
      manualRetrySameActionAndVersion: language === "nl" ? "PASS" : "NOT TESTED",
      parentAuthorizationBlocksCache: language === "nl" ? "PASS" : "NOT TESTED",
      realCollectionWithdrawalHidesCache: language === "nl" ? "PASS" : "NOT TESTED",
      chapterNavigation: true,
      noCompletion: true,
    });
    await context.close();
  }
  assert.equal(
    calls.some(
      (c) => c.method !== "GET" && !c.path.endsWith("/position") && !c.path.endsWith("/annotations") && /\/read\/|\/complete$|exercise/.test(c.path),
    ),
    false,
    "Er worden geen leesafrondingen of oefensessies aangeroepen",
  );
  writeFileSync(`${out}/resultaten.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  for (const finish of [...held,...heldLearning,...heldAnnotations]) finish();
  await browser.close();
  front.closeAllConnections?.();
  await new Promise((resolve) => front.close(resolve));
  for (const f of fixtures)
    await prisma.contentCollection.update({
      where: { id: f.collection.id },
      data: { enabled: false },
    });
  await prisma.$disconnect();
}
