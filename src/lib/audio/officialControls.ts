import type { MessageKey } from "@/lib/i18n/core";
/** Kleine HTTP-batches; de bestaande duurzame taken blijven de voortgang bewaren. */
export const OFFICIAL_BATCH_SIZE=20;
export function officialBatches<T>(items:readonly T[]):T[][] {
  return Array.from({length:Math.ceil(items.length/OFFICIAL_BATCH_SIZE)},(_,i)=>items.slice(i*OFFICIAL_BATCH_SIZE,(i+1)*OFFICIAL_BATCH_SIZE));
}
export const officialReasons:Record<string,MessageKey>={
  STORAGE_FULL:"officialAudio.storageFull",STORAGE_PERMISSION:"officialAudio.storagePermission",STORAGE_UNAVAILABLE:"officialAudio.storageMissing",
  PILOT_REQUIRED:"officialAudio.bulkLocked",TARGET_MISSING:"officialAudio.editionMissing",SOURCE_MISMATCH:"officialAudio.sourceChanged",SOURCE_PROTECTED:"officialAudio.protection",LEGACY_PROTECTED:"officialAudio.protection",
  DATABASE_BUSY:"officialAudio.databaseBusy",DATABASE_UNAVAILABLE:"officialAudio.serviceError",AUDIO_TASK_FAILED:"officialAudio.serviceError",BATCH_TOO_LARGE:"officialAudio.batchTooLarge",
  DOWNLOAD_REQUIRED:"officialAudio.downloadRequired",RESUME_NOT_ALLOWED:"officialAudio.resumeUnavailable",PUBLICATION_CONFLICT:"officialAudio.publicationConflict",QUALITY_REVIEW_REQUIRED:"audioLibrary.review",FORBIDDEN:"officialAudio.forbidden",
};
