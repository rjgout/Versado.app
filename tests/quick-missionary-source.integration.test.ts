import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quickMissionaryFixture } from "./fixtures/quick-missionary";
const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "Eigen testdatabase vereist";
let db: typeof import("../src/lib/db").prisma;
let runs: typeof import("../src/lib/snelleZendeling/runs");
let lobby: typeof import("../src/lib/snelleZendeling/lobby");
let match: typeof import("../src/lib/snelleZendeling/match");
const prefix = `qm-source-${randomUUID()}`;
const users: string[] = [];
const bookIds: string[] = [];
const questions = new Map<string, string>();
const nl = "content_bom", en = "content_bom_en";
before(async () => {
  if (skip) return;
  db = (await import("../src/lib/db")).prisma;
  runs = await import("../src/lib/snelleZendeling/runs"); lobby = await import("../src/lib/snelleZendeling/lobby"); match = await import("../src/lib/snelleZendeling/match");
  for (const [id, language] of [[nl,"nl"],[en,"en"]]) {
    await quickMissionaryFixture(db, id, language);
    const book = await db.book.create({ data: { contentCollectionId: id, slug: `${prefix}-${language}`, name: `Test ${language}`, order: 0 } }); bookIds.push(book.id);
    const chapter = await db.chapter.create({ data: { bookId: book.id, number: 1, order: 0 } });
    const q = await db.quickMissionaryReviveQuestion.create({ data: { contentKey: `${prefix}-${language}`, chapterId: chapter.id, variant: 1, prompt: `Synthetisch ${language}`, options: { create: [{ label: "Het goede antwoord", isCorrect: true, order: 0 }, { label: "Een foute keuze A", order: 1 }, { label: "Een foute keuze B", order: 2 }] } } }); questions.set(id,q.id);
  }
});
after(async () => {
  if (skip) return;
  await db.liveGame.deleteMany({ where: { hostId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } });
  await db.book.deleteMany({ where: { id: { in: bookIds } } }); await db.$disconnect();
});
async function account(source = nl, admin = false) {
  const user = await db.user.create({ data: { email: `${randomUUID()}@qm.test.invalid`, handle: `QM${randomUUID().slice(0,12)}`, discriminator: "00", passwordHash: "synthetic", activeContentCollectionId: source, isAdmin: admin, xpTotal: 500, geneesBalance: 2, hintBalance: 8 } }); users.push(user.id); return user.id;
}
const setSource = (id: string, source: string) => db.user.update({ where: { id }, data: { activeContentCollectionId: source } });
const economy = (userId: string) => db.user.findUniqueOrThrow({ where: { id: userId }, select: { xpTotal: true, geneesBalance: true, hintBalance: true, currentStreak: true, activeCourseId: true } });
async function died(userId: string) { const { runId } = await runs.startQuickMissionaryRun(userId); await runs.reportDeath(runId,userId,0); return runId; }
async function pair() {
  const a = await account(nl), b = await account(en);
  const { code } = await lobby.createQuickMissionaryLobby(a);
  const game = await db.liveGame.findUniqueOrThrow({ where: { code } });
  await db.liveGameInvite.create({ data: { gameId: game.id, userId: b } });
  return { a,b,code,gameId:game.id };
}

test("Solo: snapshots, meerdere bron/taalwissels, aparte cursor en geen economische bijeffecten", { skip }, async () => {
  const user = await account(); const before = await economy(user); const run = await died(user);
  for (const source of ["content_podcasts", en, "content_podcasts"]) await setSource(user,source);
  assert.equal((await db.quickMissionaryRun.findUniqueOrThrow({where:{id:run}})).contentCollectionId,nl);
  const view = await runs.requestReviveQuestion(run,user); assert.equal(view.reviveQuestion?.exerciseId,questions.get(nl));
  const option = await db.quickMissionaryReviveOption.findFirstOrThrow({where:{questionId:view.reviveQuestion!.exerciseId,isCorrect:true}});
  await runs.answerReviveQuestion(run,user,option.questionId,option.id);
  assert.equal(await db.quickMissionaryReviveProgress.count({where:{userId:user,contentCollectionId:en}}),0);
  assert.equal((await db.quickMissionaryReviveProgress.findUniqueOrThrow({where:{userId_contentCollectionId:{userId:user,contentCollectionId:nl}}})).cursorChapterOrder,1);
  await setSource(user,en); const english = await died(user); assert.equal((await runs.requestReviveQuestion(english,user)).reviveQuestion?.exerciseId,questions.get(en));
  assert.deepEqual(await economy(user),before); assert.equal(await db.xPTransaction.count({where:{userId:user}}),0); assert.equal(await db.streakActivity.count({where:{userId:user}}),0);
});

test("Nieuwe domeinstarts weigeren podcasts, hidden, disabled, DRAFT, ontbrekende scope en setting", { skip }, async () => {
  const user = await account("content_podcasts"); await assert.rejects(runs.startQuickMissionaryRun(user), /SOURCE_UNAVAILABLE/);
  await assert.rejects(lobby.createQuickMissionaryLobby(user), /SOURCE_UNAVAILABLE/); await setSource(user,nl);
  for (const patch of [{visibleToUsers:false},{enabled:false},{publicationState:"DRAFT" as const}]) {
    await db.contentCollection.update({where:{id:nl},data:patch});
    await assert.rejects(runs.startQuickMissionaryRun(user),/SOURCE_UNAVAILABLE/); await quickMissionaryFixture(db);
  }
  await db.gameContentScope.deleteMany({where:{gameKey:"quick-missionary",contentCollectionId:nl}}); await assert.rejects(runs.startQuickMissionaryRun(user),/SOURCE_UNAVAILABLE/); await quickMissionaryFixture(db);
  await db.gameSettings.update({where:{id:"singleton"},data:{quickMissionaryEnabled:false}}); await assert.rejects(runs.startQuickMissionaryRun(user),/SOURCE_UNAVAILABLE/); await quickMissionaryFixture(db);
  assert.equal(await db.quickMissionaryRun.count({where:{userId:user}}),0);
});

test("Genees retry/twee toestellen behouden vraag, optievolgorde, gezien-rij en voorraad", { skip }, async () => {
  const user=await account(); const run=await died(user);
  const views=await Promise.all([runs.requestReviveQuestion(run,user),runs.requestReviveQuestion(run,user)]);
  assert.deepEqual(views[0].reviveQuestion,views[1].reviveQuestion); assert.equal(await db.quickMissionaryReviveSeen.count({where:{runId:run}}),1);
  assert.equal((await economy(user)).geneesBalance,2);
});

test("Een onbekende oude bron wordt nooit uit profiel/BOM afgeleid en kost geen XP of Genees", {skip},async()=>{
 const user=await account(); const before=await economy(user);
 const run=await db.quickMissionaryRun.create({data:{userId:user,dayKey:"2026-10-11",status:"DEAD_AWAITING_REVIVE",reviveUsed:true}});
 const view=await runs.getQuickMissionaryRunView(run.id,user); assert.equal(view.reviveUnavailableReason,"legacy-source"); assert.equal(view.deathOption,"none");
 await assert.rejects(runs.requestReviveQuestion(run.id,user),/NO_QUESTION/); assert.equal((await runs.buyGeneesInRun(run.id,user)).result.ok,false);
 assert.deepEqual(await economy(user),before,"een geweigerde vraag/aankoop verandert de economie of reeks niet");
 assert.equal(await db.streakActivity.count({where:{userId:user}}),0);
 assert.equal(await db.quickMissionaryReviveSeen.count({where:{runId:run.id}}),0);
 // Sinds #198 telt deze al gespeelde legacy-run bij definitief afronden wel voor de reeks, zonder bronfallback of XP/Genees.
 await runs.finishQuickMissionaryRun(run.id,user,0);
 assert.equal((await db.quickMissionaryRun.findUniqueOrThrow({where:{id:run.id}})).contentCollectionId,null);
 const completed={...before,currentStreak:1};
 assert.deepEqual(await economy(user),completed);
 assert.equal(await db.streakActivity.count({where:{userId:user}}),1);
 assert.equal(await db.xPTransaction.count({where:{userId:user}}),0);
 await runs.finishQuickMissionaryRun(run.id,user,0);
 assert.deepEqual(await economy(user),completed,"afrondingsretry geeft geen tweede reeksactiviteit of economische mutatie");
 assert.equal(await db.streakActivity.count({where:{userId:user}}),1);
});

test("Oude reeds uitgegeven vraag herstelt alleen haar bewezen bron onder de runlock", {skip},async()=>{
 const user=await account(en), q=questions.get(nl)!; const options=await db.quickMissionaryReviveOption.findMany({where:{questionId:q},orderBy:{order:"desc"}});
 const run=await db.quickMissionaryRun.create({data:{userId:user,dayKey:"2026-10-11",status:"DEAD_AWAITING_REVIVE",reviveUsed:true,reviveExerciseId:q,reviveOptionIds:JSON.stringify(options.map(o=>o.id))}});
 const before=await economy(user); const views=await Promise.all([runs.requestReviveQuestion(run.id,user),runs.requestReviveQuestion(run.id,user)]);
 assert.deepEqual(views[0].reviveQuestion?.options.map(o=>o.id),options.map(o=>o.id)); assert.deepEqual(views[0].reviveQuestion,views[1].reviveQuestion);
 assert.equal((await db.quickMissionaryRun.findUniqueOrThrow({where:{id:run.id}})).contentCollectionId,nl); assert.equal(await db.quickMissionaryReviveSeen.count({where:{runId:run.id}}),0); assert.deepEqual(await economy(user),before);
});

test("Ingetrokken bron blokkeert vraaglekkage/antwoord/aankoop ook voor admin, bewaart uitgegeven vraag", {skip},async()=>{
 const user=await account(nl,true), run=await died(user); const issued=await runs.requestReviveQuestion(run,user); const before=await economy(user);
 const correct=await db.quickMissionaryReviveOption.findFirstOrThrow({where:{questionId:issued.reviveQuestion!.exerciseId,isCorrect:true}});
 for(const patch of [{visibleToUsers:false},{enabled:false},{publicationState:"DRAFT" as const}]) {
  await db.contentCollection.update({where:{id:nl},data:patch});
  const view=await runs.getQuickMissionaryRunView(run,user); assert.equal(view.reviveQuestion,null); assert.equal(view.reviveBlocked,true); assert.equal(view.reviveAvailable,false);
  await assert.rejects(runs.requestReviveQuestion(run,user),/NO_QUESTION/); await assert.rejects(runs.answerReviveQuestion(run,user,correct.questionId,correct.id),/NO_QUESTION/);
  assert.equal((await runs.buyGeneesInRun(run,user)).result.ok,false); assert.equal((await db.quickMissionaryRun.findUniqueOrThrow({where:{id:run}})).reviveExerciseId,correct.questionId);
  assert.deepEqual(await economy(user),before); await quickMissionaryFixture(db);
 }
 assert.deepEqual((await runs.requestReviveQuestion(run,user)).reviveQuestion,issued.reviveQuestion);
});

test("Verkeerde vraaguitgave wordt geweigerd; verwijdering oorspronkelijke bron is RESTRICT", {skip},async()=>{
 const user=await account(),run=await died(user); const q=questions.get(en)!; const opts=await db.quickMissionaryReviveOption.findMany({where:{questionId:q}});
 await db.quickMissionaryRun.update({where:{id:run},data:{reviveExerciseId:q,reviveOptionIds:JSON.stringify(opts.map(o=>o.id))}});
 assert.equal((await runs.getQuickMissionaryRunView(run,user)).reviveQuestion,null); await assert.rejects(runs.answerReviveQuestion(run,user,q,opts[0].id),/NO_QUESTION/);
 await assert.rejects(db.contentCollection.delete({where:{id:nl}})); assert.equal((await db.quickMissionaryRun.findUniqueOrThrow({where:{id:run}})).contentCollectionId,nl);
});

test("Oude verdiende Genees zonder bewaarde vraag kan doorgaan, maar ontvangt geen nieuwe Genees", {skip},async()=>{
 const user=await account(); const run=await db.quickMissionaryRun.create({data:{userId:user,dayKey:"2026-10-11",status:"REVIVE_READY",reviveUsed:true}});
 await runs.resumeAfterRevive(run.id,user); await runs.reportDeath(run.id,user,0); assert.equal((await runs.getQuickMissionaryRunView(run.id,user)).reviveAvailable,false); await runs.finishQuickMissionaryRun(run.id,user,0);
});

test("Samen: host/gast behouden eigen snapshot na wisselen en reconnect; start retry is idempotent", {skip},async()=>{
 const p=await pair(); await lobby.joinQuickMissionaryLobby(p.code,p.b); await setSource(p.a,"content_podcasts"); await setSource(p.b,nl);
 await lobby.joinQuickMissionaryLobby(p.code,p.b); await lobby.joinQuickMissionaryLobby(p.code,p.a);
 const results=await Promise.all([match.startMatch(p.gameId,p.a),match.startMatch(p.gameId,p.a)]); assert.deepEqual(results[0],results[1]); assert.ok(results[0].ok);
 const rows=await db.quickMissionaryRun.findMany({where:{matchId:results[0].matchId}}); assert.equal(rows.length,2); assert.equal(rows.find(r=>r.userId===p.a)?.contentCollectionId,nl); assert.equal(rows.find(r=>r.userId===p.b)?.contentCollectionId,en);
 await db.gameSettings.update({where:{id:"singleton"},data:{quickMissionaryEnabled:false}}); await db.gameContentScope.deleteMany({where:{gameKey:"quick-missionary"}});
 await lobby.joinQuickMissionaryLobby(p.code,p.a); await lobby.joinQuickMissionaryLobby(p.code,p.b);
 for(const row of rows) { await runs.reportDeath(row.id,row.userId,0); const view=await runs.requestReviveQuestion(row.id,row.userId); assert.equal(view.reviveQuestion?.exerciseId,questions.get(row.contentCollectionId!)); }
 await quickMissionaryFixture(db,nl); await quickMissionaryFixture(db,en,"en");
});

test("Oude lobby vereist bewuste bevestiging, houdt uitnodigingen intact en verzint geen snapshot", {skip},async()=>{
 const p=await pair(); await lobby.joinQuickMissionaryLobby(p.code,p.b); await db.liveGamePlayer.updateMany({where:{gameId:p.gameId},data:{contentCollectionId:null}});
 await lobby.joinQuickMissionaryLobby(p.code,p.a); assert.deepEqual(await match.startMatch(p.gameId,p.a),{ok:false,error:"SOURCE_CONFIRMATION_REQUIRED"});
 assert.equal(await db.liveGameInvite.count({where:{gameId:p.gameId}}),1); await lobby.joinQuickMissionaryLobby(p.code,p.a,true); await lobby.joinQuickMissionaryLobby(p.code,p.b,true);
 assert.ok((await match.startMatch(p.gameId,p.a)).ok);
});

test("Ingetrokken gastbron blokkeert alleen nieuwe start; geen match/XP/voorraadmutatie of gewiste lobby", {skip},async()=>{
 const p=await pair(); await lobby.joinQuickMissionaryLobby(p.code,p.b); const before=await economy(p.b);
 await db.contentCollection.update({where:{id:en},data:{visibleToUsers:false}}); assert.deepEqual(await match.startMatch(p.gameId,p.a),{ok:false,error:"SOURCE_UNAVAILABLE"});
 assert.equal(await db.quickMissionaryMatch.count({where:{liveGameId:p.gameId}}),0); assert.equal((await db.liveGame.findUniqueOrThrow({where:{id:p.gameId}})).status,"LOBBY"); assert.equal(await db.liveGameInvite.count({where:{gameId:p.gameId}}),1); assert.deepEqual(await economy(p.b),before); await quickMissionaryFixture(db,en,"en");
});

test("Gelijktijdig deelnemen/starten: geen losse run, dubbele speler of verloren snapshot", {skip},async()=>{
 const p=await pair(); await Promise.allSettled([lobby.joinQuickMissionaryLobby(p.code,p.b),match.startMatch(p.gameId,p.a)]);
 const started=await match.startMatch(p.gameId,p.a); assert.ok(started.ok); const rows=await db.quickMissionaryRun.findMany({where:{matchId:started.matchId}}); assert.equal(rows.length,2); assert.ok(rows.every(r=>r.contentCollectionId));
 const foreign=await account(); await assert.rejects(lobby.joinQuickMissionaryLobby(p.code,foreign),/NOT_PARTICIPANT/);
});

test("Noodkoop na bronwissel rekent exact eenmaal af voor de runbron, nooit voor de actuele voorkeur", {skip},async()=>{
 const user=await account(); await db.user.update({where:{id:user},data:{geneesBalance:0}});const run=await died(user);
 await db.quickMissionaryRun.update({where:{id:run},data:{reviveUsed:true}});await setSource(user,"content_podcasts");
 const bought=await Promise.all([runs.buyGeneesInRun(run,user),runs.buyGeneesInRun(run,user)]);assert.equal(bought.filter(r=>r.result.ok).length,1);
 assert.equal((await economy(user)).xpTotal,400);assert.equal((await economy(user)).geneesBalance,1);assert.equal(await db.geneesPurchase.count({where:{userId:user,runId:run}}),1);
 const views=await Promise.all([runs.requestReviveQuestion(run,user),runs.requestReviveQuestion(run,user)]);assert.equal(views[0].reviveQuestion?.exerciseId,questions.get(nl));assert.deepEqual(views[0].reviveQuestion,views[1].reviveQuestion);assert.equal((await economy(user)).geneesBalance,0);assert.equal((await db.quickMissionaryRun.findUniqueOrThrow({where:{id:run}})).stockRevivesUsed,1);
});

test("Lege of onbruikbare runvragenbank: geen noodkoop, Genees-verbruik, audit of voortgang", {skip},async()=>{
 const user=await account();await db.user.update({where:{id:user},data:{geneesBalance:0}});const run=await died(user);await db.quickMissionaryRun.update({where:{id:run},data:{reviveUsed:true}});
 const before=await economy(user),q=questions.get(nl)!;const opts=await db.quickMissionaryReviveOption.findMany({where:{questionId:q}});
 for(const invalid of ["draft","options"]) {
  if(invalid==="draft")await db.quickMissionaryReviveQuestion.update({where:{id:q},data:{status:"DRAFT"}});
  else await db.quickMissionaryReviveOption.update({where:{id:opts[0].id},data:{label:""}});
  try {assert.deepEqual((await runs.buyGeneesInRun(run,user)).result,{ok:false,error:"NO_QUESTIONS"});assert.equal((await runs.getQuickMissionaryRunView(run,user)).reviveAvailable,false);assert.deepEqual(await economy(user),before);assert.equal(await db.geneesPurchase.count({where:{runId:run}}),0);assert.equal(await db.quickMissionaryReviveSeen.count({where:{runId:run}}),0);assert.equal(await db.quickMissionaryReviveProgress.count({where:{userId:user}}),0);}
  finally {await db.quickMissionaryReviveQuestion.update({where:{id:q},data:{status:"APPROVED"}});await db.quickMissionaryReviveOption.update({where:{id:opts[0].id},data:{label:opts[0].label}});}
 }
});

test("Eigenaar wordt vóór bronherstel gecontroleerd; oude vraag met ingetrokken toegang blijft onveranderd", {skip},async()=>{
 const user=await account(),other=await account();const q=questions.get(nl)!;const opts=await db.quickMissionaryReviveOption.findMany({where:{questionId:q}});
 const old=await db.quickMissionaryRun.create({data:{userId:user,dayKey:"2026-10-11",status:"DEAD_AWAITING_REVIVE",reviveUsed:true,reviveExerciseId:q,reviveOptionIds:JSON.stringify(opts.map(o=>o.id))}});
 await assert.rejects(runs.getQuickMissionaryRunView(old.id,other),/NOT_FOUND/);await assert.rejects(runs.requestReviveQuestion(old.id,other),/NOT_FOUND/);
 await db.contentCollection.update({where:{id:nl},data:{visibleToUsers:false}});
 try {await assert.rejects(runs.requestReviveQuestion(old.id,user),/NO_QUESTION/);const saved=await db.quickMissionaryRun.findUniqueOrThrow({where:{id:old.id}});assert.equal(saved.contentCollectionId,null);assert.equal(saved.reviveExerciseId,q);assert.equal(saved.reviveOptionIds,old.reviveOptionIds);}
 finally {await quickMissionaryFixture(db);}
});
