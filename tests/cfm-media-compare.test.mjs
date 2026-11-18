import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { compareImages, jpegStructure } from "../scripts/study-content/compare-cfm-media.mjs";

// Synthetische, deterministische afbeelding met vlakken en een verloop: geen CFM-bronmateriaal.
async function scene({ width = 160, height = 90, patch = false } = {}) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    raw[i] = (x * 255) / width; raw[i + 1] = (y * 255) / height; raw[i + 2] = ((x + y) % 64) * 4;
    if (patch && x > 60 && x < 120 && y > 20 && y < 70) { raw[i] = 250; raw[i + 1] = 20; raw[i + 2] = 20; }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } });
}

describe("CFM-mediavergelijking (alleen lezen)", () => {
  it("noemt dezelfde pixels met andere bytecodering inhoudelijk gelijk", async () => {
    const base = await scene();
    const a = await base.clone().jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    const decoded = await sharp(a).raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(decoded.data, { raw: decoded.info }).jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
    assert.notDeepEqual(a, b);
    const result = await compareImages(a, b);
    assert.equal(result.verdict, "inhoudelijk gelijk", JSON.stringify(result.metrics));
  });

  it("noemt een zichtbaar ander vlak inhoudelijk gewijzigd en wijst het gebied aan", async () => {
    const a = await (await scene()).jpeg({ quality: 90 }).toBuffer();
    const b = await (await scene({ patch: true })).jpeg({ quality: 90 }).toBuffer();
    const result = await compareImages(a, b);
    assert.equal(result.verdict, "inhoudelijk gewijzigd");
    assert.ok(result.metrics.worstBlock && result.metrics.maxBlockMeanDiff > 12);
  });

  it("noemt andere afmetingen gewijzigd, ook bij dezelfde inhoud", async () => {
    const a = await (await scene({ width: 160, height: 90 })).jpeg().toBuffer();
    const b = await (await scene({ width: 161, height: 90 })).jpeg().toBuffer();
    assert.equal((await compareImages(a, b)).verdict, "inhoudelijk gewijzigd");
  });

  it("leest JPEG-structuur zonder pixels te decoderen", async () => {
    const jpeg = await (await scene()).jpeg({ progressive: true }).toBuffer();
    const structure = jpegStructure(jpeg);
    assert.equal(structure.progressive, true);
    assert.ok(structure.quantTables >= 1);
  });

  it("weigert een uitvoermap buiten /tmp", async () => {
    const { run } = await import("../scripts/study-content/compare-cfm-media.mjs");
    await assert.rejects(() => run({ out: "/home/user/uit" }), /onder \/tmp/);
  });
});
