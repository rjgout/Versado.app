// Alleen-lezen vergelijking van gepinde CFM-afbeeldingen met de huidige officiële bron.
// Wijzigt nooit een lock, hash of databestand: het schrijft uitsluitend een rapport onder een eigen /tmp-map.
//
//   node scripts/study-content/compare-cfm-media.mjs --out /tmp/cfm-vergelijking \
//     [--old-archive pinned-assets.json.gz] [--old-dir <map met oude bestanden>] [--only <bestands-id-begin,...>]
//
// Oude bytes tellen alleen mee als hun sha256 exact de gepinde (verwachte) hash is: zo is bewezen dat het
// werkelijk de oude bytes zijn. Zonder zulke bytes is het oordeel "niet vast te stellen"; er wordt nooit
// aangenomen dat een afbeelding gelijk is op grond van afmetingen of bestandsgrootte alleen.
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const THRESHOLDS = Object.freeze({
  // Herencodering-ruis: vrijwel geen verschil in gedecodeerde pixels.
  equalMinPsnr: 38,
  equalMaxBlockMeanDiff: 4,
  equalMaxStrongFraction: 0.001,
  // Duidelijk andere inhoud.
  changedMaxPsnr: 30,
  changedMinBlockMeanDiff: 12,
  strongDelta: 32,
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Loopt de JPEG-markers door en geeft de structuur zonder pixels te decoderen. */
export function jpegStructure(bytes) {
  const segments = [];
  let progressive = null;
  let quantTables = 0;
  let i = 2;
  while (i + 4 <= bytes.length && bytes[0] === 0xff && bytes[1] === 0xd8) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const length = bytes.readUInt16BE(i + 2);
    if (marker >= 0xe0 && marker <= 0xef) segments.push({ marker: `APP${marker - 0xe0}`, bytes: length + 2 });
    if (marker === 0xfe) segments.push({ marker: "COM", bytes: length + 2 });
    if (marker === 0xdb) quantTables++;
    if (marker === 0xc0 || marker === 0xc1) progressive = false;
    if (marker === 0xc2) progressive = true;
    i += 2 + length;
  }
  return { progressive, quantTables, segments };
}

async function decode(bytes) {
  const image = sharp(bytes, { failOn: "error" });
  const meta = await image.metadata();
  const { data, info } = await image.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return { meta, data, info, structure: meta.format === "jpeg" ? jpegStructure(bytes) : null };
}

const metaSummary = (d) => ({
  format: d.meta.format, width: d.info.width, height: d.info.height, channels: d.info.channels,
  space: d.meta.space, density: d.meta.density ?? null, chromaSubsampling: d.meta.chromaSubsampling ?? null,
  iccBytes: d.meta.icc?.length ?? 0, exifBytes: d.meta.exif?.length ?? 0, xmpBytes: d.meta.xmp?.length ?? 0,
  structure: d.structure,
});

/** Vergelijkt twee afbeeldingen op gedecodeerde pixels; geeft ruwe maten en een oordeel met reden. */
export async function compareImages(oldBytes, newBytes) {
  const [a, b] = await Promise.all([decode(oldBytes), decode(newBytes)]);
  const result = { old: metaSummary(a), current: metaSummary(b), bytes: { old: oldBytes.length, current: newBytes.length } };
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== b.info.channels) {
    return { ...result, verdict: "inhoudelijk gewijzigd", reason: "Afmetingen of kanalen verschillen.", metrics: null };
  }
  const { width, height, channels } = a.info;
  let sumAbs = 0, sumSq = 0, maxAbs = 0, strong = 0;
  const block = 16, cols = Math.ceil(width / block), rows = Math.ceil(height / block);
  const blockSum = new Float64Array(cols * rows), blockN = new Uint32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = (y * width + x) * channels;
      let pixelAbs = 0;
      for (let c = 0; c < channels; c++) {
        const delta = Math.abs(a.data[base + c] - b.data[base + c]);
        sumAbs += delta; sumSq += delta * delta; pixelAbs += delta;
        if (delta > maxAbs) maxAbs = delta;
        if (delta > THRESHOLDS.strongDelta) strong++;
      }
      const at = Math.floor(y / block) * cols + Math.floor(x / block);
      blockSum[at] += pixelAbs / channels; blockN[at]++;
    }
  }
  const samples = width * height * channels;
  const mse = sumSq / samples;
  const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
  let maxBlockMeanDiff = 0, worstBlock = null;
  for (let k = 0; k < blockSum.length; k++) {
    const mean = blockSum[k] / blockN[k];
    if (mean > maxBlockMeanDiff) { maxBlockMeanDiff = mean; worstBlock = { x: (k % cols) * block, y: Math.floor(k / cols) * block, size: block }; }
  }
  const metrics = {
    pixelIdentical: maxAbs === 0, maxAbsDelta: maxAbs, meanAbsDelta: +(sumAbs / samples).toFixed(4),
    psnrDb: psnr === Infinity ? null : +psnr.toFixed(2), strongDeltaFraction: +(strong / samples).toFixed(6),
    maxBlockMeanDiff: +maxBlockMeanDiff.toFixed(3), worstBlock,
  };
  let verdict, reason;
  if (metrics.pixelIdentical) { verdict = "inhoudelijk gelijk"; reason = "Gedecodeerde pixels zijn identiek; alleen de bytecodering verschilt."; }
  else if (psnr >= THRESHOLDS.equalMinPsnr && maxBlockMeanDiff <= THRESHOLDS.equalMaxBlockMeanDiff && metrics.strongDeltaFraction <= THRESHOLDS.equalMaxStrongFraction) {
    verdict = "inhoudelijk gelijk"; reason = "Alleen herencoderingsruis: hoge PSNR, geen lokaal afwijkend gebied.";
  } else if (psnr < THRESHOLDS.changedMaxPsnr || maxBlockMeanDiff > THRESHOLDS.changedMinBlockMeanDiff) {
    verdict = "inhoudelijk gewijzigd"; reason = "Lage PSNR of een lokaal duidelijk afwijkend gebied.";
  } else { verdict = "niet vast te stellen"; reason = "Tussen de drempels in: visuele beoordeling nodig."; }
  return { ...result, verdict, reason, metrics };
}

const HOSTS = new Set(["www.churchofjesuschrist.org"]);
async function fetchOfficial(source) {
  let url = new URL(source);
  for (let hop = 0; hop <= 3; hop++) {
    if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.username || url.password || url.port) throw Error("CFM_COMPARE_HOST");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(45000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get("location") ?? "", url); continue; }
    if (!response.ok) throw Error(`CFM_COMPARE_HTTP:${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 10485760) throw Error("CFM_COMPARE_SIZE");
    return { bytes, contentType: response.headers.get("content-type") };
  }
  throw Error("CFM_COMPARE_REDIRECTS");
}

async function loadOldCandidates({ archivePath, oldDir }) {
  const byHash = new Map();
  const add = (bytes, origin) => { const hash = sha256(bytes); if (!byHash.has(hash)) byHash.set(hash, { bytes, origin }); };
  if (archivePath) {
    const archive = JSON.parse(zlib.gunzipSync(await fs.readFile(archivePath)).toString("utf8"));
    for (const [name, value] of Object.entries(archive.files)) if (name.startsWith("media/")) add(Buffer.from(value, "base64"), `archief ${path.basename(archivePath)}`);
  }
  if (oldDir) {
    for (const name of await fs.readdir(oldDir)) {
      const full = path.join(oldDir, name);
      if ((await fs.stat(full)).isFile()) add(await fs.readFile(full), `map ${path.basename(oldDir)}`);
    }
  }
  return byHash;
}

export async function run({ out, archivePath, oldDir, only }) {
  if (!out || !path.isAbsolute(out) || !out.startsWith("/tmp/")) throw Error("--out moet een absolute eigen map onder /tmp zijn.");
  const lock = (await Promise.all(["cfm-2026-nl", "cfm-2027-nl"].map(async (dir) => JSON.parse(await fs.readFile(`data/study-content/${dir}/media-lock.json`, "utf8"))))).flat();
  const unique = [...new Map(lock.map((entry) => [entry.file, entry])).values()].filter((entry) => !only || only.some((prefix) => entry.file.startsWith(prefix)));
  const olds = await loadOldCandidates({ archivePath, oldDir });
  await fs.mkdir(path.join(out, "afbeeldingen"), { recursive: true });
  const rows = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < unique.length) {
      const entry = unique[next++];
      let current;
      try { current = await fetchOfficial(entry.url); } catch (error) { rows.push({ file: entry.file, status: "bron onbereikbaar", error: error.message }); continue; }
      const currentHash = sha256(current.bytes);
      if (currentHash === entry.checksum) continue; // Geen afwijking: niets te vergelijken.
      const row = { file: entry.file, url: entry.url, expectedSha256: entry.checksum, currentSha256: currentHash, pinnedBytes: entry.byteSize, currentBytes: current.bytes.length, currentContentType: current.contentType };
      const old = olds.get(entry.checksum);
      if (!old) {
        const decoded = await decode(current.bytes);
        Object.assign(row, { oldAvailable: false, verdict: "niet vast te stellen", reason: "Oude bytes met de gepinde hash zijn niet beschikbaar; alleen structuur en afmetingen van de huidige afbeelding zijn gecontroleerd.", current: metaSummary(decoded), dimensionsMatchLock: decoded.info.width === entry.width && decoded.info.height === entry.height });
      } else {
        Object.assign(row, { oldAvailable: true, oldOrigin: old.origin, ...(await compareImages(old.bytes, current.bytes)) });
        const stem = entry.file.slice(0, 12);
        const [a, b] = await Promise.all([sharp(old.bytes).toBuffer(), sharp(current.bytes).toBuffer()]);
        const [ra, rb] = await Promise.all([sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true }), sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true })]);
        if (ra.info.width === rb.info.width && ra.info.height === rb.info.height) {
          const diff = Buffer.alloc(ra.data.length);
          for (let k = 0; k < diff.length; k++) diff[k] = Math.min(255, Math.abs(ra.data[k] - rb.data[k]) * 16); // 16× uitvergroot
          const { width, height, channels } = ra.info;
          const panel = (data) => sharp(data, { raw: { width, height, channels } }).png().toBuffer();
          const sheet = await sharp({ create: { width: width * 3 + 20, height, channels: 3, background: "#ffffff" } })
            .composite([{ input: await panel(ra.data), left: 0, top: 0 }, { input: await panel(rb.data), left: width + 10, top: 0 }, { input: await panel(diff), left: width * 2 + 20, top: 0 }]).png().toBuffer();
          await fs.writeFile(path.join(out, "afbeeldingen", `${stem}-oud-nieuw-verschil16x.png`), sheet);
          row.contactSheet = `afbeeldingen/${stem}-oud-nieuw-verschil16x.png`;
        }
      }
      rows.push(row);
    }
  }));
  rows.sort((x, y) => x.file.localeCompare(y.file));
  const summary = { checked: unique.length, deviations: rows.length, verdicts: rows.reduce((acc, r) => ({ ...acc, [r.verdict ?? r.status]: (acc[r.verdict ?? r.status] ?? 0) + 1 }), {}), thresholds: THRESHOLDS, locksTouched: false };
  await fs.writeFile(path.join(out, "rapport.json"), JSON.stringify({ summary, rows }, null, 2));
  return { summary, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
  const result = await run({ out: arg("--out"), archivePath: arg("--old-archive"), oldDir: arg("--old-dir"), only: arg("--only")?.split(",") });
  console.log(JSON.stringify(result.summary, null, 2));
  for (const row of result.rows) console.log(`${row.file.slice(0, 12)}  ${row.verdict ?? row.status}  ${row.metrics ? `PSNR ${row.metrics.psnrDb ?? "∞"} dB, max Δ ${row.metrics.maxAbsDelta}, blok ${row.metrics.maxBlockMeanDiff}` : row.reason ?? ""}`);
}
