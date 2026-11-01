import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { prisma } from "../src/lib/db";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import {
  CFM_SOURCE_2026,
  type CfmMedia,
  type CfmSource,
} from "../src/lib/studyContent/cfmSources";
import {
  importCfmDrafts,
  loadCfmLesson,
} from "../src/lib/studyContent/cfm2026Import";
import {
  cfmSourceHash,
  cfmSnapshotItem,
  CFM_RIGHTS,
} from "../src/lib/studyContent/cfm2026Adapter";
import {
  CFM_MEDIA_DRAFT_VERSION,
  resolveCfmMedia,
  type CfmMediaCandidate,
} from "../src/lib/studyContent/cfmMedia";
import {
  findOriginalCfmBytes,
  restoreOriginalCfmFile,
} from "../src/lib/studyContent/originalMedia";
import {
  cfmRecoveryPlan,
  validateCfmRecoveryPlan,
} from "../src/lib/studyContent/cfmRecovery";
import {
  registerStudySnapshotImport,
  claimStudyImport,
  persistStudyImportItem,
} from "../src/lib/studyContent/imports";
import { autoPublishCfmVolume } from "../src/lib/studyContent/cfmAutoPublish";
import { studyProgramReview } from "../src/lib/studyContent/programReview";
import { publishStudyProgram } from "../src/lib/studyContent/programPublication";
import {
  readStudyMedia,
  validateStudyImage,
  studyStorage,
} from "../src/lib/studyContent/storage";
import {
  syntheticStudyEnvironment,
  StudyPublishingError,
} from "../src/lib/studyContent/policy";
import {
  StudyMediaError,
  mediaDiagnosticText,
} from "../src/lib/studyContent/mediaDiagnostic";
import { withContentImportLock } from "../src/lib/contentImportLock";
const database = new URL(
  process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid",
);
if (
  !syntheticStudyEnvironment() ||
  database.href !== process.env.DATABASE_URL ||
  !process.env.CONTENT_ACCESS_TEST_BASE_URL?.startsWith("http://127.0.0.1:")
)
  throw Error("Uitsluitend eigen geïsoleerde runner");
after(() => prisma.$disconnect());
const noDownloads = async () => {
  throw Error("Onverwachte download");
};
const isCode = (code: string) => (e: unknown) =>
  e instanceof StudyPublishingError && e.code === code;

async function counts() {
  return {
    runs: await prisma.contentImportRun.findMany({ orderBy: { id: "asc" } }),
    revisions: await prisma.studyRevision.findMany({ orderBy: { id: "asc" } }),
    editions: await prisma.studyLessonEdition.findMany({
      orderBy: { id: "asc" },
    }),
    media: await prisma.contentMedia.findMany({ orderBy: { id: "asc" } }),
    progress: await prisma.studyStepProgress.findMany(),
    reads: await prisma.contentProgress.findMany(),
    users: await prisma.user.findMany({ orderBy: { id: "asc" } }),
  };
}

test("CFM-herstel: echte import, snapshots, append-only, onderbreking, revisie en gescheiden publicatie", async (t) => {
  const admin = await prisma.user.create({
    data: {
      email: `${randomUUID()}@example.invalid`,
      handle: `Herstel${randomUUID().slice(0, 6)}`,
      discriminator: "01",
      passwordHash: "synthetic",
      isAdmin: true,
      emailVerifiedAt: new Date(),
    },
  });
  const actor = { id: admin.id, isAdmin: true },
    member = { ...actor, isAdmin: false };
  const base = process.env.CONTENT_ACCESS_TEST_BASE_URL!;
  const cookie = `${SESSION_COOKIE}=${await createSessionToken(admin.id)}`;
  await t.test(
    "herstelplan is read-only, actor- en snapshotgebonden; HTTP weigert onbevoegde en oude plannen",
    async () => {
      const before = await counts(),
        plan = await cfmRecoveryPlan(actor, prisma);
      assert.equal(plan.assets.length, 7);
      assert.equal(plan.requiresMediaReview, true);
      assert.equal(
        plan.planHash,
        (await cfmRecoveryPlan(actor, prisma)).planHash,
      );
      await assert.rejects(
        cfmRecoveryPlan(member, prisma),
        isCode("FORBIDDEN"),
      );
      await assert.rejects(
        validateCfmRecoveryPlan(actor, prisma, plan.planHash, false),
        isCode("CONFLICT"),
      );
      await assert.rejects(
        validateCfmRecoveryPlan(
          { ...actor, id: randomUUID() },
          prisma,
          plan.planHash,
          true,
        ),
        isCode("CONFLICT"),
      );
      for (const [headers, status] of [
        [{}, 401],
        [{ Cookie: cookie }, 200],
      ] as const) {
        const response = await fetch(`${base}/api/admin/reseed?cfmRecovery=1`, {
          headers,
        });
        assert.equal(response.status, status);
        if (status === 200) {
          assert.equal(
            response.headers.get("cache-control"),
            "no-store, private",
          );
          assert.equal((await response.json()).planHash, plan.planHash);
        }
      }
      const input = {
        action: "cfm-prepare",
        approvedSnapshot: plan.approvedSnapshot,
        planHash: "0".repeat(64),
        confirmDraftsOnly: true,
        confirmReviewedMedia: true,
      };
      for (const [origin, body, status] of [
        ["https://other.invalid", input, 403],
        [base, input, 409],
        [base, { ...input, bypass: true }, 400],
        [
          base,
          { ...input, planHash: plan.planHash, confirmReviewedMedia: false },
          409,
        ],
      ] as const) {
        assert.equal(
          (
            await fetch(`${base}/api/admin/reseed`, {
              method: "POST",
              headers: {
                Cookie: cookie,
                Origin: origin,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            })
          ).status,
          status,
        );
      }
      assert.deepEqual(await counts(), before);
    },
  );

  await t.test(
    "echte herstel-POST doorloopt joblock/herplan en bewaart een concrete MEDIA-fout in het beheerlogboek",
    async () => {
      const parsed = await loadCfmLesson(
        CFM_SOURCE_2026.manifest.lessons[0].sourceKey,
      );
      const pin = parsed.assets[0],
        store = await studyStorage();
      const media = await prisma.contentMedia.create({
        data: {
          checksum: pin.checksum,
          mimeType: pin.mimeType,
          width: pin.width,
          height: pin.height,
          byteSize: pin.byteSize,
          storageKey: `${pin.checksum}.jpg`,
          volumeId: store.volumeId,
          sourceMetadata: { sourceKey: pin.url },
          rightsMetadata: CFM_RIGHTS,
          status: "READY",
        },
      });
      // Bewust ontbrekend bestand op uitsluitend de eigen testvolume: het importpad stopt vóór iedere download.
      const plan = await cfmRecoveryPlan(actor, prisma),
        before = await counts();
      const response = await fetch(`${base}/api/admin/reseed`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: base,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "cfm-prepare",
          approvedSnapshot: plan.approvedSnapshot,
          planHash: plan.planHash,
          confirmDraftsOnly: true,
          confirmReviewedMedia: true,
        }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).started, true);
      let job:
        | { status: string; error: string | null; logs: string[] }
        | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        job = (
          await (
            await fetch(`${base}/api/admin/reseed`, {
              headers: { Cookie: cookie },
            })
          ).json()
        ).job;
        if (job?.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(job?.status, "error");
      assert.match(
        job?.error ?? "",
        /CFM 2026; les .*SNAPSHOT; ORIGINAL_NOT_FOUND/,
      );
      assert.ok(job?.error?.includes(media.checksum));
      const durable = await prisma.contentUpdateRun.findFirstOrThrow({
        where: { createdById: actor.id },
        orderBy: { startedAt: "desc" },
      });
      assert.equal(durable.status, "FAILED");
      assert.equal(durable.error, job?.error);
      assert.ok(durable.error?.includes(media.checksum));
      const after = await counts();
      assert.deepEqual(after.editions, before.editions);
      assert.deepEqual(after.revisions, before.revisions);
      assert.deepEqual(after.progress, before.progress);
      assert.deepEqual(after.reads, before.reads);
      assert.deepEqual(after.users, before.users);
      assert.equal(await prisma.studyPublicationAction.count(), 0);
    },
  );

  // Alleen deze geïsoleerde testprocesregistratie krijgt synthetische bronbestanden. De echte bronfiles en pins
  // blijven onaangeroerd; de aparte HTTP-server gebruikt de echte repositoryregistratie. Geen externe downloads.
  const original = { ...CFM_SOURCE_2026 },
    directory = await fs.mkdtemp(
      path.join(process.cwd(), ".cfm-recovery-fixture-"),
    );
  const root = (await studyStorage()).root;
  const oldBytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#137344" },
  })
    .png()
    .toBuffer();
  const newBytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#a34332" },
  })
    .png()
    .toBuffer();
  const oldMeta = await validateStudyImage(oldBytes, "image/png"),
    newMeta = await validateStudyImage(newBytes, "image/png");
  const asset: CfmMedia = {
    ...oldMeta,
    file: "synthetic.png",
    url: `https://www.churchofjesuschrist.org/imgs/${randomUUID()}/full/320/0/default`,
  };
  const candidate: CfmMediaCandidate = {
    ...asset,
    ...newMeta,
    originalChecksum: asset.checksum,
    originalBytes: asset.byteSize,
  };
  const lessons = original.manifest.lessons.slice(0, 3);
  try {
    await fs.mkdir(path.join(directory, "source"));
    const lessonPins: Record<string, string> = {};
    for (const lesson of lessons) {
      const source: CfmSource = {
        uri: `/manual/${original.manualSlug}/${lesson.sourceKey}`,
        restricted: false,
        title: `Synthetische les ${lesson.sourceKey}`,
        attributes: {
          lang: "nld",
          "data-uri": `/manual/${original.manualSlug}/${lesson.sourceKey}`,
        },
        body: `<p id="p1">Alleen synthetische testinhoud.</p><img id="test-image" src="${asset.url}" alt="Gecontroleerd testbeeld" />`,
      };
      const raw = JSON.stringify(source);
      lessonPins[lesson.sourceKey] = cfmSourceHash(raw);
      await fs.writeFile(
        path.join(directory, "source", `${lesson.sourceKey}.json`),
        raw,
      );
    }
    Object.assign(CFM_SOURCE_2026, {
      dataDir: path.relative(process.cwd(), directory),
      manifest: { ...original.manifest, lessons: lessons.slice(0, 1) },
      mediaLock: [asset],
      sourceLock: { ...original.sourceLock, lessons: lessonPins },
      referenceReview: null,
    });
    const volume = CFM_SOURCE_2026;
    let first: Awaited<ReturnType<typeof importCfmDrafts>>;
    await t.test(
      "eerste import maakt uitsluitend concepten; identieke retry doet geen download en verandert niets",
      async () => {
        first = await importCfmDrafts(actor, volume, {
          mode: "append-only",
          mediaBytes: async () => oldBytes,
        });
        assert.equal(first.importedLessons, 1);
        assert.equal(first.skippedLessons, 0);
        assert.equal(await prisma.studyPublicationAction.count(), 0);
        const before = await counts();
        const second = await importCfmDrafts(actor, volume, {
          mode: "append-only",
          mediaBytes: noDownloads,
        });
        assert.equal(second.skippedLessons, 1);
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      "origineel uit snapshot heeft voorrang; ontbrekend en beschadigd bestand worden expliciet en idempotent hersteld",
      async () => {
        const media = await prisma.contentMedia.findUniqueOrThrow({
            where: { checksum: asset.checksum },
          }),
          file = path.join(root, media.storageKey);
        const before = await counts();
        assert.ok(
          (await findOriginalCfmBytes(prisma, asset))?.bytes.equals(oldBytes),
        );
        await fs.unlink(file);
        const blocked = await autoPublishCfmVolume(actor, CFM_SOURCE_2026);
        assert.equal(blocked.publishedNow, 0);
        assert.match(
          blocked.blocked[0].diagnostic ?? "",
          /CFM 2026; les .*READ; ENOENT/,
        );
        assert.ok(blocked.blocked[0].diagnostic?.includes(asset.checksum));
        await assert.rejects(
          resolveCfmMedia(actor, prisma, asset, { mediaBytes: noDownloads }),
          (e) =>
            e instanceof StudyMediaError &&
            e.diagnostic.reason === "EXPLICIT_REPAIR_REQUIRED",
        );
        const restored = await resolveCfmMedia(actor, prisma, asset, {
          recovery: true,
          reviewedMedia: true,
          testCandidates: [candidate],
          mediaBytes: noDownloads,
        });
        assert.ok(restored.bytes.equals(oldBytes));
        assert.equal(restored.asset.checksum, asset.checksum);
        await fs.chmod(file, 0o600);
        await fs.writeFile(file, Buffer.alloc(oldBytes.length, 1));
        await fs.chmod(file, 0o440);
        await restoreOriginalCfmFile(actor, prisma, media, oldBytes);
        const damaged = (await fs.readdir(root)).filter((f) =>
          f.startsWith(".damaged-"),
        );
        assert.equal(damaged.length, 1);
        assert.ok(
          (await fs.readFile(path.join(root, damaged[0]))).equals(
            Buffer.alloc(oldBytes.length, 1),
          ),
        );
        assert.ok((await readStudyMedia(media, true)).equals(oldBytes));
        assert.equal(
          await restoreOriginalCfmFile(actor, prisma, media, oldBytes),
          false,
        );
        await assert.rejects(
          restoreOriginalCfmFile(member, prisma, media, oldBytes),
          isCode("FORBIDDEN"),
        );
        await assert.rejects(
          restoreOriginalCfmFile(actor, prisma, media, newBytes),
          isCode("MEDIA"),
        );
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      "twee processen kunnen dezelfde originele herstelactie veilig hervatten; symlinks blijven geweigerd",
      async () => {
        const media = await prisma.contentMedia.findUniqueOrThrow({
            where: { checksum: asset.checksum },
          }),
          file = path.join(root, media.storageKey);
        await fs.unlink(file);
        const worker = path.join(directory, "restore.ts");
        await fs.writeFile(
          worker,
          `import {prisma} from '../src/lib/db'; import {findOriginalCfmBytes,restoreOriginalCfmFile} from '../src/lib/studyContent/originalMedia'; const asset=${JSON.stringify(asset)}; const media=await prisma.contentMedia.findUniqueOrThrow({where:{checksum:asset.checksum}}); const original=await findOriginalCfmBytes(prisma,asset); if(!original)throw Error('Geen origineel'); await restoreOriginalCfmFile(${JSON.stringify(actor)},prisma,media,original.bytes); await prisma.$disconnect();`,
        );
        const run = () =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(process.execPath, ["--import", "tsx", worker], {
              cwd: process.cwd(),
              env: process.env,
              stdio: "inherit",
            });
            child.on("error", reject);
            child.on("exit", (code) =>
              code === 0 ? resolve() : reject(Error(`Herstelproces ${code}`)),
            );
          });
        await Promise.all([run(), run()]);
        assert.ok((await readStudyMedia(media, true)).equals(oldBytes));
        const backup = path.join(root, `backup-${randomUUID()}`);
        await fs.rename(file, backup);
        await fs.symlink(backup, file);
        try {
          await assert.rejects(
            restoreOriginalCfmFile(actor, prisma, media, oldBytes),
            isCode("MEDIA"),
          );
          assert.ok((await fs.lstat(file)).isSymbolicLink());
        } finally {
          await fs.unlink(file);
          await fs.rename(backup, file);
        }
      },
    );
    await t.test(
      "alleen nieuwe lessen erbij; bestaande publicatie en voortgang blijven bytegelijk",
      async () => {
        const edition = await prisma.studyLessonEdition.findUniqueOrThrow({
          where: { id: first!.lessons[0].editionId },
        });
        const revision = await prisma.studyRevision.findUniqueOrThrow({
          where: { id: edition.draftRevisionId! },
        });
        await prisma.studyLessonEdition.update({
          where: { id: edition.id },
          data: {
            publishedRevisionId: revision.id,
            draftRevisionId: null,
            publicationVersion: 1,
          },
        });
        await prisma.studyStepProgress.create({
          data: {
            userId: admin.id,
            lessonEditionId: edition.id,
            stepFingerprint: "a".repeat(32),
            stepIndex: 1,
            planVersion: 2,
            revisionId: revision.id,
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });
        const before = await counts();
        volume.manifest = { ...volume.manifest, lessons: lessons.slice(0, 2) };
        const result = await importCfmDrafts(actor, volume, {
          mode: "append-only",
          mediaBytes: noDownloads,
        });
        assert.equal(result.skippedLessons, 1);
        assert.equal(result.importedLessons, 2);
        const after = await counts();
        assert.equal(after.revisions.length, before.revisions.length + 1);
        assert.deepEqual(after.progress, before.progress);
        assert.deepEqual(after.users, before.users);
        assert.deepEqual(after.reads, before.reads);
        assert.deepEqual(
          after.editions.find((e) => e.id === edition.id),
          before.editions.find((e) => e.id === edition.id),
        );
      },
    );
    await t.test(
      "onderbroken import hervat dezelfde run zonder nieuwe revisies; actieve importlock weigert een tweede proces",
      async () => {
        volume.manifest = { ...volume.manifest, lessons };
        const parsed = await loadCfmLesson(lessons[2].sourceKey, volume),
          item = cfmSnapshotItem(parsed, () => oldBytes);
        item.startsOn = lessons[2].startsOn;
        item.endsOn = lessons[2].endsOn;
        const run = await registerStudySnapshotImport(
          actor,
          volume.volume.collectionId,
          {
            workKey: volume.manifest.workKey,
            editionKey: volume.manifest.editionKey,
            language: "nl",
            adapterName: volume.adapter,
            adapterVersion: "2",
            synthetic: false,
            sourceVersion: volume.sourceLock.lessons[lessons[2].sourceKey],
            period: {
              sourceKey: lessons[2].periodSourceKey,
              label: "test",
              year: 2026,
            },
            items: [item],
          },
        );
        const lease = await claimStudyImport(actor, run.id);
        assert.ok(lease);
        await persistStudyImportItem(actor, lease, 0);
        await prisma.contentImportRun.update({
          where: { id: run.id },
          data: { status: "FAILED", leaseHolder: null, leaseExpiresAt: null },
        });
        const count = await prisma.studyRevision.count();
        const result = await importCfmDrafts(actor, volume, {
          mode: "append-only",
          mediaBytes: noDownloads,
        });
        assert.equal(result.skippedLessons, 3);
        assert.equal(await prisma.studyRevision.count(), count);
        assert.equal(
          (
            await prisma.contentImportRun.findUniqueOrThrow({
              where: { id: run.id },
            })
          ).status,
          "DRAFT_READY",
        );
        await withContentImportLock(async () => {
          await assert.rejects(
            withContentImportLock(async () => {
              throw Error("Mag niet uitvoeren");
            }),
            /Er loopt al een contentimport/,
          );
        });
      },
    );
    await t.test(
      "ontbrekend origineel: uitsluitend expliciet beoordeelde pin, nooit stille hashvervanging of automatische publicatie",
      async () => {
        // Nieuwe geïsoleerde bronidentiteit: geen oude bytes/snapshot. Een afwijkende download wordt nog steeds geweigerd.
        const missingBytes = await sharp({
          create: { width: 8, height: 8, channels: 3, background: "#337398" },
        })
          .png()
          .toBuffer();
        const missingMeta = await validateStudyImage(missingBytes, "image/png");
        const alternate = {
          ...asset,
          ...missingMeta,
          url: asset.url.replace("/imgs/", "/imgs/revision-"),
        };
        const change = {
          ...candidate,
          url: alternate.url,
          originalChecksum: alternate.checksum,
          originalBytes: alternate.byteSize,
        };
        assert.equal(await findOriginalCfmBytes(prisma, alternate), null);
        const before = await counts();
        await assert.rejects(
          resolveCfmMedia(actor, prisma, alternate, {
            mediaBytes: async () => newBytes,
          }),
          isCode("MEDIA"),
        );
        await assert.rejects(
          resolveCfmMedia(actor, prisma, alternate, {
            recovery: true,
            reviewedMedia: false,
            testCandidates: [change],
            mediaBytes: async () => newBytes,
          }),
          isCode("MEDIA"),
        );
        const resolved = await resolveCfmMedia(actor, prisma, alternate, {
          recovery: true,
          reviewedMedia: true,
          testCandidates: [change],
          mediaBytes: async () => newBytes,
        });
        assert.equal(resolved.asset.checksum, candidate.checksum);
        assert.deepEqual(await counts(), before);
        // Eén bestaande conceptles krijgt een beoordeelde mediarevisie; de publicatie blijft een afzonderlijke actie.
        volume.mediaLock = [alternate];
        for (const lesson of lessons) {
          const file = path.join(
              directory,
              "source",
              `${lesson.sourceKey}.json`,
            ),
            raw = (await fs.readFile(file, "utf8")).replace(
              asset.url,
              alternate.url,
            );
          await fs.writeFile(file, raw);
          volume.sourceLock = {
            ...volume.sourceLock,
            lessons: {
              ...volume.sourceLock.lessons,
              [lesson.sourceKey]: cfmSourceHash(raw),
            },
          };
        }
        const selected = lessons[1].sourceKey;
        const revisionsBeforeFailure = await prisma.studyRevision.count();
        const editionsBeforeFailure = await prisma.studyLessonEdition.findMany({
          orderBy: { id: "asc" },
        });
        await prisma.$executeRawUnsafe(
          `CREATE FUNCTION cfm_recovery_fail_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CFM_TEST_ROLLBACK'; END $$`,
        );
        await prisma.$executeRawUnsafe(
          `CREATE TRIGGER cfm_recovery_fail_revision BEFORE INSERT ON "StudyRevision" FOR EACH ROW EXECUTE FUNCTION cfm_recovery_fail_revision()`,
        );
        try {
          await assert.rejects(
            importCfmDrafts(actor, volume, {
              mode: "append-only",
              recovery: true,
              reviewedMedia: true,
              revisionKeys: [selected],
              testCandidates: [change],
              mediaBytes: async () => newBytes,
            }),
            /CFM_TEST_ROLLBACK/,
          );
        } finally {
          await prisma.$executeRawUnsafe(
            `DROP TRIGGER cfm_recovery_fail_revision ON "StudyRevision"`,
          );
          await prisma.$executeRawUnsafe(
            `DROP FUNCTION cfm_recovery_fail_revision()`,
          );
        }
        assert.equal(
          await prisma.studyRevision.count(),
          revisionsBeforeFailure,
        );
        assert.deepEqual(
          await prisma.studyLessonEdition.findMany({ orderBy: { id: "asc" } }),
          editionsBeforeFailure,
        );
        assert.equal(
          await prisma.contentImportRun.count({
            where: {
              status: "FAILED",
              adapterVersion: CFM_MEDIA_DRAFT_VERSION,
            },
          }),
          1,
        );
        const result = await importCfmDrafts(actor, volume, {
          mode: "append-only",
          recovery: true,
          reviewedMedia: true,
          revisionKeys: [selected],
          testCandidates: [change],
          mediaBytes: async (a) =>
            a.checksum === candidate.checksum ? newBytes : oldBytes,
        });
        const updated = result.lessons.find((l) => l.lessonKey === selected)!;
        assert.equal(
          (
            await prisma.contentImportRun.findUniqueOrThrow({
              where: { id: updated.runId! },
            })
          ).adapterVersion,
          CFM_MEDIA_DRAFT_VERSION,
        );
        assert.equal(
          (
            await prisma.studyLessonEdition.findUniqueOrThrow({
              where: { id: updated.editionId },
            })
          ).publishedRevisionId,
          null,
        );
        // De synthetische bron is alleen voor dit proces gepind; alle echte publicatievalidaties blijven actief.
        const automatic = await autoPublishCfmVolume(actor, volume);
        assert.equal(automatic.publishedNow, 0);
        assert.ok(
          automatic.blocked.some(
            (l) =>
              l.sourceKey === selected &&
              l.codes.includes("EXPLICIT_REVISION_REQUIRED"),
          ),
        );
        const review = await studyProgramReview(
          actor,
          volume.volume.collectionId,
        );
        // Alleen de geselecteerde les heeft deze nieuwe bron; de overige bronveranderingen worden niet blind meegenomen.
        assert.ok(
          review.lessons.find((l) => l.sourceKey === selected)?.status ===
            "ready",
        );
        const after = await counts();
        assert.deepEqual(after.progress, before.progress);
        assert.deepEqual(after.users, before.users);
        assert.deepEqual(after.reads, before.reads);
        // Retry gebruikt de geldige nieuwe mediavolume, geen tweede download/registratie.
        const again = await importCfmDrafts(actor, volume, {
          mode: "append-only",
          recovery: true,
          reviewedMedia: true,
          revisionKeys: [selected],
          testCandidates: [change],
          mediaBytes: noDownloads,
        });
        assert.equal(
          again.lessons.find((l) => l.lessonKey === selected)!.revisionId,
          updated.revisionId,
        );
        assert.deepEqual(await counts(), after);
      },
    );
    // Pas alle drie bronmanifesten terug aan op hun daadwerkelijk opgeslagen afbeelding. Daarmee kan de normale
    // bestaande handmatige programma-publicatie de complete gecontroleerde set opnieuw zelfstandig valideren.
    await t.test(
      "handmatige publicatie heeft eigen voorcontrole en bevestiging; gepubliceerde media en historie worden niet vervangen",
      async () => {
        // Een vervangende bron hoort uitsluitend bij de tweede les; geef de andere lessen weer hun oorspronkelijke bron.
        for (const lesson of [lessons[0], lessons[2]]) {
          const file = path.join(
              directory,
              "source",
              `${lesson.sourceKey}.json`,
            ),
            raw = (await fs.readFile(file, "utf8")).replace(
              asset.url.replace("/imgs/", "/imgs/revision-"),
              asset.url,
            );
          await fs.writeFile(file, raw);
          volume.sourceLock = {
            ...volume.sourceLock,
            lessons: {
              ...volume.sourceLock.lessons,
              [lesson.sourceKey]: cfmSourceHash(raw),
            },
          };
        }
        volume.mediaLock = [
          asset,
          { ...asset, url: asset.url.replace("/imgs/", "/imgs/revision-") },
        ];
        const review = await studyProgramReview(
          actor,
          volume.volume.collectionId,
        );
        assert.equal(
          review.blocked,
          0,
          JSON.stringify(
            review.lessons.map((l) => ({ key: l.sourceKey, issues: l.issues })),
          ),
        );
        const before = await counts(),
          result = await publishStudyProgram(
            actor,
            {
              collectionId: volume.volume.collectionId,
              reviewToken: review.reviewToken,
              batchId: randomUUID(),
              confirmReviewed: true,
            },
            prisma,
            { budgetMs: 30_000 },
          );
        assert.equal(result.done, true);
        assert.equal(result.failed.length, 0);
        const after = await counts();
        assert.deepEqual(after.progress, before.progress);
        assert.deepEqual(after.users, before.users);
        assert.deepEqual(after.media, before.media);
        assert.deepEqual(after.revisions, before.revisions);
        assert.equal(
          (
            await prisma.contentCollection.findUniqueOrThrow({
              where: { id: volume.volume.collectionId },
            })
          ).visibleToUsers,
          false,
        );
      },
    );
  } finally {
    Object.assign(CFM_SOURCE_2026, original);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("MEDIA-diagnostiek blijft concreet, begrensd en zonder verzoekgeheimen", async () => {
  const bytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#3a4993" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    validateStudyImage(bytes, "image/png", "0".repeat(64)),
    (e) => {
      assert.ok(e instanceof StudyMediaError);
      const message = mediaDiagnosticText(
        new StudyMediaError({
          ...e.diagnostic,
          year: 2026,
          lessonKey: "07",
          status: 200,
          host: "www.churchofjesuschrist.org",
          pathname: "/imgs/known/full/320/0/default",
        }),
      )!;
      assert.match(message, /CFM 2026; les 07; CHECKSUM/);
      assert.match(message, /verwacht=0{64}/);
      assert.match(message, /ontvangen=[a-f0-9]{64}/);
      assert.match(message, /HTTP=200/);
      return true;
    },
  );
  await assert.rejects(
    validateStudyImage(Buffer.from("<html>error</html>"), "image/jpeg"),
    (e) => e instanceof StudyMediaError && e.diagnostic.stage === "MIME",
  );
});
