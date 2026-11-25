import test from "node:test";
import assert from "node:assert/strict";
import { CFM_MEDIA_CANDIDATES } from "../src/lib/studyContent/cfmMedia";
import { CFM_SOURCE_2026 } from "../src/lib/studyContent/cfmSources";
import { loadCfmLesson } from "../src/lib/studyContent/cfm2026Import";
import { parseCfmLesson } from "../src/lib/studyContent/cfm2026Adapter";
import { studyObjectHash } from "../src/lib/studyContent/policy";
import fs from "node:fs/promises";

test("zeven beoordeelde kandidaten zijn geen actieve pinwijziging en behouden bronidentiteiten, afmetingen en lesinhoud", async () => {
  assert.equal(CFM_MEDIA_CANDIDATES.length, 7);
  assert.equal(new Set(CFM_MEDIA_CANDIDATES.map((a) => a.url)).size, 7);
  for (const candidate of CFM_MEDIA_CANDIDATES) {
    const original = CFM_SOURCE_2026.mediaLock.find(
      (a) => a.url === candidate.url,
    )!;
    assert.ok(original);
    assert.equal(original.checksum, candidate.originalChecksum);
    assert.equal(original.byteSize, candidate.originalBytes);
    assert.notEqual(original.checksum, candidate.checksum);
    assert.match(candidate.checksum, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      [candidate.width, candidate.height, candidate.mimeType, candidate.file],
      [original.width, original.height, original.mimeType, original.file],
    );
    assert.ok(candidate.byteSize > 0 && candidate.byteSize < 10 * 1024 * 1024);
    assert.equal(
      new URL(candidate.url).hostname,
      "www.churchofjesuschrist.org",
    );
  }
  let changedLessons = 0;
  const proposed = CFM_SOURCE_2026.mediaLock.map(
    (a) => CFM_MEDIA_CANDIDATES.find((c) => c.url === a.url) ?? a,
  );
  for (const lesson of CFM_SOURCE_2026.manifest.lessons) {
    const original = await loadCfmLesson(lesson.sourceKey);
    if (
      !original.assets.some((a) =>
        CFM_MEDIA_CANDIDATES.some((c) => c.url === a.url),
      )
    )
      continue;
    const source = JSON.parse(
      await fs.readFile(
        `${CFM_SOURCE_2026.dataDir}/source/${lesson.sourceKey}.json`,
        "utf8",
      ),
    );
    const candidate = parseCfmLesson(lesson.sourceKey, source, proposed);
    assert.equal(
      studyObjectHash(candidate.document),
      studyObjectHash(original.document),
    );
    assert.equal(candidate.title, original.title);
    assert.equal(
      studyObjectHash(candidate.inventory.references),
      studyObjectHash(original.inventory.references),
    );
    changedLessons++;
  }
  assert.equal(changedLessons, 6);
});
