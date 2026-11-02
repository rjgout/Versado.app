import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nativeReaderSchema } from "../src/lib/native/readerContract";
import {
  nativeReaderDestination,
  nativeReaderRoute,
} from "../src/lib/native/readerNavigation";
import { nativeRoute, nativeDeepLink } from "../src/lib/native/navigation";
import { accessRouteAllowed } from "../src/lib/native/access";
import {
  NativeDataRuntime,
  nativeContentQueryKey,
} from "../src/lib/data/native";
import {
  NativeClientError,
  NativeSessionClient,
} from "../src/lib/native/client";
import type { LiveEnvironment } from "../src/lib/data/store";
const value = {
  version: 1,
  userId: "A",
  activeCollectionId: "bom",
  selectionVersion: 0,
  language: "nl",
  courseId: "c",
  kind: "steps",
  targetId: "s",
  chapterId: "ch",
  collectionName: "Boek van Mormon",
  bookName: "Alma",
  chapterNumber: 32,
  sourceLanguage: "nl",
  startVerse: 3,
  endVerse: 4,
  focusVerse: 3,
  verses: [
    { id: "v3", number: 3, text: "Drie" },
    { id: "v4", number: 4, text: "Vier" },
  ],
};
const accountA = {id:"A",handle:"Synthetisch",uiLanguage:"nl",onboardingRequired:false,appleLinked:false,passwordLoginEnabled:true};
const environment: LiveEnvironment = {
  now: () => 0,
  random: () => 0,
  isOnline: () => true,
  isVisible: () => true,
  schedule: () => () => {},
};
function runtime(api: () => Promise<unknown>) {
  return new NativeDataRuntime(
    { api } as unknown as NativeSessionClient,
    environment,
  );
}
test("exacte contextdragende padlinks, query-/methodegrenzen en lokale deep links", () => {
  assert.equal(
    nativeReaderDestination("/reading-lesson/s", "c"),
    "/courses/c/read/steps/s",
  );
  assert.equal(
    nativeReaderDestination("/lesson/ch?cursus=c", "c"),
    "/courses/c/read/chapters/ch",
  );
  for (const path of [
    "/lesson/ch",
    "/lesson/ch?cursus=other",
    "/lesson/ch?cursus=c&extra=1",
    "/reading-lesson/s?x=1",
    "/reading-lesson/%2f",
    "https://other.invalid/reading-lesson/s",
  ])
    assert.equal(nativeReaderDestination(path, "c"), null);
  for (const kind of ["steps", "chapters"]) {
    const path = `courses/c/read/${kind}/s`;
    assert.equal(accessRouteAllowed(path, "GET"), true);
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD"])
      assert.equal(accessRouteAllowed(path, method), false);
    assert.ok(nativeReaderRoute(`/${path}`));
    assert.equal(nativeRoute(`/${path}`), `/${path}`);
    assert.equal(
      nativeDeepLink(
        `https://dev.versado.app/${path}`,
        "https://dev.versado.app",
      ),
      `/${path}`,
    );
    for (const suffix of ["/", "?x=1", "/complete", "%2f", "/../me"])
      assert.equal(accessRouteAllowed(path + suffix, "GET"), false);
  }
});
test("contract weigert ontbrekende, dubbele, verkeerde of te grote verzen en verboden extra velden", () => {
  assert.equal(nativeReaderSchema.safeParse(value).success, true);
  for (const input of [
    { ...value, verses: [] },
    { ...value, verses: [value.verses[0], value.verses[0]] },
    { ...value, endVerse: 501 },
    {
      ...value,
      verses: [
        { ...value.verses[0], text: "x".repeat(20001) },
        value.verses[1],
      ],
    },
    { ...value, focusVerse: 2 },
    { ...value, xp: 5 },
  ])
    assert.equal(nativeReaderSchema.safeParse(input).success, false);
  const big = {
    ...value,
    kind: "chapters",
    startVerse: 1,
    endVerse: 40,
    focusVerse: 1,
    verses: Array.from({ length: 40 }, (_, i) => ({
      id: `v${i}`,
      number: i + 1,
      text: "x".repeat(19000),
    })),
  };
  assert.equal(nativeReaderSchema.safeParse(big).success, false);
});
test("late antwoorden worden verworpen na logout, account-, taal-, bron- of selectieversiewissel (ook ABA)", async () => {
  for (const mode of ["logout", "account", "language", "source", "ABA"]) {
    let finish!: (v: unknown) => void;
    const r = runtime(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const observer = r.store.observe(
      ["native", 0, ...nativeContentQueryKey("A")],
      {
        scopes: ["content"],
        staleTime: Infinity,
        initialData: {
          picker: { activeCollectionId: "bom", selectionVersion: 0 },
        },
        fetcher: async () => ({
          picker: { activeCollectionId: "bom", selectionVersion: 0 },
        }),
      },
    );
    const pending = r.reader(
      "A",
      "nl",
      { activeCollectionId: "bom", selectionVersion: 0 },
      "c",
      "steps",
      "s",
    );
    await Promise.resolve();
    if (mode === "logout") r.reset();
    if (mode === "source" || mode === "ABA")
      r.store.setData(["native", 0, ...nativeContentQueryKey("A")], {
        picker: {
          activeCollectionId: mode === "source" ? "other" : "bom",
          selectionVersion: 2,
        },
      });
    finish({
      ...value,
      ...(mode === "account" ? { userId: "B" } : {}),
      ...(mode === "language" ? { language: "en" } : {}),
    });
    await assert.rejects(
      pending,
      (e) => e instanceof NativeClientError && e.status === 409,
      mode,
    );
    observer.release();
    r.reset();
  }
});
test("native gebruikt werkelijk dezelfde React-presentatie en bevat geen hoofdstukafronding", () => {
  for (const file of [
    "src/components/LessonFlow.tsx",
    "src/components/native/NativeReaderView.tsx",
  ])
    assert.match(readFileSync(file, "utf8"), /<ScriptureReaderView\b/);
  const native =
    readFileSync("src/components/native/NativeFoundation.tsx", "utf8") +
    readFileSync("src/components/native/NativeReaderView.tsx", "utf8");
  assert.doesNotMatch(
    native,
    /chapters\/.*complete|markCourseStarted|issueExerciseSession|completeChapterReading/,
  );
  const shared = readFileSync(
    "src/components/reading/ScriptureReaderView.tsx",
    "utf8",
  );
  assert.doesNotMatch(
    shared,
    /next\/|fetch\(|annotations\/|prisma|ReadAloudPlayer/,
  );
});

test("hervatcoördinaten: CAS, teruglezen en replay wijzigen nooit een nieuwere positie", async () => {
  const { claimReaderPosition, readerPositionKey } = await import("../src/lib/learning/readerPosition");
  const input={verse:4,actionId:"00000000-0000-4000-8000-000000000001",expectedVersion:0,selectionVersion:1};
  const first=claimReaderPosition(null,input)!;
  assert.equal(first.version,1);
  assert.deepEqual(claimReaderPosition(first,input),first);
  assert.equal(claimReaderPosition(first,{...input,verse:3}),null,"zelfde actie met andere inhoud geweigerd");
  const backwards=claimReaderPosition(first,{...input,verse:3,expectedVersion:1,actionId:"00000000-0000-4000-8000-000000000002"})!;
  assert.equal(backwards.verse,3,"teruglezen is een geldige positie, geen voortgangsreset");
  assert.equal(claimReaderPosition(backwards,input),null,"vertraagde oude actie overschrijft niets");
  const scope={activeCollectionId:"c",sourceLanguage:"nl",courseId:"course",kind:"steps",targetId:"s",chapterId:"ch"};
  for(const key of Object.keys(scope))assert.notEqual(readerPositionKey(scope),readerPositionKey({...scope,[key]:"anders"}));
});
test("resume/position hebben uitsluitend exacte methodes en paden in alle drie Access-lagen",()=>{
  const root="courses/c/read/steps/s";
  assert.ok(accessRouteAllowed(root+"/resume","GET"));
  assert.ok(accessRouteAllowed(root+"/position","POST"));
  for(const [path,method]of [[root+"/resume","POST"],[root+"/position","GET"],[root+"/position?x=1","POST"],[root+"/resume/","GET"],[root+"/complete","POST"],[root+"/position/extra","POST"],[root+"/resume\n","GET"],[root+"/position\n","POST"]])assert.equal(accessRouteAllowed(path,method),false);
  for(const name of ["ios/App/App/NativeAccessTransport.swift","android/app/src/main/java/app/versado/app/NativeAccessTransport.java"]){
    const source=readFileSync(name,"utf8");
    assert.ok(source.includes("/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/resume"));
    assert.ok(source.includes("/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/position"));
  }
});
test("een laat bevestigd positieantwoord na accountwissel wordt verworpen zonder cache van B te wijzigen",async()=>{
  const {readerResumeSchema}=await import("../src/lib/native/readerPositionContract");
  const state=readerResumeSchema.parse({reader:value,positionVersion:0,previous:null,next:null});
  let finish!:(result:unknown)=>void,posts=0;
  const client={api:async()=>accountA,actionOnce:()=>{posts++;return new Promise(resolve=>{finish=resolve;});}} as unknown as NativeSessionClient;
  const data=new NativeDataRuntime(client,environment);
  const input={chapterId:"ch",startVerse:3,endVerse:4,activeCollectionId:"bom",selectionVersion:0,language:"nl" as const,verse:4,expectedVersion:0,actionId:"00000000-0000-4000-8000-000000000001"};
  const write=data.readerPositionWriter(state,["reader","A"])(input);
  await new Promise(resolve=>setImmediate(resolve));
  data.reset();
  finish({activeCollectionId:"bom",selectionVersion:0,language:"nl",verse:4,actionId:input.actionId,userId:"A",courseId:"c",kind:"steps",targetId:"s",version:1});
  await assert.rejects(write,(error:unknown)=>error instanceof NativeClientError && error.code==="session_changed");
  assert.equal(posts,1);
});

for(const outcome of ["old-get","failed-get"] as const)test(`bevestigde positie blijft zichtbaar na ${outcome}; geen schrijfretry of brede progress-invalidatie`,async()=>{
  const {readerResumeSchema}=await import("../src/lib/native/readerPositionContract");
  const state=readerResumeSchema.parse({reader:value,positionVersion:0,previous:null,next:null});
  const input={chapterId:"ch",startVerse:3,endVerse:4,activeCollectionId:"bom",selectionVersion:0,language:"nl" as const,verse:4,expectedVersion:0,actionId:"00000000-0000-4000-8000-000000000003"};
  let writes=0,invalidations=0,finish!:(v:typeof state)=>void,fail!:(error:Error)=>void;
  const client={api:async()=>accountA,actionOnce:async()=>{writes++;return {userId:"A",activeCollectionId:"bom",selectionVersion:0,language:"nl",courseId:"c",kind:"steps",targetId:"s",actionId:input.actionId,version:1,verse:4};}} as unknown as NativeSessionClient;
  const runtime=new NativeDataRuntime(client,environment),key=["reader","A"],storeKey=["native",0,...key];
  const observer=runtime.store.observe(storeKey,{scopes:["progress"],fetcher:()=>new Promise<typeof state>((resolve,reject)=>{finish=resolve;fail=reject;})});
  runtime.store.setData(storeKey,state);
  runtime.store.invalidate=()=>{invalidations++;};
  await runtime.readerPositionWriter(state,key)(input);
  if(outcome==="old-get")finish(state);else fail(new NativeClientError("network_unavailable"));
  await new Promise(resolve=>setImmediate(resolve));
  const confirmed=runtime.store.getSnapshot<typeof state>(observer.entryKey).data!;
  assert.equal(confirmed.positionVersion,1);assert.equal(confirmed.reader.focusVerse,4);
  assert.equal(writes,1);assert.equal(invalidations,0);
  observer.release();runtime.reset();
});
test("een oude writer-port kan na accountwisseling zelfs geen POST starten",async()=>{
  const {readerResumeSchema}=await import("../src/lib/native/readerPositionContract");
  let calls=0;const client={api:async()=>accountA,actionOnce:async()=>{calls++;}} as unknown as NativeSessionClient;
  const data=new NativeDataRuntime(client,environment),state=readerResumeSchema.parse({reader:value,positionVersion:0,previous:null,next:null});
  const writer=data.readerPositionWriter(state,["reader","A"]);data.reset();
  await assert.rejects(writer({chapterId:"ch",startVerse:3,endVerse:4,activeCollectionId:"bom",selectionVersion:0,language:"nl",verse:4,expectedVersion:0,actionId:"00000000-0000-4000-8000-000000000003"}),/session_changed/);
  assert.equal(calls,0);
});

for(const rejectWrite of [false,true])test(`kort access-token herstellen via GET vóór exact één cursor-POST (${rejectWrite?"ingetrokken tijdens schrijven":"bevestigd"})`,async()=>{
  const {readerResumeSchema}=await import("../src/lib/native/readerPositionContract");
  const state=readerResumeSchema.parse({reader:value,positionVersion:0,previous:null,next:null});
  const input={chapterId:"ch",startVerse:3,endVerse:4,activeCollectionId:"bom",selectionVersion:0,language:"nl" as const,verse:4,expectedVersion:0,actionId:"00000000-0000-4000-8000-000000000005"};
  let saved:string|null=null;
  const calls:Array<{path:string;method:string;authorization:string|null}>=[];
  const client=new NativeSessionClient("https://native.example.invalid",{read:async()=>saved,write:async v=>{saved=v;},clear:async()=>{saved=null;}},async(url,init)=>{
    const path=new URL(String(url)).pathname.split("/native/")[1],authorization=new Headers(init?.headers).get("Authorization");
    calls.push({path,method:init?.method??"GET",authorization});
    if(path==="login")return Response.json({accessToken:"expired",refreshToken:"initial-refresh",expiresIn:300});
    if(path==="refresh")return Response.json({accessToken:"fresh",refreshToken:"next-refresh",expiresIn:300});
    if(path==="me")return authorization==="Bearer expired"?Response.json({error:"session_expired"},{status:401}):Response.json(accountA);
    assert.equal(path,"courses/c/read/steps/s/position");
    assert.equal(authorization,"Bearer fresh");
    return rejectWrite?Response.json({error:"session_expired"},{status:401}):Response.json({userId:"A",activeCollectionId:"bom",selectionVersion:0,language:"nl",courseId:"c",kind:"steps",targetId:"s",actionId:input.actionId,version:1,verse:4});
  });
  await client.login("synthetic@example.invalid","password");
  const runtime=new NativeDataRuntime(client,environment),write=runtime.readerPositionWriter(state,["reader","A"])(input);
  if(rejectWrite)await assert.rejects(write,/session_expired/);else assert.equal((await write).version,1);
  assert.deepEqual(calls.map(c=>c.path),["login","me","refresh","me","courses/c/read/steps/s/position"]);
  assert.equal(calls.filter(c=>c.path.endsWith("/position")).length,1,"de mutatie wordt nooit automatisch herhaald");
});

for(const mode of ["account-switch","wrong-actor"] as const)test(`late me-controle vóór positieopslag: ${mode} verstuurt geen POST`,async()=>{
  const {readerResumeSchema}=await import("../src/lib/native/readerPositionContract");
  let finish!:(value:unknown)=>void,posts=0;
  const client={api:()=>new Promise(resolve=>{finish=resolve;}),actionOnce:async()=>{posts++;}} as unknown as NativeSessionClient;
  const data=new NativeDataRuntime(client,environment),state=readerResumeSchema.parse({reader:value,positionVersion:0,previous:null,next:null});
  const pending=data.readerPositionWriter(state,["reader","A"])({chapterId:"ch",startVerse:3,endVerse:4,activeCollectionId:"bom",selectionVersion:0,language:"nl",verse:4,expectedVersion:0,actionId:"00000000-0000-4000-8000-000000000006"});
  if(mode==="account-switch")data.reset();
  finish({...accountA,id:mode==="wrong-actor"?"B":"A"});
  await assert.rejects(pending,(error:unknown)=>error instanceof NativeClientError&&error.code==="session_changed");
  assert.equal(posts,0);
});
