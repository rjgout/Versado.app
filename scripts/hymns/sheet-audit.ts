// Bouwt voor elke lofzang met notatie en voor elk couplet de bladmuziek en telt wat lukt. Basis voor het kwaliteitsrapport
// (docs/hymns/18-BLADMUZIEK.md): een geslaagde render zonder tekstvalidatie telt niet als gevalideerd coupletblad.
//   npx tsx scripts/hymns/sheet-audit.ts [uitvoer.json]
import fs from "node:fs";
import path from "node:path";
import { decodeNotation } from "../../src/lib/hymns/notation/decode";
import { buildMusicXml } from "../../src/lib/hymns/notation/musicxml";
import { syllablesOf } from "../../src/lib/hymns/notation/lyrics";

const DATA = path.join(process.cwd(), "src/lib/hymns/library/data");
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf8"));
const rows: Record<string, unknown>[] = [];
for (const h of manifest.hymns) {
  const pad = String(h.number).padStart(3, "0");
  const row: Record<string, unknown> = { number: h.number, title: h.title, pdf: !!h.pdfUrl, hasChorus: h.hasChorus };
  const linkPath = path.join(DATA, `link/${pad}.json`);
  if (!fs.existsSync(linkPath)) { row.status = "geen-koppeling"; rows.push(row); continue; }
  const link = JSON.parse(fs.readFileSync(linkPath, "utf8"));
  const slug = String(link.compositionId).replace(/^comp:/, "");
  const nPath = path.join(DATA, `notation/${slug}.json`);
  if (!fs.existsSync(nPath)) { row.status = "geen-notatie"; rows.push(row); continue; }
  row.notation = true;
  const notation = decodeNotation(JSON.parse(fs.readFileSync(nPath, "utf8")));
  const chorus = link.chorus ? syllablesOf(link.chorus) : null;
  const stanzas = [];
  for (const s of link.stanzas) {
    const verse = syllablesOf(s);
    const syl = verse.syllables ? [...verse.syllables, ...(chorus?.syllables ?? [])] : [];
    const r = buildMusicXml(notation, { syllables: syl });
    const textOk = !!verse.syllables && r.problems.length === 0 && r.lyricsPlaced === syl.length && (!link.chorus || !!chorus?.syllables);
    stanzas.push({ n: s.n, linking: s.linking, textOk, placed: r.lyricsPlaced, syllables: syl.length, problems: [...verse.problems, ...r.problems].map((p) => p.code) });
  }
  row.stanzas = stanzas;
  row.chorusLinked = chorus ? !!chorus.syllables : null;
  rows.push(row);
}
const out = process.argv[2];
if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1));
const withN = rows.filter((r) => r.notation);
const all = withN.filter((r) => (r.stanzas as { textOk: boolean }[]).every((s) => s.textOk));
const first = withN.filter((r) => (r.stanzas as { textOk: boolean }[])[0]?.textOk);
const codes: Record<string, number> = {};
for (const r of withN) for (const s of r.stanzas as { problems: string[] }[]) for (const c of s.problems) codes[c] = (codes[c] ?? 0) + 1;
console.log(JSON.stringify({ lofzangen: rows.length, metPdf: rows.filter((r) => r.pdf).length, metNotatie: withN.length, couplet1Ok: first.length, alleCoupletten: all.length, problemen: codes }));
