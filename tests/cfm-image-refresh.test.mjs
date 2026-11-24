import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  CFM_SOURCES,
  cfmDynamicMediaBinding,
} from "../src/lib/studyContent/cfmSources.ts";
import { currentCfmImage } from "../src/lib/studyContent/cfmMedia.ts";
import { downloadStudyImage } from "../src/lib/studyContent/download.ts";
import {
  validateStudyImage,
  installStudyMedia,
  readStudyMedia,
  validateStudyMediaMetadata,
} from "../src/lib/studyContent/storage.ts";
import { cfmTestImage } from "./fixtures/cfm-test-image.mjs";
import urls from "./fixtures/cfm-drift-image-urls.json" with { type: "json" };
const assets = CFM_SOURCES.flatMap((s) => s.mediaLock);

test("alle veertien dynamische bronnen accepteren geldige andere bytes; bronregistratie blijft verplicht", async () => {
  assert.equal(urls.length, 14);
  for (const url of urls) {
    const asset = assets.find((a) => a.url === url);
    assert.ok(asset);
    const bytes = await cfmTestImage(asset);
    const result = await currentCfmImage(asset, async () => bytes);
    assert.notEqual(result.image.checksum, asset.checksum);
    assert.deepEqual(
      [result.image.width, result.image.height],
      [asset.width, asset.height],
    );
    const recompressed = await sharp(bytes).jpeg({ quality: 61 }).toBuffer();
    assert.equal(
      (await currentCfmImage(asset, async () => recompressed)).bytes,
      recompressed,
    );
  }
  await assert.rejects(
    currentCfmImage(
      { ...assets[0], url: "https://untrusted.invalid/x" },
      async () => {
        throw Error("must not call");
      },
    ),
    /INVALID/,
  );
  await assert.rejects(
    currentCfmImage(assets[0], async () => Buffer.from("broken image")),
    /MEDIA/,
  );
  const wrong = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .jpeg()
    .toBuffer();
  await assert.rejects(
    currentCfmImage(assets[0], async () => wrong),
    /MEDIA/,
  );
});

test("vervangen gebruikt gevalideerde tijdelijke opslag; HTTP/netwerk/MIME/decode-fout behoudt bestaand bestand", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "versado-cfm-download-"),
  );
  const previous = {};
  for (const key of [
    "DATABASE_URL",
    "STUDY_PUBLICATION_PROFILE",
    "STUDY_MEDIA_DIR",
    "STUDY_MEDIA_TEST_ROOT",
  ])
    previous[key] = process.env[key];
  Object.assign(process.env, {
    DATABASE_URL:
      "postgresql://test:test@127.0.0.1:5432/versado_content_access_test",
    STUDY_PUBLICATION_PROFILE: "synthetic-test",
    STUDY_MEDIA_DIR: root,
    STUDY_MEDIA_TEST_ROOT: root,
  });
  const volumeId = randomUUID();
  await fs.writeFile(
    path.join(root, ".versado-study-volume.json"),
    JSON.stringify({ version: 1, purpose: "versado-study-media", volumeId }),
  );
  try {
    const asset = assets[0],
      old = await cfmTestImage(asset),
      oldImage = await validateStudyImage(old, asset.mimeType);
    await installStudyMedia(old, oldImage);
    const fresh = await sharp(old).jpeg({ quality: 59 }).toBuffer();
    let mode = "ok";
    const request = {
      allowedHosts: ["www.churchofjesuschrist.org"],
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: async () => {
        if (mode === "network") throw Error("synthetic network");
        const bytes = mode === "broken" ? Buffer.from("bad") : fresh;
        return {
          status: mode === "http" ? 503 : 200,
          headers: {
            "content-type": mode === "mime" ? "text/html" : "image/jpeg",
            "content-length": String(bytes.length),
          },
          body: (async function* () {
            yield bytes;
          })(),
          close() {},
        };
      },
    };
    const downloaded = await downloadStudyImage(asset.url, request, undefined);
    assert.notEqual(downloaded.image.checksum, oldImage.checksum);
    // Nieuwe bytes bestaan vóór enige vervanging; oude content blijft intact.
    assert.deepEqual(
      await readStudyMedia({ ...oldImage, volumeId }, true),
      old,
    );
    await installStudyMedia(downloaded.bytes, downloaded.image);
    assert.deepEqual(
      await readStudyMedia({ ...downloaded.image, volumeId }, true),
      fresh,
    );
    for (mode of ["network", "http", "mime", "broken"]) {
      await assert.rejects(downloadStudyImage(asset.url, request, undefined));
      assert.deepEqual(
        await readStudyMedia({ ...oldImage, volumeId }, true),
        old,
      );
      assert.deepEqual(
        await readStudyMedia({ ...downloaded.image, volumeId }, true),
        fresh,
      );
      assert.ok(
        !(await fs.readdir(root)).some((name) =>
          name.startsWith(".quarantine"),
        ),
      );
    }
    await assert.rejects(
      downloadStudyImage(
        asset.url,
        {
          ...request,
          resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        },
        undefined,
      ),
    );
    await assert.rejects(
      downloadStudyImage(
        "http://www.churchofjesuschrist.org/x",
        request,
        undefined,
      ),
    );
    // Andere/pinned imports behouden hun verplichte checksumvergelijking.
    mode = "ok";
    await assert.rejects(
      downloadStudyImage(asset.url, request, oldImage.checksum),
    );
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("alleen geregistreerde CFM-bronidentiteit kan dynamisch zijn; rechten en overige bronnen blijven strikt", () => {
  const source = CFM_SOURCES[0],
    asset = source.mediaLock[0];
  const metadata = {
    sourceKey: asset.url,
    adapter: source.adapter,
    cfmPreviousChecksums: ["a".repeat(64)],
  };
  assert.equal(
    cfmDynamicMediaBinding(source.manifest.workKey, asset.checksum, metadata),
    true,
  );
  assert.equal(
    cfmDynamicMediaBinding(source.manifest.workKey, "a".repeat(64), metadata),
    true,
  );
  for (const changed of [
    { ...metadata, sourceKey: "https://untrusted.invalid/x" },
    { ...metadata, adapter: "fixture-v1" },
    { ...metadata, cfmPreviousChecksums: ["invalid"] },
  ])
    assert.equal(
      cfmDynamicMediaBinding(source.manifest.workKey, "a".repeat(64), changed),
      false,
    );
  assert.equal(
    cfmDynamicMediaBinding("otb-ot", "a".repeat(64), metadata),
    false,
  );
  assert.throws(() =>
    validateStudyMediaMetadata({
      sourceMetadata: { ...metadata, adapter: "fixture-v1" },
      sourceUrl: null,
      rightsMetadata: { holder: "test", permission: "test" },
    }),
  );
});
