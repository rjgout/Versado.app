import sharp from "sharp";
import {
  validateStudyImage,
  installStudyMedia,
} from "../src/lib/studyContent/storage";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma, createPrismaClient } from "../src/lib/db";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import {
  createStudyImport,
  executeStudyImport,
  claimStudyImport,
  persistStudyImportItem,
  requireStudyLease,
} from "../src/lib/studyContent/imports";
import {
  publishStudyRevision,
  type StudyPublicationRequest,
} from "../src/lib/studyContent/publication";
import {
  studyPublishingOverview,
  studyRevisionPreview,
  studyRevisionHistory,
} from "../src/lib/studyContent/admin";
import {
  getPublishedStudyLesson,
  appendStudyRevision,
} from "../src/lib/studyContent/revisions";
import { authorizedStudyMedia } from "../src/lib/studyContent/mediaAccess";
import {
  snapshotRevisionInput,
  studyFixture,
} from "../src/lib/studyContent/fixtureAdapter";
import { studyRevisionFixture } from "./fixtures/study-content";
import type { StudyAdmin } from "../src/lib/studyContent/policy";
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
let actor: StudyAdmin,
  second: StudyAdmin,
  normal: StudyAdmin,
  auth: string,
  normalAuth: string,
  collection: string,
  runId: string,
  editionId: string,
  revisionId: string,
  mediaId: string;
let originalUser: unknown;
async function account(isAdmin: boolean) {
  return prisma.user.create({
    data: {
      email: `${randomUUID()}@study.test.invalid`,
      passwordHash: "test-only",
      handle: `S${randomUUID().slice(0, 8)}`,
      discriminator: "00",
      isAdmin,
      uiLanguage: "nl",
      hintBalance: 9,
      xpTotal: 123,
      timeZone: "UTC",
    },
  });
}
async function source(label = "bron", patch: Record<string, unknown> = {}) {
  const key = `synthetic-study-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  return (
    await prisma.contentCollection.create({
      data: {
        id: key,
        slug: key,
        name: `Synthetische ${label}`,
        work: key,
        editionKey: "fixture-v1",
        language: "nl",
        icon: "",
        visibleToUsers: true,
        publicationState: "PUBLISHED",
        ...patch,
      },
    })
  ).id;
}
async function imported(
  id: string,
  key:
    | "sample"
    | "updated"
    | "unresolved"
    | "invalid"
    | "batch-error" = "sample",
) {
  const run = await createStudyImport(actor, id, key);
  await executeStudyImport(actor, run.id);
  const item = await prisma.contentImportItem.findFirstOrThrow({
    where: { runId: run.id },
  });
  return { run, item };
}
function action(
  run = runId,
  edition = editionId,
  revision = revisionId,
  version = 0,
  kind: "PUBLISH" | "ROLLBACK" = "PUBLISH",
): StudyPublicationRequest {
  return {
    importRunId: run,
    editionId: edition,
    revisionId: revision,
    expectedVersion: version,
    kind,
    actionId: randomUUID(),
  };
}
async function request(
  method = "GET",
  body?: unknown,
  cookie: string | null = auth,
  origin: string | null = base.origin,
  route = "/api/admin/study-publications",
) {
  return fetch(new URL(route, base), {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
}
before(async () => {
  const a = await account(true),
    b = await account(true),
    n = await account(false);
  actor = { id: a.id, isAdmin: true };
  second = { id: b.id, isAdmin: true };
  normal = { id: n.id, isAdmin: false };
  auth = `${SESSION_COOKIE}=${await createSessionToken(a.id)}`;
  normalAuth = `${SESSION_COOKIE}=${await createSessionToken(n.id)}`;
  originalUser = await prisma.user.findMany({
    where: { id: { in: [a.id, b.id, n.id] } },
    orderBy: { id: "asc" },
  });
  collection = await source();
});
after(async () => {
  await prisma.$disconnect();
});
test("auth/Origin/strict payload weigeren vóór import, preview en publicatie", async () => {
  const before = await prisma.contentImportRun.count();
  for (const method of ["GET", "POST"]) {
    assert.equal(
      (
        await request(
          method,
          method === "POST" ? { action: "import" } : undefined,
          null,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await request(
          method,
          method === "POST" ? { action: "import" } : undefined,
          normalAuth,
        )
      ).status,
      403,
    );
  }
  for (const origin of ["https://evil.invalid", null])
    assert.equal(
      (
        await request(
          "POST",
          { action: "import", collectionId: collection, fixtureKey: "sample" },
          auth,
          origin,
        )
      ).status,
      403,
    );
  for (const patch of [
    { userId: normal.id },
    { sql: "SELECT secret" },
    { preview: true },
    { fixtureKey: "unknown" },
  ])
    assert.equal(
      (
        await request("POST", {
          action: "import",
          collectionId: collection,
          fixtureKey: "sample",
          ...patch,
        })
      ).status,
      400,
    );
  assert.equal(await prisma.contentImportRun.count(), before);
  assert.equal(
    (
      await request(
        "GET",
        undefined,
        auth,
        null,
        "/api/admin/study-publications?unknown=true",
      )
    ).status,
    400,
  );
  await assert.rejects(studyPublishingOverview(normal), /FORBIDDEN/);
  await assert.rejects(
    createStudyImport(normal, collection, "sample"),
    /FORBIDDEN/,
  );
});
test("DB/FS-compensatie: mislukte READY-commit behoudt bestand/STAGED en hervat zonder duplicaat", async () => {
  const run = await createStudyImport(actor, collection, "sample");
  runId = run.id;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION study_test_fail_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-ready-fault'; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER study_test_ready BEFORE UPDATE ON "ContentMedia" FOR EACH ROW EXECUTE FUNCTION study_test_fail_ready()`,
  );
  try {
    await assert.rejects(executeStudyImport(actor, runId));
  } finally {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER study_test_ready ON "ContentMedia"`,
    );
    await prisma.$executeRawUnsafe(`DROP FUNCTION study_test_fail_ready()`);
  }
  const staged = await prisma.contentMedia.findFirstOrThrow();
  assert.equal(staged.status, "STAGED");
  assert.ok(
    (
      await fs.stat(path.join(process.env.STUDY_MEDIA_DIR!, staged.storageKey))
    ).isFile(),
  );
  assert.equal(
    (await prisma.contentImportRun.findUniqueOrThrow({ where: { id: runId } }))
      .status,
    "FAILED",
  );
  assert.equal(
    await prisma.studyRevision.count({
      where: { edition: { collectionId: collection } },
    }),
    0,
  );
  await executeStudyImport(actor, runId);
  const finished = await prisma.contentImportRun.findUniqueOrThrow({
    where: { id: runId },
  });
  assert.equal(finished.status, "DRAFT_READY");
  assert.deepEqual(
    [finished.foundItems, finished.validatedItems, finished.processedItems],
    [1, 1, 1],
  );
  assert.equal(await prisma.contentMedia.count(), 1);
  assert.equal(
    (await prisma.contentMedia.findUniqueOrThrow({ where: { id: staged.id } }))
      .status,
    "READY",
  );
  mediaId = staged.id;
  const item = await prisma.contentImportItem.findFirstOrThrow({
    where: { runId },
  });
  editionId = item.lessonEditionId;
  revisionId = item.revisionId;
});
test("identieke import/workerretry deelt run en revisie; concept wijzigt geen publicatie", async () => {
  assert.equal(
    (await createStudyImport(actor, collection, "sample")).id,
    runId,
  );
  await executeStudyImport(actor, runId);
  assert.equal(await prisma.contentImportItem.count({ where: { runId } }), 1);
  assert.equal(
    await prisma.studyRevision.count({ where: { lessonEditionId: editionId } }),
    1,
  );
  const edition = await prisma.studyLessonEdition.findUniqueOrThrow({
    where: { id: editionId },
  });
  assert.equal(edition.publishedRevisionId, null);
  assert.equal(edition.draftRevisionId, revisionId);
  assert.equal(edition.publicationVersion, 0);
  assert.equal(
    await getPublishedStudyLesson(normal, edition.lessonId, collection),
    null,
  );
});
test("conceptmedia blijven privé; preview alleen expliciete admin zonder voorkeurs-/beloningswrites", async () => {
  await assert.rejects(authorizedStudyMedia(normal, mediaId), /UNAVAILABLE/);
  await assert.rejects(
    authorizedStudyMedia(normal, mediaId, true),
    /FORBIDDEN/,
  );
  assert.equal(
    (
      await request(
        "GET",
        undefined,
        normalAuth,
        null,
        `/api/study-media/${mediaId}?preview=true`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "GET",
        undefined,
        normalAuth,
        null,
        `/api/admin/study-media/${mediaId}`,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "GET",
        undefined,
        null,
        null,
        `/api/admin/study-media/${mediaId}`,
      )
    ).status,
    401,
  );
  const response = await request(
    "GET",
    undefined,
    auth,
    null,
    `/api/admin/study-media/${mediaId}`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const preview = await studyRevisionPreview(actor, editionId, revisionId);
  assert.equal(preview.media[0].ready, true);
  assert.equal(preview.references[0].diagnosis, "EXTERNAL_VERIFIED");
  assert.equal(preview.body.sections.length, 1);
  const http = await request(
    "GET",
    undefined,
    auth,
    null,
    `/api/admin/study-publications?editionId=${editionId}&revisionId=${revisionId}`,
  );
  assert.equal(http.status, 200);
  const text = await http.text();
  for (const secret of [
    "passwordHash",
    "SESSION_SECRET",
    "DATABASE_URL",
    "leaseHolder",
    process.env.STUDY_MEDIA_DIR!,
  ])
    assert.equal(text.includes(secret), false);
});
test("cross-edition/revisie/actor-manipulatie wordt geweigerd", async () => {
  const other = await imported(await source("andere editie"));
  await assert.rejects(
    publishStudyRevision(
      actor,
      action(runId, other.item.lessonEditionId, revisionId),
    ),
    /UNAVAILABLE/,
  );
  await assert.rejects(
    publishStudyRevision(
      actor,
      action(runId, editionId, other.item.revisionId),
    ),
    /UNAVAILABLE/,
  );
  await assert.rejects(publishStudyRevision(normal, action()), /FORBIDDEN/);
  await assert.rejects(
    prisma.studyLessonEdition.update({
      where: { id: editionId },
      data: { draftRevisionId: other.item.revisionId },
    }),
  );
  await assert.rejects(
    prisma.contentImportRun.update({
      where: { id: runId },
      data: { language: "en" },
    }),
    /STUDY_IMPORT_SNAPSHOT_IMMUTABLE/,
  );
});
test("ontbrekend/corrupt READY-bestand en readonly volume blokkeren publicatie zonder pointer/audit", async () => {
  const media = await prisma.contentMedia.findUniqueOrThrow({
      where: { id: mediaId },
    }),
    file = path.join(process.env.STUDY_MEDIA_DIR!, media.storageKey),
    temporary = `${file}.test-missing`;
  await fs.rename(file, temporary);
  try {
    await assert.rejects(publishStudyRevision(actor, action()), /MEDIA/);
  } finally {
    await fs.rename(temporary, file);
  }
  await fs.chmod(process.env.STUDY_MEDIA_DIR!, 0o500);
  try {
    await assert.rejects(publishStudyRevision(actor, action()), /STORAGE/);
  } finally {
    await fs.chmod(process.env.STUDY_MEDIA_DIR!, 0o700);
  }
  assert.equal(
    (
      await prisma.studyLessonEdition.findUniqueOrThrow({
        where: { id: editionId },
      })
    ).publishedRevisionId,
    null,
  );
  assert.equal(
    await prisma.studyPublicationAction.count({
      where: { lessonEditionId: editionId },
    }),
    0,
  );
});
test("identieke mediabytes met afwijkende rechten worden bij herimport geweigerd", async () => {
  const run = await createStudyImport(actor, collection, "rights-conflict");
  await assert.rejects(executeStudyImport(actor, run.id), /MEDIA/);
  const failed = await prisma.contentImportRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(failed.status, "FAILED");
  const current = await prisma.studyLessonEdition.findUniqueOrThrow({ where: { id: editionId } });
  assert.equal(current.publishedRevisionId, null);
  assert.equal(current.publicationVersion, 0);
  assert.equal(await prisma.studyPublicationAction.count({ where: { lessonEditionId: editionId } }), 0);
});

test("rechtenhash van een medium wordt bij publicatie opnieuw gevalideerd", async () => {
  // Simuleer uitsluitend in de geïsoleerde testdatabase een corrupte metadatarecord.
  // De SQL-trigger blokkeert dit in normale applicatiecode; na iedere wijziging
  // wordt de trigger binnen dezelfde transactie opnieuw ingeschakeld.
  const original = (await prisma.contentMedia.findUniqueOrThrow({ where: { id: mediaId } })).rightsMetadata;
  async function setTestMediaRights(rights: unknown) {
    await prisma.$transaction(async (db) => {
      await db.$executeRawUnsafe('ALTER TABLE "ContentMedia" DISABLE TRIGGER "ContentMedia_immutable"');
      await db.$executeRaw`UPDATE "ContentMedia" SET "rightsMetadata" = ${JSON.stringify(rights)}::jsonb WHERE id = ${mediaId}`;
      await db.$executeRawUnsafe('ALTER TABLE "ContentMedia" ENABLE TRIGGER "ContentMedia_immutable"');
    });
  }
  await setTestMediaRights({
    holder: "Synthetische fixture",
    permission: "Andere, niet-gecontroleerde mediatoestemming",
  });
  try {
    await assert.rejects(publishStudyRevision(actor, action()), /MEDIA/);
  } finally {
    await setTestMediaRights(original);
  }
  const edition = await prisma.studyLessonEdition.findUniqueOrThrow({ where: { id: editionId } });
  assert.equal(edition.publishedRevisionId, null);
  assert.equal(edition.publicationVersion, 0);
  assert.equal(await prisma.studyPublicationAction.count({ where: { lessonEditionId: editionId } }), 0);
});

test("volledige publicatie is atomair, identieke verloren-response retry schrijft eenmaal", async () => {
  const input = action();
  const values = await Promise.all([
    publishStudyRevision(actor, input),
    publishStudyRevision(actor, input),
  ]);
  assert.deepEqual(values.map((v) => v.changed).sort(), [false, true]);
  const retry = await publishStudyRevision(actor, input);
  assert.equal(retry.changed, false);
  assert.equal(retry.publicationVersion, 1);
  assert.equal(
    await prisma.studyPublicationAction.count({
      where: { lessonEditionId: editionId },
    }),
    1,
  );
  await assert.rejects(publishStudyRevision(second, input), /INVALID/);
  const row = await prisma.studyLessonEdition.findUniqueOrThrow({
    where: { id: editionId },
  });
  assert.equal(row.publishedRevisionId, revisionId);
  assert.equal(row.draftRevisionId, null);
  assert.equal(
    (await getPublishedStudyLesson(normal, row.lessonId, collection))
      ?.revisionId,
    revisionId,
  );
  assert.ok((await authorizedStudyMedia(normal, mediaId)).bytes.length);
});
test("historische publicatieaudit opent geen oude afbeelding na revisiewissel", async () => {
  const published = await prisma.studyLessonEdition.findUniqueOrThrow({ where: { id: editionId } });
  assert.equal(published.publishedRevisionId, revisionId);
  const textOnly = await appendStudyRevision(actor, editionId, {
    schemaVersion: 1,
    title: "Huidige synthetische les zonder afbeelding",
    body: {
      schemaVersion: 1,
      sections: [{
        id: "current-section",
        blocks: [{
          id: "current-paragraph",
          type: "paragraph",
          content: [{ type: "text", text: "Deze revisie gebruikt geen oude media." }],
        }],
      }],
    },
    sourceMetadata: { sourceKey: "fixture:current-text-only" },
    rightsMetadata: { holder: "Versado-testfixture", permission: "Alleen geïsoleerde test." },
  });
  await prisma.studyLessonEdition.update({
    where: { id: editionId },
    data: { publishedRevisionId: textOnly.id },
  });
  try {
    assert.equal(await prisma.studyPublicationAction.count({
      where: { lessonEditionId: editionId, revisionId },
    }), 1);
    await assert.rejects(authorizedStudyMedia(normal, mediaId), /UNAVAILABLE/);
    await assert.rejects(authorizedStudyMedia(actor, mediaId), /UNAVAILABLE/);
    assert.ok((await authorizedStudyMedia(actor, mediaId, true)).bytes.length);
    const ordinary = await request("GET", undefined, normalAuth, null, `/api/study-media/${mediaId}`);
    assert.equal(ordinary.status, 404);
    const preview = await request("GET", undefined, auth, null, `/api/admin/study-media/${mediaId}`);
    assert.equal(preview.status, 200);
  } finally {
    await prisma.studyLessonEdition.update({
      where: { id: editionId },
      data: { publishedRevisionId: published.publishedRevisionId },
    });
  }
  assert.ok((await authorizedStudyMedia(normal, mediaId)).bytes.length);
});

test("gewijzigde bron wordt immutable concept; publicatie blijft staan; diff gebruikt anchors", async () => {
  const next = await imported(collection, "updated");
  assert.notEqual(next.item.revisionId, revisionId);
  const row = await prisma.studyLessonEdition.findUniqueOrThrow({
    where: { id: editionId },
  });
  assert.equal(row.publishedRevisionId, revisionId);
  assert.equal(row.draftRevisionId, next.item.revisionId);
  const preview = await studyRevisionPreview(
    actor,
    editionId,
    next.item.revisionId,
  );
  assert.ok(
    preview.diff.changes.some(
      (c) => c.kind === "question" && c.change === "changed",
    ),
  );
  assert.equal(preview.diff.titleChanged, true);
  assert.equal(preview.diff.sourceChanged, false);
  await assert.rejects(
    publishStudyRevision(
      actor,
      action(next.run.id, editionId, next.item.revisionId, 0),
    ),
    /CONFLICT/,
  );
});
test("twee beheerders publish/publish en publish/rollback hebben één CAS-winnaar; oude retry herstelt niets", async () => {
  const next = await prisma.contentImportRun.findFirstOrThrow({
      where: {
        collectionId: collection,
        sourceVersion: "synthetic-updated-v1",
      },
    }),
    item = await prisma.contentImportItem.findFirstOrThrow({
      where: { runId: next.id },
    });
  const inputs = [
    action(next.id, editionId, item.revisionId, 1),
    action(next.id, editionId, item.revisionId, 1),
  ];
  const both = await Promise.allSettled([
    publishStudyRevision(actor, inputs[0]),
    publishStudyRevision(second, inputs[1]),
  ]);
  assert.equal(both.filter((x) => x.status === "fulfilled").length, 1);
  assert.ok(
    both.some(
      (x) => x.status === "rejected" && /CONFLICT/.test(String(x.reason)),
    ),
  );
  const winner =
    both[0].status === "fulfilled"
      ? { actor, input: inputs[0] }
      : { actor: second, input: inputs[1] };
  const rollback = action(runId, editionId, revisionId, 2, "ROLLBACK");
  const old = await publishStudyRevision(actor, rollback);
  assert.equal(old.publicationVersion, 3);
  assert.equal(old.publishedRevisionId, revisionId);
  const retry = await publishStudyRevision(winner.actor, winner.input);
  assert.equal(retry.publicationVersion, 3);
  assert.equal(retry.publishedRevisionId, revisionId);
  assert.equal(retry.changed, false);
  const fresh = await imported(await source("wedstrijd"));
  await publishStudyRevision(
    actor,
    action(fresh.run.id, fresh.item.lessonEditionId, fresh.item.revisionId),
  );
  const newer = await imported(fresh.run.collectionId, "updated");
  const results = await Promise.allSettled([
    publishStudyRevision(
      actor,
      action(
        newer.run.id,
        fresh.item.lessonEditionId,
        newer.item.revisionId,
        1,
      ),
    ),
    publishStudyRevision(
      second,
      action(
        fresh.run.id,
        fresh.item.lessonEditionId,
        fresh.item.revisionId,
        1,
        "ROLLBACK",
      ),
    ),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    await prisma.studyPublicationAction.count({
      where: { lessonEditionId: editionId },
    }),
    3,
  );
});
test("DB-fout bij audit rolt pointer, versie en concept terug", async () => {
  const next = await imported(await source("foutinjectie"));
  const before = await prisma.studyLessonEdition.findUniqueOrThrow({
    where: { id: next.item.lessonEditionId },
  });
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION study_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-publication-fault'; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER study_test_audit BEFORE INSERT ON "StudyPublicationAction" FOR EACH ROW EXECUTE FUNCTION study_test_audit_failure()`,
  );
  try {
    await assert.rejects(
      publishStudyRevision(
        actor,
        action(next.run.id, next.item.lessonEditionId, next.item.revisionId),
      ),
    );
  } finally {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER study_test_audit ON "StudyPublicationAction"`,
    );
    await prisma.$executeRawUnsafe(`DROP FUNCTION study_test_audit_failure()`);
  }
  assert.deepEqual(
    await prisma.studyLessonEdition.findUniqueOrThrow({
      where: { id: before.id },
    }),
    before,
  );
  assert.equal(
    await prisma.studyPublicationAction.count({
      where: { lessonEditionId: before.id },
    }),
    0,
  );
});
test("fout in tweede batch behoudt eerste reviewbare concept en vorige publicatie; run mag niet publiceren", async () => {
  const batch = await createStudyImport(actor, collection, "batch-error");
  await assert.rejects(executeStudyImport(actor, batch.id));
  const row = await prisma.contentImportRun.findUniqueOrThrow({
    where: { id: batch.id },
  });
  assert.equal(row.status, "FAILED");
  assert.equal(row.processedItems, 1);
  assert.equal(row.foundItems, 2);
  assert.equal(
    (
      await prisma.studyLessonEdition.findUniqueOrThrow({
        where: { id: editionId },
      })
    ).publishedRevisionId,
    revisionId,
  );
  const item = await prisma.contentImportItem.findFirstOrThrow({
    where: { runId: batch.id },
  });
  await assert.rejects(
    publishStudyRevision(
      actor,
      action(batch.id, item.lessonEditionId, item.revisionId, 3),
    ),
    /INCOMPLETE/,
  );
  const count = await prisma.studyRevision.count({
    where: { lessonEditionId: editionId },
  });
  await assert.rejects(executeStudyImport(actor, batch.id));
  assert.equal(
    await prisma.studyRevision.count({ where: { lessonEditionId: editionId } }),
    count,
  );
});
test("onopgeloste verwijzingen en ongeldige bronstructuur maken nooit publiceerbare inhoud", async () => {
  const result = await imported(await source("onopgelost"), "unresolved");
  const preview = await studyRevisionPreview(
    actor,
    result.item.lessonEditionId,
    result.item.revisionId,
  );
  assert.equal(preview.references[0].diagnosis, "UNRESOLVED");
  await assert.rejects(
    publishStudyRevision(
      actor,
      action(
        result.run.id,
        result.item.lessonEditionId,
        result.item.revisionId,
      ),
    ),
    /REFERENCES/,
  );
  const invalid = await createStudyImport(
    actor,
    await source("ongeldig"),
    "invalid",
  );
  await assert.rejects(executeStudyImport(actor, invalid.id));
  assert.equal(
    await prisma.contentImportItem.count({ where: { runId: invalid.id } }),
    0,
  );
  assert.equal(
    (
      await prisma.contentImportRun.findUniqueOrThrow({
        where: { id: invalid.id },
      })
    ).status,
    "FAILED",
  );
});
test("procesherstart, dubbele claims, fencing en leaseverlies voorkomen verouderde writes", async () => {
  const id = await source("lease"),
    run = await createStudyImport(actor, id, "sample");
  await assert.rejects(createStudyImport(actor, id, "updated"), /BUSY/);
  const claims = await Promise.allSettled([
    claimStudyImport(actor, run.id),
    claimStudyImport(second, run.id),
  ]);
  assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1);
  const old = (
    claims.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof claimStudyImport>>
    >
  ).value!;
  await prisma.$executeRaw`UPDATE "ContentImportRun" SET "leaseExpiresAt"=clock_timestamp()-INTERVAL '1 second' WHERE id=${run.id}`;
  await assert.rejects(
    prisma.$transaction((db) => requireStudyLease(db, old)),
    /LEASE_LOST/,
  );
  const newer = await claimStudyImport(actor, run.id);
  assert.ok(newer);
  assert.equal(newer.fence, old.fence + 1);
  await assert.rejects(persistStudyImportItem(actor, old, 0), /LEASE_LOST/);
  assert.equal(
    await prisma.contentImportItem.count({ where: { runId: run.id } }),
    0,
  );
  await persistStudyImportItem(actor, newer, 0);
  const count = await prisma.studyRevision.count({
    where: { edition: { collectionId: id } },
  });
  await prisma.$executeRaw`UPDATE "ContentImportRun" SET "leaseExpiresAt"=clock_timestamp()-INTERVAL '1 second' WHERE id=${run.id}`;
  await executeStudyImport(actor, run.id);
  assert.equal(
    (await prisma.contentImportRun.findUniqueOrThrow({ where: { id: run.id } }))
      .status,
    "DRAFT_READY",
  );
  assert.equal(
    await prisma.studyRevision.count({
      where: { edition: { collectionId: id } },
    }),
    count,
  );
});
test("gewone bronrechten blijven leidend, ook voor admins; expliciet preview blijft zonder openbaarstelling", async () => {
  const row = await prisma.studyLessonEdition.findUniqueOrThrow({
    where: { id: editionId },
  });
  for (const patch of [
    { publicationState: "DRAFT" as const },
    { visibleToUsers: false },
    { enabled: false },
  ]) {
    await prisma.contentCollection.update({
      where: { id: collection },
      data: patch,
    });
    assert.equal(
      await getPublishedStudyLesson(normal, row.lessonId, collection),
      null,
    );
    assert.equal(
      await getPublishedStudyLesson(actor, row.lessonId, collection),
      null,
    );
    assert.ok(await studyRevisionPreview(actor, editionId, revisionId));
    await prisma.contentCollection.update({
      where: { id: collection },
      data: {
        publicationState: "PUBLISHED",
        enabled: true,
        visibleToUsers: true,
      },
    });
  }
  for (const id of (
    await prisma.contentCollection.findMany({
      where: { work: { startsWith: "synthetic-study-" } },
    })
  ).map((c) => c.id))
    await prisma.contentCollection.update({
      where: { id },
      data: { visibleToUsers: false },
    });
  await assert.rejects(authorizedStudyMedia(actor, mediaId), /UNAVAILABLE/);
  assert.ok(await authorizedStudyMedia(actor, mediaId, true));
  await prisma.contentCollection.update({
    where: { id: collection },
    data: { visibleToUsers: true },
  });
});
test("immutability/relaties voorkomen vernietiging van audit, snapshots, publicaties en historische media", async () => {
  const run = await prisma.contentImportRun.findUniqueOrThrow({
      where: { id: runId },
    }),
    audit = await prisma.studyPublicationAction.findFirstOrThrow({
      where: { lessonEditionId: editionId },
    }),
    reference = await prisma.contentReference.findFirstOrThrow({
      where: { revisionId },
    });
  await assert.rejects(
    prisma.contentImportRun.update({
      where: { id: run.id },
      data: { sourceHash: "f".repeat(64) },
    }),
    /STUDY_IMPORT_SNAPSHOT_IMMUTABLE/,
  );
  await assert.rejects(
    prisma.contentImportRun.delete({ where: { id: run.id } }),
  );
  await assert.rejects(prisma.contentMedia.delete({ where: { id: mediaId } }));
  await assert.rejects(
    prisma.studyPublicationAction.update({
      where: { id: audit.id },
      data: { revisionId: "different" },
    }),
  );
  await assert.rejects(
    prisma.studyPublicationAction.delete({ where: { id: audit.id } }),
  );
  await assert.rejects(
    prisma.contentReference.update({
      where: { id: reference.id },
      data: { label: "stiekem veranderd" },
    }),
  );
  await assert.rejects(
    prisma.contentCollection.delete({ where: { id: collection } }),
  );
  assert.ok(
    await prisma.studyRevision.findUnique({ where: { id: revisionId } }),
  );
});
test("ontbrekende/verouderde tabellen leveren gecontroleerde API-fout zonder databasepad of query", async () => {
  // Transactionele DDL uitsluitend eigen wegwerpdatabase; API ziet committed naamwisseling.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ContentImportRun" RENAME TO "ContentImportRun_test_missing"`,
  );
  try {
    const response = await request();
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(!body.includes("Prisma"));
    assert.ok(!body.includes("SELECT"));
    assert.ok(!body.includes("postgresql"));
  } finally {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ContentImportRun_test_missing" RENAME TO "ContentImportRun"`,
    );
  }
});
test("prod-vrijgave gesloten, legacy FSY onaangetast; gebruikers/XP/hints/reeks/contexten byte-identiek", async () => {
  const profile = process.env.STUDY_PUBLICATION_PROFILE;
  process.env.STUDY_PUBLICATION_PROFILE = "production";
  try {
    await assert.rejects(
      createStudyImport(actor, collection, "sample"),
      /RELEASE_CLOSED/,
    );
    await assert.rejects(
      publishStudyRevision(actor, action()),
      /RELEASE_CLOSED/,
    );
  } finally {
    process.env.STUDY_PUBLICATION_PROFILE = profile;
  }
  await assert.rejects(
    createStudyImport(actor, "content_fsy", "sample"),
    /UNAVAILABLE/,
  );
  assert.deepEqual(
    await prisma.user.findMany({
      where: { id: { in: [actor.id, second.id, normal.id] } },
      orderBy: { id: "asc" },
    }),
    originalUser,
  );
  for (const id of [actor.id, second.id, normal.id]) {
    assert.equal(
      await prisma.userStudyContext.count({ where: { userId: id } }),
      0,
    );
    assert.equal(
      await prisma.streakActivity.count({ where: { userId: id } }),
      0,
    );
    assert.equal(
      await prisma.xPTransaction.count({ where: { userId: id } }),
      0,
    );
    assert.equal(
      await prisma.readingSession.count({ where: { userId: id } }),
      0,
    );
    assert.equal(
      await prisma.contentProgress.count({ where: { userId: id } }),
      0,
    );
  }
});

test("alle oudere ankers en revisies blijven bereikbaar via stabiele keyset-paginering", async () => {
  const old = await imported(await source("historie"));
  for (let n = 0; n < 22; n++)
    await appendStudyRevision(actor, old.item.lessonEditionId, {
      ...snapshotRevisionInput(studyFixture("sample").items[0]),
      title: `Synthetische historische revisie ${n}`,
    });
  const first = await studyRevisionHistory(actor, old.item.lessonEditionId);
  assert.equal(first.revisions.length, 20);
  assert.ok(first.nextCursor);
  const next = await studyRevisionHistory(
    actor,
    old.item.lessonEditionId,
    first.nextCursor,
  );
  assert.equal(next.nextCursor, null);
  assert.equal(
    new Set([...first.revisions, ...next.revisions].map((r) => r.id)).size,
    23,
  );
  assert.ok(next.revisions.some((r) => r.id === old.item.revisionId));
  await assert.rejects(
    studyRevisionHistory(normal, old.item.lessonEditionId),
    /FORBIDDEN/,
  );
});

test("leaseklok en audit-timestamps blijven UTC bij een afwijkende PostgreSQL-sessietijdzone", async () => {
  const connection = new URL(process.env.DATABASE_URL!);
  connection.searchParams.set("options", "-c timezone=Pacific/Auckland");
  const client = createPrismaClient({ url: connection.href });
  try {
    const collectionId = await source("UTC lease"),
      run = await createStudyImport(actor, collectionId, "sample", client);
    assert.ok(Math.abs(Date.now() - run.startedAt.getTime()) < 5000);
    const lease = await claimStudyImport(actor, run.id, client);
    assert.ok(lease);
    await persistStudyImportItem(actor, lease, 0, client);
    const row = await client.contentImportRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    const remaining = row.leaseExpiresAt!.getTime() - Date.now();
    assert.ok(remaining > 40000 && remaining <= 45000, String(remaining));
  } finally {
    await client.$disconnect();
  }
});

test("API-querytimeout geeft een veilige herstelbare fout bij een databasevergrendeling", async () => {
  let unlock!: () => void, locked!: () => void;
  const gate = new Promise<void>((r) => (unlock = r)),
    ready = new Promise<void>((r) => (locked = r));
  const blocker = prisma.$transaction(
    async (db) => {
      await db.$executeRaw`LOCK TABLE "ContentImportRun" IN ACCESS EXCLUSIVE MODE`;
      locked();
      await gate;
    },
    { timeout: 15000 },
  );
  await ready;
  const started = Date.now();
  try {
    const response = await request();
    assert.equal(response.status, 503);
    assert.ok(Date.now() - started < 9000);
    const text = await response.text();
    assert.ok(!text.includes("SELECT") && !text.includes("postgresql"));
  } finally {
    unlock();
    await blocker;
  }
});

test("nieuwe onopgeloste referentieaudit hergebruikt niet het oude goedgekeurde conceptbewijs", async () => {
  const first = await imported(await source("evidence-versie"));
  const unresolved = await imported(first.run.collectionId, "unresolved");
  assert.notEqual(unresolved.item.revisionId, first.item.revisionId);
  const preview = await studyRevisionPreview(
    actor,
    first.item.lessonEditionId,
    unresolved.item.revisionId,
  );
  assert.equal(preview.references[0].diagnosis, "UNRESOLVED");
  await assert.rejects(
    publishStudyRevision(
      actor,
      action(
        unresolved.run.id,
        unresolved.item.lessonEditionId,
        unresolved.item.revisionId,
      ),
    ),
    /REFERENCES/,
  );
});

test("legacy 2A-preview inventariseert ook ontbrekende media- en referentiekoppelingen zonder backfill", async () => {
  const id = await source("legacy preview"),
    collection = await prisma.contentCollection.findUniqueOrThrow({
      where: { id },
    }),
    period = await prisma.studyPeriod.create({
      data: {
        workKey: collection.work!,
        sourceKey: "legacy-preview-period",
        label: "Bestaande synthetische periode",
      },
    }),
    lesson = await prisma.studyLesson.create({
      data: {
        workKey: collection.work!,
        periodId: period.id,
        sourceKey: "legacy-preview-lesson",
      },
    }),
    edition = await prisma.studyLessonEdition.create({
      data: {
        workKey: collection.work!,
        lessonId: lesson.id,
        collectionId: id,
        slug: "legacy-preview",
      },
    });
  const revision = await appendStudyRevision(
      actor,
      edition.id,
      studyRevisionFixture(),
    ),
    preview = await studyRevisionPreview(actor, edition.id, revision.id);
  assert.ok(preview.media.length > 0);
  assert.ok(preview.media.every((m) => !m.ready && m.mediaId === null));
  assert.ok(preview.references.some((r) => r.diagnosis === "UNRESOLVED"));
  assert.equal(preview.importRunId, null);
  assert.equal(
    await prisma.studyRevisionMedia.count({
      where: { revisionId: revision.id },
    }),
    0,
  );
  assert.equal(
    await prisma.contentReference.count({ where: { revisionId: revision.id } }),
    0,
  );
  const response = await request(
    "GET",
    undefined,
    normalAuth,
    null,
    "/adminbackend/content/study-publications",
  );
  const html = await response.text();
  assert.ok(response.headers.has("location") || html.includes("NEXT_REDIRECT"));
  assert.ok(!html.includes(revision.title));
});

test("een extra binding aan een tekstpublicatie maakt private media niet publiek", async () => {
  const bytes = await sharp({
      create: {
        width: 9,
        height: 8,
        channels: 4,
        background: { r: 32, g: 60, b: 90, alpha: 1 },
      },
    })
      .png()
      .toBuffer(),
    image = await validateStudyImage(bytes, "image/png"),
    store = await installStudyMedia(bytes, image),
    media = await prisma.contentMedia.create({
      data: {
        ...image,
        volumeId: store.volumeId,
        sourceMetadata: {
          sourceKey: "fixture:private-image",
          adapter: "synthetic-v1",
        },
        rightsMetadata: {
          holder: "Synthetische fixture",
          permission: "Alleen geïsoleerde test",
        },
      },
    });
  await prisma.contentMedia.update({
    where: { id: media.id },
    data: { status: "READY" },
  });
  const id = await source("extra private binding"),
    collection = await prisma.contentCollection.findUniqueOrThrow({
      where: { id },
    }),
    period = await prisma.studyPeriod.create({
      data: {
        workKey: collection.work!,
        sourceKey: "extra-period",
        label: "Synthetisch",
      },
    }),
    lesson = await prisma.studyLesson.create({
      data: {
        workKey: collection.work!,
        periodId: period.id,
        sourceKey: "extra-lesson",
      },
    }),
    edition = await prisma.studyLessonEdition.create({
      data: {
        workKey: collection.work!,
        lessonId: lesson.id,
        collectionId: id,
        slug: "extra-private",
      },
    });
  const revision = await appendStudyRevision(actor, edition.id, {
    schemaVersion: 1,
    title: "Tekst zonder afbeelding",
    body: {
      schemaVersion: 1,
      sections: [
        {
          id: "source-section",
          blocks: [
            {
              id: "source-paragraph",
              type: "paragraph",
              content: [{ type: "text", text: "Synthetische leestekst" }],
            },
          ],
        },
      ],
    },
    sourceMetadata: { sourceKey: "fixture:text" },
    rightsMetadata: { holder: "Test", permission: "Synthetisch" },
  });
  await prisma.studyRevisionMedia.create({
    data: {
      revisionId: revision.id,
      mediaKey: "unapproved-extra",
      mediaId: media.id,
    },
  });
  await prisma.studyLessonEdition.update({
    where: { id: edition.id },
    data: { publishedRevisionId: revision.id },
  });
  await assert.rejects(authorizedStudyMedia(normal, media.id), /UNAVAILABLE/);
  assert.ok((await authorizedStudyMedia(actor, media.id, true)).bytes.length);
  assert.equal(
    (
      await request(
        "GET",
        undefined,
        normalAuth,
        null,
        `/api/study-media/${media.id}`,
      )
    ).status,
    404,
  );
});
