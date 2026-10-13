import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { studyRightsMetadataSchema } from "./revisions";
import { safeStudyUrlSchema, studySourceKeySchema } from "./schema";
import { StudyPublishingError, syntheticStudyEnvironment } from "./policy";

export const STUDY_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const keyPattern = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
const markerName = ".versado-study-volume.json";
export interface StudyStorage {
  root: string;
  volumeId: string;
}
export interface ValidatedStudyImage {
  checksum: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  storageKey: string;
}

export function hasStudyMount(
  mountinfo: string,
  root: string,
  writable: boolean,
) {
  return mountinfo.split("\n").some((line) => {
    const fields = line.split(" ");
    const point = fields[4]?.replace(/\\([0-7]{3})/g, (_, value) =>
      String.fromCharCode(parseInt(value, 8)),
    );
    return (
      point === root && (!writable || fields[5]?.split(",").includes("rw"))
    );
  });
}
/** Operator initialiseert de echte mount één keer; geen mkdir/fallback bij appstart. */
export async function studyStorage(writable = true): Promise<StudyStorage> {
  try {
    const root = process.env.STUDY_MEDIA_DIR;
    if (
      !root ||
      !path.isAbsolute(root) ||
      path.resolve(root) !== root ||
      root === "/"
    )
      throw new Error();
    let part = "/";
    for (const segment of root.split("/").filter(Boolean)) {
      part = path.join(part, segment);
      if ((await fs.lstat(part)).isSymbolicLink()) throw new Error();
    }
    const info = await fs.stat(root);
    if (
      !info.isDirectory() ||
      (info.mode & 0o022) !== 0 ||
      (writable && (info.mode & 0o222) === 0)
    )
      throw new Error();
    const testRoot =
      syntheticStudyEnvironment() && process.env.STUDY_MEDIA_TEST_ROOT === root;
    if (
      !testRoot &&
      !hasStudyMount(
        await fs.readFile("/proc/self/mountinfo", "utf8"),
        root,
        writable,
      )
    )
      throw new Error();
    await fs.access(
      root,
      constants.R_OK | constants.X_OK | (writable ? constants.W_OK : 0),
    );
    const handle = await fs.open(
      path.join(root, markerName),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let value: unknown;
    try {
      if ((await handle.stat()).size > 1024) throw new Error();
      value = JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
    const marker = value as {
      version?: unknown;
      purpose?: unknown;
      volumeId?: unknown;
    };
    if (
      marker.version !== 1 ||
      marker.purpose !== "versado-study-media" ||
      typeof marker.volumeId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(marker.volumeId)
    )
      throw new Error();
    return { root, volumeId: marker.volumeId };
  } catch {
    throw new StudyPublishingError("STORAGE");
  }
}

export async function validateStudyImage(
  bytes: Buffer,
  claimedMime: string,
  expectedChecksum?: string,
): Promise<ValidatedStudyImage> {
  if (!bytes.length || bytes.length > STUDY_MEDIA_MAX_BYTES)
    throw new StudyPublishingError("MEDIA");
  let detected: "png" | "jpeg" | "webp" | null = null;
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    detected = "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    detected = "jpeg";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    detected = "webp";
  const mimeType = `image/${detected}`;
  if (!detected || claimedMime.toLowerCase().split(";")[0].trim() !== mimeType)
    throw new StudyPublishingError("MEDIA");
  try {
    const decoder = sharp(bytes, {
      limitInputPixels: 16_000_000,
      failOn: "warning",
    });
    const metadata = await decoder.metadata();
    const { width, height } = metadata;
    if (
      metadata.format !== detected ||
      !width ||
      !height ||
      width > 8192 ||
      height > 8192 ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error();
    // Metadata alleen bewijst geen decodeerbaar/compleet bestand.
    await decoder.raw().toBuffer();
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (expectedChecksum && checksum !== expectedChecksum) throw new Error();
    return {
      checksum,
      mimeType,
      byteSize: bytes.length,
      width,
      height,
      storageKey: `${checksum}.${detected === "jpeg" ? "jpg" : detected}`,
    };
  } catch {
    throw new StudyPublishingError("MEDIA");
  }
}

export async function readStudyMedia(
  media: Pick<ValidatedStudyImage, "storageKey" | "checksum" | "byteSize"> & {
    volumeId: string;
  },
  writable = false,
) {
  if (!keyPattern.test(media.storageKey))
    throw new StudyPublishingError("MEDIA");
  const store = await studyStorage(writable);
  if (store.volumeId !== media.volumeId)
    throw new StudyPublishingError("STORAGE");
  let handle;
  try {
    handle = await fs.open(
      path.join(store.root, media.storageKey),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size !== media.byteSize ||
      stat.size > STUDY_MEDIA_MAX_BYTES
    )
      throw new Error();
    const bytes = await handle.readFile();
    if (createHash("sha256").update(bytes).digest("hex") !== media.checksum)
      throw new Error();
    return bytes;
  } catch {
    throw new StudyPublishingError("MEDIA");
  } finally {
    await handle?.close();
  }
}

/** Exclusieve atomische hardlink: nooit een bestaand hashbestand overschrijven. */
export async function installStudyMedia(
  bytes: Buffer,
  media: ValidatedStudyImage,
) {
  const store = await studyStorage();
  const target = path.join(store.root, media.storageKey);
  const quarantine = path.join(store.root, `.quarantine-${randomUUID()}.part`);
  const handle = await fs.open(
    quarantine,
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
    try {
      await fs.link(quarantine, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    // Zowel nieuw geïnstalleerde bestanden als een race/deduplicatie opnieuw controleren.
    await readStudyMedia({ ...media, volumeId: store.volumeId }, true);
    const directory = await fs.open(
      store.root,
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return store;
  } catch (error) {
    if (error instanceof StudyPublishingError) throw error;
    throw new StudyPublishingError("MEDIA");
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(quarantine).catch(() => {});
  }
}

export function validateStudyMediaMetadata(media: {
  sourceMetadata: unknown;
  rightsMetadata: unknown;
  sourceUrl: string | null;
}) {
  try {
    z.object({
      sourceKey: studySourceKeySchema,
      adapter: z.string().min(1).max(128),
    })
      .strict()
      .parse(media.sourceMetadata);
    studyRightsMetadataSchema.parse(media.rightsMetadata);
    if (media.sourceUrl) safeStudyUrlSchema.parse(media.sourceUrl);
  } catch {
    throw new StudyPublishingError("MEDIA");
  }
}
