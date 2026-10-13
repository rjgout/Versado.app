// Alleen testhelper in wegwerpcontainers. Geen productie- of NAS-configuratie.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  studyStorage,
  validateStudyImage,
  installStudyMedia,
  readStudyMedia,
} from "../../src/lib/studyContent/storage.ts";
import { FIXTURE_IMAGE } from "../../src/lib/studyContent/fixtureAdapter.ts";
const mode = process.argv[2];
if (mode === "unmounted" || mode === "readonly") {
  await assert.rejects(studyStorage(), /STORAGE/);
  console.log(JSON.stringify({ mode, blocked: true }));
} else {
  const bytes = Buffer.from(FIXTURE_IMAGE, "base64"),
    image = await validateStudyImage(bytes, "image/png");
  const store =
    mode === "install"
      ? await installStudyMedia(bytes, image)
      : await studyStorage();
  assert.deepEqual(
    await readStudyMedia({ ...image, volumeId: store.volumeId }),
    bytes,
  );
  if (mode === "install")
    await fs.writeFile(
      "/data/study-media/.test-volume-identity",
      store.volumeId,
      { mode: 0o600 },
    );
  else
    assert.equal(
      await fs.readFile("/data/study-media/.test-volume-identity", "utf8"),
      store.volumeId,
    );
  console.log(
    JSON.stringify({
      mode,
      volumeId: store.volumeId,
      checksum: image.checksum,
      mountVerified: true,
    }),
  );
}
