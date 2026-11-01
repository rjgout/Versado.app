import type { PrismaClient } from "@/generated/prisma/client";
import type { CfmMedia } from "./cfmSources";
import candidates from "../../../data/study-content/cfm-2026-nl/media-revision-candidates.json";
import { findOriginalCfmBytes, restoreOriginalCfmFile } from "./originalMedia";
import { readStudyMedia, validateStudyImage } from "./storage";
import { downloadStudyImage } from "./download";
import {
  StudyPublishingError,
  syntheticStudyEnvironment,
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
  if (options.testCandidates && !syntheticStudyEnvironment())
    throw new StudyPublishingError("INVALID");
  const stored = await client.contentMedia.findUnique({
    where: { checksum: asset.checksum },
  });
  const check = async (bytes: Buffer, a: CfmMedia) => {
    const v = await validateStudyImage(bytes, a.mimeType, a.checksum);
    if (
      v.width !== a.width ||
      v.height !== a.height ||
      v.byteSize !== a.byteSize
    )
      throw new StudyMediaError({
        stage: "MANIFEST",
        expectedChecksum: a.checksum,
        expectedBytes: a.byteSize,
        actualBytes: v.byteSize,
      });
    return bytes;
  };
  if (stored?.status === "READY") {
    try {
      return {
        asset,
        bytes: await check(await readStudyMedia(stored, true), asset),
        origin: "volume",
      };
    } catch (e) {
      if (!(e instanceof StudyPublishingError) || e.code !== "MEDIA") throw e;
    }
  }
  const original = await findOriginalCfmBytes(client, asset);
  if (original) {
    if (stored?.status === "READY") {
      if (!options.recovery)
        throw new StudyMediaError({
          stage: "READ",
          reason: "EXPLICIT_REPAIR_REQUIRED",
          expectedChecksum: asset.checksum,
          mediaId: stored.id,
        });
      await restoreOriginalCfmFile(actor, client, stored, original.bytes);
    }
    return {
      asset,
      bytes: await check(original.bytes, asset),
      origin: `snapshot ${original.runId}`,
    };
  }
  const candidate = (options.testCandidates ?? CFM_MEDIA_CANDIDATES).find(
    (c) =>
      c.url === asset.url &&
      c.originalChecksum === asset.checksum &&
      c.originalBytes === asset.byteSize,
  );
  // Een beheerder moet de vervangende bytes vooraf expliciet beoordelen; deze keuze blijft een concept.
  if (options.recovery && options.reviewedMedia && candidate) {
    const ready = await client.contentMedia.findUnique({
      where: { checksum: candidate.checksum },
    });
    if (ready?.status === "READY")
      return {
        asset: {
          ...asset,
          checksum: candidate.checksum,
          byteSize: candidate.byteSize,
        },
        bytes: await check(await readStudyMedia(ready, true), candidate),
        origin: "beoordeelde mediarevisie op volume",
      };
    const bytes = options.mediaBytes
      ? await options.mediaBytes(candidate)
      : (
          await downloadStudyImage(
            candidate.url,
            { allowedHosts: ["www.churchofjesuschrist.org"] },
            candidate.checksum,
          )
        ).bytes;
    return {
      asset: {
        ...asset,
        checksum: candidate.checksum,
        byteSize: candidate.byteSize,
      },
      bytes: await check(bytes, candidate),
      origin: "beoordeelde mediarevisie",
    };
  }
  if (stored?.status === "READY")
    throw new StudyMediaError({
      stage: "SNAPSHOT",
      reason: "ORIGINAL_NOT_FOUND",
      expectedChecksum: asset.checksum,
      mediaId: stored.id,
    });
  const bytes = options.mediaBytes
    ? await options.mediaBytes(asset)
    : (
        await downloadStudyImage(
          asset.url,
          { allowedHosts: ["www.churchofjesuschrist.org"] },
          asset.checksum,
        )
      ).bytes;
  return { asset, bytes: await check(bytes, asset), origin: "officiële bron" };
}

/** Diagnostiek blijft gebonden aan de gepinde bron, zonder querystrings of verzoekgeheimen. */
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
