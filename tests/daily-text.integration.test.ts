import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { getTextOfTheDay, dailyTextSourceOptions } from "../src/lib/dailyText";
import { CFM_PROGRAMME_KEY } from "../src/lib/studyContent/cfmProgramme";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import { runDailyTextTick } from "../src/lib/scheduler";
import { appendStudyRevision } from "../src/lib/studyContent/revisions";
import { dailyTextFixture, dailyTextTestEnvironment, QUOTE } from "./fixtures/daily-text";

const base = dailyTextTestEnvironment();
let f: Awaited<ReturnType<typeof dailyTextFixture>>;
let owner: Awaited<ReturnType<typeof account>>;
async function account(data = {}) {
  return prisma.user.create({ data: { email: `${randomUUID()}@daily-text.test.invalid`, passwordHash: "synthetic", handle: `D${randomUUID().slice(0,8)}`, discriminator: "00", timeZone: "UTC", contentLanguage: "nl", ...data } });
}
before(async () => { f = await dailyTextFixture(); owner = await account({ activeContentCollectionId: f.own.id }); });
after(async () => { await prisma.$disconnect(); });
const date = () => new Date(f.day(2).getTime() + 12 * 3600000);
const request = () => ({ actor: owner, date: date(), timeZone: "UTC", language: "nl" });

test("Vandaag volgt de exacte content, meldingen standaard CFM; geen voortgang of voorkeuren wijzigen", async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  assert.equal(before.dailyTextSource, CFM_PROGRAMME_KEY);
  assert.equal(before.notifyDailyText, false);
  const own = await getTextOfTheDay({ ...request(), collectionId: f.own.id });
  assert.equal(own?.text, "ALLEEN-EIGEN-BRON");
  assert.equal((await getTextOfTheDay({ ...request(), source: f.own.work, language: "en" }))?.text, "ONLY-OWN-ENGLISH-SOURCE");
  assert.equal((await getTextOfTheDay({ ...request(), collectionId: f.own.id, language: "en" }))?.text, "ALLEEN-EIGEN-BRON", "de actieve uitgave blijft de bron van Vandaag");
  assert.equal((await dailyTextSourceOptions(owner, "en")).filter(o => o.value === f.own.work).length, 1);
  assert.equal(own?.href, `/scripture/${f.ownChapter.id}#vers-1`);
  assert.equal((await getTextOfTheDay(request()))?.text, "ALLEEN-ACTUELE-CFM-SCHRIFTTEKST");
  assert.equal((await getTextOfTheDay({ ...request(), source: f.other.work }))?.text, "ALLEEN-ANDERE-BRON");
  assert.equal((await getTextOfTheDay({ ...request(), collectionId: f.empty.id }))?.text, "ALLEEN-ACTUELE-CFM-SCHRIFTTEKST");
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }), before);
  assert.equal(await prisma.contentProgress.count({ where: { userId: owner.id } }), 0);
  assert.equal(await prisma.streakActivity.count({ where: { userId: owner.id } }), 0);
});

test("CFM gebruikt de lokale kalenderweek, geen concept, vorige of toekomstige les", async () => {
  const boundary = new Date(f.monday.getTime() - 30 * 60000);
  // Hetzelfde moment: in Amsterdam maandag, in Los Angeles nog zondag.
  const east = await getTextOfTheDay({ ...request(), date: boundary, timeZone: "Europe/Amsterdam" });
  assert.equal(east?.text, "ALLEEN-ACTUELE-CFM-SCHRIFTTEKST");
  // Zonder beschikbare Schrifteditie maakt het citaat de exacte lesherkomst zichtbaar.
  await prisma.contentCollection.update({ where: { id: f.bible.id }, data: { enabled: false } });
  try {
    assert.equal((await getTextOfTheDay({ ...request(), date: boundary, timeZone: "Europe/Amsterdam" }))?.text, QUOTE);
    assert.match((await getTextOfTheDay({ ...request(), date: boundary, timeZone: "America/Los_Angeles" }))!.text, /ONJUISTE-WEEK-previous/);
    const current = await getTextOfTheDay(request());
    assert.equal(current?.text, QUOTE);
    assert.match(current!.href, new RegExp(`/study-lesson/${f.current.lessonId}/${f.cfm.id}\\?weergave=volledig#study-day-quote$`));
    assert.equal(await getTextOfTheDay({ ...request(), date: f.day(21) }), null, "geen willekeurige week als de actuele ontbreekt");
    await prisma.studyLessonEdition.update({ where: { id: f.current.id }, data: { publishedRevisionId: null } });
    assert.equal(await getTextOfTheDay(request()), null, "een concept op dezelfde datum is geen gepubliceerde week");
  } finally {
    const revision = await prisma.studyRevision.findFirstOrThrow({ where: { lessonEditionId: f.current.id } });
    await prisma.studyLessonEdition.update({ where: { id: f.current.id }, data: { publishedRevisionId: revision.id } });
    await prisma.contentCollection.update({ where: { id: f.bible.id }, data: { enabled: true } });
  }
});

test("verborgen, uitgeschakelde en ingetrokken bronnen lekken niet via dagtekst of opties", async () => {
  await prisma.contentCollection.update({ where: { id: f.other.id }, data: { visibleToUsers: false } });
  try {
    assert.equal((await getTextOfTheDay({ ...request(), source: f.other.work }))?.text, "ALLEEN-ACTUELE-CFM-SCHRIFTTEKST");
    assert.ok(!(await dailyTextSourceOptions(owner, "nl")).some(o => o.value === f.other.work));
    assert.equal((await getTextOfTheDay({ ...request(), actor: { id: owner.id, isAdmin: true }, source: f.other.work }))?.text, "ALLEEN-ANDERE-BRON");
    await prisma.contentCollection.update({ where: { id: f.other.id }, data: { publicationState: "DRAFT" } });
    assert.equal((await getTextOfTheDay({ ...request(), actor: { id: owner.id, isAdmin: true }, collectionId: f.other.id }))?.text, "ALLEEN-ACTUELE-CFM-SCHRIFTTEKST");
  } finally { await prisma.contentCollection.update({ where: { id: f.other.id }, data: { visibleToUsers: true, publicationState: "PUBLISHED" } }); }
  const options = await dailyTextSourceOptions(owner, "nl");
  assert.equal(options.filter(o => o.value === CFM_PROGRAMME_KEY).length, 1);
  assert.ok(!options.some(o => o.value === f.cfm.work), "geen losse CFM-jaargangkeuze");
  await prisma.contentCollection.update({ where: { id: f.cfm.id }, data: { visibleToUsers: false } });
  try { assert.equal(await getTextOfTheDay(request()), null, "ook de CFM-terugval respecteert leesrechten"); }
  finally { await prisma.contentCollection.update({ where: { id: f.cfm.id }, data: { visibleToUsers: true } }); }
});

test("studiecontent probeert beschikbare lescitaten voordat CFM als terugval nodig is", async () => {
  const key = `daily-text-study-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({ data: { id: key, slug: key, name: "Eigen studiebron", work: key, editionKey: "test", language: "nl", icon: "", publicationState: "PUBLISHED", visibleToUsers: true } });
  const period = await prisma.studyPeriod.create({ data: { workKey: key, sourceKey: key, label: "Testperiode" } });
  const content = "Dit volledige citaat komt uit de gekozen studiebron en mag niet door een CFM-citaat worden vervangen.";
  for (let order = 0; order < 2; order++) {
    const lesson = await prisma.studyLesson.create({ data: { workKey: key, periodId: period.id, sourceKey: `${key}-${order}`, order } });
    const edition = await prisma.studyLessonEdition.create({ data: { lessonId: lesson.id, collectionId: key, workKey: key, slug: `${key}-${order}` } });
    const revision = await appendStudyRevision({ isAdmin: true }, edition.id, { schemaVersion: 1, title: "Synthetische studieles", sourceMetadata: { sourceKey: `${key}-${order}` }, rightsMetadata: { holder: "Tests", permission: "Uitsluitend testfixture" }, body: { schemaVersion: 1, sections: [{ id: "body", blocks: [{ id: "p1", type: order ? "quote" : "question", content: [{ type: "text", text: order ? content : "Wat wil je over deze les bespreken?" }] }] }] } });
    await prisma.studyLessonEdition.update({ where: { id: edition.id }, data: { publishedRevisionId: revision.id } });
  }
  for (let day = 0; day < 7; day++) assert.equal((await getTextOfTheDay({ ...request(), collectionId: key, date: f.day(day) }))?.text, content);
});

test("profielkeuze wordt geautoriseerd en bewaard, zonder actieve bron of opt-in te wijzigen", async () => {
  const cookie = `${SESSION_COOKIE}=${await createSessionToken(owner.id)}`;
  const patch = (source: string, auth = cookie) => fetch(`${base}/api/account`, { method: "PATCH", headers: { Cookie: auth, "Content-Type": "application/json" }, body: JSON.stringify({ dailyTextSource: source }) });
  assert.equal((await patch(f.other.work!)).status, 200);
  const profileResponse = await fetch(`${base}/api/profile`, { headers: { Cookie: cookie } });
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.equal(profile.dailyTextSource, f.other.work);
  assert.ok(profile.dailyTextSources.some((s: {value: string}) => s.value === CFM_PROGRAMME_KEY));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  assert.equal(user.activeContentCollectionId, f.own.id);
  assert.equal(user.notifyDailyText, false);
  assert.equal(user.dailyTextTime, "09:00");
  assert.equal((await patch("bestaat-niet")).status, 400);
  assert.equal((await patch(f.other.work!, "")).status, 401);
  await prisma.contentCollection.update({ where: { id: f.other.id }, data: { enabled: false } });
  try { assert.equal((await patch(f.other.work!)).status, 400); }
  finally { await prisma.contentCollection.update({ where: { id: f.other.id }, data: { enabled: true } }); }
});

test("scheduler respecteert bronkeuze, lokale dag, opt-in en eenmaal per dag", async () => {
  const a = await account({ activeContentCollectionId: f.own.id, notifyDailyText: true, emailNotificationsEnabled: true, dailyTextTime: "12:00" });
  const b = await account({ activeContentCollectionId: f.own.id, dailyTextSource: f.other.work, notifyDailyText: true, pushNotificationsEnabled: true, dailyTextTime: "12:00" });
  const off = await account({ notifyDailyText: false, pushNotificationsEnabled: true, dailyTextTime: "12:00" });
  const noChannel = await account({ notifyDailyText: true, dailyTextTime: "12:00" });
  const messages: Array<{id: string; text: string}> = [];
  const deliver = async (id: string, content: { content: string }) => { messages.push({ id, text: content.content }); };
  await runDailyTextTick(date(), deliver);
  assert.deepEqual(messages.filter(m => [a.id,b.id].includes(m.id)).sort((x,y)=>x.id.localeCompare(y.id)), [
    { id: a.id, text: "ALLEEN-ACTUELE-CFM-SCHRIFTTEKST" }, { id: b.id, text: "ALLEEN-ANDERE-BRON" },
  ].sort((x,y)=>x.id.localeCompare(y.id)));
  assert.ok(!messages.some(m => [off.id,noChannel.id].includes(m.id)));
  const count = messages.length;
  await runDailyTextTick(date(), deliver);
  assert.equal(messages.length, count);
});
