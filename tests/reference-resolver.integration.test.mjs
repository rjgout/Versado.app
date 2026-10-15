import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/db.ts";
import {
  referenceFixture,
  referenceHttp,
  referenceAccount,
  ensureReferenceOtbScripture,
  assertReferenceTestEnvironment,
} from "./fixtures/reference-content.mjs";
import { auditStudyReferences } from "../src/lib/references/audit.ts";
assertReferenceTestEnvironment();
after(() => prisma.$disconnect());
test("Nederlandse OTB-preview gebruikt de echte gekozen collectie, een hoofdstukanker en normale leesrechten", async () => {
  const f = await referenceFixture();
  const { collection, chapter } = await ensureReferenceOtbScripture();
  const beforeCollection = {
    enabled: collection.enabled,
    visibleToUsers: collection.visibleToUsers,
    publicationState: collection.publicationState,
  };
  const beforeUser = await prisma.user.findUniqueOrThrow({
    where: { id: f.owner.user.id },
  });
  try {
    await prisma.contentCollection.update({
      where: { id: collection.id },
      data: {
        enabled: true,
        visibleToUsers: true,
        publicationState: "PUBLISHED",
      },
    });
    const { resolveReferenceBatch } =
      await import("../src/lib/references/resolver.ts");
    const [resolved] = await prisma.$transaction((db) =>
      resolveReferenceBatch(db, f.owner.actor, f.dto.lesson, [
        {
          target: {
            sourceKey: "Gen. 1:1-5",
            workKey: "old-testament",
            editionKey: "otb",
            language: "nl",
          },
          diagnosticKey: "otb-reference",
        },
      ]),
    );
    assert.equal(resolved.kind, "internal");
    assert.equal(resolved.collectionId, collection.id);
    assert.equal(resolved.href, `/scripture/${chapter.id}#vers-1`);
    assert.deepEqual(
      resolved.preview.verses.map((verse) => verse.number),
      [1, 2, 3, 4, 5],
    );
    for (const item of [
      { key: "gen", name: "Genesis", chapter: 24, verses: 67 },
      { key: "psa", name: "Psalmen", chapter: 119, verses: 176 },
    ]) {
      const book = await prisma.book.upsert({
        where: {
          contentCollectionId_key: {
            contentCollectionId: collection.id,
            key: item.key,
          },
        },
        update: {},
        create: {
          slug: `long-reference-${item.key}-${f.owner.user.id}`,
          key: item.key,
          name: item.name,
          order: 1,
          contentCollectionId: collection.id,
        },
      });
      const longChapter = await prisma.chapter.create({
        data: {
          bookId: book.id,
          number: item.chapter,
          order: item.chapter,
          verses: {
            create: Array.from({ length: item.verses }, (_, i) => ({
              number: i + 1,
              text: `Synthetisch lang hoofdstukvers ${i + 1}.`,
            })),
          },
        },
      });
      const [preview] = await prisma.$transaction((db) =>
        resolveReferenceBatch(db, f.owner.actor, f.dto.lesson, [
          {
            target: {
              sourceKey: `${item.name} ${item.chapter}`,
              workKey: "old-testament",
              editionKey: "otb",
              language: "nl",
            },
            diagnosticKey: "long-chapter",
          },
        ]),
      );
      assert.equal(preview.kind, "internal");
      assert.equal(preview.preview.truncated, true);
      assert.equal(preview.preview.verses.length, 40);
      assert.equal(preview.href, `/scripture/${longChapter.id}#vers-1`);
      const fullPage = await fetch(
        new URL(preview.href, assertReferenceTestEnvironment()),
        { headers: { cookie: f.owner.cookie } },
      );
      assert.equal(fullPage.status, 200);
      assert.match(
        await fullPage.text(),
        new RegExp(`Synthetisch lang hoofdstukvers ${item.verses}\\.`),
      );
    }
    await prisma.contentCollection.update({
      where: { id: collection.id },
      data: { visibleToUsers: false },
    });
    const [blocked] = await prisma.$transaction((db) =>
      resolveReferenceBatch(db, f.owner.actor, f.dto.lesson, [
        {
          target: {
            sourceKey: "Genesis 1:1",
            workKey: "old-testament",
            editionKey: "otb",
            language: "nl",
          },
          diagnosticKey: "hidden-otb-reference",
        },
      ]),
    );
    assert.deepEqual(blocked, {
      kind: "unavailable",
      reason: "missing",
      diagnosticKey: "hidden-otb-reference",
    });
    assert.deepEqual(
      await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }),
      beforeUser,
    );
  } finally {
    await prisma.contentCollection.update({
      where: { id: collection.id },
      data: beforeCollection,
    });
  }
});
test("echte published-only preview geeft exacte verzen zonder voortgang/economie/voorkeurmutaties", async () => {
  const f = await referenceFixture();
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: f.owner.user.id },
  });
  const beforeProgress = await prisma.contentProgress.count({
    where: { userId: f.owner.user.id },
  });
  const beforePositions = await prisma.readingPosition.count({
    where: { userId: f.owner.user.id },
  });
  const r = await referenceHttp(f, { action: "preview", ...f.request });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  const result = await r.json();
  assert.equal(result.kind, "internal");
  assert.deepEqual(
    result.preview.verses.map((v) => v.number),
    [1, 2, 3],
  );
  assert.ok(result.preview.verses[0].text.startsWith("Ik, Nephi"));
  assert.equal(JSON.stringify(result).includes("passwordHash"), false);
  assert.deepEqual(
    await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }),
    before,
  );
  assert.equal(
    await prisma.contentProgress.count({ where: { userId: f.owner.user.id } }),
    beforeProgress,
  );
  assert.equal(
    await prisma.readingPosition.count({ where: { userId: f.owner.user.id } }),
    beforePositions,
  );
});
test("anoniem, onveilige origin, clienttarget/userId en verouderde sessiebinding worden geweigerd", async () => {
  const f = await referenceFixture();
  assert.equal(
    (await referenceHttp(f, { action: "preview", ...f.request }, null)).status,
    401,
  );
  assert.equal(
    (
      await referenceHttp(
        f,
        { action: "preview", ...f.request },
        f.owner,
        "https://evil.invalid",
      )
    ).status,
    403,
  );
  for (const extra of [
    { userId: f.admin.user.id },
    { target: { sourceKey: "hidden" } },
    { isAdmin: true },
    { url: "//evil.invalid" },
  ])
    assert.equal(
      (await referenceHttp(f, { action: "preview", ...f.request, ...extra }))
        .status,
      400,
    );
  assert.equal(
    (
      await referenceHttp(
        f,
        { action: "preview", ...f.request },
        { ...f.owner, sessionKey: "old-session" },
      )
    ).status,
    403,
  );
});
test("DRAFT/hidden/disabled oorsprong blijft ook voor admins gesloten; bewijs geeft geen extra rechten", async () => {
  const f = await referenceFixture();
  for (const change of [
    { visibleToUsers: false },
    { enabled: false },
    { publicationState: "DRAFT" },
  ]) {
    await prisma.contentCollection.update({
      where: { id: f.collection.id },
      data: change,
    });
    for (const who of [f.owner, f.admin])
      assert.equal(
        (await referenceHttp(f, { action: "preview", ...f.request }, who))
          .status,
        404,
      );
    await prisma.contentCollection.update({
      where: { id: f.collection.id },
      data: {
        visibleToUsers: true,
        enabled: true,
        publicationState: "PUBLISHED",
      },
    });
  }
});
test("ingetrokken doel en gewijzigde bron geven geen interne tekst of andere editie als fallback", async () => {
  const f = await referenceFixture(),
    source = await prisma.contentCollection.findUniqueOrThrow({
      where: { id: "content_bom" },
    });
  try {
    await prisma.contentCollection.update({
      where: { id: source.id },
      data: { visibleToUsers: false },
    });
    const result = await (
      await referenceHttp(f, { action: "preview", ...f.request })
    ).json();
    assert.equal(result.kind, "external");
    assert.equal(result.preview, undefined);
  } finally {
    await prisma.contentCollection.update({
      where: { id: source.id },
      data: { visibleToUsers: source.visibleToUsers },
    });
  }
});
test("historische verwijzing vereist zowel publicatieaudit als eigen nog geldig leesbezoekbewijs", async () => {
  const f = await referenceFixture();
  await f.publish("updated");
  const { visitProof, ...without } = f.request;
  assert.equal(
    (await referenceHttp(f, { action: "preview", ...without })).status,
    404,
  );
  assert.equal(
    (
      await referenceHttp(f, {
        action: "preview",
        ...f.request,
        visitProof: visitProof + "x",
      })
    ).status,
    404,
  );
  const other = await referenceAccount();
  assert.equal(
    (await referenceHttp(f, { action: "preview", ...f.request }, other)).status,
    404,
  );
  const r = await referenceHttp(f, { action: "preview", ...f.request });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).kind, "internal");
});
test("beheerreview controleert dezelfde mapping zonder publicatiepointer of gebruikersgegevens te veranderen", async () => {
  const f = await referenceFixture(),
    before = await prisma.studyLessonEdition.findUniqueOrThrow({
      where: { id: f.item.lessonEditionId },
    });
  await assert.rejects(
    auditStudyReferences(
      f.owner.actor,
      f.item.lessonEditionId,
      f.item.revisionId,
    ),
    /FORBIDDEN/,
  );
  const result = await auditStudyReferences(
    f.admin.actor,
    f.item.lessonEditionId,
    f.item.revisionId,
  );
  assert.equal(result.references[0].diagnosis, "INTERNAL_VERIFIED");
  assert.deepEqual(
    await prisma.studyLessonEdition.findUniqueOrThrow({
      where: { id: f.item.lessonEditionId },
    }),
    before,
  );
});
async function moreInput(f) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: f.owner.user.id },
  });
  return {
    action: "more",
    ...f.request,
    expectedSelection: {
      activeContentCollectionId: user.activeContentCollectionId,
      contentLanguage: user.contentLanguage,
    },
    expectedSelectionVersion: user.contentSelectionVersion,
    expectedPositionVersion: 0,
  };
}
test("Meer lezen en terugkeer wijzigen alleen bewuste bronvoorkeur; retry en ABA overschrijven niets", async () => {
  const f = await referenceFixture(),
    input = await moreInput(f);
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: f.owner.user.id },
  });
  const more = await referenceHttp(f, input);
  assert.equal(more.status, 200);
  const trip = await more.json();
  assert.match(trip.href, /^\/scripture\//);
  assert.ok(trip.href.includes("returnKey="));
  const after = await prisma.user.findUniqueOrThrow({
    where: { id: f.owner.user.id },
  });
  assert.equal(after.activeContentCollectionId, "content_bom");
  assert.equal(
    after.contentSelectionVersion,
    before.contentSelectionVersion + 1,
  );
  for (const field of [
    "xpTotal",
    "hintBalance",
    "activeCourseId",
    "streakCount",
  ])
    assert.equal(after[field], before[field]);
  assert.equal(
    await prisma.readingSession.count({ where: { userId: f.owner.user.id } }),
    0,
  );
  assert.equal((await referenceHttp(f, input)).status, 409); // responseverlies: geen tweede mutatie of verzonnen terugkeerbewijs
  assert.equal(
    (await referenceHttp(f, { action: "return", token: trip.token })).status,
    200,
  );
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
      .activeContentCollectionId,
    f.collection.id,
  );
  const returned = await prisma.user.findUniqueOrThrow({
    where: { id: f.owner.user.id },
  });
  assert.equal(
    (await referenceHttp(f, { action: "return", token: trip.token })).status,
    200,
  );
  assert.deepEqual(
    await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }),
    returned,
  );
  const next = await (await referenceHttp(f, await moreInput(f))).json();
  await prisma.user.update({
    where: { id: f.owner.user.id },
    data: { activeContentCollectionId: f.collection.id },
  });
  await prisma.user.update({
    where: { id: f.owner.user.id },
    data: { activeContentCollectionId: "content_bom" },
  });
  assert.equal(
    (await referenceHttp(f, { action: "return", token: next.token })).status,
    409,
  );
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
      .activeContentCollectionId,
    "content_bom",
  );
});
test("twee gelijktijdige uitstappen, andere gebruiker, vervallen rechten en gewijzigde lescontext zijn veilig", async () => {
  const f = await referenceFixture(),
    body = await moreInput(f);
  const requests = await Promise.all([
    referenceHttp(f, body),
    referenceHttp(f, body),
  ]);
  assert.deepEqual(requests.map((r) => r.status).sort(), [200, 409]);
  const trip = await requests.find((r) => r.status === 200).json();
  const other = await referenceAccount();
  assert.equal(
    (await referenceHttp(f, { action: "return", token: trip.token }, other))
      .status,
    404,
  );
  await prisma.userStudyContext.create({
    data: {
      userId: f.owner.user.id,
      workKey: f.collection.work,
      activeLessonKey: null,
      version: 1,
      lastActionId: crypto.randomUUID(),
    },
  });
  assert.equal(
    (await referenceHttp(f, { action: "return", token: trip.token })).status,
    409,
  );
  await prisma.contentCollection.update({
    where: { id: f.collection.id },
    data: { publicationState: "DRAFT" },
  });
  assert.equal(
    (await referenceHttp(f, { action: "return", token: trip.token })).status,
    404,
  );
});
test("publicatiegate weigert gewijzigd bewijs en resolver toont geen ongemapte interne doelen", async () => {
  const f = await referenceFixture();
  await prisma.contentReference.updateMany({
    where: { revisionId: f.item.revisionId },
    data: { evidenceKey: "forged-proof" },
  });
  await assert.rejects(
    import("../src/lib/studyContent/publication.ts").then(
      ({ publishStudyRevision }) =>
        publishStudyRevision(f.admin.actor, {
          editionId: f.item.lessonEditionId,
          revisionId: f.item.revisionId,
          importRunId: f.item.runId,
          kind: "PUBLISH",
          expectedVersion: 1,
          actionId: crypto.randomUUID(),
        }),
    ),
    /REFERENCES/,
  );
  assert.equal(
    (await referenceHttp(f, { action: "preview", ...f.request })).status,
    200,
  ); // autoriteit is onveranderlijke body + werkelijk bewijs, geen mutable diagnostiek
});

test("databasefout tijdens broncommit rolt de teller en selectie terug en lekt geen ruwe fout", async () => {
  const f = await referenceFixture(),
    before = await prisma.user.findUniqueOrThrow({
      where: { id: f.owner.user.id },
    }),
    body = await moreInput(f);
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION reference_selection_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-test-db-failure'; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER reference_selection_fail AFTER UPDATE OF "activeContentCollectionId" ON "User" FOR EACH ROW WHEN (NEW."activeContentCollectionId"='content_bom') EXECUTE FUNCTION reference_selection_fail()`,
  );
  try {
    const r = await referenceHttp(f, body);
    assert.equal(r.status, 503);
    assert.equal(
      JSON.stringify(await r.json()).includes("private-test-db-failure"),
      false,
    );
    assert.deepEqual(
      await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }),
      before,
    );
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER reference_selection_fail ON "User"',
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION reference_selection_fail()");
  }
});

test("gepubliceerde studieles en sectie gebruiken dezelfde veilige resolver zonder taaluitwijking", async () => {
  const f = await referenceFixture(),
    { resolveReferenceBatch } =
      await import("../src/lib/references/resolver.ts");
  const target = {
    sourceKey: "study:" + f.dto.lesson.sourceKey + "#section-intro",
  };
  const [result] = await prisma.$transaction((db) =>
    resolveReferenceBatch(db, f.owner.actor, f.dto.lesson, [
      { target, diagnosticKey: "study-ref" },
    ]),
  );
  assert.equal(result.kind, "internal");
  assert.equal(result.preview.kind, "study");
  assert.equal(result.preview.document.sections.length, 1);
  assert.ok(result.href.endsWith("#section-intro"));
  for (const change of [
    { language: "en" },
    { editionKey: "non-equivalent" },
    { sourceKey: "study:" + f.dto.lesson.sourceKey + "#missing" },
  ]) {
    const [missing] = await prisma.$transaction((db) =>
      resolveReferenceBatch(db, f.owner.actor, f.dto.lesson, [
        { target: { ...target, ...change }, diagnosticKey: "study-ref" },
      ]),
    );
    assert.equal(missing.kind, "unavailable");
  }
});

test("echte PostgreSQL-preview blijft begrensd en haalt geen individuele preview vooraf op", async () => {
  const f = await referenceFixture();
  const { PrismaPg } = await import("@prisma/adapter-pg"),
    { PrismaClient } = await import("../src/generated/prisma/client.ts"),
    { resolveStudyReference } =
      await import("../src/lib/references/resolver.ts");
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: [{ emit: "event", level: "query" }],
  });
  const queries = [];
  client.$on("query", (e) =>
    queries.push({ query: e.query, duration: e.duration }),
  );
  try {
    await resolveStudyReference(
      f.owner.actor,
      f.request,
      f.owner.sessionKey,
      client,
    );
    queries.length = 0;
    const timings = [],
      bytes = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now(),
        result = await resolveStudyReference(
          f.owner.actor,
          f.request,
          f.owner.sessionKey,
          client,
        );
      timings.push(Math.round((performance.now() - start) * 100) / 100);
      bytes.push(Buffer.byteLength(JSON.stringify(result)));
    }
    const selects = queries.filter((q) => /^SELECT/i.test(q.query.trim()));
    const chapters = selects.filter(
      (q) =>
        /FROM "(?:public"\.)?Chapter"/.test(q.query) ||
        /FROM "public"\."Chapter"/.test(q.query),
    );
    assert.ok(selects.length <= 45);
    assert.equal(chapters.length, 3);
    assert.ok(bytes.every((b) => b <= 48000));
    console.log(
      JSON.stringify({
        referenceQueryBudget: {
          samples: 3,
          selectsPerPreview: selects.length / 3,
          chapterQueriesPerPreview: chapters.length / 3,
          totalQueriesPerPreview: queries.length / 3,
          milliseconds: timings,
          responseBytes: bytes[0],
        },
        productionQueried: false,
      }),
    );
  } finally {
    await client.$disconnect();
  }
});

test("client kan een vorige voorkeur niet verzinnen bij een uitstap die al op het doel staat", async () => {
  const f = await referenceFixture();
  await prisma.user.update({
    where: { id: f.owner.user.id },
    data: { activeContentCollectionId: "content_bom" },
  });
  const current = await prisma.user.findUniqueOrThrow({
      where: { id: f.owner.user.id },
    }),
    input = await moreInput(f);
  input.expectedSelection = {
    activeContentCollectionId: f.collection.id,
    contentLanguage: "nl",
  };
  const response = await referenceHttp(f, input);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).token, undefined);
  assert.deepEqual(
    await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }),
    current,
  );
});

test("Meer lezen naar een andere studieles bewaart beide contextversies en blokkeert een nieuwere doelkeuze", async () => {
  const f = await referenceFixture(),
    target = await referenceFixture();
  const { appendStudyRevision } =
      await import("../src/lib/studyContent/revisions.ts"),
    { getStudyReader } = await import("../src/lib/studyContent/reader.ts");
  const original = await prisma.studyRevision.findUniqueOrThrow({
      where: { id: f.item.revisionId },
    }),
    body = structuredClone(original.body);
  const ref = body.sections[0].blocks.find(
    (block) => block.type === "reference",
  );
  ref.label = "Doelstudieles";
  ref.target = {
    sourceKey: "study:" + target.dto.lesson.sourceKey + "#section-intro",
    workKey: target.collection.work,
    editionKey: target.collection.editionKey,
    language: "nl",
  };
  const revision = await appendStudyRevision(
    f.admin.actor,
    f.item.lessonEditionId,
    {
      schemaVersion: 1,
      title: original.title,
      body,
      sourceMetadata: original.sourceMetadata,
      rightsMetadata: original.rightsMetadata,
    },
  );
  // Alleen eigen synthetische resolverfixture; geen import/publicatievrijgave of productieactie.
  await prisma.contentReference.create({
    data: {
      revisionId: revision.id,
      occurrenceKey: "reference-intro",
      label: ref.label,
      originalTarget: ref.target,
      normalizedTarget: {},
      diagnosis: "UNRESOLVED",
    },
  });
  await prisma.studyLessonEdition.update({
    where: { id: f.item.lessonEditionId },
    data: {
      publishedRevisionId: revision.id,
      publicationVersion: { increment: 1 },
    },
  });
  const dto = await getStudyReader(
    f.owner.actor,
    f.item.edition.lessonId,
    f.collection.id,
    f.owner.sessionKey,
  );
  f.request = {
    ...f.request,
    revisionId: revision.id,
    visitProof: dto.visitProof,
  };
  await prisma.userStudyContext.create({
    data: {
      userId: f.owner.user.id,
      workKey: target.collection.work,
      activeLessonKey: "study:" + target.dto.lesson.lessonId,
      version: 1,
      lastActionId: crypto.randomUUID(),
    },
  });
  const more = await referenceHttp(f, await moreInput(f));
  assert.equal(more.status, 200);
  const trip = await more.json();
  assert.equal(trip.trip.targetStudyWorkKey, target.collection.work);
  assert.equal(trip.trip.targetStudyVersion, 1);
  const selected = await prisma.user.findUniqueOrThrow({
    where: { id: f.owner.user.id },
  });
  assert.equal(selected.activeContentCollectionId, target.collection.id);
  await prisma.userStudyContext.update({
    where: {
      userId_workKey: {
        userId: f.owner.user.id,
        workKey: target.collection.work,
      },
    },
    data: {
      activeLessonKey: null,
      version: 2,
      lastActionId: crypto.randomUUID(),
    },
  });
  assert.equal(
    (await referenceHttp(f, { action: "return", token: trip.token })).status,
    409,
  );
  assert.deepEqual(
    await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }),
    selected,
  );
});
