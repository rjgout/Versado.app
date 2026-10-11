import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/versado_puzzle_test")) throw new Error("Gebruik de geïsoleerde puzzeldatabase");
if (url) process.env.DATABASE_URL = url;
const skip = !url && "Gebruik test:puzzle:integration";
const load = async () => ({ db: (await import("../src/lib/db")).prisma, solo: await import("../src/lib/puzzle/solo"), shop: await import("../src/lib/shop"), engine: await import("../src/lib/puzzle/engine"), geometry: await import("../src/lib/puzzle/geometry"), chapter: await import("../src/lib/chapterGuess"), scrabble: await import("../src/lib/scrabbleGame") });
let L: Awaited<ReturnType<typeof load>>;
const users: string[] = [];
const books: string[] = [];
before(async () => { if (!skip) L = await load(); });
after(async () => { if (!skip) { await L.db.user.deleteMany({ where: { id: { in: users } } }); await L.db.book.deleteMany({where:{id:{in:books}}}); await L.db.$disconnect(); } });
type State = Awaited<ReturnType<typeof L.solo.startSoloPuzzle>>;
async function account(balance = 8) {
  const user = await L.db.user.create({ data: { email: `hint-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `H${randomUUID().slice(0,8)}`, discriminator: "00", hintBalance: balance, xpTotal: 100 } }); users.push(user.id); return user;
}
async function expire(state: State) {
  const snapshot = structuredClone(state.snapshot);
  snapshot.hints.forEach((hint) => { if (hint.expiresAt) hint.expiresAt = new Date(0).toISOString(); });
  await L.db.puzzleSession.update({ where: { id: state.id }, data: { snapshot: JSON.stringify(snapshot) } });
  return (await L.solo.resumeSoloPuzzle((await L.db.puzzleSession.findUniqueOrThrow({ where: { id: state.id } })).ownerId!, state.id, "nl"))!;
}
const preview = { kind: "hint", hint: "PREVIEW" } as const;
const personal = { ...preview, confirmPersonal: true };
async function act(userId: string, state: State, operation: Parameters<typeof L.solo.applySoloAction>[4] = preview, id = randomUUID()) {
  const next = await L.solo.applySoloAction(userId, state.id, state.version, id, operation, "nl"); assert.ok(next); return next;
}
async function exhaust(userId: string, level: "ADVENTURER" | "EXPERT" | "MASTER" = "ADVENTURER", image = 180) {
  let state = await L.solo.startSoloPuzzle(userId, image, 12, level, "nl");
  const count = { ADVENTURER: 3, EXPERT: 2, MASTER: 1 }[level];
  for (let i=0;i<count;i++) state = await expire(await act(userId,state));
  return state;
}

test("ieder niveau gebruikt eerst inbegrepen hints; hervatten/start resetten hetzelfde budget niet", { skip }, async () => {
  for (const [level,count] of [["DISCOVERER",7],["ADVENTURER",3],["EXPERT",2],["MASTER",1]] as const) {
    const user = await account(); let state = await L.solo.startSoloPuzzle(user.id,181,12,level,"nl");
    for (let i=0;i<count;i++) { state = await act(user.id,state); assert.equal(state.hintBalance,8); assert.equal(state.snapshot.hints.at(-1)!.source,"INCLUDED"); state = await expire(state); }
    assert.deepEqual(await L.solo.startSoloPuzzle(user.id,181,12,level,"nl"),state);
    assert.deepEqual(await L.solo.resumeSoloPuzzle(user.id,state.id,"nl"),state);
    const other = await L.solo.startSoloPuzzle(user.id,182,12,level,"nl"); assert.equal(other.snapshot.hints.length,0); assert.equal(other.hintBalance,8);
  }
});

test("vierde Avonturierhint kost na bevestiging één voorraad; saldo 1 wordt 0 en nooit negatief", { skip }, async () => {
  const user = await account(1); const before = await exhaust(user.id);
  await assert.rejects(act(user.id,before), (error: unknown) => error instanceof L.solo.PuzzleHintError && error.code === "CONFIRM");
  assert.deepEqual(await L.solo.resumeSoloPuzzle(user.id,before.id,"nl"),before);
  const next = await act(user.id,before,personal); assert.equal(next.hintBalance,0); assert.equal(next.snapshot.hints.at(-1)!.source,"PERSONAL"); assert.equal(next.snapshot.hints.at(-1)!.extra,true);
  const expired = await expire(next);
  await assert.rejects(act(user.id,expired,personal), (error: unknown) => error instanceof L.solo.PuzzleHintError && error.code === "EMPTY");
  assert.deepEqual(await L.solo.resumeSoloPuzzle(user.id,expired.id,"nl"),expired);
  const current = await L.db.user.findUniqueOrThrow({where:{id:user.id}}); assert.equal(current.hintBalance,0); assert.equal(current.xpTotal,100); assert.equal(current.currentStreak,0);
  assert.equal(await L.db.streakActivity.count({where:{userId:user.id}}),0);
});

test("ongeldige targets, actieve hint, vreemde eigenaar en verouderde versie kosten niets", { skip }, async () => {
  const user = await account(1); const other = await account(); const state = await exhaust(user.id);
  for (const operation of [{kind:"hint",hint:"LOCATION"},{kind:"hint",hint:"CONNECTION",pieceId:95},{kind:"hint",hint:"FILTER",filter:null}] as const) assert.deepEqual(await act(user.id,state,operation),state);
  assert.equal(await L.solo.applySoloAction(other.id,state.id,state.version,randomUUID(),personal,"nl"),null);
  assert.equal(await L.solo.applySoloAction(user.id,state.id,state.version-1,randomUUID(),personal,"nl"),null);
  const active = await act(user.id,state,personal); assert.deepEqual(await act(user.id,active,personal),active); assert.equal(active.hintBalance,0);
  const six = await L.solo.startSoloPuzzle(user.id,183,6,"ADVENTURER","nl"); assert.deepEqual(await act(user.id,six,{kind:"hint",hint:"FILTER",filter:"MIDDLES"}),six);
});

test("dubbele actionId, verschillende gelijktijdige requests en verloren response schrijven maar eenmaal af", { skip }, async () => {
  const user = await account(1); const state = await exhaust(user.id); const id = randomUUID();
  const replies = await Promise.all(Array.from({length:4},()=>L.solo.applySoloAction(user.id,state.id,state.version,id,personal,"nl")));
  const next = replies[0]!; assert.ok(next); assert.ok(replies.every((reply)=>reply?.hintBalance===0&&reply.snapshot.hints.length===4));
  assert.deepEqual(await L.solo.applySoloAction(user.id,state.id,state.version,id,personal,"nl"),next);
  assert.equal(await L.db.puzzleAction.count({where:{sessionId:state.id,actionId:id}}),1);
  assert.equal(await L.solo.applySoloAction(user.id,state.id,state.version,id,preview,"nl"),null);
  const expired = await expire(next); await L.db.user.update({where:{id:user.id},data:{hintBalance:1}});
  const concurrent = await Promise.all([act(user.id,expired,personal),L.solo.applySoloAction(user.id,expired.id,expired.version,randomUUID(),personal,"nl")]);
  assert.equal(concurrent.filter(Boolean).length,1); assert.equal((await L.solo.resumeSoloPuzzle(user.id,state.id,"nl"))!.hintBalance,0);
});

test("twee sessies/apparaten kunnen samen de laatste persoonlijke hint niet dubbel uitgeven", { skip }, async () => {
  const user = await account(1); const a = await exhaust(user.id,"EXPERT",184); const b = await exhaust(user.id,"MASTER",185);
  const replies = await Promise.allSettled([act(user.id,a,personal),act(user.id,b,personal)]);
  assert.equal(replies.filter((r)=>r.status==="fulfilled").length,1);
  const rejected = replies.find((r)=>r.status==="rejected") as PromiseRejectedResult; assert.equal(rejected.reason.code,"EMPTY");
  const currentA = (await L.solo.resumeSoloPuzzle(user.id,a.id,"nl"))!; const currentB = (await L.solo.resumeSoloPuzzle(user.id,b.id,"nl"))!;
  assert.equal(currentA.snapshot.hints.length+currentB.snapshot.hints.length,4); assert.equal(currentA.hintBalance,0);
});

test("fout na afschrijving rolt voorraad, log en snapshot samen terug", { skip }, async () => {
  const user = await account(1); const state = await exhaust(user.id); const id=randomUUID();
  // Een echte DB-fout na de voorraadupdate bewijst rollback van de transactie.
  await L.db.$executeRawUnsafe(`CREATE FUNCTION puzzle_test_reject_hint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sessionId" = '${state.id}' THEN RAISE EXCEPTION 'hintlog-testfout'; END IF; RETURN NEW; END $$`);
  await L.db.$executeRawUnsafe('CREATE TRIGGER puzzle_test_hint_failure BEFORE INSERT ON "PuzzleAction" FOR EACH ROW EXECUTE FUNCTION puzzle_test_reject_hint()');
  try { await assert.rejects(act(user.id,state,personal,id),/hintlog-testfout/); }
  finally { await L.db.$executeRawUnsafe('DROP TRIGGER puzzle_test_hint_failure ON "PuzzleAction"'); await L.db.$executeRawUnsafe('DROP FUNCTION puzzle_test_reject_hint()'); }
  assert.deepEqual(await L.solo.resumeSoloPuzzle(user.id,state.id,"nl"),state); assert.equal(await L.db.puzzleAction.count({where:{sessionId:state.id,actionId:id}}),0);
  const retry=await act(user.id,state,personal,id); assert.equal(retry.hintBalance,0);
});

test("historische bronnen ontbreken veilig; oude extra hints veroorzaken geen afschrijving", { skip }, async () => {
  const user=await account(1); const state=await exhaust(user.id); const snapshot=structuredClone(state.snapshot);
  snapshot.hints.forEach((hint)=>delete hint.source); snapshot.hints.push({type:"PREVIEW",at:new Date(0).toISOString(),extra:true});
  await L.db.puzzleSession.update({where:{id:state.id},data:{snapshot:JSON.stringify(snapshot)}});
  const old=(await L.solo.resumeSoloPuzzle(user.id,state.id,"nl"))!; assert.equal(old.hintBalance,1); assert.deepEqual(old.snapshot,snapshot);
  const next=await act(user.id,old,personal); assert.equal(next.hintBalance,0); assert.deepEqual(next.snapshot.hints.slice(0,4),snapshot.hints); assert.equal(next.snapshot.hints[4].source,"PERSONAL");
});

test("geometrisch voltooid en beantwoord kosten geen hint; opnieuw spelen krijgt nieuwe inbegrepen hints", { skip }, async () => {
  const user=await account(1); let state=await exhaust(user.id); const geometry=L.geometry.createPuzzleGeometry(12,state.seed,state.geometryVersion);
  for(const piece of geometry.pieces) { const group=L.engine.groupFor(state.snapshot,piece.id)!; if(!group.anchored) { state=await act(user.id,state,{kind:"move",groupId:group.id,...L.engine.boardPosition(geometry,group)}); state=await act(user.id,state,{kind:"anchor",groupId:group.id}); } }
  assert.equal(state.status,"COMPLETED"); assert.equal(await L.solo.applySoloAction(user.id,state.id,state.version,randomUUID(),personal,"nl"),null);
  await L.solo.answerSoloPuzzle(user.id,state.id,0); const answered=(await L.solo.resumeSoloPuzzle(user.id,state.id,"nl"))!;
  assert.equal(await L.solo.applySoloAction(user.id,state.id,answered.version,randomUUID(),personal,"nl"),null);
  const replay=await L.solo.startSoloPuzzle(user.id,180,12,"ADVENTURER","nl"); assert.notEqual(replay.id,state.id); assert.equal(replay.snapshot.hints.length,0); assert.equal(replay.hintBalance,1);
});

test("winkel en spellen gebruiken dezelfde voorraad en bestaande XP-prijs", { skip }, async () => {
  const user=await account(0); const state=await exhaust(user.id); const bought=await L.shop.buyHints(user.id,2); assert.ok(bought.ok); assert.equal(bought.hintBalance,2); assert.equal(bought.xpTotal,0); assert.equal(L.shop.HINT_PRICE_XP,50);
  const resumed=(await L.solo.resumeSoloPuzzle(user.id,state.id,"nl"))!; assert.equal(resumed.hintBalance,2);
  const paid=await act(user.id,resumed,personal); assert.equal(paid.hintBalance,1);
  const book=await L.db.book.create({data:{slug:`hint-test-${randomUUID()}`,name:"Testboek",order:999,contentCollectionId:"content_bom"}}); books.push(book.id);
  await L.db.chapter.createMany({data:[1,2,3,4].map((number)=>({bookId:book.id,number,order:number,heading:"Testomschrijving"}))});
  const game=await L.chapter.createChapterGuessGame(user.id,"BEGINNER",3); assert.ok("hintCredits" in game,JSON.stringify(game)); assert.equal(game.hintCredits,1);
  const chapterHint=await L.chapter.chapterGuessHint(game.gameId,user.id); assert.ok("hintCredits" in chapterHint); assert.equal(chapterHint.hintCredits,0);
  assert.equal((await L.solo.resumeSoloPuzzle(user.id,state.id,"nl"))!.hintBalance,0);
  await L.db.user.update({where:{id:user.id},data:{xpTotal:50}}); const anotherPurchase=await L.shop.buyHints(user.id,1); assert.ok(anotherPurchase.ok);
  const opponent=await account(0); const word=await L.db.scrabbleGame.create({data:{player1Id:user.id,player2Id:opponent.id,status:"ACTIVE",board:"[]",bag:"[]",player1Rack:'["G","O","D"]',player2Rack:"[]"}});
  const wordHint=await L.scrabble.scrabbleHint(word.id,user.id); assert.ok(wordHint.ok); assert.equal(wordHint.hintBalance,0);
  assert.equal((await L.solo.resumeSoloPuzzle(user.id,state.id,"nl"))!.hintBalance,0);
});
