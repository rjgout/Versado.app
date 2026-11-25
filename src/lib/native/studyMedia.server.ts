import { createHash } from "node:crypto";
import sharp from "sharp";
import { authorizedStudyMedia, authorizeStudyMedia } from "@/lib/studyContent/mediaAccess";
import { activeNativeSession, NativeAuthError, type NativeSessionBinding } from "./sessions";
import { nativeStudyImageSchema, NATIVE_STUDY_IMAGE_MAX_BYTES } from "./studyMediaContract";
// Alleen een begrensde transformatie, geen nieuwe bronopslag of servercache.
let processing = 0;
export async function nativeStudyImage(binding: NativeSessionBinding, mediaId: string) {
  if (processing >= 2) throw new NativeAuthError("media_busy", 503);
  processing++;
  try {
    const actor = await activeNativeSession(binding);
    const source = await authorizedStudyMedia(actor, mediaId);
    const image = await sharp(source.bytes, { limitInputPixels: 16_000_000, animated: false }).rotate()
      .resize(640, 640, { fit: "inside", withoutEnlargement: true }).webp({ quality: 76, effort: 3 }).toBuffer({ resolveWithObject: true });
    if (image.data.length > NATIVE_STUDY_IMAGE_MAX_BYTES) throw new NativeAuthError("media_unavailable", 404);
    // Een sessie, rol, bronselectie of publicatie kan tijdens lezen/decoderen wijzigen.
    const current = await activeNativeSession(binding);
    if (current.contentSelectionVersion !== actor.contentSelectionVersion || current.activeContentCollectionId !== actor.activeContentCollectionId) throw new NativeAuthError("content_context_changed", 409);
    const latest = await authorizeStudyMedia(current, mediaId);
    if (latest.checksum !== source.checksum) throw new NativeAuthError("media_unavailable", 404);
    await activeNativeSession(binding);
    const serverNow = Date.now();
    return nativeStudyImageSchema.parse({ version: 1, userId: current.id, mediaId,
      serverNow, selectionVersion: current.contentSelectionVersion,
      expiresAt: new Date(serverNow + 60_000).toISOString(),
      mimeType: "image/webp", width: image.info.width, height: image.info.height, byteSize: image.data.length,
      sha256: createHash("sha256").update(image.data).digest("hex"), sourceChecksum: source.checksum, base64: image.data.toString("base64"),
    });
  } catch (error) {
    if (error instanceof NativeAuthError) throw error;
    throw new NativeAuthError("media_unavailable", 404);
  } finally { processing--; }
}
