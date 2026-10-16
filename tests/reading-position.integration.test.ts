import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import {
  appendStudyRevision,
  getPublishedStudyLesson,
} from "../src/lib/studyContent/revisions";
import {
  createStudyImport,
  executeStudyImport,
} from "../src/lib/studyContent/imports";
import { publishStudyRevision } from "../src/lib/studyContent/publication";
import {
  getReadingPosition,
  saveReadingPosition,
  ReadingPositionError,
} from "../src/lib/studyContent/readingPosition";
import {
  readingStart,
  type ReadingPositionAction,
} from "../src/lib/studyContent/readingPositionContract";
import { getStudyReader } from "../src/lib/studyContent/reader";
import { issueReadingVisitProof, READING_VISIT_TTL_SECONDS } from "../src/lib/studyContent/readingVisitProof";
import { studyRevisionFixture } from "./fixtures/study-content";
const url = new URL(
    process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid",
  ),
  base = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
if (
  url.hostname !== "127.0.0.1" ||
  url.pathname !== "/versado_content_access_test" ||
  process.env.DATABASE_URL !== url.href ||
  base.hostname !== "127.0.0.1"
)
  throw new Error("Eigen geïsoleerde runner vereist");
let admin: { id: string; isAdmin: boolean },
  owner: { id: string; isAdmin: boolean },
  other: { id: string; isAdmin: boolean },
  cookie: string,
  adminCookie: string;
let ownerSession: string, adminSession: string;
let collection: string, editionId: string, lessonId: string, revisionId: string;
async function account(isAdmin = false) {
  return prisma.user.create({
    data: {
      email: `${randomUUID()}@reading.test.invalid`,
      passwordHash: "test-only",
      handle: `R${randomUUID().slice(0, 8)}`,
      discriminator: "00",
      isAdmin,
      hintBalance: 8,
      xpTotal: 123,
      timeZone: "Europe/Amsterdam",
    },
  });
}
async function source() {
  const key = `synthetic-study-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({
    data: {
      id: key,
      slug: key,
      name: "Synthetische readerbron",
      work: key,
      editionKey: "fixture-v1",
      language: "nl",
      icon: "",
      visibleToUsers: true,
      publicationState: "PUBLISHED",
    },
  });
  return key;
}
async function publish(id: string, fixture: "sample" | "updated") {
  const run = await createStudyImport(admin, id, fixture);
  await executeStudyImport(admin, run.id);
  const item = await prisma.contentImportItem.findFirstOrThrow({
    where: { runId: run.id },
    include: { edition: true },
  });
  await publishStudyRevision(admin, {
    editionId: item.lessonEditionId,
    revisionId: item.revisionId,
    importRunId: run.id,
    expectedVersion: item.edition.publicationVersion,
    actionId: randomUUID(),
    kind: "PUBLISH",
  });
  return item;
}
async function action(
  patch: Partial<ReadingPositionAction> = {},
): Promise<ReadingPositionAction> {
  const s = await getReadingPosition(owner, editionId),
    lesson = await getPublishedStudyLesson(owner, lessonId, collection);
  assert.ok(lesson);
  return {
    ...readingStart(lesson.body, lesson.revisionId),
    lessonEditionId: editionId,
    expectedVersion: s.position?.version ?? 0,
    actionId: randomUUID(),
    intent: "SAVE",
    ...patch,
  };
}
async function api(
  method: "GET" | "PUT",
  payload?: unknown,
  auth = cookie,
  origin = base.origin,
) {
  return fetch(
    `${base.origin}/api/reading-position${method === "GET" ? `?lessonEditionId=${editionId}` : ""}`,
    {
      method,
      headers: {
        ...(auth ? { Cookie: auth } : {}),
        Origin: origin,
        "X-Reading-Session": auth === adminCookie ? adminSession : ownerSession,
        "Content-Type": "application/json",
      },
      ...(method === "PUT" ? { body: JSON.stringify(payload) } : {}),
    },
  );
}
before(async () => {
  const a = await account(true),
    u = await account(),
    v = await account();
  admin = a;
  owner = u;
  other = v;

  cookie = `${SESSION_COOKIE}=${await createSessionToken(u.id)}`;
  adminCookie = `${SESSION_COOKIE}=${await createSessionToken(a.id)}`;
  ownerSession = createHash("sha256")
    .update(cookie.slice(cookie.indexOf("=") + 1))
    .digest("hex");
  adminSession = createHash("sha256")
    .update(adminCookie.slice(adminCookie.indexOf("=") + 1))
    .digest("hex");
  collection = await source();
  const item = await publish(collection, "sample");
  editionId = item.lessonEditionId;
  revisionId = item.revisionId;
  lessonId = (
    await prisma.studyLessonEdition.findUniqueOrThrow({
      where: { id: editionId },
    })
  ).lessonId;
});
after(async () => {
  await prisma.$disconnect();
});
test("anoniem 401, strikte userId-payload en onveilige Origin geweigerd", async () => {
  assert.equal((await api("GET", undefined, "")).status, 401);
  assert.equal(
    (await api("PUT", { ...(await action()), userId: other.id })).status,
    400,
  );
  assert.equal(
    (await api("PUT", await action(), cookie, "https://unsafe.test.invalid"))
      .status,
    403,
  );
});
test("GET en openen reader maken geen rij, context, READ, XP of reeks", async () => {
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: owner.id },
  });
  assert.equal((await getReadingPosition(owner, editionId)).position, null);
  assert.ok(await getStudyReader(owner, lessonId, collection));
  assert.equal(
    await prisma.readingPosition.count({ where: { userId: owner.id } }),
    0,
  );
  assert.deepEqual(
    await prisma.user.findUnique({ where: { id: owner.id } }),
    before,
  );
});
test("één opgeslagen eigen positie, private API en exacte serverquote; andere gebruiker ziet niets", async () => {
  const a = await action({ sectionFraction: 0.35 });
  const r = await api("PUT", a);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control")!, /no-store/);
  const body = await r.json();
  assert.equal(body.state.position.version, 1);
  assert.equal(body.state.position.sectionFraction, 0.35);
  assert.ok(body.state.position.quoteContext);
  assert.equal((await getReadingPosition(other, editionId)).position, null);
  const text = await (await api("GET")).text();
  assert.equal(text.includes(owner.id), false);
  assert.equal(text.includes("passwordHash"), false);
});
test("zelfde actionId kost geen nieuwe versie; andere inhoud met dezelfde actionId wordt geweigerd", async () => {
  const a = await action({ sectionFraction: 0.4 });
  const first = await saveReadingPosition(owner, a);
  assert.deepEqual(await saveReadingPosition(owner, a), {
    changed: false,
    state: first.state,
  });
  await assert.rejects(
    saveReadingPosition(owner, { ...a, sectionFraction: 0.5 }),
    (e: unknown) => e instanceof ReadingPositionError && e.code === "INVALID",
  );
});
test("ongewijzigde autosave schrijft niets; twee gelijktijdige writes geven één herstelbaar conflict", async () => {
  const a = await action({ sectionFraction: 0.6 });
  const version = a.expectedVersion;
  const result = await Promise.allSettled([
    saveReadingPosition(owner, a),
    saveReadingPosition(owner, {
      ...a,
      actionId: randomUUID(),
      sectionFraction: 0.7,
    }),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await getReadingPosition(owner, editionId)).position?.version,
    version + 1,
  );
  const current = (await getReadingPosition(owner, editionId)).position!;
  assert.equal(
    (
      await saveReadingPosition(
        owner,
        await action({ sectionFraction: current.sectionFraction }),
      )
    ).changed,
    false,
  );
});
test("dubbele eerste creatie maakt geen dubbele rij", async () => {
  const a = { ...(await action({ sectionFraction: 0.2 })), expectedVersion: 0 };
  const results = await Promise.allSettled([
    saveReadingPosition(other, a),
    saveReadingPosition(other, {
      ...a,
      actionId: randomUUID(),
      sectionFraction: 0.3,
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    await prisma.readingPosition.count({
      where: { userId: other.id, lessonEditionId: editionId },
    }),
    1,
  );
});
test("oude retry kan na start-over niet terugschrijven; server 409 bevat alleen eigen context", async () => {
  const old = await action({ sectionFraction: 0.8 });
  await saveReadingPosition(owner, old);
  await saveReadingPosition(
    owner,
    await action({ intent: "START_OVER", sectionFraction: 0 }),
  );
  const r = await api("PUT", old);
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.state.position.sectionFraction, 0);
  assert.equal(body.state.position.lessonEditionId, editionId);
});
test("ongeldige ankers, quotes, fracties en gefingeerde resets worden niet opgeslagen", async () => {
  const before = await getReadingPosition(owner, editionId);
  for (const patch of [
    { sectionAnchor: "missing" },
    { blockAnchor: "missing" },
    { sectionFraction: 1.1 },
    { intent: "START_OVER", sectionFraction: 0.5 },
  ])
    assert.equal(
      (await api("PUT", { ...(await action()), ...patch })).status,
      400,
    );
  assert.equal(
    (
      await api("PUT", {
        ...(await action()),
        quoteContext: "my invented quote",
      })
    ).status,
    400,
  );
  assert.deepEqual(await getReadingPosition(owner, editionId), before);
});
test("SQL-constraints bewaken editie, ankers, fraction, versie en eigenaarschap", async () => {
  const existing = await prisma.readingPosition.findUniqueOrThrow({
    where: {
      userId_lessonEditionId: { userId: owner.id, lessonEditionId: editionId },
    },
  });
  for (const data of [
    { userId: "absent-user" },
    { lessonEditionId: "absent-edition" },
    { blockAnchor: "absent-block" },
    { sectionFraction: 2 },
    { sectionFraction: NaN },
    { version: 0 },
  ])
    await assert.rejects(
      prisma.readingPosition.update({
        where: {
          userId_lessonEditionId: {
            userId: owner.id,
            lessonEditionId: editionId,
          },
        },
        data,
      }),
    );
  assert.deepEqual(
    await prisma.readingPosition.findUnique({
      where: {
        userId_lessonEditionId: {
          userId: owner.id,
          lessonEditionId: editionId,
        },
      },
    }),
    existing,
  );
});
test("concept/cross-edition-revisie is geen normale positiedoel, ook niet voor admin", async () => {
  const draft = await appendStudyRevision(admin, editionId, {
    ...studyRevisionFixture(),
    title: "Synthetisch concept",
  });
  await assert.rejects(
    saveReadingPosition(owner, await action({ revisionId: draft.id })),
    (e: unknown) =>
      e instanceof ReadingPositionError && e.code === "UNAVAILABLE",
  );
  // Zelfs een geldig ondertekend token creëert geen publicatiebewijs voor concepten.
  await assert.rejects(
    saveReadingPosition(
      owner,
      await action({
        revisionId: draft.id,
        visitProof: issueReadingVisitProof(owner.id, editionId, draft.id, ownerSession),
      }),
      prisma,
      ownerSession,
    ),
    (e: unknown) =>
      e instanceof ReadingPositionError && e.code === "UNAVAILABLE",
  );
  const otherSource = await source();
  const item = await publish(otherSource, "sample");
  await assert.rejects(
    saveReadingPosition(owner, await action({ revisionId: item.revisionId })),
    (e: unknown) =>
      e instanceof ReadingPositionError && e.code === "UNAVAILABLE",
  );
  assert.equal(
    (
      await api(
        "PUT",
        { ...(await action()), revisionId: draft.id, expectedVersion: 0 },
        adminCookie,
      )
    ).status,
    404,
  );
});
test("oude revisie vereist een echt, nog geldig en sessiegebonden bezoekbewijs", async () => {
  // Alleen het openen van de TOEN actuele publicatie geeft een bewijs.
  const visit = await getStudyReader(owner, lessonId, collection, ownerSession);
  assert.ok(visit?.visitProof);
  assert.equal(visit.lesson.revisionId, revisionId);
  const save = await action({ revisionId, sectionFraction: 0.3 });
  await publish(collection, "updated");
  const invalidProofs = [
    undefined,
    "rv1.forged.invalid",
    issueReadingVisitProof(other.id, editionId, revisionId, ownerSession),
    issueReadingVisitProof(owner.id, "other-edition", revisionId, ownerSession),
    issueReadingVisitProof(owner.id, editionId, "other-revision", ownerSession),
    issueReadingVisitProof(owner.id, editionId, revisionId, "another-session"),
    issueReadingVisitProof(owner.id, editionId, revisionId, ownerSession, Date.now() - (READING_VISIT_TTL_SECONDS + 60) * 1000),
  ];
  for (const proof of invalidProofs) {
    const response = await api("PUT", { ...save, ...(proof ? { visitProof: proof } : {}) });
    assert.equal(response.status, 404, "oud tekstfragment vereist echt leesbezoek");
  }
  const current = await getStudyReader(owner, lessonId, collection, ownerSession);
  assert.ok(current?.visitProof);
  assert.notEqual(current.lesson.revisionId, revisionId);
  assert.equal((await api("PUT", { ...save, visitProof: current.visitProof })).status, 404);
  // Ook een correct uitgegeven bewijs mag niet op een andere sessie werken.
  await assert.rejects(
    saveReadingPosition(owner, { ...save, visitProof: visit.visitProof }, prisma, "different-session"),
    (e: unknown) => e instanceof ReadingPositionError && e.code === "UNAVAILABLE",
  );
  const historical = await api("PUT", { ...save, visitProof: visit.visitProof });
  assert.equal(historical.status, 200);
  const body = await historical.json();
  assert.equal(body.state.position.revisionId, revisionId);
  assert.ok(body.state.position.quoteContext);
  assert.equal((await prisma.readingPosition.findUniqueOrThrow({
    where: { userId_lessonEditionId: { userId: owner.id, lessonEditionId: editionId } },
  })).revisionId, revisionId);
});
test("hidden/disabled/DRAFT en retired weigeren gewone admin- en leesmutaties; positie blijft behouden", async () => {
  const row = await prisma.readingPosition.findUniqueOrThrow({
    where: {
      userId_lessonEditionId: { userId: owner.id, lessonEditionId: editionId },
    },
  });
  for (const patch of [
    { visibleToUsers: false },
    { enabled: false },
    { publicationState: "DRAFT" as const },
  ]) {
    await prisma.contentCollection.update({
      where: { id: collection },
      data: patch,
    });
    assert.equal((await api("GET")).status, 404);
    assert.equal((await api("GET", undefined, adminCookie)).status, "visibleToUsers" in patch ? 200 : 404);
    assert.equal(
      (await api("PUT", { ...actionBase(row), actionId: randomUUID() })).status,
      404,
    );
    await prisma.contentCollection.update({
      where: { id: collection },
      data: {
        enabled: true,
        visibleToUsers: true,
        publicationState: "PUBLISHED",
      },
    });
  }
  await prisma.studyLesson.update({
    where: { id: lessonId },
    data: { retiredAt: new Date() },
  });
  assert.equal((await api("GET")).status, 404);
  await prisma.studyLesson.update({
    where: { id: lessonId },
    data: { retiredAt: null },
  });
  assert.deepEqual(
    await prisma.readingPosition.findUnique({
      where: {
        userId_lessonEditionId: {
          userId: owner.id,
          lessonEditionId: editionId,
        },
      },
    }),
    row,
  );
});
function actionBase(row: {
  revisionId: string;
  sectionAnchor: string;
  blockAnchor: string;
  sectionFraction: number;
  version: number;
}) {
  return {
    lessonEditionId: editionId,
    revisionId: row.revisionId,
    sectionAnchor: row.sectionAnchor,
    blockAnchor: row.blockAnchor,
    sectionFraction: row.sectionFraction,
    expectedVersion: row.version,
    intent: "SAVE",
  };
}
test("profielbron en contenttaal veranderen de exacte positie niet; andere editietaal heeft eigen positie", async () => {
  const before = await getReadingPosition(owner, editionId);
  await prisma.user.update({
    where: { id: owner.id },
    data: {
      activeContentCollectionId: "content_podcasts",
      contentLanguage: "en",
    },
  });
  assert.deepEqual(await getReadingPosition(owner, editionId), before);
  const parent = await prisma.contentCollection.findUniqueOrThrow({
    where: { id: collection },
  });
  const translated = await prisma.contentCollection.create({
    data: {
      id: collection + "-en",
      slug: collection + "-en",
      name: "Synthetic English edition",
      work: parent.work,
      editionKey: parent.editionKey,
      language: "en",
      icon: "",
      visibleToUsers: true,
      publicationState: "PUBLISHED",
    },
  });
  const edition = await prisma.studyLessonEdition.create({
    data: {
      lessonId,
      collectionId: translated.id,
      workKey: parent.work!,
      slug: "translated-lesson",
    },
  });
  const revision = await appendStudyRevision(
    admin,
    edition.id,
    studyRevisionFixture(),
  );
  await prisma.studyLessonEdition.update({
    where: { id: edition.id },
    data: { publishedRevisionId: revision.id },
  });
  assert.equal((await getReadingPosition(owner, edition.id)).position, null);
  const published = await getPublishedStudyLesson(
    owner,
    lessonId,
    translated.id,
  );
  assert.ok(published);
  await saveReadingPosition(owner, {
    ...readingStart(published.body, published.revisionId),
    lessonEditionId: edition.id,
    expectedVersion: 0,
    actionId: randomUUID(),
    intent: "SAVE",
    sectionFraction: 0.5,
  });
  assert.deepEqual(await getReadingPosition(owner, editionId), before);
});
test("foutinjectie rolt hele write terug zonder voortgang/beloningen; READ wordt niet gereset", async () => {
  const old = await prisma.readingPosition.findUniqueOrThrow({
    where: {
      userId_lessonEditionId: { userId: owner.id, lessonEditionId: editionId },
    },
  });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION reading_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER reading_test_failure BEFORE UPDATE ON "ReadingPosition" FOR EACH ROW EXECUTE FUNCTION reading_test_failure()`,
  );
  try {
    assert.equal(
      (await api("PUT", await action({ sectionFraction: 0.99 }))).status,
      503,
    );
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER reading_test_failure ON "ReadingPosition"',
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION reading_test_failure()");
  }
  assert.deepEqual(
    await prisma.readingPosition.findUnique({
      where: {
        userId_lessonEditionId: {
          userId: owner.id,
          lessonEditionId: editionId,
        },
      },
    }),
    old,
  );
  await saveReadingPosition(owner, await action({ sectionFraction: 1 }));
  await saveReadingPosition(
    owner,
    await action({ intent: "START_OVER", sectionFraction: 0 }),
  );
  assert.deepEqual(
    await prisma.user.findUnique({ where: { id: owner.id } }),
    u,
  );
  assert.equal(
    await prisma.streakActivity.count({ where: { userId: owner.id } }),
    0,
  );
  assert.equal(
    await prisma.contentProgress.count({ where: { userId: owner.id } }),
    0,
  );
  assert.equal(
    await prisma.userStudyContext.count({ where: { userId: owner.id } }),
    0,
  );
});

test("bestaande READ, oefencredits en beloningsvelden blijven gelijk bij start-over", async () => {
  const row = await prisma.contentProgress.create({
    data: {
      userId: owner.id,
      contentKey: "synthetic-existing-read",
      readStatus: "READ",
      readAt: new Date(),
      baseXpEarned: 17,
      rewardCorrect: 4,
      exerciseAnswered: 5,
      legacyCompleted: true,
    },
  });
  await saveReadingPosition(
    owner,
    await action({ intent: "START_OVER", sectionFraction: 0 }),
  );
  assert.deepEqual(
    await prisma.contentProgress.findUnique({ where: { id: row.id } }),
    row,
  );
});
