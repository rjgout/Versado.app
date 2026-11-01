import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import type { PrismaClient, ContentMedia } from "@/generated/prisma/client";
import type { CfmMedia } from "./cfmSources";
import { CFM_RIGHTS } from "./cfm2026Adapter";
import {
  studyObjectHash,
  requireStudyAdmin,
  StudyPublishingError,
  type StudyAdmin,
} from "./policy";
import { readStudyMedia, studyStorage, validateStudyImage } from "./storage";
import { StudyMediaError } from "./mediaDiagnostic";

/** Alleen lezen. Geen willekeurige backups/paden: uitsluitend bestaande CFM-snapshots met de exacte bron en pin. */
export async function findOriginalCfmBytes(
  client: PrismaClient,
  asset: CfmMedia,
) {
  const length = 4 * Math.ceil(asset.byteSize / 3);
  const rows = await client.$queryRaw<
    Array<{ id: string; asset: unknown; total: bigint }>
  >`
 SELECT r.id, m.asset, count(*) OVER() AS total FROM "ContentImportRun" r
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.snapshot->'items')='array' THEN r.snapshot->'items' ELSE '[]'::jsonb END) i(item)
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i.item->'media')='array' THEN i.item->'media' ELSE '[]'::jsonb END) m(asset)
 WHERE r."workKey" IN ('cfm-old-testament-2026','cfm-new-testament-2027')
 AND m.asset->>'checksum'=${asset.checksum} AND m.asset->>'sourceKey'=${asset.url}
 AND length(m.asset->>'base64')=${length} ORDER BY r."startedAt", r.id LIMIT 16`;
  for (const row of rows) {
    const a = row.asset as {
      base64?: unknown;
      mimeType?: unknown;
      rights?: unknown;
    } | null;
    if (!a) continue;
    try {
      if (
        typeof a.base64 !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(a.base64) ||
        a.mimeType !== asset.mimeType ||
        studyObjectHash(a.rights) !== studyObjectHash(CFM_RIGHTS)
      )
        continue;
      const bytes = Buffer.from(a.base64, "base64");
      if (bytes.toString("base64") !== a.base64) continue;
      const v = await validateStudyImage(bytes, asset.mimeType, asset.checksum);
      if (
        v.byteSize === asset.byteSize &&
        v.width === asset.width &&
        v.height === asset.height
      )
        return { bytes, runId: row.id };
    } catch {
      /* Een beschadigde snapshot geeft geen toestemming voor andere bytes. */
    }
  }
  if (rows.length && rows[0].total > 16n)
    throw new StudyMediaError({
      stage: "SNAPSHOT",
      reason: "MORE_CANDIDATES_REQUIRE_REVIEW",
      expectedChecksum: asset.checksum,
    });
  return null;
}

/** Expliciet herstel van dezelfde identiteit, onder de bestaande hashlock. Geen metadata-/revisie-/publicatiewrite. */
export async function restoreOriginalCfmFile(
  actor: StudyAdmin,
  client: PrismaClient,
  media: ContentMedia,
  bytes: Buffer,
) {
  requireStudyAdmin(actor);
  const valid = await validateStudyImage(bytes, media.mimeType, media.checksum),
    store = await studyStorage();
  if (
    valid.storageKey !== media.storageKey ||
    valid.byteSize !== media.byteSize ||
    valid.width !== media.width ||
    valid.height !== media.height ||
    store.volumeId !== media.volumeId
  )
    throw new StudyPublishingError("CONFLICT");
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout='5s'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`study-media:${media.checksum}`},0))`;
      const current = await tx.contentMedia.findUnique({
        where: { id: media.id },
      });
      if (
        !current ||
        current.status !== "READY" ||
        current.checksum !== media.checksum ||
        current.storageKey !== media.storageKey ||
        current.volumeId !== store.volumeId ||
        current.byteSize !== media.byteSize ||
        current.width !== media.width ||
        current.height !== media.height ||
        current.mimeType !== media.mimeType ||
        studyObjectHash(current.rightsMetadata) !== studyObjectHash(CFM_RIGHTS)
      )
        throw new StudyPublishingError("CONFLICT");
      try {
        await readStudyMedia(current, true);
        return false;
      } catch (e) {
        if (!(e instanceof StudyPublishingError) || e.code !== "MEDIA") throw e;
      }
      const target = path.join(store.root, valid.storageKey),
        temporary = path.join(store.root, `.original-${randomUUID()}.part`);
      let before;
      try {
        before = await fs.lstat(target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (before && (!before.isFile() || before.isSymbolicLink()))
        throw new StudyMediaError({
          stage: "READ",
          reason: "UNSAFE_TARGET",
          mediaId: media.id,
        });
      const handle = await fs.open(
        temporary,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.chmod(0o440);
        await handle.close();
        if (before) {
          // De beschadigde inode blijft beschikbaar; nooit een goed bestand vervangen.
          const now = await fs.lstat(target);
          if (
            now.ino !== before.ino ||
            now.dev !== before.dev ||
            now.size !== before.size ||
            now.mtimeMs !== before.mtimeMs
          )
            throw new StudyPublishingError("CONFLICT");
          await fs.link(
            target,
            path.join(
              store.root,
              `.damaged-${randomUUID()}-${valid.storageKey}`,
            ),
          );
          await fs.rename(temporary, target);
        } else {
          try {
            await fs.link(temporary, target);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          }
        }
        await readStudyMedia(current, true);
        const directory = await fs.open(
          store.root,
          constants.O_RDONLY | constants.O_DIRECTORY,
        );
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
        return true;
      } finally {
        await handle.close().catch(() => {});
        await fs.unlink(temporary).catch(() => {});
      }
    },
    { maxWait: 5000, timeout: 15000 },
  );
}
