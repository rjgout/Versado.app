// Alleen de eigen PostgreSQL-fixture. Queryevents bevatten SQL: uitsluitend aantallen exporteren.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href || process.env.NODE_ENV !== "production") throw new Error("Uitsluitend eigen productie-testomgeving");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.href }), log: [{ emit: "event", level: "query" }] });
globalThis.prisma = db;
const { getContentContext } = await import("../../src/lib/contentCollections.ts");
const { canStartGame } = await import("../../src/lib/gameAvailability.ts");
const { GAME_SCOPE_KEYS } = await import("../../src/lib/gameAvailabilityPolicy.ts");
let queries = 0;
const models = new Map();
db.$on("query", event => {
  queries++;
  const model = /FROM "public"\."([^"]+)"/.exec(event.query)?.[1] ?? "other";
  models.set(model, (models.get(model) ?? 0) + 1);
});
const userId = "availability-performance-user";
async function scopes(id, keys) {
  await db.gameContentScope.deleteMany({ where: { contentCollectionId: id } });
  if (keys.length) await db.gameContentScope.createMany({ data: keys.map(gameKey => ({ gameKey, contentCollectionId: id })) });
}
async function source(id) { await db.user.update({ where: { id: userId }, data: { activeContentCollectionId: id } }); }
async function measure(name, invoke, validate) {
  for (let i = 0; i < 10; i++) validate(await invoke());
  const durations = [], counts = [];
  models.clear();
  for (let i = 0; i < 80; i++) {
    queries = 0;
    const start = performance.now();
    const result = await invoke();
    durations.push(performance.now() - start); counts.push(queries);
    validate(result);
  }
  durations.sort((a,b) => a-b);
  assert.equal(new Set(counts).size, 1, "Deterministisch querybudget per fixture");
  return { name, samples: 80, queries: counts[0], medianMs: Number(((durations[39]+durations[40])/2).toFixed(3)), p95Ms: Number(durations[75].toFixed(3)), queriesByModel: Object.fromEntries([...models].map(([name,count]) => [name, count/80])) };
}
try {
  await db.contentCollection.updateMany({ where: { id: { in: ["content_bom","content_podcasts"] } }, data: { enabled: true, visibleToUsers: true, publicationState: "LEGACY" } });
  const enabledSettings = Object.fromEntries(["wordGame","scrabble","gezinsavond","chapterGuess","challenges","liveExercises","alleskenner","jigsaw","wordSearch","quickMissionary","mystery"].map(key => [`${key}Enabled`, true]));
  await db.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...enabledSettings }, update: enabledSettings });
  await db.user.create({ data: { id: userId, email: "performance@test.invalid", handle: "perf-fixture", discriminator: "00", passwordHash: "synthetic", activeContentCollectionId: "content_bom", contentLanguage: "nl", hintBalance: 8, xpTotal: 100 } });
  const book = await db.book.create({ data: { id: "performance-book", slug: "performance-book", name: "Synthetische hoofdstukpool", order: 9999, contentCollectionId: "content_bom" } });
  await db.chapter.createMany({ data: Array.from({ length: 250 }, (_,i) => ({ id: `performance-chapter-${i}`, bookId: book.id, number: i+1, order: i, heading: `Synthetische kop ${i}` })) });
  await db.exercise.createMany({ data: Array.from({ length: 1500 }, (_,i) => ({ id: `performance-exercise-${i}`, chapterId: `performance-chapter-${i%250}`, order: i, type: ["TRUE_FALSE","FILL_BLANK","WORD_BANK"][i%3], verseRef: "Synthetisch", prompt: "Synthetische vraag", answers: "[\"true\"]" })) });
  const question = { prompt: "Vraag", options: ["a","b","c","d"], answer: "a", evidence: [], source: "fixture" };
  const topic = { subject: "Onderwerp", answers: ["a","b","c","d","e"].map(text => ({ text, accept: [text] })), distractors: ["f","g","h","i","j","k"], source: "fixture" };
  await db.alleskennerItem.createMany({ data: [...Array.from({ length: 500 }, (_,i) => ({ id: `performance-question-${i}`, kind: "QUESTION", data: JSON.stringify(question) })), ...Array.from({ length: 50 }, (_,i) => ({ id: `performance-topic-${i}`, kind: "TOPIC", data: JSON.stringify(topic) })), { id: "performance-puzzle", kind: "PUZZLE", data: JSON.stringify({ groups: [], source: "fixture" }) }, { id: "performance-gallery", kind: "GALLERY", data: JSON.stringify({ variant: "QUOTES", refs: ["Synthetisch"] }) }, { id: "performance-memory", kind: "MEMORY", data: JSON.stringify({ title: "Onthouden", passage: "Synthetisch", answers: [], distractors: [] }) }] });
  const report = { environment: { node: process.version, nodeEnv: process.env.NODE_ENV, database: "isolated PostgreSQL 16", execution: "Production service functions via existing tsx, Prisma SQL query events; no HTTP/network latency", warmups: 10, addedFixtureChapters: 250, addedFixtureExercises: 1500, addedFixtureAlleskennerItems: 553 }, results: [] };
  await scopes("content_bom", GAME_SCOPE_KEYS);
  report.results.push(await measure("context-bom-all-scopes", () => getContentContext(userId), c => assert.equal(c.gameKeys.length, GAME_SCOPE_KEYS.length)));
  await scopes("content_podcasts", GAME_SCOPE_KEYS); await source("content_podcasts");
  report.results.push(await measure("context-podcasts", () => getContentContext(userId), c => assert.equal(c.gameKeys.length, 0)));
  await source("content_bom"); await scopes("content_bom", ["jigsaw"]);
  report.results.push(await measure("context-bom-one-scope", () => getContentContext(userId), c => assert.deepEqual(c.gameKeys, ["jigsaw"])));
  await scopes("content_bom", []);
  report.results.push(await measure("context-bom-no-scopes", () => getContentContext(userId), c => assert.equal(c.gameKeys.length, 0)));
  await scopes("content_bom", GAME_SCOPE_KEYS);
  report.results.push(await measure("start-allowed-jigsaw", () => canStartGame(userId,"jigsaw"), c => assert.equal(c, true)));
  await source("content_podcasts");
  report.results.push(await measure("start-denied-jigsaw", () => canStartGame(userId,"jigsaw"), c => assert.equal(c, false)));
  if (process.argv.includes("--assert-budget")) {
    const budgets = [16,7,8,5,5,3];
    report.results.forEach((result,i) => assert.ok(result.queries <= budgets[i], `${result.name}: ${result.queries} > budget ${budgets[i]}`));
    for (const result of report.results.filter(r => r.name.startsWith("start-"))) {
      for (const model of ["Chapter","Exercise","AlleskennerItem","Person","Place","Book","UserStudyContext","ContentSwitcherSettings"]) assert.equal(result.queriesByModel[model] ?? 0,0,`Directe puzzelstart mag geen ${model} laden`);
    }
    // Geen persoonlijke/rechten-cache: wijzigingen moeten de volgende aanvraag raken.
    await source("content_bom");
    assert.equal(await canStartGame(userId,"jigsaw"), true);
    await db.gameSettings.update({ where: { id: "singleton" }, data: { jigsawEnabled: false } });
    assert.equal(await canStartGame(userId,"jigsaw"), false);
    await db.gameSettings.update({ where: { id: "singleton" }, data: { jigsawEnabled: true } });
    for (const patch of [{ visibleToUsers: false }, { enabled: false }, { publicationState: "DRAFT" }]) {
      await db.contentCollection.update({ where: { id: "content_bom" }, data: patch });
      assert.equal(await canStartGame(userId,"jigsaw"), false);
      await db.contentCollection.update({ where: { id: "content_bom" }, data: { enabled: true, visibleToUsers: true, publicationState: "LEGACY" } });
    }
    await scopes("content_bom", []); assert.equal(await canStartGame(userId,"jigsaw"), false);
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(user.hintBalance,8); assert.equal(user.xpTotal,100);
    assert.equal(await db.userStudyContext.count({ where: { userId } }),0);
    console.log("Availability query budgets, fresh authorization/settings/scopes and economy: passed");
  }
  console.log(JSON.stringify(report, null, 2));
  if (process.env.AVAILABILITY_PERFORMANCE_REPORT) writeFileSync(process.env.AVAILABILITY_PERFORMANCE_REPORT, JSON.stringify(report,null,2));
} finally { await db.$disconnect(); delete globalThis.prisma; }
