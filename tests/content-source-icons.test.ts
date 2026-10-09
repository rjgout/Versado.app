import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { contentIcon, contentIconSources, CONTENT_SOURCE_ICON_PATHS } from "../src/lib/contentMetadata";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const SOURCE_DIR = path.join(PUBLIC, "icons", "content-sources");

const EXPECTED = {
  bofm: "bofm.webp",
  "dc-testament": "dc-testament.webp",
  pgp: "pgp.webp",
  "old-testament": "old-testament.webp",
  "new-testament": "new-testament.webp",
  fsy: "fsy.webp",
  podcasts: "podcasts.webp",
  generic: "source-generic.webp",
} as const;

function webpSizeAndAlpha(file: string): { width: number; height: number; alpha: boolean } {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF", `${file}: geen RIFF-container`);
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP", `${file}: geen WebP-container`);
  assert.equal(bytes.toString("ascii", 12, 16), "VP8X", `${file}: verwacht lossless alpha-export met VP8X-header`);
  return {
    width: 1 + bytes.readUIntLE(24, 3),
    height: 1 + bytes.readUIntLE(27, 3),
    alpha: (bytes[20] & 0x10) !== 0,
  };
}

test("de publieke broniconmap bevat exact de acht runtime-WebP's", () => {
  assert.deepEqual(readdirSync(SOURCE_DIR).sort(), Object.values(EXPECTED).sort());
  for (const filename of Object.values(EXPECTED)) {
    const file = path.join(SOURCE_DIR, filename);
    assert.ok(existsSync(file), `${filename} ontbreekt`);
    assert.deepEqual(webpSizeAndAlpha(file), { width: 256, height: 256, alpha: true }, filename);
  }
});

test("iedere bekende contentbron kiest het eigen icoon en daarna de generieke fallback", () => {
  const known = Object.entries(EXPECTED).filter(([key]) => key !== "generic");
  for (const [work] of known) {
    assert.deepEqual(
      contentIconSources({ id: `collection-${work}`, work }),
      [CONTENT_SOURCE_ICON_PATHS[work as keyof typeof CONTENT_SOURCE_ICON_PATHS], CONTENT_SOURCE_ICON_PATHS.generic],
      work,
    );
  }
});

test("een onbekende of werkloze toekomstige bron krijgt alleen het algemene bronicoon", () => {
  assert.deepEqual(contentIconSources({ id: "future-collection", work: "future-work" }), [CONTENT_SOURCE_ICON_PATHS.generic]);
  assert.deepEqual(contentIconSources({ id: "future-collection", work: null }), [CONTENT_SOURCE_ICON_PATHS.generic]);
});

test("de bestaande Lucidefunctie blijft beschikbaar als laatste fallback", () => {
  assert.ok(contentIcon({ id: "future-collection", work: "future-work" }));
});
