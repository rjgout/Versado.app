import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { readStudyMedia, validateStudyMediaMetadata } from "./storage";
import { validateStoredStudyRevision } from "./publication";
import { studyObjectHash } from "./policy";
import { studyDocumentInventory } from "./fixtureAdapter";
import { type StudyAdmin, StudyPublishingError } from "./policy";

export async function authorizedStudyMedia(
  actor: StudyAdmin,
  mediaId: string,
  preview = false,
) {
  if (preview && !actor.isAdmin) throw new StudyPublishingError("FORBIDDEN");
  const edition = {
    collection: readingAccessWhere(actor),
    lesson: { retiredAt: null, work: { kind: "STUDY_PROGRAM" as const } },
  };
  // Gewone media-toegang volgt uitsluitend de actuele publicatiepointer.
  // Historisch gepubliceerde revisies blijven bewaard voor beheer en rollback,
  // maar hun media worden niet opnieuw openbaar via de auditgeschiedenis.
  const accessible: Prisma.StudyRevisionWhereInput = {
    publishedBy: { some: edition },
  };
  const media = await prisma.contentMedia.findFirst({
    where: {
      id: mediaId,
      status: "READY",
      ...(preview ? {} : { revisionMedia: { some: { revision: accessible } } }),
    },
  });
  if (!media) throw new StudyPublishingError("UNAVAILABLE");
  if (!preview) {
    // Een losse FK/pointer bewijst geen valide gepubliceerd lichaam. Een extra
    // of corrupte binding mag geen conceptbytes onder een openbare revisie lekken.
    const candidates = await prisma.studyRevisionMedia.findMany({
      where: { mediaId: media.id, revision: accessible },
      orderBy: { revisionId: "asc" },
      take: 5,
      include: { revision: true },
    });
    const valid = candidates.some((binding) => {
      try {
        const content = validateStoredStudyRevision(binding.revision),
          pin = content.sourceMetadata.mediaManifest?.find(
            (m) => m.mediaKey === binding.mediaKey,
          );
        return (
          !!pin &&
          pin.checksum === media.checksum &&
          pin.mimeType === media.mimeType &&
          pin.rightsHash === studyObjectHash(media.rightsMetadata) &&
          studyDocumentInventory(content.body).figures.some(
            (f) =>
              f.mediaKey === binding.mediaKey &&
              f.width === media.width &&
              f.height === media.height,
          )
        );
      } catch {
        return false;
      }
    });
    if (!valid) throw new StudyPublishingError("UNAVAILABLE");
  }
  validateStudyMediaMetadata(media);
  const bytes = await readStudyMedia(media);
  return {
    bytes,
    mimeType: media.mimeType,
    checksum: media.checksum,
    storageKey: media.storageKey,
  };
}
