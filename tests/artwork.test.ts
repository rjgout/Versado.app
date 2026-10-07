// Het artworkregister (src/lib/artwork.ts): elk boek van de Schriften heeft
// een eigen beeld dat echt bestaat, en een cursus kiest het beeld dat bij
// zijn plek hoort.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artworkFor, courseArtworkKeys, gameArtworkKeys, type ArtworkKeys } from "../src/lib/artwork";
import { BOOK_KEYS_BY_SLUG } from "../prisma/bookKeys";
import { INTRO_SLUG, KIDS_SLUG, FSY_SLUG } from "../src/lib/courses";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

function assertFile(key: ArtworkKeys) {
  const asset = artworkFor(key);
  assert.ok(asset, `${key} heeft geen beeld`);
  assert.ok(existsSync(path.join(PUBLIC, asset.src)), `${asset.src} ontbreekt`);
  return asset;
}

function pngSize(src: string) {
  const png = readFileSync(path.join(PUBLIC, src));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("elk boek van de Schriften heeft een eigen, bestaand beeld", () => {
  const sources = Object.values(BOOK_KEYS_BY_SLUG).map((key) => assertFile(`book:${key}`).src);
  assert.equal(new Set(sources).size, sources.length, "twee boeken met hetzelfde beeld");
});

test("vaste cursussen en Vrije keuze per werk hebben een bestaand beeld", () => {
  for (const slug of [INTRO_SLUG, KIDS_SLUG, FSY_SLUG]) assertFile(`course:${slug}`);
  for (const work of ["bofm", "dc-testament", "pgp"]) assertFile(`course-work:${work}:FREE_CHOICE`);
});

test("een cursus volgt het boek waar je bent, anders het begin of de keuzeroute", () => {
  const first = (keys: string[]) => artworkFor(keys)?.src;
  // Van voor naar achter, nog niet begonnen: het eerste boek van het werk.
  assert.equal(first(courseArtworkKeys({ slug: "voor-naar-achter-content_dc", type: "FRONT_TO_BACK", work: "dc-testament" })), artworkFor("book:dc-testament/dc")?.src);
  assert.equal(first(courseArtworkKeys({ slug: "lezen-van-voor-naar-achter", type: "READING_LESSONS", work: "pgp" })), artworkFor("book:pgp/moses")?.src);
  // Onderweg: het huidige boek, ook bij Vrije keuze.
  assert.equal(first(courseArtworkKeys({ slug: "voor-naar-achter", type: "FRONT_TO_BACK", work: "bofm", bookKey: "bofm/hel" })), artworkFor("book:bofm/hel")?.src);
  assert.equal(first(courseArtworkKeys({ slug: "vrije-keuze", type: "FREE_CHOICE", work: "bofm", bookKey: "bofm/ether" })), artworkFor("book:bofm/ether")?.src);
  // Vrije keuze zonder plek: het keuzebeeld van dat werk, in elke taaluitgave.
  assert.equal(first(courseArtworkKeys({ slug: "vrije-keuze-content_pgp_en", type: "FREE_CHOICE", work: "pgp" })), artworkFor("course-work:pgp:FREE_CHOICE")?.src);
  // Een eigen cursusbeeld gaat voor.
  assert.equal(first(courseArtworkKeys({ slug: KIDS_SLUG, type: "KIDS", work: "bofm" })), artworkFor(`course:${KIDS_SLUG}`)?.src);
  // Een podcastcursus krijgt hier geen schriftbeeld.
  assert.equal(first(courseArtworkKeys({ slug: "podcast", type: "PODCAST", work: "podcasts" })), undefined);
});

test("het vliegspel kiest een bestaande cover per persoonlijke gids", () => {
  assert.equal(assertFile(gameArtworkKeys("quick-missionary", "novi")).src, "/images/games/snelle-zendeling.png");
  const varo = assertFile(gameArtworkKeys("quick-missionary", "varo"));
  const vera = assertFile(gameArtworkKeys("quick-missionary", "vera"));
  assert.equal(varo.src, "/images/games/vliegende-varo.png");
  assert.equal(vera.src, "/images/games/vliegende-vera.png");
  assert.deepEqual(pngSize(varo.src), { width: 1672, height: 941 });
  assert.deepEqual(pngSize(vera.src), { width: 1672, height: 941 });
  assert.notDeepEqual(gameArtworkKeys("quick-missionary", "novi"), gameArtworkKeys("quick-missionary", "varo"));
});

test("Het Mysterie gebruikt de algemene horizontale game-cover", () => {
  const mystery = assertFile(gameArtworkKeys("mystery"));
  assert.equal(mystery.src, "/images/games/het-mysterie.png");
  assert.deepEqual(pngSize(mystery.src), { width: 1664, height: 936 });
});
