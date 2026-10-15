import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { decodeNotation } from "../src/lib/hymns/notation/decode";
import { buildMusicXml, DIVISIONS } from "../src/lib/hymns/notation/musicxml";
import { syllablesOf } from "../src/lib/hymns/notation/lyrics";
import { markableMeasure, measureIndexAt } from "../src/lib/hymns/notation/measureMap";
import { NOTATION_VERSION } from "../src/lib/hymns/notation/types";
import { parseHymnPrefs, DEFAULT_HYMN_PREFS } from "../src/lib/hymnPrefs";
import { navigationTarget } from "../src/components/hymns-poc/reading";
import { loadSheetData } from "../src/lib/hymns/library/server";

// Bladmuziek per couplet: de notatielaag, de lettergreepkoppeling, de MusicXML en de positiemapping. Alles zonder browser;
// het echte renderen (OpenSheetMusicDisplay) staat in scripts/hymns/e2e-sheet.mjs.

const root = process.cwd();
const DATA = path.join(root, "src/lib/hymns/library/data");
const json = (rel: string) => JSON.parse(readFileSync(path.join(DATA, rel), "utf8"));
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function load(number: number) {
  const link = json(`link/${String(number).padStart(3, "0")}.json`);
  const slug = String(link.compositionId).replace(/^comp:/, "");
  const notation = decodeNotation(json(`notation/${slug}.json`));
  return { link, notation };
}
function xmlFor(number: number, stanza: number) {
  const { link, notation } = load(number);
  const verse = syllablesOf(link.stanzas.find((s: { n: number }) => s.n === stanza));
  const chorus = link.chorus ? syllablesOf(link.chorus) : null;
  const syllables = [...(verse.syllables ?? []), ...(chorus?.syllables ?? [])];
  return { ...buildMusicXml(notation, { syllables }), syllables, notation };
}
const lyricsOf = (xml: string) => [...xml.matchAll(/<lyric[^>]*>[\s\S]*?<text>([^<]*)<\/text>/g)].map((m) => m[1]);
const withoutLyrics = (xml: string) => xml.replace(/<lyric[\s\S]*?<\/lyric>/g, "");

test("notatie: versie, maten en noten kloppen met de analysegegevens", () => {
  const { notation, link } = load(24);
  assert.equal(notation.version, NOTATION_VERSION);
  assert.ok(notation.measures.length >= 30);
  assert.ok(notation.notes.some((n) => n.staff === 0) && notation.notes.some((n) => n.staff === 1), "G- en F-balk aanwezig");
  const music = json(`music/${String(link.compositionId).replace(/^comp:/, "")}.json`);
  assert.equal(notation.notes.length, music.notes.length, "zelfde aantal noten als de analyse");
});

test("decode weigert een onbekende notatieversie", () => {
  const { notation } = load(24);
  assert.throws(() => decodeNotation({ ...json(`notation/${String(load(24).link.compositionId).replace(/^comp:/, "")}.json`), v: 999 }));
  assert.ok(notation);
});

test("lettergrepen: woordkoppeling gaat door, regelkoppeling wordt nooit tot lettergrepen verzonnen", () => {
  const ok = syllablesOf({ linking: "word", lines: [{ start: 0, words: [0, 1], syl: [[["E", 0], ["re", 1]], [["de", 2]]] }] });
  assert.equal(ok.syllables?.length, 3);
  assert.deepEqual(ok.syllables?.map((s) => s.syllabic), ["begin", "end", "single"]);
  const line = syllablesOf({ linking: "line", lines: [{ start: 0, words: [], syl: [] }] });
  assert.equal(line.syllables, null);
  assert.equal(line.problems[0].code, "regelkoppeling");
  assert.equal(syllablesOf(null).syllables, null);
  const merged = syllablesOf({ linking: "word", lines: [{ start: 0, words: [0], syl: [[["d'", 2], ["aard", 2]]] }] });
  assert.equal(merged.syllables?.length, 1, "twee lettergrepen op één noot (elisie) delen die noot");
  const back = syllablesOf({ linking: "word", lines: [{ start: 0, words: [0, 1], syl: [[["a", 4]], [["b", 1]]] }] });
  assert.equal(back.syllables, null, "niet-oplopende beats worden afgewezen");
});

test("MusicXML lofzang 24 couplet 1: sleutels, twee balken, fermate, tekst onder de noten, refrein erachter", () => {
  const r = xmlFor(24, 1);
  assert.deepEqual(r.problems, []);
  assert.equal(r.lyricsPlaced, r.syllables.length, "elke lettergreep hangt aan een noot");
  assert.match(r.xml, /<staves>2<\/staves>/);
  assert.match(r.xml, /<sign>G<\/sign>/);
  assert.match(r.xml, /<sign>F<\/sign>/);
  assert.match(r.xml, /<fermata/);
  assert.equal(r.measureCount, r.notation.measures.length);
  assert.ok(lyricsOf(r.xml).join(" ").includes("Heil"), "het refrein staat op hetzelfde blad");
});

test("MusicXML: couplet 2 heeft dezelfde noten als couplet 1 met andere tekst", () => {
  const a = xmlFor(24, 1);
  const b = xmlFor(24, 2);
  assert.deepEqual(b.problems, []);
  assert.equal(withoutLyrics(a.xml), withoutLyrics(b.xml));
  assert.notDeepEqual(lyricsOf(a.xml).slice(0, 5), lyricsOf(b.xml).slice(0, 5));
});

test("maatsommen: in elke maat blijft de cursor binnen de maatlengte en wordt nooit negatief (alle lofzangen)", () => {
  const files = readdirSync(path.join(DATA, "link")).filter((f) => f.endsWith(".json"));
  let checked = 0;
  for (const f of files) {
    const number = Number(f.slice(0, 3));
    const { link, notation } = load(number);
    void link;
    const { xml, problems, measureCount } = buildMusicXml(notation, { syllables: [] });
    assert.deepEqual(problems, [], `lofzang ${number}`);
    assert.equal(measureCount, notation.measures.length, `lofzang ${number}: aantal maten`);
    const bodies = xml.split("<measure ").slice(1);
    assert.equal(bodies.length, notation.measures.length);
    bodies.forEach((body, i) => {
      let cursor = 0;
      let max = 0;
      for (const m of body.matchAll(/<(note|backup|forward)>([\s\S]*?)<\/\1>/g)) {
        const dur = Number(/<duration>(\d+)<\/duration>/.exec(m[2])?.[1] ?? 0);
        if (m[1] === "backup") cursor -= dur;
        else if (m[1] === "forward") cursor += dur;
        else if (!/<chord\/>/.test(m[2])) cursor += dur;
        assert.ok(cursor >= 0, `lofzang ${number} maat ${i + 1}: cursor negatief`);
        max = Math.max(max, cursor);
      }
      const len = notation.measures[i].length * DIVISIONS;
      assert.ok(max <= len + 1, `lofzang ${number} maat ${i + 1}: ${max} > ${len}`);
    });
    checked++;
  }
  assert.ok(checked >= 170, `alleen ${checked} lofzangen met notatie`);
});

test("alle coupletten met woordkoppeling plaatsen elke lettergreep, anders is de status eerlijk", () => {
  let ok = 0;
  let notOk = 0;
  for (const f of readdirSync(path.join(DATA, "link"))) {
    const n = Number(f.slice(0, 3));
    const sheet = loadSheetData(n);
    if (!sheet) continue;
    for (const s of sheet.stanzas) {
      if (s.status === "ok") {
        assert.ok(s.lyrics && s.lyrics.length > 0, `lofzang ${n} couplet ${s.n}`);
        ok++;
      } else {
        assert.equal(s.lyrics, null, "geen tekst onder de noten zonder gevalideerde koppeling");
        assert.ok(s.reason);
        notOk++;
      }
    }
  }
  assert.ok(ok > 500, `ok=${ok}`);
  assert.ok(notOk >= 0);
});

test("positiemapping: beat naar maat, opmaat en buiten het blad geven geen markering", () => {
  const measures = [{ start: 0, length: 1 }, { start: 1, length: 2 }, { start: 3, length: 2 }];
  assert.equal(measureIndexAt(measures, 0), 0);
  assert.equal(measureIndexAt(measures, 0.99), 0);
  assert.equal(measureIndexAt(measures, 1), 1);
  assert.equal(measureIndexAt(measures, 4.5), 2);
  assert.equal(measureIndexAt(measures, 5), null);
  assert.equal(measureIndexAt(measures, -0.5), null);
  assert.equal(measureIndexAt(measures, Number.NaN), null);
  assert.equal(markableMeasure({ measures, beat: 1.5, reliable: true, validated: true }), 1);
  assert.equal(markableMeasure({ measures, beat: 1.5, reliable: false, validated: true }), null, "onzeker: geen markering");
  assert.equal(markableMeasure({ measures, beat: 1.5, reliable: true, validated: false }), null, "niet-gevalideerde gravure: geen markering");
  assert.equal(markableMeasure({ measures, beat: null, reliable: true, validated: true }), null);
});

test("voorkeuren: derde weergave en zoom blijven bewaard, rommel valt terug", () => {
  assert.equal(parseHymnPrefs(JSON.stringify({ view: "sheet", sheetZoom: 150 })).view, "sheet");
  assert.equal(parseHymnPrefs(JSON.stringify({ view: "sheet", sheetZoom: 150 })).sheetZoom, 150);
  assert.equal(parseHymnPrefs(JSON.stringify({ view: "sheet", sheetZoom: 333 })).sheetZoom, DEFAULT_HYMN_PREFS.sheetZoom);
  assert.equal(parseHymnPrefs(JSON.stringify({ view: "onzin" })).view, "stanza");
  assert.equal(parseHymnPrefs("{kapot").view, "stanza");
});

test("bladeren: in de bladmuziek is er geen regelnavigatie die de leesplek verspringt", () => {
  const state = { mode: "auto", line: null, stanza: null, note: null, navTick: 0 } as never;
  assert.equal(navigationTarget(state, 3, 3, 10, "sheet"), -1);
});

test("beveiliging: de bladmuziek-API is alleen voor wie Lofzangen mag openen en er staan geen losse bronbestanden in public", () => {
  const route = read("src/app/api/hymns/[number]/sheet/route.ts");
  assert.match(route, /hymnsApiAllowed\(\)/);
  assert.match(route, /status: 404/);
  assert.ok(route.indexOf("hymnsApiAllowed") < route.indexOf("loadSheetData"), "eerst toegang, dan pas gegevens");
  assert.equal(existsSync(path.join(root, "public/hymns")), false);
  assert.equal(existsSync(path.join(root, "public/notation")), false);
});

test("privacy: de notatielaag en de bladmuziekweergave bewaren en versturen niets", () => {
  for (const f of readdirSync(path.join(root, "src/lib/hymns/notation"))) {
    const src = read(`src/lib/hymns/notation/${f}`);
    assert.doesNotMatch(src, /\bfetch\(|localStorage|sessionStorage|indexedDB|WebSocket|XMLHttpRequest/, f);
  }
  const view = read("src/components/hymns-poc/SheetMusicView.tsx");
  assert.doesNotMatch(view, /\bfetch\(|localStorage|sessionStorage|indexedDB|WebSocket|AudioContext|getUserMedia/);
  assert.match(view, /import\("opensheetmusicdisplay"\)/, "de graveerbibliotheek wordt lazy geladen");
});

test("engine ongewijzigd: de bladmuziek raakt audio, herkenning, live en volgen niet", () => {
  for (const dir of ["audio", "recognize", "follow"]) {
    for (const f of readdirSync(path.join(root, "src/lib/hymns", dir))) {
      assert.doesNotMatch(read(`src/lib/hymns/${dir}/${f}`), /notation\//, `${dir}/${f} mag de notatielaag niet kennen`);
    }
  }
  assert.doesNotMatch(read("src/lib/hymns/live.ts"), /notation\//);
});
