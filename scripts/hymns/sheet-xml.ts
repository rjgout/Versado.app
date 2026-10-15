// Bouwt de MusicXML van een lofzang-couplet (zoals de app dat doet) en schrijft die naar een bestand, voor de renderproef en de rapportage.
//   npx tsx scripts/hymns/sheet-xml.ts <nummer> <couplet> <uitvoer.xml>
import fs from "node:fs";
import path from "node:path";
import { decodeNotation } from "../../src/lib/hymns/notation/decode";
import { buildMusicXml } from "../../src/lib/hymns/notation/musicxml";
import { syllablesOf } from "../../src/lib/hymns/notation/lyrics";

const DATA = path.join(process.cwd(), "src/lib/hymns/library/data");
const [numberArg, stanzaArg, outArg] = process.argv.slice(2);
const pad = numberArg.padStart(3, "0");
const link = JSON.parse(fs.readFileSync(path.join(DATA, `link/${pad}.json`), "utf8"));
const slug = String(link.compositionId).replace(/^comp:/, "");
const notation = decodeNotation(JSON.parse(fs.readFileSync(path.join(DATA, `notation/${slug}.json`), "utf8")));
const stanza = link.stanzas.find((s: { n: number }) => s.n === Number(stanzaArg));
const verse = syllablesOf(stanza);
const chorus = syllablesOf(link.chorus);
const syllables = [...(verse.syllables ?? []), ...(chorus.syllables ?? [])];
const result = buildMusicXml(notation, { syllables });
fs.writeFileSync(outArg, result.xml);
console.log(JSON.stringify({ number: Number(numberArg), stanza: Number(stanzaArg), measures: result.measureCount, lyricsPlaced: result.lyricsPlaced, syllables: syllables.length, problems: [...verse.problems, ...chorus.problems, ...result.problems].slice(0, 10) }));
