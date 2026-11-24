import { notifyContentAvailabilityChanged } from "@/lib/realtime";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  CFM_SOURCES,
  cfmMediaSourceRegistered,
  type CfmMedia,
  type CfmVolumeSource,
} from "./cfmSources";
import candidates from "../../../data/study-content/cfm-2026-nl/media-revision-candidates.json";
import { restoreOriginalCfmFile } from "./originalMedia";
import {
  installStudyMedia,
  readStudyMedia,
  validateStudyImage,
} from "./storage";
import { downloadStudyImage, type StudyDownloadOptions } from "./download";
import {
  StudyPublishingError,
  syntheticStudyEnvironment,
  requireStudyAdmin,
  studyObjectHash,
  type StudyAdmin,
} from "./policy";
import { StudyMediaError } from "./mediaDiagnostic";
export const CFM_MEDIA_DRAFT_VERSION = "2-media-review-v1";
export const CFM_MEDIA_CANDIDATES = candidates.assets;
export type CfmMediaCandidate = CfmMedia & {
  originalChecksum: string;
  originalBytes: number;
};
async function resolveCfmMediaInner(
  actor: StudyAdmin,
  client: PrismaClient,
  asset: CfmMedia,
  options: {
    mediaBytes?: (asset: CfmMedia) => Promise<Buffer>;
    recovery?: boolean;
    reviewedMedia?: boolean;
    /** Uitsluitend synthetische testinjectie, nooit een API-veld. */
    testCandidates?: readonly CfmMediaCandidate[];
  },
) {
  requireStudyAdmin(actor);
  {
    const source = CFM_SOURCES.find((s) =>
      s.mediaLock.some((a) => a.url === asset.url),
    );
    if (!source) throw new StudyPublishingError("INVALID");
    const stored = await client.contentMedia.findFirst({
      where: {
        status: "READY",
        sourceMetadata: { path: ["sourceKey"], equals: asset.url },
        revisionMedia: {
          some: { revision: { edition: { workKey: source.manifest.workKey } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (
      stored &&
      cfmMediaSourceRegistered(source.manifest.workKey, stored.sourceMetadata)
    ) {
      try {
        const bytes = await readStudyMedia(stored, true);
        if (stored.width < 16 || stored.height < 16)
          throw new StudyPublishingError("MEDIA");
        return {
          asset: {
            ...asset,
            checksum: stored.checksum,
            byteSize: stored.byteSize,
            mimeType: stored.mimeType,
          },
          bytes,
          origin: "volume",
        };
      } catch (error) {
        if (!(error instanceof StudyPublishingError) || error.code !== "MEDIA")
          throw error;
      }
    }
    const current = await currentCfmImage(asset, options.mediaBytes);
    return {
      asset: { ...asset, ...current.image, file: asset.file },
      bytes: current.bytes,
      origin: "actuele officiële bron",
    };
  }
}

/** Diagnostiek blijft gebonden aan de geregistreerde bron, zonder querystrings of verzoekgeheimen. */
export async function resolveCfmMedia(
  ...args: Parameters<typeof resolveCfmMediaInner>
) {
  try {
    return await resolveCfmMediaInner(...args);
  } catch (error) {
    if (error instanceof StudyPublishingError && error.code === "MEDIA") {
      const url = new URL(args[2].url);
      throw new StudyMediaError({
        ...(error instanceof StudyMediaError
          ? error.diagnostic
          : { stage: "MANIFEST" as const }),
        host: url.hostname,
        pathname: url.pathname.slice(0, 512),
      });
    }
    throw error;
  }
}

/** Downloader bewaart eerst in quarantaine; volledige decode en bytegrenzen
 * blijven verplicht. Redelijke rastergrenzen staan los van de onveranderlijke leslayout. */
export async function currentCfmImage(
  asset: CfmMedia,
  mediaBytes?: (asset: CfmMedia) => Promise<Buffer>,
) {
  if (!CFM_SOURCES.some((s) => s.mediaLock.some((a) => a.url === asset.url)))
    throw new StudyPublishingError("INVALID");
  const testTransport = (
    globalThis as typeof globalThis & {
      __versadoCfmImageTestTransport?: Pick<
        StudyDownloadOptions,
        "resolve" | "transport"
      >;
    }
  ).__versadoCfmImageTestTransport;
  if (testTransport && !syntheticStudyEnvironment())
    throw new StudyPublishingError("INVALID");
  const result = mediaBytes
    ? await (async () => {
        const bytes = await mediaBytes(asset);
        return {
          bytes,
          image: await validateStudyImage(bytes, asset.mimeType),
        };
      })()
    : await downloadStudyImage(
        asset.url,
        { ...testTransport, allowedHosts: ["www.churchofjesuschrist.org"] },
        undefined,
      );
  if (result.image.width < 16 || result.image.height < 16)
    throw new StudyMediaError({ stage: "MANIFEST", reason: "DIMENSIONS" });
  return result;
}

/** Alleen tijdens bewust content bijwerken. Bestaande hashopslag blijft intact:
 * installeer het geldige nieuwe bestand, vervang daarna atomair de CFM-bindingen.
 * Bij fouten blijven de oude bestanden en bindingen behouden; geen lesrevisie,
 * publicatie, voortgang of import van lesinhoud. */
export async function refreshCfmImages(
  actor: StudyAdmin,
  client: PrismaClient,
  source: CfmVolumeSource,
  mediaBytes?: (asset: CfmMedia) => Promise<Buffer>,
) {
  requireStudyAdmin(actor);
  if (!CFM_SOURCES.includes(source)) throw new StudyPublishingError("INVALID");
  const records = await client.contentMedia.findMany({
    where: {
      revisionMedia: {
        some: { revision: { edition: { workKey: source.manifest.workKey } } },
      },
    },
  });
  const urls = new Set(
    records.map((m) => (m.sourceMetadata as { sourceKey?: string })?.sourceKey),
  );
  const report = [];
  for (const asset of source.mediaLock.filter(
    (a, i, all) =>
      urls.has(a.url) && all.findIndex((b) => b.url === a.url) === i,
  )) {
    let phase = "DOWNLOAD";
    try {
      const { bytes, image } = await currentCfmImage(asset, mediaBytes);
      phase = "INSTALL";
      const same = await client.contentMedia.findUnique({
        where: { checksum: image.checksum },
      });
      if (
        same?.status === "READY" &&
        cfmMediaSourceRegistered(
          source.manifest.workKey,
          same.sourceMetadata,
        ) &&
        (same.sourceMetadata as { sourceKey?: string }).sourceKey === asset.url
      )
        await restoreOriginalCfmFile(actor, client, same, bytes);
      const store = await installStudyMedia(bytes, image);
      phase = "COMMIT";
      const changed = await client.$transaction(async (tx) => {
        const currentActor = await tx.user.findUnique({
          where: { id: actor.id },
          select: { isAdmin: true },
        });
        if (!currentActor?.isAdmin) throw new StudyPublishingError("FORBIDDEN");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cfm-image:${source.manifest.workKey}:${asset.url}`},0))`;
        const previous = await tx.contentMedia.findMany({
          where: {
            sourceMetadata: { path: ["sourceKey"], equals: asset.url },
            revisionMedia: {
              some: {
                revision: { edition: { workKey: source.manifest.workKey } },
              },
            },
          },
        });
        const matching = previous.filter((m) => {
          const meta = m.sourceMetadata as {
            sourceKey?: string;
            adapter?: string;
          };
          return (
            meta.sourceKey === asset.url &&
            cfmMediaSourceRegistered(source.manifest.workKey, m.sourceMetadata)
          );
        });
        if (!matching.length) return 0;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`study-media:${image.checksum}`},0))`;
        let history = [
          ...new Set(
            matching.flatMap((m) => {
              const meta = m.sourceMetadata as {
                cfmPreviousChecksums?: unknown;
              };
              return [
                m.checksum,
                ...(Array.isArray(meta.cfmPreviousChecksums)
                  ? meta.cfmPreviousChecksums.filter(
                      (s): s is string =>
                        typeof s === "string" && /^[a-f0-9]{64}$/.test(s),
                    )
                  : []),
              ];
            }),
          ),
        ].sort();
        if (history.length > 4096) throw new StudyPublishingError("MEDIA");
        const metadata = {
          sourceKey: asset.url,
          adapter: source.adapter,
          cfmPreviousChecksums: history,
        };
        const rights = matching[0].rightsMetadata;
        if (
          matching.some(
            (m) =>
              studyObjectHash(m.rightsMetadata) !== studyObjectHash(rights),
          )
        )
          throw new StudyPublishingError("MEDIA");
        let replacement = await tx.contentMedia.findUnique({
          where: { checksum: image.checksum },
        });
        if (replacement) {
          const meta = replacement.sourceMetadata as {
            sourceKey?: string;
            adapter?: string;
          };
          const adapter = CFM_SOURCES.find((s) => s.adapter === meta.adapter);
          if (!adapter) throw new StudyPublishingError("MEDIA");
          metadata.adapter = adapter.adapter;
          const previousHashes = (
            replacement.sourceMetadata as { cfmPreviousChecksums?: unknown }
          ).cfmPreviousChecksums;
          if (Array.isArray(previousHashes))
            history = [
              ...new Set([
                ...history,
                ...previousHashes.filter(
                  (h): h is string =>
                    typeof h === "string" && /^[a-f0-9]{64}$/.test(h),
                ),
              ]),
            ].sort();
          if (history.length > 4096) throw new StudyPublishingError("MEDIA");
          metadata.cfmPreviousChecksums = history;
          if (
            replacement.volumeId !== store.volumeId ||
            replacement.storageKey !== image.storageKey ||
            meta.sourceKey !== asset.url ||
            !cfmMediaSourceRegistered(
              source.manifest.workKey,
              replacement.sourceMetadata,
            ) ||
            studyObjectHash(replacement.rightsMetadata) !==
              studyObjectHash(rights)
          )
            throw new StudyPublishingError("MEDIA");
        } else
          replacement = await tx.contentMedia.create({
            data: {
              ...image,
              volumeId: store.volumeId,
              sourceMetadata: metadata,
              rightsMetadata: rights!,
              status: "READY",
            },
          });
        await tx.contentMedia.update({
          where: { id: replacement.id },
          data: { sourceMetadata: metadata },
        });
        if (replacement.status !== "READY")
          throw new StudyPublishingError("MEDIA");
        const result = await tx.studyRevisionMedia.updateMany({
          where: {
            mediaId: {
              in: matching
                .filter((m) => m.id !== replacement.id)
                .map((m) => m.id),
            },
            revision: { edition: { workKey: source.manifest.workKey } },
          },
          data: { mediaId: replacement.id },
        });
        return result.count;
      });
      report.push({
        url: asset.url,
        status: "updated" as const,
        checksum: image.checksum,
        bindings: changed,
      });
    } catch (error) {
      if (error instanceof StudyPublishingError && error.code === "FORBIDDEN")
        throw error;
      report.push({
        url: asset.url,
        status: "retained" as const,
        category: error instanceof StudyPublishingError ? error.code : phase,
      });
    }
  }
  if (report.some((row) => row.status === "updated" && row.bindings > 0))
    notifyContentAvailabilityChanged();
  return report;
}
