import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { CFM_SOURCE_2026 } from "../src/lib/studyContent/cfmSources.ts";
import {
  cfmSourceHash,
  CFM_RIGHTS,
} from "../src/lib/studyContent/cfm2026Adapter.ts";
import { importCfmDrafts } from "../src/lib/studyContent/cfm2026Import.ts";
import { refreshCfmImages } from "../src/lib/studyContent/cfmMedia.ts";
import {
  cfmRecoveryPlan,
  validateCfmRecoveryPlan,
} from "../src/lib/studyContent/cfmRecovery.ts";
import { publishStudyRevision } from "../src/lib/studyContent/publication.ts";
import {
  authorizeStudyMedia,
  authorizedStudyMedia,
} from "../src/lib/studyContent/mediaAccess.ts";
import {
  readStudyMedia,
  validateStudyImage,
} from "../src/lib/studyContent/storage.ts";
import { syntheticStudyEnvironment } from "../src/lib/studyContent/policy.ts";
const base = process.env.CONTENT_ACCESS_TEST_BASE_URL;
if (
  !syntheticStudyEnvironment() ||
  !base?.startsWith("http://127.0.0.1:") ||
  process.env.DATABASE_URL !== process.env.CONTENT_ACCESS_TEST_DATABASE_URL
)
  throw Error("Eigen geïsoleerde testdatabase vereist");
after(() => prisma.$disconnect());
const account = async (isAdmin) =>
  prisma.user.create({
    data: {
      email: `${randomUUID()}@cfm-refresh.test.invalid`,
      passwordHash: "synthetic-test",
      handle: `U${randomUUID().slice(0, 7)}`,
      discriminator: "00",
      isAdmin,
    },
  });
async function domain() {
  return {
    editions: await prisma.studyLessonEdition.findMany({
      orderBy: { id: "asc" },
    }),
    revisions: await prisma.studyRevision.findMany({ orderBy: { id: "asc" } }),
    imports: await prisma.contentImportRun.findMany({ orderBy: { id: "asc" } }),
    publications: await prisma.studyPublicationAction.findMany({
      orderBy: { id: "asc" },
    }),
    collections: await prisma.contentCollection.findMany({
      orderBy: { id: "asc" },
    }),
    courses: await prisma.course.findMany({ orderBy: { id: "asc" } }),
    users: await prisma.user.findMany({ orderBy: { id: "asc" } }),
    progress: await prisma.contentProgress.findMany({ orderBy: { id: "asc" } }),
    steps: await prisma.studyStepProgress.findMany(),
  };
}

test("bestaande beheer-GET/POST: rechten, origin, actueel plan en media-only job zonder import/publicatie", async () => {
  const admin = await account(true),
    member = await account(false),
    actor = { id: admin.id, isAdmin: true };
  const cookie = `${SESSION_COOKIE}=${await createSessionToken(admin.id)}`,
    memberCookie = `${SESSION_COOKIE}=${await createSessionToken(member.id)}`;
  const before = await domain(),
    plan = await cfmRecoveryPlan(actor, prisma);
  assert.deepEqual(await domain(), before);
  assert.equal(plan.requiresMediaReview, false);
  await assert.rejects(
    cfmRecoveryPlan({ id: member.id, isAdmin: false }, prisma),
    /FORBIDDEN/,
  );
  await assert.rejects(
    validateCfmRecoveryPlan(actor, prisma, "0".repeat(64), false),
    /CONFLICT/,
  );
  const query = "/api/admin/reseed?cfmRecovery=1";
  assert.equal((await fetch(base + query)).status, 401);
  assert.equal(
    (await fetch(base + query, { headers: { Cookie: memberCookie } })).status,
    403,
  );
  const read = await fetch(base + query, { headers: { Cookie: cookie } });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).planHash, plan.planHash);
  assert.match(read.headers.get("cache-control"), /no-store/);
  const body = {
    action: "cfm-prepare",
    approvedSnapshot: plan.approvedSnapshot,
    planHash: plan.planHash,
    confirmDraftsOnly: true,
    confirmReviewedMedia: false,
  };
  const post = (value, headers = {}) =>
    fetch(base + "/api/admin/reseed", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: base,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(value),
    });
  assert.equal((await post(body, { Cookie: memberCookie })).status, 403);
  assert.equal(
    (await post(body, { Origin: "https://untrusted.invalid" })).status,
    403,
  );
  assert.equal((await post({ ...body, planHash: "0".repeat(64) })).status, 409);
  assert.equal((await post({ ...body, extra: "tampered" })).status, 400);
  // Lege CFM-staat: deze geautoriseerde media-only actie mag geen seed/import uitvoeren.
  assert.equal((await post(body)).status, 200);
  let job;
  for (let i = 0; i < 100; i++) {
    job = (
      await (
        await fetch(base + "/api/admin/reseed", { headers: { Cookie: cookie } })
      ).json()
    ).job;
    if (job.status !== "running") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(job.status, "done");
  assert.match(job.logs.join("\n"), /geen lessen geïmporteerd/);
  assert.deepEqual(await domain(), before);
});

test("echte CFM-import, vervanging, publicatie en autorisatie behouden tekst, identiteit en voortgang", async (t) => {
  const user = await account(true),
    actor = { id: user.id, isAdmin: true },
    memberUser = await account(false),
    member = { id: memberUser.id, isAdmin: false };
  const source = CFM_SOURCE_2026,
    original = { ...source },
    folder = await fs.mkdtemp(
      path.join(process.cwd(), "data/study-content/.cfm-refresh-test-"),
    );
  const pin = source.mediaLock[0],
    lesson = source.manifest.lessons[0];
  const make = async (quality) =>
    sharp({
      create: {
        width: pin.width,
        height: pin.height,
        channels: 3,
        background: "#865a34",
      },
    })
      .jpeg({ quality })
      .toBuffer();
  const initial = await make(90),
    next = await make(65),
    third = await make(45);
  const raw = JSON.stringify({
    uri: `/manual/${source.manualSlug}/${lesson.sourceKey}`,
    restricted: false,
    title: "Synthetische mediaregel",
    attributes: {
      lang: "nld",
      "data-uri": `/manual/${source.manualSlug}/${lesson.sourceKey}`,
    },
    body: `<p id="p1">Alleen synthetische testinhoud.</p><img id="test-image" src="${pin.url}" alt="Gecontroleerd testbeeld" />`,
  });
  try {
    await fs.mkdir(path.join(folder, "source"));
    await fs.writeFile(
      path.join(folder, "source", `${lesson.sourceKey}.json`),
      raw,
    );
    for (const file of source.approvalFiles)
      await fs.copyFile(
        path.join(source.dataDir, file),
        path.join(folder, file),
      );
    Object.assign(source, {
      dataDir: path.relative(process.cwd(), folder),
      manifest: { ...source.manifest, lessons: [lesson] },
      mediaLock: [pin],
      sourceLock: {
        ...source.sourceLock,
        lessons: { [lesson.sourceKey]: cfmSourceHash(raw) },
      },
      referenceReview: null,
    });
    const result = await importCfmDrafts(actor, source, {
      mode: "append-only",
      mediaBytes: async () => initial,
    });
    assert.equal(result.importedLessons, 1);
    assert.equal(await prisma.studyPublicationAction.count(), 0);
    await prisma.contentProgress.create({
      data: {
        userId: memberUser.id,
        contentKey: "cfm-refresh-preserved",
        readVerse: 2,
      },
    });
    await prisma.studyStepProgress.create({
      data: {
        userId: memberUser.id,
        lessonEditionId: result.lessons[0].editionId,
        stepFingerprint: "a".repeat(32),
        stepIndex: 1,
        revisionId: result.lessons[0].revisionId,
        status: "COMPLETED",
        completedAt: new Date("2026-01-01T12:00:00Z"),
      },
    });
    const first = await prisma.contentMedia.findFirstOrThrow({
      where: {
        sourceMetadata: { path: ["sourceKey"], equals: pin.url },
        revisionMedia: {
          some: { revision: { edition: { workKey: source.manifest.workKey } } },
        },
      },
    });
    const unchanged = await domain(),
      oldBytes = await readStudyMedia(first, true),
      plan = await cfmRecoveryPlan(actor, prisma);
    assert.deepEqual(oldBytes, initial);
    await t.test(
      "geldige hercompressie vervangt alleen de mediakoppeling; herhaling is idempotent",
      async () => {
        const { setRealtimeServer } = await import("../src/lib/realtime.ts");
        const notifications = [];
        setRealtimeServer({
          emit: (event, payload) => notifications.push({ event, payload }),
        });
        let report;
        try {
          report = await refreshCfmImages(
            actor,
            prisma,
            source,
            async () => next,
          );
        } finally {
          setRealtimeServer(undefined);
        }
        assert.ok(
          notifications.some(
            (item) =>
              item.event === "data_event" &&
              item.payload.event === "contentChanged",
          ),
        );
        assert.equal(report[0].status, "updated");
        assert.ok(report[0].bindings > 0);
        assert.deepEqual(await domain(), unchanged);
        assert.deepEqual(await readStudyMedia(first, true), initial);
        const binding = await prisma.studyRevisionMedia.findFirstOrThrow({
          where: {
            revision: { edition: { workKey: source.manifest.workKey } },
          },
          include: { media: true },
        });
        assert.notEqual(binding.mediaId, first.id);
        assert.deepEqual(await readStudyMedia(binding.media, true), next);
        assert.ok(
          binding.media.sourceMetadata.cfmPreviousChecksums.includes(
            first.checksum,
          ),
        );
        assert.equal(
          (await refreshCfmImages(actor, prisma, source, async () => next))[0]
            .bindings,
          0,
        );
        await assert.rejects(
          validateCfmRecoveryPlan(actor, prisma, plan.planHash, false),
          /CONFLICT/,
        );
      },
    );
    await t.test(
      "netwerk-, decode- en transactiefout bewaren de bestaande koppeling en bestanden",
      async () => {
        const bindings = await prisma.studyRevisionMedia.findMany(),
          media = await prisma.contentMedia.findMany({
            orderBy: { id: "asc" },
          });
        for (const callback of [
          async () => {
            throw Error("synthetic network");
          },
          async () => Buffer.from("damaged"),
        ])
          assert.equal(
            (await refreshCfmImages(actor, prisma, source, callback))[0].status,
            "retained",
          );
        assert.deepEqual(await prisma.studyRevisionMedia.findMany(), bindings);
        assert.deepEqual(
          await prisma.contentMedia.findMany({ orderBy: { id: "asc" } }),
          media,
        );
        await prisma.$executeRawUnsafe(
          `CREATE FUNCTION cfm_refresh_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic media rollback'; END $$`,
        );
        await prisma.$executeRawUnsafe(
          `CREATE TRIGGER cfm_refresh_failure BEFORE UPDATE ON "StudyRevisionMedia" FOR EACH ROW EXECUTE FUNCTION cfm_refresh_fail()`,
        );
        try {
          assert.equal(
            (
              await refreshCfmImages(actor, prisma, source, async () => third)
            )[0].status,
            "retained",
          );
        } finally {
          await prisma.$executeRawUnsafe(
            'DROP TRIGGER cfm_refresh_failure ON "StudyRevisionMedia"',
          );
          await prisma.$executeRawUnsafe("DROP FUNCTION cfm_refresh_fail()");
        }
        assert.deepEqual(await prisma.studyRevisionMedia.findMany(), bindings);
        assert.deepEqual(
          await prisma.contentMedia.findMany({ orderBy: { id: "asc" } }),
          media,
        );
        assert.deepEqual(await domain(), unchanged);
      },
    );
    await t.test(
      "een beschadigd bestaand bestand wordt pas door de geldige actuele download atomair hersteld",
      async () => {
        const binding = await prisma.studyRevisionMedia.findFirstOrThrow({
          where: {
            revision: { edition: { workKey: source.manifest.workKey } },
          },
          include: { media: true },
        });
        const file = path.join(
          process.env.STUDY_MEDIA_DIR,
          binding.media.storageKey,
        );
        await fs.chmod(file, 0o600);
        await fs.writeFile(file, Buffer.from("damaged"));
        const failed = await refreshCfmImages(
          actor,
          prisma,
          source,
          async () => {
            throw Error("synthetic network");
          },
        );
        assert.equal(failed[0].status, "retained");
        assert.deepEqual(await fs.readFile(file), Buffer.from("damaged"));
        assert.equal(
          (await refreshCfmImages(actor, prisma, source, async () => next))[0]
            .status,
          "updated",
        );
        assert.deepEqual(await readStudyMedia(binding.media, true), next);
        assert.deepEqual(await domain(), unchanged);
      },
    );
    await t.test(
      "bevoegdheden worden opnieuw gecontroleerd na download; geen gewone gebruiker kan verversen",
      async () => {
        await assert.rejects(
          refreshCfmImages(member, prisma, source, async () => third),
          /FORBIDDEN/,
        );
        const before = await prisma.studyRevisionMedia.findMany();
        await prisma.user.update({
          where: { id: user.id },
          data: { isAdmin: false },
        });
        try {
          await assert.rejects(
            refreshCfmImages(actor, prisma, source, async () => third),
            /FORBIDDEN/,
          );
        } finally {
          await prisma.user.update({
            where: { id: user.id },
            data: { isAdmin: true },
          });
        }
        assert.deepEqual(await prisma.studyRevisionMedia.findMany(), before);
      },
    );
    const run = result.lessons[0],
      edition = await prisma.studyLessonEdition.findUniqueOrThrow({
        where: { id: run.editionId },
      });
    await publishStudyRevision(
      actor,
      {
        editionId: edition.id,
        revisionId: edition.draftRevisionId,
        importRunId: run.runId,
        kind: "PUBLISH",
        expectedVersion: edition.publicationVersion,
        actionId: randomUUID(),
      },
      prisma,
    );
    await prisma.contentCollection.update({
      where: { id: edition.collectionId },
      data: {
        publicationState: "PUBLISHED",
        enabled: true,
        visibleToUsers: true,
      },
    });
    const published = await domain();
    await t.test(
      "herhaalde en gelijktijdige vernieuwing laat publicatie intact; web/native delen dezelfde autorisatie",
      async () => {
        await Promise.all([
          refreshCfmImages(actor, prisma, source, async () => next),
          refreshCfmImages(actor, prisma, source, async () => third),
        ]);
        assert.deepEqual(await domain(), published);
        const binding = await prisma.studyRevisionMedia.findFirstOrThrow({
          where: {
            revision: { edition: { workKey: source.manifest.workKey } },
          },
          include: { media: true },
        });
        const downloaded = await authorizedStudyMedia(member, binding.mediaId);
        assert.equal(downloaded.checksum, binding.media.checksum);
        assert.ok(
          [
            (await validateStudyImage(next, "image/jpeg")).checksum,
            (await validateStudyImage(third, "image/jpeg")).checksum,
          ].includes(downloaded.checksum),
        );
        assert.deepEqual(
          downloaded.bytes,
          await readStudyMedia(binding.media, true),
        );
        await prisma.contentCollection.update({
          where: { id: edition.collectionId },
          data: { visibleToUsers: false },
        });
        try {
          await assert.rejects(
            authorizeStudyMedia(member, binding.mediaId),
            /UNAVAILABLE/,
          );
        } finally {
          await prisma.contentCollection.update({
            where: { id: edition.collectionId },
            data: { visibleToUsers: true },
          });
        }
        const metadata = binding.media.sourceMetadata;
        await assert.rejects(
          prisma.contentMedia.update({
            where: { id: binding.mediaId },
            data: {
              sourceMetadata: {
                ...metadata,
                sourceKey: "https://untrusted.invalid/other",
              },
            },
          }),
          /STUDY_MEDIA_IMMUTABLE/,
        );
        await assert.rejects(
          prisma.contentMedia.update({
            where: { id: binding.mediaId },
            data: { rightsMetadata: { ...CFM_RIGHTS, holder: "different" } },
          }),
          /STUDY_MEDIA_IMMUTABLE/,
        );
        await assert.rejects(
          prisma.contentMedia.update({
            where: { id: binding.mediaId },
            data: {
              sourceMetadata: {
                ...metadata,
                cfmPreviousChecksums: [
                  ...(metadata.cfmPreviousChecksums ?? []),
                  "b".repeat(64),
                ],
              },
            },
          }),
          /STUDY_MEDIA_IMMUTABLE/,
        );
        await assert.rejects(
          prisma.studyRevisionMedia.delete({
            where: {
              revisionId_mediaKey: {
                revisionId: binding.revisionId,
                mediaKey: binding.mediaKey,
              },
            },
          }),
          /STUDY_AUDIT_IMMUTABLE/,
        );
        await assert.rejects(
          prisma.studyRevisionMedia.update({
            where: {
              revisionId_mediaKey: {
                revisionId: binding.revisionId,
                mediaKey: binding.mediaKey,
              },
            },
            data: { mediaKey: "tampered-key" },
          }),
          /STUDY_AUDIT_IMMUTABLE/,
        );
        const badBytes = await sharp({
          create: {
            width: pin.width + 1,
            height: pin.height,
            channels: 3,
            background: "blue",
          },
        })
          .jpeg()
          .toBuffer();
        const badImage = await validateStudyImage(badBytes, "image/jpeg");
        const bad = await prisma.contentMedia.create({
          data: {
            ...badImage,
            volumeId: binding.media.volumeId,
            sourceMetadata: { sourceKey: pin.url, adapter: source.adapter },
            rightsMetadata: { ...CFM_RIGHTS, holder: "different" },
            status: "READY",
          },
        });
        await assert.rejects(
          prisma.studyRevisionMedia.update({
            where: {
              revisionId_mediaKey: {
                revisionId: binding.revisionId,
                mediaKey: binding.mediaKey,
              },
            },
            data: { mediaId: bad.id },
          }),
          /STUDY_AUDIT_IMMUTABLE/,
        );
        assert.equal(
          (await authorizedStudyMedia(member, binding.mediaId)).checksum,
          binding.media.checksum,
        );
        const resized = await sharp(next)
          .resize({ width: pin.width + 1 })
          .jpeg()
          .toBuffer();
        assert.equal(
          (
            await refreshCfmImages(actor, prisma, source, async () => resized)
          )[0].status,
          "updated",
        );
        const resizedBinding = await prisma.studyRevisionMedia.findFirstOrThrow(
          {
            where: {
              revision: { edition: { workKey: source.manifest.workKey } },
            },
            include: { media: true },
          },
        );
        assert.equal(resizedBinding.media.width, pin.width + 1);
        assert.ok(
          (await authorizedStudyMedia(member, resizedBinding.mediaId)).bytes
            .length > 0,
        );

        assert.deepEqual(await domain(), published);
      },
    );
  } finally {
    Object.assign(source, original);
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("niet-CFM: mediakoppelingen, media-identiteit en tekstrevisies blijven onveranderlijk", async () => {
  const { createStudyImport, executeStudyImport } =
    await import("../src/lib/studyContent/imports.ts");
  const user = await account(true),
    actor = { id: user.id, isAdmin: true },
    key = `synthetic-study-media-guard-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  const collection = await prisma.contentCollection.create({
    data: {
      id: key,
      slug: key,
      name: "Synthetische niet-CFM-bron",
      work: key,
      editionKey: "fixture-v1",
      language: "nl",
      icon: "",
    },
  });
  const run = await createStudyImport(actor, collection.id, "sample");
  await executeStudyImport(actor, run.id);
  const binding = await prisma.studyRevisionMedia.findFirstOrThrow({
    where: { revision: { edition: { collectionId: collection.id } } },
    include: { media: true },
  });
  const before = await domain();
  const bytes = await sharp(await readStudyMedia(binding.media, true))
      .negate()
      .png()
      .toBuffer(),
    image = await validateStudyImage(bytes, "image/png");
  const replacement = await prisma.contentMedia.create({
    data: {
      ...image,
      volumeId: binding.media.volumeId,
      sourceMetadata: binding.media.sourceMetadata,
      rightsMetadata: binding.media.rightsMetadata,
      status: "READY",
    },
  });
  await assert.rejects(
    prisma.studyRevisionMedia.update({
      where: {
        revisionId_mediaKey: {
          revisionId: binding.revisionId,
          mediaKey: binding.mediaKey,
        },
      },
      data: { mediaId: replacement.id },
    }),
    /STUDY_AUDIT_IMMUTABLE/,
  );
  await assert.rejects(
    prisma.contentMedia.update({
      where: { id: binding.mediaId },
      data: {
        sourceMetadata: {
          ...binding.media.sourceMetadata,
          cfmPreviousChecksums: [binding.media.checksum],
        },
      },
    }),
    /STUDY_MEDIA_IMMUTABLE/,
  );
  await assert.rejects(
    prisma.studyRevision.update({
      where: { id: binding.revisionId },
      data: { title: "tampered" },
    }),
    /STUDY_REVISION_IMMUTABLE/,
  );
  assert.deepEqual(await domain(), before);
});
