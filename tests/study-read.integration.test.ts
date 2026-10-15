import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import { createStudyImport, executeStudyImport } from "../src/lib/studyContent/imports";
import { publishStudyRevision } from "../src/lib/studyContent/publication";
import { getStudyReader } from "../src/lib/studyContent/reader";
import {
  markStudyLessonRead,
  studyLessonContentKey,
  StudyReadError,
} from "../src/lib/studyContent/readStatus";

const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
const base = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
if (
  database.hostname !== "127.0.0.1" ||
  database.pathname !== "/versado_content_access_test" ||
  process.env.DATABASE_URL !== database.href ||
  base.hostname !== "127.0.0.1"
) throw new Error("Eigen geïsoleerde runner vereist");

let admin: { id: string; isAdmin: boolean };
let owner: { id: string; isAdmin: boolean };
let other: { id: string; isAdmin: boolean };
let collectionId: string, lessonId: string, editionId: string, revisionId: string, logicalContentKey: string;
let cookie: string, sessionKey: string;

async function account(isAdmin = false) {
  return prisma.user.create({
    data: {
      email: `${randomUUID()}@study-read.test.invalid`, passwordHash: "test-only",
      handle: `S${randomUUID().slice(0, 8)}`, discriminator: "00", isAdmin,
      hintBalance: 8, xpTotal: 41, timeZone: "Europe/Amsterdam",
    },
  });
}
async function source() {
  const key = `synthetic-study-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({
    data: {
      id: key, slug: key, name: "Synthetische leesles", work: key,
      editionKey: "fixture-v1", language: "nl", icon: "",
      publicationState: "PUBLISHED", visibleToUsers: true,
    },
  });
  return key;
}
async function publish(id: string, fixture: "sample" | "updated") {
  const run = await createStudyImport(admin, id, fixture);
  await executeStudyImport(admin, run.id);
  const item = await prisma.contentImportItem.findFirstOrThrow({
    where: { runId: run.id }, include: { edition: true },
  });
  await publishStudyRevision(admin, {
    editionId: item.lessonEditionId, revisionId: item.revisionId,
    importRunId: run.id, expectedVersion: item.edition.publicationVersion,
    actionId: randomUUID(), kind: "PUBLISH",
  });
  return item;
}
async function reader(actor = owner) {
  const value = await getStudyReader(actor, lessonId, collectionId, sessionKey);
  assert.ok(value);
  return value;
}
async function api(
  payload: unknown,
  options: { cookie?: string; session?: string; origin?: string } = {},
) {
  return fetch(`${base.origin}/api/study-read`, {
    method: "POST",
    headers: {
      ...(options.cookie === "" ? {} : { Cookie: options.cookie ?? cookie }),
      Origin: options.origin ?? base.origin,
      "X-Reading-Session": options.session ?? sessionKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
function action(revision = revisionId) {
  return { lessonEditionId: editionId, revisionId: revision, actionId: randomUUID() };
}
async function progress(userId = owner.id) {
  return prisma.contentProgress.findUnique({
    where: { userId_contentKey: { userId, contentKey: logicalContentKey } },
  });
}

before(async () => {
  admin = await account(true);
  owner = await account();
  other = await account();
  cookie = `${SESSION_COOKIE}=${await createSessionToken(owner.id)}`;
  sessionKey = createHash("sha256").update(cookie.slice(cookie.indexOf("=") + 1)).digest("hex");
  collectionId = await source();
  const item = await publish(collectionId, "sample");
  editionId = item.lessonEditionId;
  revisionId = item.revisionId;
  lessonId = item.edition.lessonId;
  logicalContentKey = studyLessonContentKey((await reader()).lesson);
});
after(async () => prisma.$disconnect());

test("openen, positioneren, preview-context en lezen maken geen READ of activiteit", async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  const value = await reader();
  assert.equal(value.readState.read, false);
  assert.equal(await progress(), null);
  assert.equal(await prisma.streakActivity.count({ where: { userId: owner.id } }), 0);
  assert.deepEqual(await prisma.user.findUnique({ where: { id: owner.id } }), before);
});

test("expliciet markeren slaat de logische lesstatus en precies één centrale activiteit atomair op", async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  const dto = await reader();
  const result = await markStudyLessonRead(owner, action(dto.lesson.revisionId));
  assert.equal(result.changed, true);
  assert.equal(result.state.read, true);
  assert.equal(result.counted, true);
  const row = await progress();
  assert.equal(row?.readStatus, "READ");
  assert.ok(row?.readAt);
  assert.equal(await prisma.streakActivity.count({ where: { userId: owner.id, key: `read:${studyLessonContentKey(dto.lesson)}` } }), 1);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  assert.equal(after.xpTotal, before.xpTotal);
  assert.equal(after.hintBalance, before.hintBalance);
});

test("retry, dubbel tikken en twee apparaten maken geen tweede status of activiteit", async () => {
  const second = await account();
  const dto = await reader({ id: second.id, isAdmin: false });
  const firstAction = action(dto.lesson.revisionId);
  const first = await markStudyLessonRead({ id: second.id, isAdmin: false }, firstAction);
  const lostResponseRetry = await markStudyLessonRead({ id: second.id, isAdmin: false }, firstAction);
  assert.equal(first.changed, true);
  assert.equal(lostResponseRetry.changed, false);
  const requests = await Promise.all(
    Array.from({ length: 3 }, () => markStudyLessonRead({ id: second.id, isAdmin: false }, action(dto.lesson.revisionId))),
  );
  assert.equal(requests.filter((value) => value.changed).length, 0);
  assert.equal(await prisma.contentProgress.count({ where: { userId: second.id, contentKey: studyLessonContentKey(dto.lesson) } }), 1);
  assert.equal(await prisma.streakActivity.count({ where: { userId: second.id, key: `read:${studyLessonContentKey(dto.lesson)}` } }), 1);
  const retry = await markStudyLessonRead({ id: second.id, isAdmin: false }, action(dto.lesson.revisionId));
  assert.equal(retry.changed, false);
  assert.equal(retry.state.read, true);
});

test("API is sessie-, origin- en gebruikergebonden en retourneert alleen eigen status", async () => {
  assert.equal((await api(action(), { cookie: "" })).status, 401);
  assert.equal((await api(action(), { origin: "https://unsafe.test.invalid" })).status, 403);
  assert.equal((await api(action(), { session: "wrong" })).status, 403);
  assert.equal((await api({ ...action(), userId: other.id })).status, 400);
  const response = await api(action());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const body = await response.text();
  assert.equal(body.includes(other.id), false);
  assert.equal(body.includes("passwordHash"), false);
});

test("nieuwe publicatierevisie behoudt READ; een oude eerste request registreert niets", async () => {
  const fresh = await account();
  const oldRevision = revisionId;
  const updated = await publish(collectionId, "updated");
  revisionId = updated.revisionId;
  await assert.rejects(
    markStudyLessonRead({ id: fresh.id, isAdmin: false }, action(oldRevision)),
    (error: unknown) => error instanceof StudyReadError && error.code === "REVISION_CHANGED",
  );
  const current = await reader();
  assert.equal(current.readState.read, true, "bestaande logische lesstatus blijft over revisies bestaan");
  assert.equal(await progress(fresh.id), null);
  assert.equal((await markStudyLessonRead({ id: fresh.id, isAdmin: false }, action())).changed, true);
});

test("verborgen, concept of ingetrokken bron levert geen nieuwe persoonlijke voortgang op", async () => {
  const blocked = await account();
  await prisma.contentCollection.update({ where: { id: collectionId }, data: { visibleToUsers: false } });
  try {
    await assert.rejects(markStudyLessonRead({ id: blocked.id, isAdmin: false }, action()), StudyReadError);
    assert.equal(await progress(blocked.id), null);
  } finally {
    await prisma.contentCollection.update({ where: { id: collectionId }, data: { visibleToUsers: true } });
  }
  await prisma.contentCollection.update({ where: { id: collectionId }, data: { publicationState: "DRAFT" } });
  try {
    await assert.rejects(markStudyLessonRead({ id: blocked.id, isAdmin: false }, action()), StudyReadError);
    assert.equal(await progress(blocked.id), null);
  } finally {
    await prisma.contentCollection.update({ where: { id: collectionId }, data: { publicationState: "PUBLISHED" } });
  }
});

test("een transactiefout schrijft noch READ noch centrale activiteit", async () => {
  const failing = await account();
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_study_read_failure() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'test-study-read-failure'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER test_study_read_failure BEFORE INSERT ON "ContentProgress"
      FOR EACH ROW WHEN (NEW."contentKey" LIKE 'study:%') EXECUTE FUNCTION test_study_read_failure();
  `);
  await assert.rejects(markStudyLessonRead({ id: failing.id, isAdmin: false }, action()));
  await prisma.$executeRawUnsafe('DROP TRIGGER test_study_read_failure ON "ContentProgress"; DROP FUNCTION test_study_read_failure();');
  assert.equal(await progress(failing.id), null);
  assert.equal(await prisma.streakActivity.count({ where: { userId: failing.id } }), 0);
});
