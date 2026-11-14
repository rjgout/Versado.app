import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { prisma } from "../src/lib/db";
import { seedNativeCourses } from "./fixtures/native-courses";
import {
  issueNativeSession,
  nativeSessionIdentity,
} from "../src/lib/native/sessions";
import { nativeReaderSchema } from "../src/lib/native/readerContract";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
const database = new URL(
    process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid",
  ),
  base = process.env.NATIVE_TEST_BASE_URL!;
if (
  database.hostname !== "127.0.0.1" ||
  database.pathname !== "/versado_content_access_test" ||
  database.href !== process.env.DATABASE_URL
)
  throw Error("Uitsluitend eigen geïsoleerde database");
let f: Awaited<ReturnType<typeof seedNativeCourses>>;
before(async () => {
  f = await seedNativeCourses();
});
after(async () => {
  await prisma.contentCollection.update({
    where: { id: f.collection.id },
    data: { enabled: false },
  });
  await prisma.$disconnect();
});
async function account() {
  const user = await f.account();
  return { user, pair: await issueNativeSession(user.id, user.sessionVersion) };
}
const path = (
  course = f.steps.id,
  kind = "steps",
  id = f.steps.lessons[1].id,
) => `courses/${course}/read/${kind}/${id}`;
function call(token?: string, p = path(), method = "GET", cookie?: string) {
  return fetch(`${base}/api/v1/native/${p}`, {
    method,
    headers: {
      Origin: "capacitor://localhost",
      "X-Versado-Client": "native-v1",
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}
async function allTables() {
  const db = new pg.Client({ connectionString: database.href });
  await db.connect();
  try {
    const { rows } = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    const result: Record<string, string> = {};
    for (const { tablename } of rows) {
      const escaped = tablename.replaceAll('"', '""');
      result[tablename] = (
        await db.query(
          `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM "${escaped}" t`,
        )
      ).rows[0].digest;
    }
    return result;
  } finally {
    await db.end();
  }
}

test("drie echte leeswijzen: juiste stapverzen en gekozen hoofdstuk; herhaalde GET verandert geen enkele databasetabel", async () => {
  const { user, pair } = await account(),
    before = await allTables();
  for (let attempt = 0; attempt < 2; attempt++) {
    const step = await call(pair.accessToken);
    assert.equal(step.status, 200, await step.clone().text());
    assert.equal(step.headers.get("cache-control"), "private, no-store");
    const value = nativeReaderSchema.parse(await step.json());
    assert.equal(value.chapterId, f.chapters[1].id);
    assert.deepEqual(
      value.verses.map((v) => v.number),
      [1, 2],
    );
    assert.equal(value.userId, user.id);
    assert.equal(value.kind, "steps");
    assert.equal(JSON.stringify(value).includes(user.email), false);
    for (const course of f.courses.filter(
      (c) => c.type !== "READING_LESSONS",
    )) {
      const response = await call(
        pair.accessToken,
        path(course.id, "chapters", f.chapters[1].id),
      );
      assert.equal(response.status, 200);
      const full = nativeReaderSchema.parse(await response.json());
      assert.deepEqual(
        full.verses.map((v) => v.number),
        [1, 2, 3, 4],
      );
      assert.equal(full.chapterId, f.chapters[1].id);
    }
  }
  assert.deepEqual(
    await allTables(),
    before,
    "Ook sessies, oefensessies, READ, XP, cursuspositie, annotaties en reeks blijven ongewijzigd",
  );
});
test("vergrendeling, bron/cursusidentiteit, methoden en sessies blijven serverautoritair", async () => {
  const { user, pair } = await account();
  assert.equal((await call()).status, 401);
  assert.equal(
    (
      await call(
        undefined,
        path(),
        "GET",
        `${SESSION_COOKIE}=${await createSessionToken(user.id)}`,
      )
    ).status,
    401,
  );
  for (const p of [
    path(f.steps.id, "steps", f.steps.lessons[2].id),
    path(f.steps.id, "chapters", f.chapters[1].id),
    path(f.courses[1].id, "steps", f.steps.lessons[1].id),
    path(f.steps.id, "steps", "unknown"),
  ])
    assert.equal((await call(pair.accessToken, p)).status, 404);
  assert.equal((await call(pair.accessToken, path(), "POST")).status, 404);
  assert.equal(
    (await call(pair.accessToken, path() + "?userId=other")).status,
    400,
  );
  const other = await seedNativeCourses("en");
  try {
    assert.equal(
      (
        await call(
          pair.accessToken,
          path(other.steps.id, "steps", other.steps.lessons[0].id),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          pair.accessToken,
          path(f.courses[2].id, "chapters", other.chapters[0].id),
        )
      ).status,
      404,
    );
  } finally {
    await prisma.contentCollection.update({
      where: { id: other.collection.id },
      data: { enabled: false },
    });
  }
  for (const patch of [
    { visibleToUsers: false },
    { visibleToUsers: true, publicationState: "DRAFT" as const },
    { publicationState: "PUBLISHED" as const, enabled: false },
  ]) {
    await prisma.contentCollection.update({
      where: { id: f.collection.id },
      data: patch,
    });
    assert.ok([404, 409].includes((await call(pair.accessToken)).status));
  }
  await prisma.contentCollection.update({
    where: { id: f.collection.id },
    data: {
      enabled: true,
      visibleToUsers: true,
      publicationState: "PUBLISHED",
    },
  });
  const identity = await nativeSessionIdentity(pair.accessToken);
  await prisma.nativeSession.update({
    where: { id: identity.binding.sessionId },
    data: { revokedAt: new Date() },
  });
  assert.equal((await call(pair.accessToken)).status, 401);
});
test("bestaande bevestigde verspositie wordt alleen gelezen; een andere gebruiker krijgt zijn eigen cursor en slot", async () => {
  const { user, pair } = await account();
  const content = await prisma.contentProgress.create({
    data: {
      userId: user.id,
      contentKey: "chapter:bofm/alma:32",
      lastChapterId: f.chapters[1].id,
      readStatus: "READING",
      readVerse: 1,
    },
  });
  // Gebruik de centrale identiteit, geen aanname over de sleutelindeling.
  const { contentKeyOf } = await import("../src/lib/learning/contentProgress");
  const canonical = contentKeyOf({
    id: f.chapters[1].id,
    number: 32,
    book: { key: f.book.key },
  });
  await prisma.contentProgress.update({
    where: { id: content.id },
    data: { contentKey: canonical },
  });
  const before = await allTables();
  const result = nativeReaderSchema.parse(
    await (await call(pair.accessToken)).json(),
  );
  assert.equal(result.focusVerse, 2);
  assert.deepEqual(await allTables(), before);
  const b = await account();
  await prisma.contentProgress.deleteMany({ where: { userId: b.user.id } });
  assert.equal((await call(b.pair.accessToken)).status, 404);
  assert.equal((await call(pair.accessToken)).status, 200);
});

// Eigen testview: alleen het lezen van de tekstkolom pauzeert. Pad-/countqueries blijven vrij.
// Dit bewijst de hercontrole NA autorisatie én tijdens de daadwerkelijke tekstquery, zonder productie-testhooks.
async function textRace(
  change: (userId: string, sessionId: string) => Promise<unknown>,
) {
  const { user, pair } = await account(),
    session = await nativeSessionIdentity(pair.accessToken),
    db = new pg.Client({ connectionString: database.href });
  await db.connect();
  const key = 526_831_051;
  let pending: Promise<Response> | undefined,
    view = false,
    locked = false;
  try {
    await db.query(
      "CREATE FUNCTION reader_test_text(value text) RETURNS text LANGUAGE plpgsql STABLE AS $$ BEGIN PERFORM pg_advisory_xact_lock(526831051); RETURN value; END $$",
    );
    await db.query('ALTER TABLE "Verse" RENAME TO "ReaderTestVerse"');
    const { rows } = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='ReaderTestVerse' ORDER BY ordinal_position",
    );
    await db.query(
      `CREATE VIEW "Verse" AS SELECT ${rows.map((r) => (r.column_name === "text" ? 'reader_test_text("text") AS "text"' : `"${r.column_name.replaceAll('"', '""')}"`)).join(",")} FROM "ReaderTestVerse"`,
    );
    view = true;
    await db.query("SELECT pg_advisory_lock($1)", [key]);
    locked = true;
    pending = call(pair.accessToken);
    let waiting = false;
    for (let i = 0; i < 120; i++) {
      const q = await db.query(
        "SELECT query FROM pg_stat_activity WHERE wait_event='advisory' AND pid<>pg_backend_pid() AND query LIKE '%\"Verse\"%' LIMIT 1",
      );
      if (q.rowCount) {
        assert.ok(
          q.rows[0].query.includes('"text"'),
          "De daadwerkelijke tekstselectie moet wachten",
        );
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(waiting, "Geen echte tekstlock bereikt");
    await change(user.id, session.binding.sessionId);
    await db.query("SELECT pg_advisory_unlock($1)", [key]);
    locked = false;
    return await pending;
  } finally {
    if (locked) await db.query("SELECT pg_advisory_unlock($1)", [key]);
    if (pending) await pending.catch(() => {});
    if (view) await db.query('DROP VIEW "Verse"');
    await db
      .query('ALTER TABLE "ReaderTestVerse" RENAME TO "Verse"')
      .catch(() => {});
    await db.query("DROP FUNCTION IF EXISTS reader_test_text(text)");
    await db.end();
  }
}
test("sessie-intrekking, verloop en verplichte beveiliging tijdens tekstladen geven geen tekst vrij", async () => {
  assert.equal(
    (
      await textRace((_, id) =>
        prisma.nativeSession.update({
          where: { id },
          data: { revokedAt: new Date() },
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await textRace(async (_, id) => {
        await prisma.nativeSession.update({
          where: { id },
          data: { expiresAt: new Date(Date.now() + 100) },
        });
        await new Promise((r) => setTimeout(r, 150));
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await textRace((id) =>
        prisma.user.update({
          where: { id },
          data: { mustChangePassword: true },
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await textRace((id) =>
        prisma.user.update({
          where: { id },
          data: { isAdmin: true, totpEnabled: false },
        }),
      )
    ).status,
    401,
  );
});
test("bron-ABA, taal en ingetrokken cursus-/bronrechten tijdens tekstladen verwerpen oude antwoorden", async () => {
  assert.equal(
    (
      await textRace(async (id) => {
        await prisma.user.update({
          where: { id },
          data: {
            activeContentCollectionId: null,
          },
        });
        await prisma.user.update({
          where: { id },
          data: {
            activeContentCollectionId: f.collection.id,
          },
        });
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await textRace((id) =>
        prisma.user.update({ where: { id }, data: { uiLanguage: "en" } }),
      )
    ).status,
    409,
  );
  try {
    assert.equal(
      (
        await textRace(() =>
          prisma.course.update({
            where: { id: f.steps.id },
            data: { enabled: false },
          }),
        )
      ).status,
      404,
    );
  } finally {
    await prisma.course.update({
      where: { id: f.steps.id },
      data: { enabled: true },
    });
  }
  try {
    assert.ok(
      [404, 409].includes(
        (
          await textRace(() =>
            prisma.contentCollection.update({
              where: { id: f.collection.id },
              data: { visibleToUsers: false },
            }),
          )
        ).status,
      ),
    );
  } finally {
    await prisma.contentCollection.update({
      where: { id: f.collection.id },
      data: { visibleToUsers: true },
    });
  }
});
test("lege, onvolledige en te grote tekst wordt geweigerd zonder afknippen of voortgangswrites", async () => {
  const { pair } = await account(),
    free = f.courses.find((c) => c.type === "FREE_CHOICE")!;
  const huge = await prisma.chapter.create({
    data: {
      bookId: f.book.id,
      number: 99,
      order: 99,
      verses: {
        create: Array.from({ length: 501 }, (_, i) => ({
          number: i + 1,
          text: "Test",
        })),
      },
    },
  });
  await prisma.courseChapter.create({
    data: { courseId: free.id, chapterId: huge.id, order: 99 },
  });
  assert.equal(
    (await call(pair.accessToken, path(free.id, "chapters", huge.id))).status,
    404,
  );
  await prisma.verse.deleteMany({
    where: { chapterId: huge.id, number: { gt: 40 } },
  });
  await prisma.verse.updateMany({
    where: { chapterId: huge.id },
    data: { text: "x".repeat(19000) },
  });
  assert.equal(
    (await call(pair.accessToken, path(free.id, "chapters", huge.id))).status,
    404,
  );
  await prisma.verse.deleteMany({ where: { chapterId: huge.id } });
  assert.equal(
    (await call(pair.accessToken, path(free.id, "chapters", huge.id))).status,
    404,
  );
});

// B3b-2a: uitsluitend de cursor binnen ContentProgress mag veranderen.
async function positionCall(token:string,p:string,input:unknown) {
  return fetch(`${base}/api/v1/native/${p}/position`,{method:"POST",headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1","Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(input)});
}
const positionInput=(reader:{activeCollectionId:string;selectionVersion:number;language:string},verse:number,expectedVersion=0)=>({...reader,verse,expectedVersion,actionId:crypto.randomUUID()});
function wireInput(reader:{activeCollectionId:string;selectionVersion:number;language:string;chapterId:string;startVerse:number;endVerse:number},verse:number,expectedVersion=0) {
  return {...positionInput({activeCollectionId:reader.activeCollectionId,selectionVersion:reader.selectionVersion,language:reader.language},verse,expectedVersion),chapterId:reader.chapterId,startVerse:reader.startVerse,endVerse:reader.endVerse};
}
test("hervat-GET schrijft niets; passief opslaan/replay verandert uitsluitend readerPositions en kent geen READ/XP/reeks toe",async()=>{
  const {user,pair}=await account(),p=path();
  const chapter=f.chapters[1];
  const key=(await import("../src/lib/learning/contentProgress")).contentKeyOf({id:chapter.id,number:chapter.number,book:{key:f.book.key}});
  await prisma.contentProgress.create({data:{userId:user.id,contentKey:key}});
  const before=await allTables();
  const response=await call(pair.accessToken,p+"/resume");assert.equal(response.status,200);
  const state=await response.json();assert.equal(state.positionVersion,0);assert.equal(state.previous,null);assert.equal(state.next,null);
  assert.deepEqual(await allTables(),before,"GET mag geen databasewrites doen");
  const old=await prisma.contentProgress.findUniqueOrThrow({where:{userId_contentKey:{userId:user.id,contentKey:key}}});
  const input=wireInput(state.reader,2);
  assert.equal((await positionCall(pair.accessToken,p,{...input,chapterId:f.chapters[0].id})).status,409,"verouderde hoofdstukidentiteit");
  assert.equal((await positionCall(pair.accessToken,p,{...input,endVerse:4})).status,409,"verouderde leesstapgrenzen");
  assert.equal((await positionCall(pair.accessToken,p,{...input,userId:"andere-gebruiker"})).status,400,"geen identiteit uit de body");
  const first=await positionCall(pair.accessToken,p,input);assert.equal(first.status,200);const saved=await first.json();assert.equal(saved.version,1);
  const after=await allTables();
  for(const table of Object.keys(before))if(table!=="ContentProgress")assert.equal(after[table],before[table],`onbedoelde wijziging ${table}`);
  const current=await prisma.contentProgress.findUniqueOrThrow({where:{id:old.id}});
  assert.deepEqual({...current,readerPositions:{}},{...old,readerPositions:{}});
  assert.equal(current.readStatus,null);assert.equal(current.readVerse,0);assert.equal(current.readAt,null);
  assert.deepEqual(await (await positionCall(pair.accessToken,p,input)).json(),saved);
  assert.deepEqual(await allTables(),after,"idempotente retry schrijft niets");
  const reopened=await (await call(pair.accessToken,p+"/resume")).json();
  assert.equal(reopened.reader.focusVerse,2);assert.equal(reopened.positionVersion,1);
  assert.equal((await positionCall(pair.accessToken,p,{...input,verse:1})).status,409);
  assert.equal((await positionCall(pair.accessToken,p,{...input,actionId:crypto.randomUUID(),verse:3,expectedVersion:1})).status,400,"buiten de eigen leesstap");
});
test("twee gelijktijdige claims en late replay behouden precies één versie; andere cursus krijgt eigen cursor",async()=>{
  const {pair}=await account(),p=path();const state=await (await call(pair.accessToken,p+"/resume")).json();
  const inputs=[wireInput(state.reader,1),wireInput(state.reader,2)];
  const responses=await Promise.all(inputs.map(input=>positionCall(pair.accessToken,p,input)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const winner=inputs[responses.findIndex(r=>r.status===200)];
  const newer=wireInput(state.reader,winner.verse===1?2:1,1);
  assert.equal((await positionCall(pair.accessToken,p,newer)).status,200);
  assert.equal((await positionCall(pair.accessToken,p,winner)).status,409);
  const other=await (await call(pair.accessToken,path(f.courses[2].id,"chapters",f.chapters[1].id)+"/resume")).json();
  assert.equal(other.positionVersion,0);assert.equal(other.reader.focusVerse,1);
  assert.equal((await (await call(pair.accessToken,p+"/resume")).json()).positionVersion,2);
});
test("hoofdstuknavigatie volgt cursusvolgorde/locks; stap-voor-stap biedt nooit een volgende stap aan",async()=>{
  const {pair}=await account();
  for(const course of f.courses.slice(1)){
    const one=await (await call(pair.accessToken,path(course.id,"chapters",f.chapters[0].id)+"/resume")).json();
    assert.equal(one.previous,null);assert.equal(one.next,f.chapters[1].id);
    const two=await (await call(pair.accessToken,path(course.id,"chapters",f.chapters[1].id)+"/resume")).json();
    assert.equal(two.previous,f.chapters[0].id);assert.equal(two.next,null);
  }
  const unstarted=await f.account();await prisma.contentProgress.deleteMany({where:{userId:unstarted.id}});
  const tokens=await issueNativeSession(unstarted.id,unstarted.sessionVersion);
  const first=await (await call(tokens.accessToken,path(f.courses[1].id,"chapters",f.chapters[0].id)+"/resume")).json();
  assert.equal(first.next,null,"vergrendeld volgende hoofdstuk blijft afgeschermd");
  const firstPath=path(f.courses[1].id,"chapters",f.chapters[0].id);
  assert.equal((await positionCall(tokens.accessToken,firstPath,wireInput(first.reader,4))).status,200,"laatste vers is alleen een hervatpunt");
  assert.equal((await (await call(tokens.accessToken,firstPath+"/resume")).json()).next,null,"bewaren van het laatste vers ontgrendelt niets");

  assert.equal((await call(tokens.accessToken,path(f.courses[1].id,"chapters",f.chapters[1].id)+"/resume")).status,404);
  const step=await (await call(pair.accessToken,path()+"/resume")).json();assert.equal(step.previous,null);assert.equal(step.next,null);
});
test("alle drie de leesmethoden en vijf talen bewaren eigen positie zonder beloningswrites",async()=>{
  for(const language of ["nl","en","de","fr","es"]){
    const fixture=await seedNativeCourses(language),user=await fixture.account(language),tokens=await issueNativeSession(user.id,user.sessionVersion);
    for(const course of fixture.courses){
      const kind=course.type==="READING_LESSONS"?"steps":"chapters",target=kind==="steps"?fixture.steps.lessons[1].id:fixture.chapters[1].id,p=path(course.id,kind,target);
      const state=await (await call(tokens.accessToken,p+"/resume")).json();
      assert.equal(state.reader.sourceLanguage,language);assert.equal(state.reader.language,language);
      assert.equal((await positionCall(tokens.accessToken,p,wireInput(state.reader,2))).status,200);
      const resumed=await (await call(tokens.accessToken,p+"/resume")).json();assert.equal(resumed.reader.focusVerse,2);
    }
    const updated=await prisma.user.findUniqueOrThrow({where:{id:user.id}});
    assert.deepEqual(updated,user);
    assert.equal(await prisma.userCourseLessonProgress.count({where:{userId:user.id}}),0);
    await prisma.contentCollection.update({where:{id:fixture.collection.id},data:{enabled:false}});
  }
});
test("bronversie, verkeerde gebruiker en ingetrokken sessie mogen niet opslaan",async()=>{
  const {pair}=await account(),p=path(),state=await (await call(pair.accessToken,p+"/resume")).json(),input=wireInput(state.reader,2);
  assert.equal((await positionCall(pair.accessToken,p,{...input,selectionVersion:state.reader.selectionVersion+1})).status,409);
  const outsider=await f.account();await prisma.user.update({where:{id:outsider.id},data:{activeContentCollectionId:null}});await prisma.user.update({where:{id:outsider.id},data:{activeContentCollectionId:f.collection.id}});
  const other=await issueNativeSession(outsider.id,outsider.sessionVersion);
  assert.notEqual((await positionCall(other.accessToken,p,input)).status,200);
  const binding=(await nativeSessionIdentity(pair.accessToken)).binding;
  await prisma.nativeSession.update({where:{id:binding.sessionId},data:{revokedAt:new Date()}});
  const before=await allTables();assert.equal((await positionCall(pair.accessToken,p,input)).status,401);assert.deepEqual(await allTables(),before);
});

test("sessie-, beveiligings- en bronwijzigingen tijdens User-lockwachten verhinderen de cursorcommit",async()=>{
  for(const kind of ["logout","expiry","password","setup","2fa","delete","source","language"]){
    const {pair}=await account(),p=path(),state=await (await call(pair.accessToken,p+"/resume")).json(),input=wireInput(state.reader,2);
    const binding=(await nativeSessionIdentity(pair.accessToken)).binding;
    const lock=new pg.Client({connectionString:database.href});await lock.connect();
    let pending:Promise<Response>|undefined;
    try {
      await lock.query("BEGIN");await lock.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',[binding.userId]);
      const xid=(await lock.query('SELECT pg_current_xact_id()::text AS xid')).rows[0].xid;
      pending=positionCall(pair.accessToken,p,input);
      let waiting=false;
      for(let i=0;i<50;i++){
        const {rows}=await lock.query("SELECT 1 FROM pg_locks WHERE NOT granted AND locktype='transactionid' AND transactionid=$1::xid",[xid]);
        if(rows.length){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.ok(waiting,"de HTTP-mutatie wacht aantoonbaar op de User-lock");
      if(kind==="logout")await lock.query('UPDATE "NativeSession" SET "revokedAt"=NOW() WHERE id=$1',[binding.sessionId]);
      else if(kind==="expiry")await lock.query('UPDATE "NativeSession" SET "createdAt"=NOW()-INTERVAL \'1 minute\', "expiresAt"=NOW()-INTERVAL \'1 second\' WHERE id=$1',[binding.sessionId]);
      else if(kind==="password")await lock.query('UPDATE "User" SET "sessionVersion"="sessionVersion"+1 WHERE id=$1',[binding.userId]);
      else if(kind==="setup")await lock.query('UPDATE "User" SET "mustChangePassword"=true WHERE id=$1',[binding.userId]);
      else if(kind==="2fa")await lock.query('UPDATE "User" SET "isAdmin"=true,"totpEnabled"=false WHERE id=$1',[binding.userId]);
      else if(kind==="source"){
        await lock.query('UPDATE "User" SET "activeContentCollectionId"=NULL WHERE id=$1',[binding.userId]);
        await lock.query('UPDATE "User" SET "activeContentCollectionId"=$2 WHERE id=$1',[binding.userId,f.collection.id]);
      }
      else if(kind==="language")await lock.query('UPDATE "User" SET "uiLanguage"=$2 WHERE id=$1',[binding.userId,"en"]);
      else await lock.query('DELETE FROM "User" WHERE id=$1',[binding.userId]);
      await lock.query("COMMIT");
      assert.equal((await pending).status,["source","language"].includes(kind)?409:401);
      const rows=await prisma.contentProgress.findMany({where:{userId:binding.userId}});
      assert.ok(rows.every(row=>JSON.stringify(row.readerPositions)==="{}"));
    }finally{await lock.query("ROLLBACK");await lock.end();if(pending)await pending;}
  }
});
test("databasefout rolt cursor volledig terug; dezelfde actie kan daarna veilig slagen",async()=>{
  const {user,pair}=await account(),p=path(),state=await (await call(pair.accessToken,p+"/resume")).json(),input=wireInput(state.reader,2);
  const key=(await import("../src/lib/learning/contentProgress")).contentKeyOf({id:f.chapters[1].id,number:32,book:{key:f.book.key}});
  const progress=await prisma.contentProgress.create({data:{userId:user.id,contentKey:key}});
  const sql=new pg.Client({connectionString:database.href});await sql.connect();
  try {
    await sql.query('CREATE FUNCTION reader_position_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'synthetic cursor rollback\'; END $$');
    await sql.query('CREATE TRIGGER reader_position_fault BEFORE UPDATE OF "readerPositions" ON "ContentProgress" FOR EACH ROW EXECUTE FUNCTION reader_position_fault()');
    const response=await positionCall(pair.accessToken,p,input);assert.equal(response.status,500);
    assert.deepEqual(await prisma.contentProgress.findUniqueOrThrow({where:{id:progress.id}}),progress);
  } finally {
    await sql.query('DROP TRIGGER IF EXISTS reader_position_fault ON "ContentProgress"');
    await sql.query('DROP FUNCTION IF EXISTS reader_position_fault()');await sql.end();
  }
  assert.equal((await positionCall(pair.accessToken,p,input)).status,200);
  assert.equal((await (await call(pair.accessToken,p+"/resume")).json()).positionVersion,1);
});
test("additieve cursormigratie behoudt oude rijen en is transactioneel terug te draaien",async()=>{
  const {readFile}=await import("node:fs/promises");
  const sql=new pg.Client({connectionString:database.href});await sql.connect();
  try {
    await sql.query("BEGIN");
    await sql.query('ALTER TABLE "ContentProgress" DROP COLUMN "readerPositions"');
    const before=(await sql.query('SELECT to_jsonb(p) AS row FROM "ContentProgress" p ORDER BY id')).rows;
    await sql.query("SAVEPOINT before_cursor_migration");
    await sql.query(await readFile("prisma/migrations/20261208120000_scripture_reader_positions/migration.sql","utf8"));
    const after=(await sql.query('SELECT to_jsonb(p)-\'readerPositions\' AS row, "readerPositions" AS positions FROM "ContentProgress" p ORDER BY id')).rows;
    assert.deepEqual(after.map(({row})=>({row})),before);assert.ok(after.every(r=>JSON.stringify(r.positions)==="{}"));
    await sql.query("ROLLBACK TO before_cursor_migration");
    assert.equal((await sql.query("SELECT column_name FROM information_schema.columns WHERE table_name='ContentProgress' AND column_name='readerPositions'")).rowCount,0);
  }finally{await sql.query("ROLLBACK");await sql.end();}
});

test("cursorcommit gebruikt één verbinding en put een volledig bezette databasepool niet uit",async()=>{
  const {execFile}=await import("node:child_process");
  const {promisify}=await import("node:util");
  const runWorker=promisify(execFile);
  const {pair}=await account(),{binding}=await nativeSessionIdentity(pair.accessToken);
  for(const course of f.courses) {
    const kind=course.type==="READING_LESSONS"?"steps":"chapters",targetId=kind==="steps"?f.steps.lessons[1].id:f.chapters[1].id;
    const state=await (await call(pair.accessToken,path(course.id,kind,targetId)+"/resume")).json();
    // Laat de eventloop de keep-alive-FIN verwerken terwijl de worker draait;
    // spawnSync kan anders daarna een reeds gesloten HTTP-socket hergebruiken.
    const result=await runWorker(process.execPath,["--import","tsx","tests/fixtures/native-reader-position-worker.ts",JSON.stringify({binding,courseId:course.id,kind,targetId,input:wireInput(state.reader,2)})],{env:process.env,encoding:"utf8",timeout:12000});
    assert.equal(JSON.parse(result.stdout).version,1);
  }
});

test("stapgrenzen en boekidentiteit kunnen niet tussen autorisatie en cursorcommit wijzigen",async()=>{
  const {user,pair}=await account(),p=path(),state=await (await call(pair.accessToken,p+"/resume")).json();
  const key=(await import("../src/lib/learning/contentProgress")).contentKeyOf({id:f.chapters[1].id,number:32,book:{key:f.book.key}});
  await prisma.contentProgress.create({data:{userId:user.id,contentKey:key}});
  const barrier=new pg.Client({connectionString:database.href}),editor=new pg.Client({connectionString:database.href});await barrier.connect();await editor.connect();
  let pending:Promise<Response>|undefined;
  try {
    await barrier.query('CREATE FUNCTION reader_position_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(876543210); RETURN NEW; END $$');
    await barrier.query('CREATE TRIGGER reader_position_barrier BEFORE UPDATE OF "readerPositions" ON "ContentProgress" FOR EACH ROW EXECUTE FUNCTION reader_position_barrier()');
    await barrier.query('SELECT pg_advisory_lock(876543210)');
    pending=positionCall(pair.accessToken,p,wireInput(state.reader,2));
    let waiting=false;
    for(let i=0;i<100;i++){
      const {rows}=await barrier.query("SELECT query FROM pg_stat_activity WHERE wait_event='advisory' AND pid<>pg_backend_pid()");
      if(rows.some(r=>r.query.includes('"readerPositions"'))){waiting=true;break;}
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.ok(waiting,"cursorupdate is na de autorisatie aantoonbaar onderbroken");
    await editor.query("SET lock_timeout='150ms'");
    await assert.rejects(editor.query('UPDATE "CourseLesson" SET "endVerse"=3 WHERE id=$1',[f.steps.lessons[1].id]),(error:unknown)=>!!error&&typeof error==="object"&&"code"in error&&error.code==="55P03");
    await assert.rejects(editor.query('UPDATE "Book" SET key=\'bofm/ander\' WHERE id=$1',[f.book.id]),(error:unknown)=>!!error&&typeof error==="object"&&"code"in error&&error.code==="55P03");
    await barrier.query('SELECT pg_advisory_unlock(876543210)');
    assert.equal((await pending).status,200);
    assert.equal((await prisma.courseLesson.findUniqueOrThrow({where:{id:f.steps.lessons[1].id}})).endVerse,2);
    assert.equal((await prisma.book.findUniqueOrThrow({where:{id:f.book.id}})).key,f.book.key);
  }finally{
    await barrier.query('SELECT pg_advisory_unlock(876543210)');if(pending)await pending;
    await barrier.query('DROP TRIGGER IF EXISTS reader_position_barrier ON "ContentProgress"');await barrier.query('DROP FUNCTION IF EXISTS reader_position_barrier()');
    await editor.end();await barrier.end();
  }
});

test("dezelfde gebruiker behoudt aparte hervatpunten voor twee tekstuitgaven met dezelfde canonieke inhoud",async()=>{
  const a=await seedNativeCourses("nl"),b=await seedNativeCourses("en"),user=await a.account(),tokens=await issueNativeSession(user.id,user.sessionVersion);
  try {
    const aPath=path(a.steps.id,"steps",a.steps.lessons[1].id),bPath=path(b.steps.id,"steps",b.steps.lessons[1].id);
    const first=await (await call(tokens.accessToken,aPath+"/resume")).json();
    assert.equal((await positionCall(tokens.accessToken,aPath,wireInput(first.reader,2))).status,200);
    await prisma.user.update({where:{id:user.id},data:{uiLanguage:"de"}});
    const translated=await (await call(tokens.accessToken,aPath+"/resume")).json();assert.equal(translated.reader.language,"de");assert.equal(translated.reader.focusVerse,2);
    await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:b.collection.id,contentLanguage:"en",uiLanguage:"en"}});
    assert.notEqual((await call(tokens.accessToken,aPath+"/resume")).status,200);
    const second=await (await call(tokens.accessToken,bPath+"/resume")).json();assert.equal(second.positionVersion,0);
    assert.equal((await positionCall(tokens.accessToken,bPath,wireInput(second.reader,1))).status,200);
    await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:a.collection.id,contentLanguage:"nl",uiLanguage:"nl"}});
    const restored=await (await call(tokens.accessToken,aPath+"/resume")).json();assert.equal(restored.reader.focusVerse,2);assert.equal(restored.positionVersion,1);
    const progress=await prisma.contentProgress.findUniqueOrThrow({where:{userId_contentKey:{userId:user.id,contentKey:"bofm/alma#32"}}});
    assert.equal(Object.keys(progress.readerPositions as object).length,2);
    assert.equal(progress.readStatus,null);assert.equal(progress.readVerse,0);assert.equal(progress.readAt,null);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).xpTotal,user.xpTotal);
  }finally{for(const fixture of [a,b])await prisma.contentCollection.update({where:{id:fixture.collection.id},data:{enabled:false}});}
});
