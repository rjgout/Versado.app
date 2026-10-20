import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { subscribeUserToCourse, markCourseStarted } from "../src/lib/courses";
import { cfmCourseSlug, ensureCfmCourses, markCfmCourseStarted } from "../src/lib/studyContent/cfmCourses";

// Eigen geïsoleerde database vereist, zoals de overige integratietests (nooit productie of een gedeelde database).
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href)
  throw new Error("Eigen geïsoleerde runner vereist");

let collectionId: string, userId: string;
const slugOf = (type: string) => cfmCourseSlug({ id: collectionId, slug: collectionId }, type as "STUDY_STEPS" | "STUDY_FREE");

async function collection(prefix: string) {
  const key = `synthetic-study-cfm-${prefix}-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({ data: { id: key, slug: key, name: `Synthetische CFM ${prefix}`, work: key, editionKey: "fixture-v1", language: "nl", icon: "", publicationState: "DRAFT", visibleToUsers: false } });
  return { id: key, slug: key };
}

before(async () => {
  collectionId = (await collection("cursussen")).id;
  userId = (await prisma.user.create({ data: { email: `${randomUUID()}@cfm-courses.test.invalid`, passwordHash: "test-only", handle: `K${randomUUID().slice(0, 8)}`, discriminator: "00" } })).id;
});
after(async () => {
  await prisma.$disconnect();
});

test("de CFM-cursussen worden aangemaakt zonder iemand in te schrijven en blijven bij herhaling ongemoeid", async () => {
  const mine = { id: collectionId, slug: collectionId };
  await ensureCfmCourses(prisma, mine);
  const courses = await prisma.course.findMany({ where: { contentCollectionId: collectionId }, orderBy: { order: "asc" } });
  assert.deepEqual(courses.map((c) => c.type), ["STUDY_STEPS", "STUDY_FREE"]);
  assert.deepEqual(courses.map((c) => c.slug), [slugOf("STUDY_STEPS"), slugOf("STUDY_FREE")]);
  assert.equal(await prisma.userCourseProgress.count({ where: { courseId: { in: courses.map((c) => c.id) } } }), 0);
  // Een door de beheerder aangepaste cursus blijft zoals ze is.
  await prisma.course.update({ where: { id: courses[1].id }, data: { enabled: false, name: "Eigen naam" } });
  await ensureCfmCourses(prisma, mine);
  const again = await prisma.course.findUniqueOrThrow({ where: { id: courses[1].id } });
  assert.equal(again.enabled, false);
  assert.equal(again.name, "Eigen naam");
  assert.equal(await prisma.course.count({ where: { contentCollectionId: collectionId } }), 2);
  await prisma.course.update({ where: { id: courses[1].id }, data: { enabled: true } });
});

test("twee CFM-collecties krijgen elk eigen cursussen die elkaar nooit overschrijven of hergebruiken", async () => {
  const a = await collection("jaar-a"), b = await collection("jaar-b");
  // Gelijktijdig en herhaald: nog steeds precies twee cursussen per collectie.
  await Promise.all([ensureCfmCourses(prisma, a), ensureCfmCourses(prisma, b), ensureCfmCourses(prisma, a)]);
  await ensureCfmCourses(prisma, b);
  const rows = await prisma.course.findMany({ where: { contentCollectionId: { in: [a.id, b.id] } } });
  assert.equal(rows.length, 4);
  for (const c of [a, b]) assert.deepEqual(rows.filter((r) => r.contentCollectionId === c.id).map((r) => r.type).sort(), ["STUDY_FREE", "STUDY_STEPS"]);
  assert.equal(new Set(rows.map((r) => r.id)).size, 4);
  assert.equal(new Set(rows.map((r) => r.slug)).size, 4, "de slugs verschillen per collectie");
  // Het wijzigen van één collectie raakt de andere niet.
  const bSteps = rows.find((r) => r.contentCollectionId === b.id && r.type === "STUDY_STEPS")!;
  await prisma.course.update({ where: { id: bSteps.id }, data: { enabled: false } });
  await ensureCfmCourses(prisma, a);
  await ensureCfmCourses(prisma, b);
  assert.equal((await prisma.course.findUniqueOrThrow({ where: { id: bSteps.id } })).enabled, false, "uitgeschakeld blijft uitgeschakeld");
  assert.equal(await prisma.userCourseProgress.count({ where: { courseId: { in: rows.map((r) => r.id) } } }), 0, "niemand automatisch ingeschreven");
  // Nieuwe cursussen zijn niet publiek: de collectie bepaalt dat en is standaard verborgen.
  assert.equal((await prisma.contentCollection.findUniqueOrThrow({ where: { id: a.id } })).visibleToUsers, false);
});

test("toevoegen, verbergen en opnieuw toevoegen laat studiegegevens en de rij zelf ongemoeid", async () => {
  const steps = await prisma.course.findFirstOrThrow({ where: { slug: slugOf("STUDY_STEPS") } });
  await subscribeUserToCourse(prisma, userId, steps.id);
  const row = await prisma.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId: steps.id } } });
  assert.equal(row.subscribed, true);
  assert.equal(row.currentChapterId, null, "een studiecursus heeft geen hoofdstukcursor");
  // Verbergen = alleen subscribed uit (zoals de unsubscribe-route); er wordt niets gewist.
  await prisma.userCourseProgress.update({ where: { userId_courseId: { userId, courseId: steps.id } }, data: { subscribed: false } });
  await subscribeUserToCourse(prisma, userId, steps.id);
  assert.equal((await prisma.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId: steps.id } } })).subscribed, true);
  assert.equal(await prisma.userCourseProgress.count({ where: { userId, courseId: steps.id } }), 1, "niet dubbel aangeboden of aangemaakt");
});

test("een week openen maakt alleen een ingeschreven cursus de huidige leerreis", async () => {
  const steps = await prisma.course.findFirstOrThrow({ where: { slug: slugOf("STUDY_STEPS") } });
  const free = await prisma.course.findFirstOrThrow({ where: { slug: slugOf("STUDY_FREE") } });
  await markCfmCourseStarted(prisma, userId, collectionId, "FREE");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).activeCourseId, null, "niet ingeschreven: niets verandert");
  await markCfmCourseStarted(prisma, userId, collectionId, "STEPS");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).activeCourseId, steps.id);
  await subscribeUserToCourse(prisma, userId, free.id);
  await markCourseStarted(prisma, userId, free.id);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).activeCourseId, free.id);
});
