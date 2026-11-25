import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prisma } from "../src/lib/db";
import { issueNativeSession, nativeSessionIdentity, rotateNativeSession } from "../src/lib/native/sessions";
import { nativeTodayActionResultSchema } from "../src/lib/native/todayActionsContract";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
const database = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || database.href !== process.env.DATABASE_URL) throw Error("Alleen eigen geïsoleerde database");
const a = process.env.NATIVE_SOCKET_TEST_A!, b = process.env.NATIVE_SOCKET_TEST_B!;
if (!a || !b || a === b || ![a,b].every(url => new URL(url).hostname === "127.0.0.1")) throw Error("Twee afzonderlijke eigen Node-processen verplicht");
after(async () => prisma.$disconnect());
async function account() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, handle: `Actie${randomUUID().slice(0,6)}`, discriminator: "01", passwordHash: "synthetic", emailVerifiedAt: new Date(), onboardingSeenAt: new Date(), xpTotal: 123, hintBalance: 4, currentStreak: 2, lastStudyDate: "2026-10-30" } });
  return { user, pair: await issueNativeSession(user.id, user.sessionVersion) };
}
const itemKey = (id = randomUUID()) => `course-${id}:2026-10-31T10:00:00.000Z`;
async function call(host: string, path: string, token: string | undefined, input: unknown, method = "POST", extra = {}) {
  return fetch(`${host}/api/v1/native/today-actions/${path}`, { method, headers: { Origin: "capacitor://localhost", "X-Versado-Client": "native-v1", "Content-Type": "application/json", "x-real-ip": "127.0.0.91", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, ...(method === "GET" ? {} : { body: JSON.stringify(input) }) });
}
async function web(host: string, userId: string, path: string, input?: unknown) {
  return fetch(`${host}/api/${path}`, { method: input === undefined ? "POST" : "PUT", headers: { Origin: a, Cookie: `${SESSION_COOKIE}=${await createSessionToken(userId)}`, "Content-Type": "application/json" }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function snapshot(userId: string) {
  return { user: await prisma.user.findUniqueOrThrow({ where: { id: userId } }), read: await prisma.contentProgress.findMany({ where: { userId } }), course: await prisma.userCourseProgress.findMany({ where: { userId } }), freezes: await prisma.freezeTransaction.findMany({ where: { userId } }), days: await prisma.streakDay.findMany({ where: { userId } }) };
}
async function incoming() {
  const sender = await account(), receiver = await account(), stranger = await account();
  const friendship = await prisma.friendship.create({ data: { senderId: sender.user.id, receiverId: receiver.user.id } });
  return { sender, receiver, stranger, friendship };
}
test("hide: two processes/retries/web edits preserve all personal preferences and progress", async () => {
  const { user, pair } = await account(), first = itemKey(), second = itemKey(), before = await snapshot(user.id);
  await prisma.userListOrder.create({ data: { userId: user.id, listKey: "today-continue", itemKey: first, order: 7 } });
  const results = await Promise.all([call(a,"hide",pair.accessToken,{itemKey:first}), call(b,"hide",pair.accessToken,{itemKey:second}), call(b,"hide",pair.accessToken,{itemKey:first})]);
  for (const result of results) { assert.equal(result.status,200); assert.equal(nativeTodayActionResultSchema.parse(await result.json()).outcome.kind,"hidden"); }
  const rows = await prisma.userListOrder.findMany({ where: { userId: user.id, listKey: "today-continue" } });
  assert.equal(rows.length,2); assert.ok(rows.every(r => r.hidden)); assert.deepEqual(await snapshot(user.id),before);
  const third = itemKey();const concurrent = await Promise.all([web(a,user.id,"list-order",{listKey:"today-continue",hideKeys:[third]}),call(b,"hide",pair.accessToken,{itemKey:second})]);assert.deepEqual(concurrent.map(r=>r.status),[200,200]);
  const listed = await fetch(`${a}/api/list-order?listKey=today-continue`,{headers:{Cookie:`${SESSION_COOKIE}=${await createSessionToken(user.id)}`}});assert.equal(listed.status,200);assert.deepEqual(new Set((await listed.json()).hidden),new Set([first,second,third]));assert.deepEqual(await snapshot(user.id),before);
  const other = await account();assert.equal(await prisma.userListOrder.count({where:{userId:other.user.id}}),0);
});
test("accept: native/web race has one transition, one existing achievement per user and no extra rewards/notifications", async () => {
  const {sender,receiver,friendship} = await incoming();
  await prisma.achievement.upsert({where:{slug:"first-friend"},create:{slug:"first-friend",name:"Eerste vriend",description:"Synthetische test",icon:"users"},update:{}});
  const before = await snapshot(receiver.user.id), notifications = await prisma.notification.count({where:{userId:{in:[sender.user.id,receiver.user.id]}}});
  const responses = await Promise.all([call(a,"friend-response",receiver.pair.accessToken,{friendshipId:friendship.id,action:"accept"}),call(b,"friend-response",receiver.pair.accessToken,{friendshipId:friendship.id,action:"accept"}),web(a,receiver.user.id,`friends/${friendship.id}/accept`)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200,200]);assert.equal((await prisma.friendship.findUniqueOrThrow({where:{id:friendship.id}})).status,"ACCEPTED");
  const replay = await call(b,"friend-response",receiver.pair.accessToken,{friendshipId:friendship.id,action:"accept"});const result=nativeTodayActionResultSchema.parse(await replay.json());assert.equal(result.outcome.kind,"friend-response");if(result.outcome.kind==="friend-response")assert.equal(result.outcome.changed,false);
  for(const id of [sender.user.id,receiver.user.id]) {assert.equal(await prisma.userAchievement.count({where:{userId:id,achievement:{slug:"first-friend"}}}),1);assert.equal(await prisma.activityFeedItem.count({where:{userId:id,kind:"ACHIEVEMENT",achievementSlug:"first-friend"}}),1);}
  assert.equal(await prisma.notification.count({where:{userId:{in:[sender.user.id,receiver.user.id]}}}),notifications);assert.deepEqual(await snapshot(receiver.user.id),before);
  const friends = await fetch(`${a}/api/friends`,{headers:{Cookie:`${SESSION_COOKIE}=${await createSessionToken(receiver.user.id)}`}});assert.ok((await friends.json()).friends.some((f:{friendshipId:string})=>f.friendshipId===friendship.id));
});
test("decline/delete is terminal: replay 404, no resurrection; only recipient responds natively", async () => {
  const {sender,receiver,stranger,friendship} = await incoming();
  for(const account of [sender,stranger])for(const action of ["accept","decline"]) assert.equal((await call(a,"friend-response",account.pair.accessToken,{friendshipId:friendship.id,action})).status,404);
  const responses=await Promise.all([call(a,"friend-response",receiver.pair.accessToken,{friendshipId:friendship.id,action:"decline"}),call(b,"friend-response",receiver.pair.accessToken,{friendshipId:friendship.id,action:"decline"})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,404]);assert.equal(await prisma.friendship.count({where:{id:friendship.id}}),0);
  assert.equal((await call(b,"friend-response",receiver.pair.accessToken,{friendshipId:friendship.id,action:"accept"})).status,404);
  // Preserve the web's existing sender cancellation without granting that native permission.
  const second=await prisma.friendship.create({data:{senderId:sender.user.id,receiverId:receiver.user.id}});assert.equal((await web(a,sender.user.id,`friends/${second.id}/decline`)).status,200);
});
test("opposite responses on two processes serialize; decline never deletes an accepted friendship",async()=>{
 const {receiver,friendship}=await incoming();const [yes,no]=await Promise.all([call(a,"friend-response",receiver.pair.accessToken,{friendshipId:friendship.id,action:"accept"}),call(b,"friend-response",receiver.pair.accessToken,{friendshipId:friendship.id,action:"decline"})]);
 const row=await prisma.friendship.findUnique({where:{id:friendship.id}});
 if(row){assert.equal(row.status,"ACCEPTED");assert.equal(yes.status,200);assert.equal(no.status,409);}else{assert.equal(no.status,200);assert.equal(yes.status,404);}
});
test("Bearer, exact method, body/actor validation, expired/replayed sessions stay fail-closed",async()=>{
 const {user,pair}=await account(),input={itemKey:itemKey()};
 assert.equal((await call(a,"hide",undefined,input, "POST",{Cookie:`${SESSION_COOKIE}=${await createSessionToken(user.id)}`})).status,401);
 for(const extra of [{userId:"B"},{listKey:"courses"},{hiddenKeys:[]},{publish:true}])assert.equal((await call(a,"hide",pair.accessToken,{...input,...extra})).status,400);
 for(const method of ["GET","DELETE"])assert.equal((await call(a,"hide",pair.accessToken,input,method)).status,404);
 assert.equal((await call(a,"hide/anything",pair.accessToken,input)).status,404);
 const identity=await nativeSessionIdentity(pair.accessToken);await prisma.nativeSession.update({where:{id:identity.binding.sessionId},data:{createdAt:new Date(Date.now()-60_000),expiresAt:new Date(Date.now()-1000)}});assert.equal((await call(a,"hide",pair.accessToken,input)).status,401);
 const replay=await account();await rotateNativeSession(replay.pair.refreshToken,randomUUID());await assert.rejects(rotateNativeSession(replay.pair.refreshToken,randomUUID()),/refresh_replayed/);assert.equal((await call(a,"hide",replay.pair.accessToken,input)).status,401);
 assert.equal(await prisma.userListOrder.count({where:{userId:{in:[user.id,replay.user.id]}}}),0);
});
async function blocked(change:(lock:pg.Client,userId:string,sessionId:string)=>Promise<unknown>) {
 const {user,pair}=await account(),identity=await nativeSessionIdentity(pair.accessToken),lock=new pg.Client({connectionString:database.href});await lock.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',[user.id]);const xid=(await lock.query('SELECT pg_current_xact_id()::text AS xid')).rows[0].xid;let pending:Promise<Response>|undefined;
 try{pending=call(a,"hide",pair.accessToken,{itemKey:itemKey()});let waiting=false;for(let i=0;i<100;i++){const rows=await lock.query("SELECT 1 FROM pg_locks WHERE NOT granted AND locktype='transactionid' AND transactionid=$1::xid",[xid]);if(rows.rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.equal(waiting,true);await change(lock,user.id,identity.binding.sessionId);await lock.query('COMMIT');const response=await pending;assert.equal(response.status,401);assert.equal(await prisma.userListOrder.count({where:{userId:user.id}}),0);
 }finally{await lock.query('ROLLBACK');await lock.end();if(pending)await pending.catch(()=>{});}
}
test("revocation and password/account security changes while action waits cannot commit",async()=>{
 await blocked((lock,_user,session)=>lock.query('UPDATE "NativeSession" SET "revokedAt"=now() WHERE id=$1::uuid',[session]));
 await blocked((lock,user)=>lock.query('UPDATE "User" SET "sessionVersion"="sessionVersion"+1 WHERE id=$1',[user]));
 await blocked((lock,_user,session)=>lock.query('UPDATE "NativeSession" SET "createdAt"=now()-interval \'1 minute\', "expiresAt"=now()-interval \'1 second\' WHERE id=$1::uuid',[session]));
 await blocked((lock,user)=>lock.query('DELETE FROM "User" WHERE id=$1',[user]));
});
test("database failure rolls back the entire list rewrite and can be explicitly retried",async()=>{
 const {user,pair}=await account(),key=itemKey();await prisma.userListOrder.create({data:{userId:user.id,listKey:"today-continue",itemKey:key,order:5}});const before=await prisma.userListOrder.findMany({where:{userId:user.id}});
 await prisma.$executeRawUnsafe(`CREATE FUNCTION b2b_fail_list() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId"='${user.id}' THEN RAISE EXCEPTION 'synthetic list failure'; END IF; RETURN NEW; END $$`);await prisma.$executeRawUnsafe('CREATE TRIGGER b2b_fail_list BEFORE INSERT ON "UserListOrder" FOR EACH ROW EXECUTE FUNCTION b2b_fail_list()');
 try{assert.equal((await call(a,"hide",pair.accessToken,{itemKey:key})).status,500);assert.deepEqual(await prisma.userListOrder.findMany({where:{userId:user.id}}),before);}finally{await prisma.$executeRawUnsafe('DROP TRIGGER b2b_fail_list ON "UserListOrder"');await prisma.$executeRawUnsafe('DROP FUNCTION b2b_fail_list()');}
 assert.equal((await call(b,"hide",pair.accessToken,{itemKey:key})).status,200);assert.equal((await prisma.userListOrder.findFirstOrThrow({where:{userId:user.id}})).hidden,true);
});

test("friend achievement failure rolls back acceptance, both achievements and their activity feed",async()=>{
 const {sender,receiver,friendship}=await incoming();
 await prisma.$executeRawUnsafe(`CREATE FUNCTION b2b_fail_friend() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId"='${receiver.user.id}' THEN RAISE EXCEPTION 'synthetic friend failure'; END IF; RETURN NEW; END $$`);await prisma.$executeRawUnsafe('CREATE TRIGGER b2b_fail_friend BEFORE INSERT ON "UserAchievement" FOR EACH ROW EXECUTE FUNCTION b2b_fail_friend()');
 try{assert.equal((await call(a,"friend-response",receiver.pair.accessToken,{friendshipId:friendship.id,action:"accept"})).status,500);assert.equal((await prisma.friendship.findUniqueOrThrow({where:{id:friendship.id}})).status,"PENDING");assert.equal(await prisma.userAchievement.count({where:{userId:{in:[sender.user.id,receiver.user.id]}}}),0);assert.equal(await prisma.activityFeedItem.count({where:{userId:{in:[sender.user.id,receiver.user.id]}}}),0);}finally{await prisma.$executeRawUnsafe('DROP TRIGGER b2b_fail_friend ON "UserAchievement"');await prisma.$executeRawUnsafe('DROP FUNCTION b2b_fail_friend()');}
 assert.equal((await call(b,"friend-response",receiver.pair.accessToken,{friendshipId:friendship.id,action:"accept"})).status,200);
});
test("session clock expiry during domain work rolls back a pending preference commit",async()=>{
 const {user,pair}=await account(),identity=await nativeSessionIdentity(pair.accessToken),key=itemKey();
 await prisma.$executeRawUnsafe(`CREATE FUNCTION b2b_slow_list() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId"='${user.id}' THEN PERFORM pg_sleep(0.45); END IF; RETURN NEW; END $$`);await prisma.$executeRawUnsafe('CREATE TRIGGER b2b_slow_list BEFORE INSERT ON "UserListOrder" FOR EACH ROW EXECUTE FUNCTION b2b_slow_list()');
 try{await prisma.nativeSession.update({where:{id:identity.binding.sessionId},data:{expiresAt:new Date(Date.now()+250)}});assert.equal((await call(a,"hide",pair.accessToken,{itemKey:key})).status,401);assert.equal(await prisma.userListOrder.count({where:{userId:user.id}}),0);}finally{await prisma.$executeRawUnsafe('DROP TRIGGER b2b_slow_list ON "UserListOrder"');await prisma.$executeRawUnsafe('DROP FUNCTION b2b_slow_list()');}
});
