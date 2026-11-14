import { z } from "zod";
export const NATIVE_STUDY_IMAGE_MAX_BYTES = 256 * 1024;
export const nativeStudyMediaId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const nativeStudyImageSchema = z.object({
  version: z.literal(1), userId: nativeStudyMediaId, mediaId: nativeStudyMediaId,
  serverNow: z.number().int().positive(), selectionVersion: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime(), mimeType: z.literal("image/webp"),
  width: z.number().int().min(1).max(640), height: z.number().int().min(1).max(640),
  byteSize: z.number().int().min(12).max(NATIVE_STUDY_IMAGE_MAX_BYTES), sha256: hash, sourceChecksum: hash,
  base64: z.string().min(16).max(4 * Math.ceil(NATIVE_STUDY_IMAGE_MAX_BYTES / 3)).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict().refine(value => { const ttl = Date.parse(value.expiresAt) - value.serverNow; return ttl > 0 && ttl <= 60_000; });
export type NativeStudyImage = z.infer<typeof nativeStudyImageSchema>;
/** Beperkt tot een bestaande media-identiteit, nooit een URL of bestandspad. */
export function studyMediaIdFromSource(src: string): string | null {
  const match = /^\/api\/study-media\/([A-Za-z0-9_-]{1,128})$/.exec(src);
  return match?.[1] ?? null;
}

/** Controle vóór de bytes in de lokale afbeelding terechtkomen. Geen URL met
 * authenticatie; alleen in-geheugen beelddata, nooit een schijf-/browsercache. */
export async function nativeStudyDataUrl(input: unknown) {
  const value = nativeStudyImageSchema.parse(input), binary = atob(value.base64);
  if (binary.length !== value.byteSize) throw new Error("invalid_media");
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (binary.slice(0,4) !== "RIFF" || binary.slice(8,12) !== "WEBP" || new DataView(bytes.buffer).getUint32(4,true)+8 !== bytes.byteLength) throw new Error("invalid_media");
  const checksum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2,"0")).join("");
  if (checksum !== value.sha256) throw new Error("invalid_media");
  return { mediaId: value.mediaId, userId: value.userId, selectionVersion: value.selectionVersion,
    serverNow: value.serverNow, expiresAt: value.expiresAt, checksum: value.sha256, src: `data:image/webp;base64,${value.base64}` };
}
