// Haalt één officiële CFM-jaargang op en pint de bron voor de generieke importvoorziening (docs/CFM-DOORLOPEND.md §6):
//   npx tsx scripts/study-content/fetch-cfm-volume.ts --slug <handboekslug> --dir data/study-content/cfm-2027-nl [--lang nld]
// Schrijft per les source/<sleutel>.json, source-lock.json (sha256 per bestand) en media-lock.json (sha256, type en afmetingen
// per afbeelding) en drukt de lesregels voor het manifest af (officiële begin- en einddatum uit de inhoudsopgave, nooit uit een
// weekpatroon berekend). Er wordt niets in de database gezet en niets gepubliceerd; het resultaat gaat via een gewone PR en de
// beheerder keurt de snapshot daarna goed in "Content opnieuw laden".
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { cfmSourceHash, cfmSourceUrl } from "../../src/lib/studyContent/cfm2026Adapter";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const slug = args.get("slug"), dir = args.get("dir"), lang = args.get("lang") ?? "nld";
if (!slug || !dir || !/^[a-z0-9-]+$/.test(slug) || !/^data\/study-content\/[a-z0-9-]+$/.test(dir)) throw new Error("Gebruik: --slug <handboekslug> --dir data/study-content/<map>");

const HOST = "https://www.churchofjesuschrist.org";
const api = (uri: string) => `${HOST}/study/api/v3/language-pages/type/content?lang=${lang}&uri=${uri}`;
const MONTHS: Record<string, number> = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 };
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(uri: string) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(api(uri), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
    if (response.ok) return (await response.json()) as { uri: string; restricted: number | boolean; meta: { title: string; pageAttributes: Record<string, string> }; content: { body: string } };
    if (attempt === 4 || (response.status < 500 && response.status !== 429)) throw new Error(`HTTP ${response.status} voor ${uri}`);
    await delay(1000 * attempt);
  }
  throw new Error("onbereikbaar");
}

const toc = await getJson(`/manual/${slug}/000-contents`);
// De weeklessen zijn de pagina's met een tweecijferige sleutel; bijlagen (00a, 53-appendix, …) en leeshulpen (31a, 48a) hebben
// geen officiële lesweek en horen niet in de weekkalender.
const keys = [...new Set([...toc.content.body.matchAll(new RegExp(`/study/manual/${slug}/(\\d{2})\\?`, "g"))].map((m) => m[1]))].filter((k) => k !== "00");
if (!keys.length) throw new Error("Geen lessen gevonden in de inhoudsopgave");

type Lesson = { key: string; title: string; start: string; end: string; refs: string };
const lessons: Lesson[] = [];
const files = new Map<string, string>();
const volumeYear = Number(/(\d{4})$/.exec(slug)?.[1]);
let year = volumeYear, previousMonth = 0, first = true;
for (const key of keys) {
  const data = await getJson(`/manual/${slug}/${key}`);
  const title = data.meta.title;
  const match = /^(\d{1,2})(?:\s+([a-z]+))?\s*[–-]\s*(\d{1,2})\s+([a-z]+)\.\s*(.*)$/i.exec(title) ?? /^(\d{1,2})\s+([a-z]+)\s*[–-]\s*(\d{1,2})\s+([a-z]+)[.:]\s*(.*)$/i.exec(title);
  if (!match) throw new Error(`Weekperiode niet te lezen uit de titel van les ${key}: ${title}`);
  const [, d1, m1raw, d2, m2raw] = match;
  const m2 = MONTHS[m2raw.toLowerCase()], m1 = m1raw ? MONTHS[m1raw.toLowerCase()] : m2;
  if (!m1 || !m2) throw new Error(`Onbekende maand in les ${key}: ${title}`);
  // Het jaar volgt uit de volgorde: de eerste week kan in december van het vorige jaar beginnen; daarna loopt het jaar op bij een nieuwe januari.
  if (first) { if (m1 === 12 && m2 === 1) year = volumeYear - 1; first = false; }
  else if (m1 < previousMonth) year += 1;
  const startYear = year; if (m1 === 12 && m2 === 1) year += 1;
  previousMonth = m2;
  const day = (y: number, m: number, d: string) => `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`;
  const start = day(startYear, m1, d1), end = day(year, m2, d2);
  const refs = title.replace(/^.*?:\s*/, "");
  lessons.push({ key, title, start, end, refs });
  const record = { uri: data.uri, restricted: data.restricted, title, attributes: data.meta.pageAttributes, body: data.content.body };
  files.set(key, JSON.stringify(record, null, 2) + "\n");
  await delay(300);
}
// Een lesweek begint de dag na het einde van de vorige: een gat of overlap betekent dat de datumlezing niet klopt.
for (let i = 1; i < lessons.length; i++) {
  const gap = (Date.parse(`${lessons[i].start}T00:00:00Z`) - Date.parse(`${lessons[i - 1].end}T00:00:00Z`)) / 86_400_000;
  if (gap !== 1) throw new Error(`Weken ${lessons[i - 1].key}→${lessons[i].key} sluiten niet aan (${lessons[i - 1].end} → ${lessons[i].start})`);
}
lessons.sort((a, b) => a.start.localeCompare(b.start));

// Media: elke afbeelding (en videoposter) uit de bron, gepind op checksum, type en afmetingen.
const mediaUrls = new Map<string, string>();
for (const [key, raw] of files) {
  const body = JSON.parse(raw).body as string;
  const lessonUrl = `${HOST}/study/manual/${slug}/${key}?lang=${lang}`;
  for (const m of body.matchAll(/<(?:img\b[^>]*?\bsrc|video\b[^>]*?\bposter)="([^"]+)"/g)) mediaUrls.set(cfmSourceUrl(m[1].replace(/&amp;/g, "&"), lessonUrl, lang), key);
}
const media = [];
for (const url of [...mediaUrls.keys()].sort()) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`Afbeelding niet beschikbaar (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const meta = await sharp(bytes).metadata();
  const mimeType = ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[meta.format ?? ""];
  if (!mimeType || !meta.width || !meta.height) throw new Error(`Onbekend afbeeldingstype: ${url}`);
  media.push({ url, file: createHash("sha256").update(url).digest("hex"), checksum: createHash("sha256").update(bytes).digest("hex"), mimeType, width: meta.width, height: meta.height, byteSize: bytes.length });
  await delay(150);
}

const root = path.join(process.cwd(), dir);
await fs.mkdir(path.join(root, "source"), { recursive: true });
const lock: Record<string, string> = {};
for (const [key, raw] of files) { await fs.writeFile(path.join(root, "source", `${key}.json`), raw); lock[key] = cfmSourceHash(raw); }
await fs.writeFile(path.join(root, "source-lock.json"), JSON.stringify({ verifiedAt: new Date().toISOString().slice(0, 10), source: `${HOST}/study/manual/${slug}/000-contents?lang=${lang}`, lessons: Object.fromEntries(Object.entries(lock).sort()) }, null, 2) + "\n");
await fs.writeFile(path.join(root, "media-lock.json"), JSON.stringify(media, null, 2) + "\n");
console.log(`${lessons.length} lessen, ${media.length} afbeeldingen vastgelegd in ${dir}`);
console.log("Manifestregels ([sleutel, begin, einde, titel]):");
for (const l of lessons) console.log(`  ["${l.key}", "${l.start}", "${l.end}", ${JSON.stringify(l.refs)}],`);
