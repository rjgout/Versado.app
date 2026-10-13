// Uitsluitend expliciete operatoractie na stackwijziging; nooit appstart/seed/import.
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
const root = process.env.STUDY_MEDIA_DIR;
if (
  !root ||
  !path.isAbsolute(root) ||
  path.resolve(root) !== root ||
  root === "/"
)
  throw new Error("STUDY_STORAGE_CONFIGURATION_REQUIRED");
let part = "/";
for (const segment of root.split("/").filter(Boolean)) {
  part = path.join(part, segment);
  if ((await fs.lstat(part)).isSymbolicLink())
    throw new Error("STUDY_STORAGE_SYMLINK");
}
const mountinfo = await fs.readFile("/proc/self/mountinfo", "utf8");
if (
  !mountinfo.split("\n").some((line) => {
    const fields = line.split(" ");
    return (
      fields[4]?.replace(/\\([0-7]{3})/g, (_, n) =>
        String.fromCharCode(parseInt(n, 8)),
      ) === root && fields[5]?.split(",").includes("rw")
    );
  })
)
  throw new Error("STUDY_PERSISTENT_MOUNT_REQUIRED");
const stat = await fs.stat(root);
if (!stat.isDirectory() || (stat.mode & 0o222) === 0)
  throw new Error("STUDY_STORAGE_NOT_WRITABLE");
await fs.chmod(root, 0o700);
const file = path.join(root, ".versado-study-volume.json");
try {
  const handle = await fs.open(
    file,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(
      JSON.stringify({
        version: 1,
        purpose: "versado-study-media",
        volumeId: randomUUID(),
      }),
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const existing = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    if ((await existing.stat()).size > 1024)
      throw new Error("STUDY_VOLUME_REVIEW_REQUIRED");
    const marker = JSON.parse(await existing.readFile("utf8"));
    if (
      marker.version !== 1 ||
      marker.purpose !== "versado-study-media" ||
      typeof marker.volumeId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(marker.volumeId)
    )
      throw new Error("STUDY_VOLUME_REVIEW_REQUIRED");
  } finally {
    await existing.close();
  }
}
const directory = await fs.open(
  root,
  constants.O_RDONLY | constants.O_DIRECTORY,
);
try {
  await directory.sync();
} finally {
  await directory.close();
}
console.log(
  "STUDY_MEDIA_VOLUME_INITIALIZED — bestaande media behouden, publicatie niet vrijgegeven.",
);
