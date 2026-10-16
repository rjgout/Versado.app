import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { mysteryFixture, mysteryAccount } from "./fixtures/mystery";
import { MYSTERY_GAME } from "../src/lib/mysteries/game";
import { actOnMystery, getMysteryAttempt } from "../src/lib/mysteries/attempts";
import { emptyClueNotes, type MysteryAction, type MysteryAttemptView } from "../src/lib/mysteries/attemptContract";
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
const base = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || base.hostname !== "127.0.0.1" || process.env.DATABASE_URL !== database.href) throw new Error("Eigen runner vereist");
before(mysteryFixture); after(async () => { await prisma.$disconnect(); });
const d = MYSTERY_GAME.puzzles[0];
async function post(account: Awaited<ReturnType<typeof mysteryAccount>> | null, body: unknown, origin: string | null = base.origin, endpoint = "/api/mysteries/attempts") {
  return fetch(new URL(endpoint, base), { method: "POST", headers: { ...(account ? { Cookie: account.cookie } : {}), ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function begin(userId: string, variant = "001a") { return (await actOnMystery(userId, { action: "start", variant, actionId: randomUUID() })).attempt; }
function action(attempt: MysteryAttemptView, kind: "hint" | "complete", id = randomUUID()): MysteryAction { return { action: kind, attemptId: attempt.id, expectedRevision: attempt.revision, actionId: id }; }
async function save(userId: string, a: MysteryAttemptView, placements = {}, clueNotes = {}) { return (await actOnMystery(userId,{action:"save",attemptId:a.id,expectedRevision:a.revision,actionId:randomUUID(),placements,clueNotes})).attempt; }
const money = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: { hintBalance:true,xpTotal:true,currentStreak:true,activeCourseId:true,geneesBalance:true } });

test("GET blijft zonder bijeffecten; 401, CSRF, strikte payload en oude client zonder poging",async()=>{
 const u=await mysteryAccount(); assert.equal(await prisma.mysteryAttempt.count({where:{userId:u.id}}),0);
 assert.equal((await fetch(new URL('/api/mysteries/attempts?variant=001a',base))).status,401);
 const get=await fetch(new URL('/api/mysteries/attempts?variant=001a',base),{headers:{Cookie:u.cookie}}); assert.equal(get.status,200); assert.equal((await get.json()).attempt,null);
 assert.equal(await prisma.mysteryAttempt.count({where:{userId:u.id}}),0);
 for(const origin of [null,'https://evil.invalid'])assert.equal((await post(u,{action:'start',variant:'001a',actionId:randomUUID()},origin)).status,403);
 assert.equal((await post(u,{action:'start',variant:'001a',actionId:randomUUID(),userId:'other'})).status,400);
 assert.equal((await post(u,{action:'complete',placements:d.solution,hintCount:0},base.origin,'/api/mysteries/001a/progress')).status,409);
 assert.equal(await prisma.mysteryProgress.count({where:{userId:u.id}}),0);
});
test("alle 18 varianten starten en hervatten met exacte bron, drie plaatsingen, aantekeningen en eigen versie",async()=>{
 const u=await mysteryAccount('content_bom_en',false,true);
 for(const definition of MYSTERY_GAME.puzzles){
  const a=await begin(u.id,definition.routeId); const placements=Object.fromEntries(Object.entries(definition.solution).slice(0,3));
  const notes=emptyClueNotes(definition);notes[Object.keys(notes)[0]]=true;const saved=await save(u.id,a,placements,notes);
  const restored=await getMysteryAttempt(u.id,definition);assert.deepEqual(restored,saved); assert.equal(saved.revision,1);
  assert.equal((await prisma.mysteryAttempt.findUniqueOrThrow({where:{id:a.id}})).contentCollectionId,'content_bom_en');
  const chapter=await prisma.chapter.findUniqueOrThrow({where:{id:saved.readerHref!.split('/').at(-1)},include:{book:true}}); assert.equal(chapter.book.contentCollectionId,'content_bom_en');
 }
});
test("bron/taal/setting/scope-wissel verandert bestaande poging niet en geeft geen voortgang of economie",async()=>{
 const u=await mysteryAccount(); let a=await begin(u.id);const before=await money(u.id);a=await save(u.id,a,{lehi:d.solution.lehi},{});
 await prisma.user.update({where:{id:u.id},data:{activeContentCollectionId:'content_podcasts',contentLanguage:'en'}});
 await prisma.gameSettings.update({where:{id:'singleton'},data:{mysteryEnabled:false}});await prisma.gameContentScope.deleteMany({where:{gameKey:'mystery',contentCollectionId:'content_bom'}});
 assert.deepEqual((await begin(u.id)),a);a=await save(u.id,a,{lehi:d.solution.lehi,sariah:d.solution.sariah},{});assert.ok(a.readerHref);
 assert.deepEqual(await money(u.id),before);assert.equal(await prisma.streakActivity.count({where:{userId:u.id}}),0);assert.equal(await prisma.xPTransaction.count({where:{userId:u.id}}),0);
 await mysteryFixture();
});
test("foreign eigenaar, vergrendelde variant en ongeldige state worden in domein en echte API geweigerd",async()=>{
 const u=await mysteryAccount(),other=await mysteryAccount();const a=await begin(u.id);
 assert.equal((await post(other,action(a,'hint'))).status,404);
 assert.equal((await post(other,{action:'save',attemptId:a.id,expectedRevision:0,actionId:randomUUID(),placements:{},clueNotes:{}})).status,404);
 await assert.rejects(begin(other.id,'002a'),/SOURCE_UNAVAILABLE/);
 for(const patch of [{placements:{lehi:{row:9,column:1}},clueNotes:{}},{placements:{lehi:{row:1,column:1},sariah:{row:1,column:1}},clueNotes:{}},{placements:{nephi:{row:1,column:1}},clueNotes:{}},{placements:{},clueNotes:{fake:true}}]){
  assert.equal((await post(u,{action:'save',attemptId:a.id,expectedRevision:0,actionId:randomUUID(),...patch})).status,400);
 }
 assert.equal((await prisma.mysteryAttempt.findUniqueOrThrow({where:{id:a.id}})).revision,0);
});
test("gelijke eerste starts en twee revisiesaves zijn atomair; stale response bevat toegestane actuele stand",async()=>{
 const u=await mysteryAccount();const both=await Promise.all([begin(u.id),begin(u.id)]);assert.equal(both[0].id,both[1].id);assert.equal(await prisma.mysteryAttempt.count({where:{userId:u.id,active:true}}),1);
 const payload={action:'save',attemptId:both[0].id,expectedRevision:0,actionId:randomUUID(),placements:{lehi:d.solution.lehi},clueNotes:{}};
 const first=await post(u,payload);assert.equal(first.status,200);assert.equal((await post(u,payload)).status,200);
 const stale=await post(u,{...payload,actionId:randomUUID(),placements:{}});assert.equal(stale.status,409);assert.equal((await stale.json()).attempt.revision,1);
 const reused=await post(u,{...payload,placements:{}});assert.equal(reused.status,400);
 const a=(await getMysteryAttempt(u.id,d))!;const outcomes=await Promise.all([save(u.id,a,{lehi:d.solution.lehi}),save(u.id,a,{sariah:d.solution.sariah})].map(p=>p.then(()=>true,()=>false)));assert.deepEqual(outcomes.sort(),[false,true]);
});
test("één hintbetaling bij duplicate/retry/twee toestellen; hintCount uitsluitend serverregistratie",async()=>{
 const u=await mysteryAccount();let a=await begin(u.id);const req=action(a,'hint');const both=await Promise.all([post(u,req),post(u,req)]);assert.deepEqual(both.map(r=>r.status),[200,200]);
 const results=await Promise.all(both.map(r=>r.json()));assert.equal(results[0].hint,results[1].hint);assert.equal((await money(u.id)).hintBalance,7);assert.equal(results[0].attempt.hintCount,1);
 a=await save(u.id,results[0].attempt,{lehi:d.solution.lehi}); const retry=await post(u,req);assert.equal(retry.status,200);assert.equal((await retry.json()).attempt.revision,a.revision);assert.equal((await money(u.id)).hintBalance,7);
 const parallel=await Promise.all([post(u,action(a,'hint')),post(u,action(a,'hint'))]);assert.deepEqual(parallel.map(r=>r.status).sort(),[200,409]);assert.equal((await money(u.id)).hintBalance,6);
 assert.equal((await post(u,{...action((await getMysteryAttempt(u.id,d))!,'hint'),hintCount:-99})).status,400);
});
test("saldo 1 → 0, geen negatieve voorraad; ongeldige actie of DB-fout betaalt niets",async()=>{
 const u=await mysteryAccount();let a=await begin(u.id);await prisma.user.update({where:{id:u.id},data:{hintBalance:1}});a=(await actOnMystery(u.id,action(a,'hint'))).attempt;const before=await money(u.id);
 assert.equal(before.hintBalance,0);await assert.rejects(actOnMystery(u.id,action(a,'hint')),/NO_HINTS/);assert.deepEqual(await money(u.id),before);assert.equal((await getMysteryAttempt(u.id,d))?.hintCount,1);
 await prisma.user.update({where:{id:u.id},data:{hintBalance:5}});
 await prisma.$executeRawUnsafe(`CREATE FUNCTION mystery_fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${a.id}' AND NEW."hintUses" <> OLD."hintUses" THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe('CREATE TRIGGER mystery_fail_payment BEFORE UPDATE ON "MysteryAttempt" FOR EACH ROW EXECUTE FUNCTION mystery_fail_payment()');
 try {await assert.rejects(actOnMystery(u.id,action(a,'hint')),/synthetic failure/);assert.equal((await money(u.id)).hintBalance,5);assert.equal((await getMysteryAttempt(u.id,d))?.hintCount,1);}
 finally {await prisma.$executeRawUnsafe('DROP TRIGGER mystery_fail_payment ON "MysteryAttempt"');await prisma.$executeRawUnsafe('DROP FUNCTION mystery_fail_payment()');}
});
test("hidden/disabled/DRAFT ook voor admin: geen nieuwe start of hintinhoud, poging blijft exact bewaard",async()=>{
 const u=await mysteryAccount('content_bom',true);const a=await begin(u.id);await actOnMystery(u.id,action(a,'hint'));const before=await prisma.mysteryAttempt.findUniqueOrThrow({where:{id:a.id}});
 for(const patch of [{visibleToUsers:false},{enabled:false},{publicationState:'DRAFT' as const}]){
  await prisma.contentCollection.update({where:{id:'content_bom'},data:patch});const view=(await getMysteryAttempt(u.id,d))!;assert.equal(view.available,false);assert.deepEqual(view.placements,{});assert.equal(view.hint,null);assert.equal(view.readerHref,null);
  const other=await mysteryAccount('content_bom',true);await assert.rejects(begin(other.id),/SOURCE_UNAVAILABLE/);
  assert.equal((await post(u,action(view,'hint'))).status,403);assert.deepEqual(await prisma.mysteryAttempt.findUniqueOrThrow({where:{id:a.id}}),before);await mysteryFixture();
 }
 await assert.rejects(prisma.contentCollection.delete({where:{id:'content_bom'}}));assert.ok((await getMysteryAttempt(u.id,d))?.available);
});
test("geen synthetische fallback: ontbrekende bron, podcasts, andere familie of niet-ontgrendelde variant",async()=>{
 for(const source of ['content_podcasts','content_fsy']){const u=await mysteryAccount();await prisma.user.update({where:{id:u.id},data:{activeContentCollectionId:source}});
await assert.rejects(begin(u.id),/SOURCE_UNAVAILABLE/);assert.equal(await prisma.mysteryAttempt.count({where:{userId:u.id}}),0);}
 const u=await mysteryAccount();await assert.rejects(prisma.user.update({where:{id:u.id},data:{activeContentCollectionId:'does-not-exist'}}));await prisma.gameSettings.update({where:{id:'singleton'},data:{mysteryEnabled:false}});await assert.rejects(begin(u.id),/SOURCE_UNAVAILABLE/);await mysteryFixture();
 await prisma.gameContentScope.deleteMany({where:{gameKey:'mystery',contentCollectionId:'content_bom'}});await assert.rejects(begin(u.id),/SOURCE_UNAVAILABLE/);await mysteryFixture();
});
test("completion + autosave, replay en oude retry behouden hintenhistorie en exact één reeksactiviteit",async()=>{
 const u=await mysteryAccount();let a=await begin(u.id);assert.equal((await actOnMystery(u.id,action(a,'complete'))).correct,false);
 a=(await actOnMystery(u.id,action(a,'hint'))).attempt;a=await save(u.id,a,d.solution,{});const complete=action(a,'complete');
 const results=await Promise.all([actOnMystery(u.id,complete),actOnMystery(u.id,complete)]);assert.deepEqual(results.map(r=>r.firstCompletion).sort(),[false,true]);
 const history=await prisma.mysteryProgress.findFirstOrThrow({where:{userId:u.id,mysteryId:d.mysteryId}});assert.equal(history.hintCount,1);assert.equal(await prisma.streakActivity.count({where:{userId:u.id}}),1);assert.equal((await money(u.id)).xpTotal,100);
 const done=(await getMysteryAttempt(u.id,d))!;await assert.rejects(actOnMystery(u.id,action(done,'hint')),/CONFLICT/);
 const start={action:'start' as const,variant:'001a',actionId:randomUUID(),restart:true,attemptId:done.id,expectedRevision:done.revision};const restarted=(await actOnMystery(u.id,start)).attempt;assert.notEqual(restarted.id,done.id);assert.equal(restarted.hintCount,0);assert.equal(Object.values(restarted.placements).some(Boolean),false);
 assert.equal((await actOnMystery(u.id,start)).attempt.id,restarted.id);await assert.rejects(save(u.id,done,{}),/CONFLICT/);assert.equal((await prisma.mysteryAttempt.findUniqueOrThrow({where:{id:done.id}})).hintUses instanceof Array,true);
 const solved=await save(u.id,restarted,d.solution);await actOnMystery(u.id,action(solved,'complete'));assert.deepEqual(await prisma.mysteryProgress.findUniqueOrThrow({where:{id:history.id}}),history);assert.equal(await prisma.streakActivity.count({where:{userId:u.id}}),1);assert.equal((await money(u.id)).hintBalance,7);
});
test("gelijktijdige completion/autosave kan nieuwere state niet voltooien of overschrijven",async()=>{
 const u=await mysteryAccount();let a=await begin(u.id);a=await save(u.id,a,d.solution);
 const req={action:'save' as const,attemptId:a.id,expectedRevision:a.revision,actionId:randomUUID(),placements:{},clueNotes:{}};
 const responses=await Promise.all([post(u,action(a,'complete')),post(u,req)]);assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,1);
 const latest=(await getMysteryAttempt(u.id,d))!;assert.ok(latest.status==='COMPLETED'||Object.values(latest.placements).every(x=>!x));
});
