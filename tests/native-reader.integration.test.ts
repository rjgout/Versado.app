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
