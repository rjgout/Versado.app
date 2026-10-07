import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  sw: await import("../src/lib/contentSwitch"),
  routing: await import("../src/lib/contentRouting"),
  cc: await import("../src/lib/contentCollections"),
});
let L: Awaited<ReturnType<typeof load>>;

const run = randomUUID().slice(0, 8);
// Werk 1 in Nederlands (A) en Engels (B), werk 2 alleen Nederlands (C).
const ids = { A: `t_a_${run}`, B: `t_b_${run}`, C: `t_c_${run}` };
const works = { one: `testwerk1_${run}`, two: `testwerk2_${run}` };
const userIds: string[] = [];
const fx: Record<string, string> = {};

before(async () => {
  if (skip) return;
  L = await load();
  const { db } = L;
  const collection = (id: string, work: string, language: string, name: string, order: number) => db.contentCollection.create({
    data: { id, slug: id, name, icon: "📖", order: 900 + order, work, editionKey: "test", language },
  });
  await collection(ids.A, works.one, "nl", "Werk een", 1);
  await collection(ids.B, works.one, "en", "Work one", 2);
  await collection(ids.C, works.two, "nl", "Werk twee", 3);

  const book = (cid: string, slug: string, key: string | null) => db.book.create({ data: { slug, name: slug, order: 1, key, contentCollectionId: cid } });
  const bA = await book(ids.A, `ta-${run}`, `${run}/boek`);
  const bB = await book(ids.B, `tb-${run}`, `${run}/boek`);
  const bC = await book(ids.C, `tc-${run}`, `${run}/ander`);
  const chapter = (bookId: string, number: number) => db.chapter.create({ data: { bookId, number, order: number } });
  const [a1, a2] = [await chapter(bA.id, 1), await chapter(bA.id, 2)];
  const [b1, b2] = [await chapter(bB.id, 1), await chapter(bB.id, 2)];
  const c1 = await chapter(bC.id, 1);
  Object.assign(fx, { a1: a1.id, a2: a2.id, b1: b1.id, b2: b2.id, c1: c1.id });

  const course = (cid: string, slug: string, type: "READING_LESSONS" | "FREE_CHOICE" | "KIDS" | "INTRO", order: number) =>
    db.course.create({ data: { slug: `${slug}-${run}`, type, name: slug, order, contentCollectionId: cid } });
  const readA = await course(ids.A, "lezen-a", "READING_LESSONS", 1);
  const readB = await course(ids.B, "lezen-b", "READING_LESSONS", 1);
  const readC = await course(ids.C, "lezen-c", "READING_LESSONS", 1);
  const freeA = await course(ids.A, "vrij-a", "FREE_CHOICE", 2);
  const kidsA = await course(ids.A, "kids-a", "KIDS", 3);
  const introA = await course(ids.A, "intro-a", "INTRO", 4);
  Object.assign(fx, { readA: readA.id, readB: readB.id, readC: readC.id, freeA: freeA.id, kidsA: kidsA.id, introA: introA.id });

  const lesson = (courseId: string, chapterId: string, order: number, startVerse: number) =>
    db.courseLesson.create({ data: { courseId, chapterId, order, startVerse, endVerse: startVerse + 4 } });
  fx.lessonA = (await lesson(readA.id, a1.id, 1, 1)).id;
  fx.lessonA2 = (await lesson(readA.id, a1.id, 2, 6)).id;
  fx.lessonB = (await lesson(readB.id, b1.id, 1, 1)).id;
  fx.lessonB2 = (await lesson(readB.id, b1.id, 2, 6)).id;
  await lesson(readC.id, c1.id, 1, 1);
  fx.storyA = (await db.kidsStory.create({ data: { courseId: kidsA.id, number: 1, title: "Verhaal", text: "x", images: "[]" } })).id;
  await db.gameContentScope.create({ data: { gameKey: "jigsaw", contentCollectionId: ids.A } });
});

after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { id: { in: userIds } } });
  await L.db.contentCollection.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await L.db.$disconnect();
});

async function account(active: string, contentLanguage = "nl") {
  const user = await L.db.user.create({ data: {
    email: `wissel-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Wissel${randomUUID().slice(0, 8)}`, discriminator: "00",
    activeContentCollectionId: active, contentLanguage,
  } });
  userIds.push(user.id);
  return user;
}

const get = async (userId: string) => L.db.user.findUniqueOrThrow({ where: { id: userId }, select: { activeContentCollectionId: true, contentLanguage: true } });

async function switchTo(userId: string, change: { contentCollectionId: string } | { contentLanguage: string }, pathname: string, search = "", force = false) {
  return L.sw.applyContentSwitch({ userId, isAdmin: false, change, location: { pathname, search }, force });
}

test("Lezen: Boek A → werk 2 → direct de leescursus van werk 2, daarna terug naar werk 1", { skip }, async () => {
  const user = await account(ids.A);
  const forward = await switchTo(user.id, { contentCollectionId: ids.C }, `/courses/${fx.readA}`);
  assert.deepEqual(forward, { applied: true, outcome: { kind: "redirect", href: `/courses/${fx.readC}` } });
  assert.equal((await get(user.id)).activeContentCollectionId, ids.C);
  // De cursuslijst van de nieuwe content bevat geen cursus van de vorige.
  const listed = await L.db.course.findMany({ where: { enabled: true, contentCollectionId: ids.C }, select: { id: true } });
  assert.deepEqual(listed.map((course) => course.id), [fx.readC]);

  const back = await switchTo(user.id, { contentCollectionId: ids.A }, `/courses/${fx.readC}`);
  assert.deepEqual(back, { applied: true, outcome: { kind: "redirect", href: `/courses/${fx.readA}` } });
  assert.equal((await get(user.id)).activeContentCollectionId, ids.A);
});

test("taalwissel op een ondersteunde pagina: hetzelfde hoofdstuk in de nieuwe taal", { skip }, async () => {
  const user = await account(ids.A);
  const result = await switchTo(user.id, { contentLanguage: "en" }, `/lesson/${fx.a2}`, `?cursus=${fx.readA}&vers=3`);
  // De cursus gaat mee naar het equivalent (de leescursus in het Engels), het vers blijft.
  assert.deepEqual(result, { applied: true, outcome: { kind: "redirect", href: `/lesson/${fx.b2}?vers=3&cursus=${fx.readB}` } });
  assert.deepEqual(await get(user.id), { activeContentCollectionId: ids.B, contentLanguage: "en" });
});

test("leesstap en cursus blijven op hetzelfde onderdeel bij een taalwissel", { skip }, async () => {
  const user = await account(ids.A);
  const step = await switchTo(user.id, { contentLanguage: "en" }, `/reading-lesson/${fx.lessonA2}`);
  assert.deepEqual(step, { applied: true, outcome: { kind: "redirect", href: `/reading-lesson/${fx.lessonB2}` } });
  const course = await switchTo(user.id, { contentLanguage: "nl" }, `/courses/${fx.readB}`);
  assert.deepEqual(course, { applied: true, outcome: { kind: "redirect", href: `/courses/${fx.readA}` } });
});

test("niet beschikbaar in de gekozen taal: uitleg in die taal en niets gewijzigd", { skip }, async () => {
  const user = await account(ids.A);
  // De kinderverhalen bestaan alleen in de Nederlandse uitgave.
  const result = await switchTo(user.id, { contentLanguage: "en" }, `/kids/${fx.storyA}`);
  assert.equal(result.applied, false);
  if (result.applied) return;
  assert.equal(result.outcome.reason, "language");
  assert.equal(result.outcome.hubHref, "/courses");
  assert.equal(result.notice.language, "en");
  assert.match(result.notice.body, /isn't available in English yet/);
  assert.deepEqual(await get(user.id), { activeContentCollectionId: ids.A, contentLanguage: "nl" }, "er is niets gewijzigd");

  // Een taal waarin het werk helemaal niet bestaat: de uitleg staat in die taal.
  const spanish = await switchTo(user.id, { contentLanguage: "es" }, `/courses/${fx.freeA}`);
  assert.equal(spanish.applied, false);
  if (spanish.applied) return;
  assert.equal(spanish.notice.language, "es");
  assert.match(spanish.notice.body, /no está disponible en Español/);
  assert.match(spanish.notice.proceed, /Español/);
});

test("de gebruiker kan na de uitleg toch wisselen en komt dan op het onderdeel van de nieuwe taal", { skip }, async () => {
  const user = await account(ids.A);
  const forced = await switchTo(user.id, { contentLanguage: "en" }, `/kids/${fx.storyA}`, "", true);
  assert.deepEqual(forced, { applied: true, outcome: { kind: "redirect", href: "/courses" } });
  assert.deepEqual(await get(user.id), { activeContentCollectionId: ids.B, contentLanguage: "en" });
});

test("een onderdeel dat de nieuwe content niet heeft, geeft een nette uitleg in plaats van een lege pagina", { skip }, async () => {
  const user = await account(ids.A);
  const result = await switchTo(user.id, { contentCollectionId: ids.C }, `/courses/${fx.kidsA}`);
  assert.equal(result.applied, false);
  if (result.applied) return;
  assert.equal(result.outcome.reason, "section");
  assert.match(result.notice.title, /Werk twee/);
  assert.equal((await get(user.id)).activeContentCollectionId, ids.A);
});

test("spellen volgen de speltoegang van de nieuwe content", { skip }, async () => {
  const user = await account(ids.A);
  assert.deepEqual(await switchTo(user.id, { contentCollectionId: ids.A }, "/jigsaw"), { applied: true, outcome: { kind: "stay" } });
  const blocked = await switchTo(user.id, { contentCollectionId: ids.C }, "/jigsaw");
  assert.equal(blocked.applied, false);
  if (!blocked.applied) assert.equal(blocked.outcome.hubHref, "/live");
});

test("neutrale en overzichtspagina's blijven staan en de keuze wordt bewaard (refresh)", { skip }, async () => {
  const user = await account(ids.A);
  assert.deepEqual(await switchTo(user.id, { contentCollectionId: ids.C }, "/dashboard"), { applied: true, outcome: { kind: "stay" } });
  assert.deepEqual(await switchTo(user.id, { contentCollectionId: ids.B }, "/courses"), { applied: true, outcome: { kind: "stay" } });
  // Wat de server bewaart is wat een browser-refresh weer laadt.
  const context = await L.cc.getContentContext(user.id);
  assert.equal(context.active.id, ids.B);
  assert.equal(context.contentLanguage, "nl", "de contenttaal verandert niet door een contentwissel");
});

test("zonder pagina blijft het een kale wissel (profiel)", { skip }, async () => {
  const user = await account(ids.A);
  const result = await L.sw.applyContentSwitch({ userId: user.id, isAdmin: false, change: { contentLanguage: "en" } });
  assert.deepEqual(result, { applied: true, outcome: { kind: "stay" } });
  assert.deepEqual(await get(user.id), { activeContentCollectionId: ids.B, contentLanguage: "en" });
});
