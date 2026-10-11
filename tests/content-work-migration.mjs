// Metadatafixture + uitsluitend synthetische gebruikersdata op een eigen PostgreSQL.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
const url = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== url.href) throw new Error("Uitsluitend eigen ContentWork-testdatabase");
const fixture = JSON.parse(readFileSync("tests/fixtures/content-1a-catalog.json", "utf8"));
const sql = readFileSync("prisma/migrations/20261020120000_content_work_publication/migration.sql", "utf8");
const stateFile = process.env.CONTENT_MIGRATION_TEST_STATE;
if (!stateFile) throw new Error("Eigen tijdelijk bewijsbestand vereist");
const db = new pg.Client({ connectionString: url.href }); await db.connect();
async function insert(table, data) {
  const keys = Object.keys(data);
  await db.query(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(",")}) VALUES (${keys.map((_,i) => `$${i+1}`).join(",")})`, Object.values(data));
}
async function fingerprint() {
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename NOT IN ('_prisma_migrations','ContentWork') ORDER BY tablename")).rows;
  const proof = {};
  for (const { tablename } of tables) {
    const table = `"${tablename.replaceAll('"','""')}"`;
    proof[tablename] = (await db.query(`SELECT count(*)::int AS count, md5(COALESCE(string_agg((to_jsonb(t)-'publicationState')::text, E'\\n' ORDER BY (to_jsonb(t)-'publicationState')::text),'')) AS hash FROM ${table} t`)).rows[0];
  }
  return proof;
}
async function mustRollback(setup, expected = /CONTENT_WORK_REVIEW_REQUIRED/) {
  const before = await fingerprint();
  await db.query("BEGIN");
  try {
    if (setup) await db.query(setup);
    await assert.rejects(db.query(sql), expected);
  } finally { await db.query("ROLLBACK"); }
  assert.deepEqual(await fingerprint(), before);
  assert.equal((await db.query(`SELECT to_regclass('"ContentWork"') AS present`)).rows[0].present, null);
}
try {
  if (process.argv[2] === "prepare") {
    for (const c of fixture.collections) {
      await db.query(`INSERT INTO "ContentCollection" (id,slug,name,icon,work,"editionKey",language,enabled,"visibleToUsers") VALUES ($1,$2,$1,'',$3,$4,$5,$6,$7)
        ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,work=excluded.work,"editionKey"=excluded."editionKey",language=excluded.language,enabled=excluded.enabled,"visibleToUsers"=excluded."visibleToUsers"`, [c.id,c.slug,c.work,c.editionKey,c.language,c.enabled,c.visibleToUsers]);
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "ContentCollection"')).rows[0].n, 21);
    for (let i=1;i<=28;i++) await insert("User", { id:`m-user-${i}`, email:`synthetic-${i}@migration.test.invalid`, handle:`Synthetic${i}`, discriminator:"00", passwordHash:"synthetic-only", xpTotal:100+i, hintBalance:i, currentStreak:i%7, activeContentCollectionId:fixture.collections[(i-1)%21].id });
    for (let i=1;i<=56;i++) {
      await insert("Book", { id:`m-book-${i}`, slug:`m-book-${i}`, name:"Synthetisch boek", order:i, contentCollectionId:fixture.collections[(i-1)%21].id });
      await insert("Chapter", { id:`m-chapter-${i}`, bookId:`m-book-${i}`, number:1, order:1 });
      await insert("Verse", { id:`m-verse-${i}`, chapterId:`m-chapter-${i}`, number:1, text:"Uitsluitend synthetische testtekst" });
    }
    for (let i=1;i<=62;i++) await insert("Course", { id:`m-course-${i}`, slug:`m-course-${i}`, name:"Synthetische cursus", type:"READING_LESSONS", contentCollectionId:fixture.collections[(i-1)%21].id });
    for (let i=1;i<=60;i++) {
      await insert("CourseLesson", { id:`m-lesson-${i}`, courseId:`m-course-${i}`, chapterId:`m-chapter-${1+(i-1)%56}`, order:1, startVerse:1, endVerse:1 });
      await insert("UserCourseProgress", { id:`m-course-progress-${i}`, userId:`m-user-${1+(i-1)%28}`, courseId:`m-course-${i}`, currentLessonId:`m-lesson-${i}` });
      await insert("Exercise", { id:`m-exercise-${i}`, chapterId:`m-chapter-${1+(i-1)%56}`, type:"FILL_BLANK", prompt:"Test ____", answers:'["test"]', verseRef:"1:1", order:i });
      await insert("ContentExerciseCredit", { id:`m-credit-${i}`, userId:`m-user-${1+(i-1)%28}`, exerciseId:`m-exercise-${i}`, contentKey:`bofm/test#${i}`, correct:true, updatedAt:new Date("2026-10-10T12:00:00Z") });
    }
    for (let i=1;i<=29;i++) await insert("UserCourseLessonProgress", { id:`m-lesson-progress-${i}`, userId:`m-user-${1+(i-1)%28}`, lessonId:`m-lesson-${i}`, completed:true, bestScore:80, xpEarned:12 });
    for (let i=1;i<=44;i++) await insert("ChapterProgress", { id:`m-legacy-${i}`, userId:"m-user-1", chapterId:`m-chapter-${i}`, completed:true, xpEarned:i });
    for (let i=1;i<=113;i++) await insert("ContentProgress", { id:`m-progress-${i}`, userId:`m-user-${1+(i-1)%28}`, contentKey:`bofm/test#${i}`, readStatus:"READ", rewardCorrect:2, baseXpEarned:12, legacyXp:8, updatedAt:new Date("2026-10-10T12:00:00Z") });
    for (let i=1;i<=89;i++) await insert("ExerciseSession", { id:`m-session-${i}`, userId:`m-user-${1+(i-1)%28}`, chapterId:`m-chapter-${1+(i-1)%56}`, contentKey:`bofm/test#${i}`, exerciseIds:'["m-exercise-1"]' });
    for (let i=1;i<=260;i++) await insert("ReadingSession", { id:`m-reading-${i}`, userId:`m-user-${1+(i-1)%28}`, chapterId:`m-chapter-${1+(i-1)%56}` });
    for (const table of ["Bookmark","Highlight","Note"]) await insert(table, { id:`m-${table}`, userId:"m-user-1", verseId:"m-verse-1", ...(table==="Note"?{ text:"Privétestnotitie, geen productiegegeven", updatedAt:new Date("2026-10-10T12:00:00Z") }: {}) });
    await insert("Podcast", { id:"m-podcast", slug:"m-podcast", name:"Synthetische podcast" });
    await insert("PodcastEpisode", { id:"m-episode", podcastId:"m-podcast", number:1, title:"Testaflevering" });
    for (let i=1;i<=12;i++) await insert("PodcastPlaybackProgress", { id:`m-playback-${i}`, userId:`m-user-${i}`, episodeId:"m-episode", positionSeconds:100+i, updatedAt:new Date("2026-10-10T12:00:00Z") });
    for (let i=1;i<=11;i++) await insert("PodcastEpisodeProgress", { id:`m-podcast-progress-${i}`, userId:`m-user-${i}`, episodeId:"m-episode", mode:"CONTENT", completed:true, xpEarned:10 });
    await insert("KidsStory", { id:"m-story", courseId:"m-course-1", number:1, title:"Testverhaal", text:"Synthetisch", images:"[]" });
    for (let i=1;i<=8;i++) await insert("KidsStoryProgress", { id:`m-kids-${i}`, userId:`m-user-${i}`, storyId:"m-story", completed:true, xpEarned:8 });
    await insert("IntroLesson", { id:"m-intro", number:1, slug:"m-intro", title:"Testintro", content:"[]" });
    for (let i=1;i<=24;i++) await insert("IntroLessonProgress", { id:`m-intro-progress-${i}`, userId:`m-user-${i}`, lessonId:"m-intro", completed:true, xpEarned:4 });
    for (let i=1;i<=37;i++) await insert("FsyLesson", { id:`m-fsy-${i}`, contentCollectionId:"content_fsy", year:2026, month:1+(i-1)%12, category:`test-${i}`, slug:`test-${i}`, title:`Testles ${i}`, content:'[{"type":"paragraph","text":"Synthetisch concept"}]', images:"[]", sourceUrl:`https://test.invalid/fsy/${i}`, sourceHash:`hash-${i}`, status:i<=16?"PUBLISHED":"DRAFT", publishedContent:i<=16?'[{"type":"paragraph","text":"Synthetische publicatie"}]':null });
    for (let i=1;i<=370;i++) await insert("XPTransaction", { id:`m-xp-${i}`, userId:`m-user-${1+(i-1)%28}`, amount:10, reason:"LESSON_COMPLETED" });
    for (let i=1;i<=149;i++) await insert("StreakActivity", { id:`m-activity-${i}`, userId:`m-user-${1+(i-1)%28}`, key:`read:bofm/test#${i}` });
    for (let i=1;i<=148;i++) await insert("StreakDay", { id:`m-day-${i}`, userId:`m-user-${1+(i-1)%28}`, dayKey:new Date(Date.UTC(2026,0,i)).toISOString().slice(0,10), status:"STUDIED" });
    await insert("WordGame", { id:"m-wordgame", userId:"m-user-1", dayKey:"2026-10-10", word:"ABCDE", guesses:'["FGHIJ"]', hintLevel:1, hintPools:'[["ABCDE","FGHIJ"]]', hintPurchases:'[{"actionId":"preserve"}]' });
    await insert("PuzzleDefinition", { id:"m-definition", contentKey:"test:puzzle", imageUrl:"/test.webp", storyNumber:1, aspectRatio:1, geometryVersion:2, seed:"preserve", definitionHash:"hash" });
    await insert("PuzzleVariant", { id:"m-variant", definitionId:"m-definition", pieceCount:6, difficulty:"ONTDEKKER", rulesVersion:3 });
    await insert("PuzzleSession", { id:"m-puzzle", ownerId:"m-user-1", variantId:"m-variant", snapshot:'{"preserve":"snapshot","groups":[1,2]}', version:4 });
    for (const setup of [
      'UPDATE "ContentCollection" SET work=NULL WHERE id=\'content_bom\'',
      'UPDATE "ContentCollection" SET work=\'unreviewed\' WHERE id=\'content_bom\'',
      'UPDATE "ContentCollection" SET "editionKey"=\'\' WHERE id=\'content_bom\'',
      'DROP INDEX "ContentCollection_work_editionKey_language_key"; UPDATE "ContentCollection" SET language=\'nl\' WHERE id=\'content_bom_en\'',
      `CREATE TYPE "ContentWorkKind" AS ENUM ('SCRIPTURE','STUDY_PROGRAM','OTHER'); CREATE TABLE "ContentWork" (key text PRIMARY KEY,kind "ContentWorkKind" NOT NULL); INSERT INTO "ContentWork" VALUES ('bofm','OTHER')`,
    ]) await mustRollback(setup);
    const blocker = new pg.Client({ connectionString:url.href }); await blocker.connect();
    await blocker.query('BEGIN; LOCK TABLE "ContentCollection" IN ACCESS EXCLUSIVE MODE');
    try { await assert.rejects(db.query(sql), e=>e.code==="55P03"); } finally { await blocker.query("ROLLBACK"); await blocker.end(); }
    const beforeAbort = await fingerprint();
    await db.query("BEGIN"); await db.query(sql);
    await assert.rejects(db.query("SELECT 1/0")); await db.query("ROLLBACK");
    assert.deepEqual(await fingerprint(),beforeAbort);
    assert.equal((await db.query(`SELECT to_regclass('"ContentWork"') AS present`)).rows[0].present,null);
    writeFileSync(stateFile,JSON.stringify(await fingerprint()),{mode:0o600});
    console.log("Metadatafixture 21 collecties, 28 synthetische users, 37 FSY-lessen; conflict-, lock- en rollbacktests geslaagd.");
  } else {
    assert.deepEqual(await fingerprint(),JSON.parse(readFileSync(stateFile,"utf8")));
    const collections=(await db.query('SELECT id,slug,work,"editionKey",language,enabled,"visibleToUsers","publicationState" FROM "ContentCollection" ORDER BY id')).rows;
    assert.deepEqual(collections,fixture.collections.map(c=>({...c,publicationState:"LEGACY"})));
    const expected=[['bofm','SCRIPTURE'],['dc-testament','SCRIPTURE'],['fsy','STUDY_PROGRAM'],['new-testament','SCRIPTURE'],['old-testament','SCRIPTURE'],['pgp','SCRIPTURE'],['podcasts','OTHER']];
    assert.deepEqual((await db.query('SELECT key,kind FROM "ContentWork" ORDER BY key')).rows,expected.map(([key,kind])=>({key,kind})));
    await insert("ContentWork",{key:"explicit-other",kind:"OTHER"});
    await insert("ContentCollection",{id:"new-draft",slug:"new-draft",name:"Nieuw",icon:"",work:"explicit-other"});
    const newRow=(await db.query('SELECT * FROM "ContentCollection" WHERE id=\'new-draft\'')).rows[0];
    assert.equal(newRow.publicationState,"DRAFT"); assert.equal(newRow.visibleToUsers,false);
    const beforeRetry=await fingerprint(); await db.query(sql); await db.query(sql);
    assert.deepEqual(await fingerprint(),beforeRetry);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "ContentWork"')).rows[0].n,8);
    await assert.rejects(db.query('INSERT INTO "ContentCollection"(id,slug,name,icon,work) VALUES (\'bad\',\'bad\',\'bad\',\'\',\'unreviewed\')'), e=>e.code==="23503");
    await assert.rejects(db.query('DELETE FROM "ContentWork" WHERE key=\'bofm\''), e=>e.code==="23503");
    await assert.rejects(db.query('UPDATE "ContentWork" SET key=\'renamed\' WHERE key=\'bofm\''), e=>e.code==="23503");
    console.log(JSON.stringify({preservedTables:Object.keys(beforeRetry).length,collectionIdsAndEditionsPreserved:21,legacyWorks:7,visible:6,hidden:15,fsyPublished:16,fsyDraft:21,repeatMigrationPassed:true,productionMutationPerformed:false}));
  }
} finally {await db.end();}
