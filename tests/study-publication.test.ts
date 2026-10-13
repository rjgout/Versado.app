import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  studyFixture,
  validateSnapshotItem,
  snapshotRevisionInput,
  snapshotIdentity,
  FIXTURE_IMAGE,
} from "../src/lib/studyContent/fixtureAdapter";
import { studyRevisionHash } from "../src/lib/studyContent/revisions";
import {
  diffStudyRevisions,
  studyPublicationSchema,
} from "../src/lib/studyContent/publication";
import {
  publicStudyAddress,
  studyDownloadUrl,
  downloadStudyImage,
} from "../src/lib/studyContent/download";
import {
  studyStorage,
  validateStudyImage,
  installStudyMedia,
  readStudyMedia,
  hasStudyMount,
  STUDY_MEDIA_MAX_BYTES,
} from "../src/lib/studyContent/storage";
import {
  syntheticStudyEnvironment,
  studyReleaseAllowed,
} from "../src/lib/studyContent/policy";
const bytes = Buffer.from(FIXTURE_IMAGE, "base64");
let root: string;
before(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "study-media-unit-"));
  await fs.chmod(root, 0o700);
  process.env.DATABASE_URL =
    "postgresql://unit:unit@127.0.0.1:1/versado_content_access_test";
  process.env.STUDY_PUBLICATION_PROFILE = "synthetic-test";
  process.env.STUDY_MEDIA_DIR = root;
  process.env.STUDY_MEDIA_TEST_ROOT = root;
  await fs.writeFile(
    path.join(root, ".versado-study-volume.json"),
    JSON.stringify({
      version: 1,
      purpose: "versado-study-media",
      volumeId: randomUUID(),
    }),
  );
});
after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
test("synthetische adapter behoudt negen semantische typen, anchors en gepinde bronversie", () => {
  const source = studyFixture("sample"),
    normalized = validateSnapshotItem(source.items[0]);
  assert.equal(normalized.inventory.anchors.length, 11);
  assert.equal(normalized.inventory.figures.length, 1);
  assert.equal(normalized.inventory.references.length, 1);
  assert.equal(
    snapshotIdentity(studyFixture("sample")),
    snapshotIdentity(source),
  );
  assert.notEqual(
    snapshotIdentity(studyFixture("updated")),
    snapshotIdentity(source),
  );
});
test("zelfde broninhoud/hash blijft stabiel; tekst, opdrachten, bron/rechten en media wijzigen de revisiehash", () => {
  const original = snapshotRevisionInput(studyFixture("sample").items[0]),
    hash = studyRevisionHash(original);
  assert.equal(
    hash,
    studyRevisionHash(snapshotRevisionInput(studyFixture("sample").items[0])),
  );
  assert.notEqual(
    hash,
    studyRevisionHash(snapshotRevisionInput(studyFixture("updated").items[0])),
  );
  const changed = studyFixture("sample").items[0];
  changed.media[0].checksum = "f".repeat(64);
  assert.notEqual(hash, studyRevisionHash(snapshotRevisionInput(changed)));
});
test("onbekende betekenisvolle velden, ontbrekende ankers/afbeeldingen en ongeldige schemaVersion stoppen import", () => {
  for (const mutate of [
    (x: ReturnType<typeof studyFixture>["items"][0]) => {
      x.expectedAnchors.pop();
    },
    (x: ReturnType<typeof studyFixture>["items"][0]) => {
      x.media = [];
    },
    (x: ReturnType<typeof studyFixture>["items"][0]) => {
      (x as unknown as Record<string, unknown>).unknownMeaningful =
        "niet weggooien";
    },
    (x: ReturnType<typeof studyFixture>["items"][0]) => {
      (x as unknown as Record<string, unknown>).schemaVersion = 2;
    },
  ]) {
    const item = studyFixture("sample").items[0];
    mutate(item);
    assert.throws(() => validateSnapshotItem(item));
  }
  assert.throws(() => validateSnapshotItem(studyFixture("invalid").items[0]));
  assert.throws(() =>
    validateSnapshotItem(studyFixture("batch-error").items[1]),
  );
});
test("links zonder stabiel reference-anker worden niet ongemerkt publiceerbaar", () => {
  const item = studyFixture("sample").items[0];
  const doc = item.body as {
    sections: Array<{ blocks: Array<Record<string, unknown>> }>;
  };
  doc.sections[0].blocks[1].content = [
    {
      type: "link",
      text: "Niet gecontroleerd",
      href: "https://example.invalid/unknown",
    },
  ];
  assert.throws(() => validateSnapshotItem(item), /REFERENCES/);
});
test("diff gebruikt stabiele sectie/blok/itemankers, inclusief opdrachten, referenties en mediawijzigingen", () => {
  const a = snapshotRevisionInput(studyFixture("sample").items[0]),
    b = snapshotRevisionInput(studyFixture("updated").items[0]);
  const diff = diffStudyRevisions(a, b);
  assert.ok(
    diff.changes.some(
      (c) => c.anchor === "section-intro" && c.change === "changed",
    ),
  );
  assert.ok(diff.changes.some((c) => c.kind === "question"));
  const media = studyFixture("sample").items[0];
  media.media[0].checksum = "1".repeat(64);
  assert.ok(
    diffStudyRevisions(a, snapshotRevisionInput(media)).changes.some(
      (c) => c.kind === "figure",
    ),
  );
  const removed = structuredClone(a);
  const body = removed.body as typeof b.body;
  body.sections[0].blocks = body.sections[0].blocks.filter(
    (c) => c.id !== "assignment-intro",
  );
  assert.ok(
    diffStudyRevisions(a, removed).changes.some(
      (c) => c.anchor === "assignment-intro" && c.change === "removed",
    ),
  );
});
test("publicatiepayload strikt: actionId/verwachte versie; geen body, SQL, userId of previewrechten", () => {
  const request = {
    editionId: "edition",
    revisionId: "revision",
    importRunId: "run",
    kind: "PUBLISH",
    expectedVersion: 0,
    actionId: randomUUID(),
  };
  assert.ok(studyPublicationSchema.safeParse(request).success);
  for (const patch of [
    { body: {} },
    { userId: "other" },
    { sql: "delete" },
    { preview: true },
    { expectedVersion: -1 },
    { actionId: "invalid" },
  ])
    assert.equal(
      studyPublicationSchema.safeParse({ ...request, ...patch }).success,
      false,
    );
});
for (const ip of [
  "0.0.0.0",
  "10.0.0.1",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.1.1",
  "192.0.2.1",
  "198.18.1.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "fc00::1",
  "fe80::1",
  "2001:db8::1",
  "2002:7f00:1::",
])
  test(`SSRF-special/private adres geweigerd: ${ip}`, () =>
    assert.equal(publicStudyAddress(ip), false));
test("publieke adressen en exacte HTTPS-hostallowlist", () => {
  for (const ip of [
    "8.8.8.8",
    "1.1.1.1",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
  ])
    assert.equal(publicStudyAddress(ip), true);
  for (const url of [
    "http://media.example.invalid/a",
    "https://media.example.invalid.evil/a",
    "https://media.example.invalid:8443/a",
    "https://name:secret@media.example.invalid/a",
    "https://media.example.invalid./a",
    "https://127.0.0.1/a",
  ])
    assert.throws(() => studyDownloadUrl(url, ["media.example.invalid"]));
});
test("echte signatuur, MIME, volledig decodeerbaar raster, bytes en SHA-256", async () => {
  const image = await validateStudyImage(bytes, "image/png");
  assert.equal(image.width, 8);
  assert.equal(image.height, 8);
  for (const [value, mime] of [
    [Buffer.from('<svg onload="alert(1)"/>'), "image/svg+xml"],
    [Buffer.from("<html>"), "image/png"],
    [bytes, "image/jpeg"],
    [bytes.subarray(0, 40), "image/png"],
    [Buffer.alloc(STUDY_MEDIA_MAX_BYTES + 1), "image/png"],
  ] as const)
    await assert.rejects(validateStudyImage(value, mime), /MEDIA/);
  await assert.rejects(
    validateStudyImage(bytes, "image/png", "0".repeat(64)),
    /MEDIA/,
  );
});
test("ontbrekende marker/root, readonly map, ongemounte containerlaag en symlink worden geweigerd", async () => {
  const previous = process.env.STUDY_MEDIA_DIR;
  process.env.STUDY_MEDIA_DIR = path.join(root, "missing");
  await assert.rejects(studyStorage(), /STORAGE/);
  process.env.STUDY_MEDIA_DIR = previous;
  await fs.chmod(root, 0o500);
  await assert.rejects(studyStorage(), /STORAGE/);
  await fs.chmod(root, 0o700);
  const link = `${root}-link`;
  await fs.symlink(root, link);
  process.env.STUDY_MEDIA_DIR = link;
  await assert.rejects(studyStorage(), /STORAGE/);
  process.env.STUDY_MEDIA_DIR = previous;
  await fs.unlink(link);
  const profile = process.env.STUDY_PUBLICATION_PROFILE;
  process.env.STUDY_PUBLICATION_PROFILE = "production";
  await assert.rejects(studyStorage(), /STORAGE/);
  process.env.STUDY_PUBLICATION_PROFILE = profile;
});
test("atomisch/deduplicerend opslaan, geen traversal/symlink/overschrijving; markeridentiteit bewaakt", async () => {
  const image = await validateStudyImage(bytes, "image/png"),
    store = await installStudyMedia(bytes, image);
  assert.deepEqual(
    await readStudyMedia({ ...image, volumeId: store.volumeId }),
    bytes,
  );
  await installStudyMedia(bytes, image);
  assert.deepEqual(
    await readStudyMedia({ ...image, volumeId: store.volumeId }),
    bytes,
  );
  await assert.rejects(
    readStudyMedia({
      ...image,
      storageKey: "../secret",
      volumeId: store.volumeId,
    }),
    /MEDIA/,
  );
  await assert.rejects(
    readStudyMedia({ ...image, volumeId: randomUUID() }),
    /STORAGE/,
  );
  const target = path.join(root, image.storageKey);
  await fs.unlink(target);
  await fs.symlink("/etc/passwd", target);
  await assert.rejects(installStudyMedia(bytes, image), /MEDIA/);
  await fs.unlink(target);
  await installStudyMedia(bytes, image);
});
test("mountbewijs controleert exacte mountpoint en readonly flags", () => {
  const info = "36 35 0:32 / /data/study-media rw,relatime - ext4 /dev/test rw";
  assert.ok(hasStudyMount(info, "/data/study-media", true));
  assert.equal(hasStudyMount(info, "/data/study-media/child", true), false);
  assert.equal(
    hasStudyMount(
      info.replace("rw,relatime", "ro,relatime"),
      "/data/study-media",
      true,
    ),
    false,
  );
});
const response = (
  status: number,
  data: Buffer,
  headers: Record<string, string> = {},
) => ({
  status,
  headers: {
    "content-type": "image/png",
    "content-length": String(data.length),
    ...headers,
  },
  body: (async function* () {
    yield data;
  })(),
  close: () => {},
});
test("download pinnt gevalideerde DNS en bewaakt streaming, redirects, rebinding en afbreken", async () => {
  const expected = (await validateStudyImage(bytes, "image/png")).checksum;
  let resolved = 0;
  const options = {
    allowedHosts: ["media.example.invalid"],
    resolve: async () => {
      resolved++;
      return [{ address: "8.8.8.8", family: 4 }];
    },
    transport: async (_url: URL, address: { address: string }) => {
      assert.equal(address.address, "8.8.8.8");
      return response(200, bytes);
    },
  };
  const image = await downloadStudyImage(
    "https://media.example.invalid/a",
    options,
    expected,
  );
  assert.equal(image.image.checksum, expected);
  assert.equal(resolved, 1);
  await assert.rejects(
    downloadStudyImage(
      "https://media.example.invalid/a",
      {
        ...options,
        transport: async () =>
          response(302, Buffer.alloc(0), {
            location: "https://127.0.0.1/private",
          }),
      },
      expected,
    ),
    /MEDIA/,
  );
  let lookup = 0;
  await assert.rejects(
    downloadStudyImage(
      "https://media.example.invalid/a",
      {
        ...options,
        resolve: async () => [
          { address: ++lookup === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 },
        ],
        transport: async () =>
          response(302, Buffer.alloc(0), { location: "/redirect" }),
      },
      expected,
    ),
    /MEDIA/,
  );
  assert.equal(lookup, 2);
  await assert.rejects(
    downloadStudyImage(
      "https://media.example.invalid/a",
      {
        ...options,
        transport: async () =>
          response(200, bytes, { "content-length": "999" }),
      },
      expected,
    ),
    /MEDIA/,
  );
  await assert.rejects(
    downloadStudyImage(
      "https://media.example.invalid/a",
      {
        ...options,
        transport: async () => ({
          ...response(200, bytes),
          body: (async function* () {
            yield bytes.subarray(0, 10);
            throw new Error("interrupted");
          })(),
        }),
      },
      expected,
    ),
    /MEDIA/,
  );
  assert.ok(
    !(await fs.readdir(root)).some((name) =>
      name.includes("quarantine-download"),
    ),
  );
});
test("synthetisch publicatieprofiel kan geen productiehost/database of officiële adapter vrijgeven", () => {
  const old = process.env.DATABASE_URL;
  assert.ok(syntheticStudyEnvironment());
  assert.ok(studyReleaseAllowed("synthetic-v1"));
  assert.equal(studyReleaseAllowed("official"), false);
  process.env.DATABASE_URL = "postgresql://ignored:ignored@jehova-db:5432/bom";
  assert.equal(syntheticStudyEnvironment(), false);
  assert.equal(studyReleaseAllowed("synthetic-v1"), false);
  process.env.DATABASE_URL = old;
});
test("download deadline begrenst trage DNS én een stille streaming-peer; streaminglimiet/redirectlimiet blijven hard", async () => {
  const expected = (await validateStudyImage(bytes, "image/png")).checksum,
    options = {
      allowedHosts: ["media.example.invalid"],
      timeoutMs: 15,
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      transport: async () => response(200, bytes),
    };
  await assert.rejects(
    downloadStudyImage(
      "https://media.example.invalid/a",
      { ...options, resolve: () => new Promise(() => {}) },
      expected,
    ),
    /MEDIA/,
  );
  await assert.rejects(
    downloadStudyImage(
      "https://media.example.invalid/a",
      {
        ...options,
        transport: async () => ({
          ...response(200, bytes),
          body: {
            [Symbol.asyncIterator]: () => ({
              next: () => new Promise(() => {}),
            }),
          },
        }),
      },
      expected,
    ),
    /MEDIA/,
  );
  await assert.rejects(
    downloadStudyImage(
      "https://media.example.invalid/a",
      {
        ...options,
        timeoutMs: 1000,
        transport: async () => ({
          ...response(200, bytes),
          headers: { "content-type": "image/png" },
          body: (async function* () {
            yield Buffer.alloc(STUDY_MEDIA_MAX_BYTES);
            yield bytes;
          })(),
        }),
      },
      expected,
    ),
    /MEDIA/,
  );
  await assert.rejects(
    downloadStudyImage(
      "https://media.example.invalid/a",
      {
        ...options,
        timeoutMs: 1000,
        transport: async () =>
          response(302, Buffer.alloc(0), { location: "/again" }),
      },
      expected,
    ),
    /MEDIA/,
  );
});

test("referentiebewijs verandert de revisiehash; dubbele media/evidence mogen niet als gecontroleerd doorgaan", () => {
  const first = snapshotRevisionInput(studyFixture("sample").items[0]),
    unresolved = snapshotRevisionInput(studyFixture("unresolved").items[0]);
  assert.notEqual(studyRevisionHash(first), studyRevisionHash(unresolved));
  const media = studyFixture("sample").items[0];
  media.media.push(media.media[0]);
  assert.throws(() => validateSnapshotItem(media), /INCOMPLETE/);
  const evidence = studyFixture("sample").items[0];
  evidence.evidence.push(evidence.evidence[0]);
  assert.throws(() => validateSnapshotItem(evidence), /REFERENCES/);
});
