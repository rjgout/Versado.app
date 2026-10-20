import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { subscribeUserToCourse, markCourseStarted } from "../src/lib/courses";
import { CFM_COURSES, ensureCfmCourses, markCfmCourseStarted } from "../src/lib/studyContent/cfmCourses";

// Eigen geïsoleerde database vereist, zoals de overige integratietests (nooit productie of een gedeelde database).
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href)
  throw new Error("Eigen geïsoleerde runner vereist");

let collectionId: string, userId: string;
const slugOf = (type: string) => CFM_COURSES.find((c) => c.type === type)!.slug;

before(async () => {
  const key = `synthetic-study-cfm-courses-${randomUUID()}`;
  collectionId = key;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({ data: { id: key, slug: key, name: "Synthetische CFM-cursussen", work: key, editionKey: "fixture-v1", language: "nl", icon: "", publicationState: "DRAFT", visibleToUsers: false } });
  userId = (await prisma.user.create({ data: { email: `${randomUUID()}@cfm-courses.test.invalid`, passwordHash: "test-only", handle: `K${randomUUID().slice(0, 8)}`, discriminator: "00" } })).id;
});
after(async () => {
  await prisma.$disconnect();
});

test("de CFM-cursussen worden aangemaakt zonder iemand in te schrijven en blijven bij herhaling ongemoeid", async () => {
  // Twee collecties delen de slug niet; gebruik een eigen slug-prefix zodat de test niet botst met een eerdere import.
  await prisma.course.deleteMany({ where: { slug: { in: CFM_COURSES.map((c) => c.slug) } } });
  await ensureCfmCourses(prisma, collectionId);
  const courses = await prisma.course.findMany({ where: { contentCollectionId: collectionId }, orderBy: { order: "asc" } });
  assert.deepEqual(courses.map((c) => c.type), ["STUDY_STEPS", "STUDY_FREE"]);
  assert.equal(await prisma.userCourseProgress.count({ where: { courseId: { in: courses.map((c) => c.id) } } }), 0);
  // Een door de beheerder aangepaste cursus blijft zoals ze is.
  await prisma.course.update({ where: { id: courses[1].id }, data: { enabled: false, name: "Eigen naam" } });
  await ensureCfmCourses(prisma, collectionId);
  const again = await prisma.course.findUniqueOrThrow({ where: { id: courses[1].id } });
  assert.equal(again.enabled, false);
  assert.equal(again.name, "Eigen naam");
  assert.equal(await prisma.course.count({ where: { contentCollectionId: collectionId } }), 2);
  await prisma.course.update({ where: { id: courses[1].id }, data: { enabled: true } });
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
