import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { POC_LIBRARY, resolveHymn } from "../src/lib/hymns/library";
import type { DisplayCursor } from "../src/lib/hymns/follow/display";
import type { FollowSnapshot } from "../src/lib/hymns/follow/session";
import type { LiveState } from "../src/lib/hymns/live";
import { parseHymnPrefs, DEFAULT_HYMN_PREFS } from "../src/lib/hymnPrefs";
import { activeSeq, activeWordFor, describeStatus, lyricSequence, scrollDelta } from "../src/components/hymns-poc/viewModel";

// De Lofzangen-weergave: statusteksten, de regels van karaoke, het scrollgedrag en de voorkeuren. Alles zonder
// browser; de echte weergave (focus mode, 320 px, 200% tekst, microfoon) staat in scripts/hymns/e2e-browser.mjs.

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const hymn = resolveHymn(POC_LIBRARY, 82)!;

function snap(partial: { status?: FollowSnapshot["status"]; phase?: "prelude" | "singing" | "interlude"; waiting?: boolean; lapUncertain?: boolean }): FollowSnapshot {
  return {
    time: 10,
    status: partial.status ?? "locked",
    confidence: 1,
    paused: false,
    position: 3,
    measure: 1,
    bpm: 90,
    lap: 0,
    lapUncertain: partial.lapUncertain ?? false,
    displayPosition: 3,
    positionSource: "measured",
    estimatedSeconds: 0,
    stanza: 1,
    cursor: { section: "verse", line: -1, word: null, frozen: false, estimated: false },
    phase: {
      phase: partial.phase ?? "prelude",
      entry: "mid",
      waiting: partial.waiting ?? false,
      sungLaps: 0,
      coverage: 0,
      startReason: null,
      startEvidence: [],
      levelStepDb: 0,
      interludes: 0,
    },
  };
}

const live = (patch: Partial<LiveState>): LiveState => ({ stage: "following", hymn, choice: "manual", recognition: null, snapshot: null, backlog: 0, needHymn: null, diag: { frames: 0, lastFrameSilent: null, lastRmsDb: null, candidates: 0, awaitingCandidates: false }, ...patch });

test("status: voorspel, volgt muziek, tussenspel en onzekerheid zijn te onderscheiden", () => {
  assert.equal(describeStatus("idle", live({ stage: "idle", hymn: null })), null);
  assert.equal(describeStatus("listening", live({ snapshot: snap({ phase: "prelude" }) }))?.label, "Voorspel");
  assert.equal(describeStatus("listening", live({ snapshot: snap({ phase: "singing" }) }))?.label, "Volgt muziek");
  assert.equal(describeStatus("listening", live({ snapshot: snap({ phase: "interlude" }) }))?.label, "Tussenspel");
  assert.equal(describeStatus("listening", live({ snapshot: snap({ phase: "singing", status: "uncertain" }) }))?.tone, "warn");
  assert.equal(describeStatus("listening", live({ snapshot: snap({ phase: "singing", status: "lost" }) }))?.tone, "danger");
  assert.equal(describeStatus("listening", live({ snapshot: snap({ phase: "prelude", status: "acquiring" }) }))?.label, "Luisteren…");
  const waiting = describeStatus("listening", live({ snapshot: snap({ phase: "prelude", waiting: true }) }));
  assert.match(waiting!.hint ?? "", /Zang begint/);
  // tijdens het herkennen toont het herkenningsscherm zelf één rustige status; de kop herhaalt die niet
  assert.equal(describeStatus("listening", live({ stage: "recognizing", hymn: null })), null);
});

test("coupletreeks: couplet gevolgd door refrein; geen refrein bij hymne 82", () => {
  const stanza = hymn.text.stanzas[0];
  const seq = lyricSequence(hymn.text, stanza);
  assert.equal(seq.length, stanza.lines.length);
  assert.ok(seq.every((l) => l.section === "verse"));
  const h24 = resolveHymn(POC_LIBRARY, 24)!;
  const s24 = lyricSequence(h24.text, h24.text.stanzas[0]);
  assert.equal(s24.length, h24.text.stanzas[0].lines.length + h24.text.chorus!.lines.length);
  assert.equal(s24[s24.length - 1].section, "chorus");
});

test("actieve regel: de index in de doorlopende reeks, -1 zolang er niets actief is", () => {
  const seq = lyricSequence(hymn.text, hymn.text.stanzas[0]);
  const cursor = (line: number): DisplayCursor => ({ section: "verse", line, word: 0, frozen: false, estimated: false });
  assert.equal(activeSeq(seq, cursor(2)), 2);
  assert.equal(activeSeq(seq, cursor(-1)), -1);
  assert.equal(activeSeq(seq, undefined), -1);
});

test("woordmarkering: alleen met woordkoppeling; zonder (couplet 5 van 82) hoort de markering bij de regel", () => {
  const seq1 = lyricSequence(hymn.text, hymn.text.stanzas.find((s) => s.n === 1));
  const cursor: DisplayCursor = { section: "verse", line: 0, word: 2, frozen: false, estimated: false };
  assert.equal(activeWordFor(seq1[0], cursor, hymn.text.stanzas.find((s) => s.n === 1), hymn.text), 2);
  assert.equal(activeWordFor(seq1[1], cursor, hymn.text.stanzas.find((s) => s.n === 1), hymn.text), null, "andere regel kreeg een woord");
  const five = hymn.text.stanzas.find((s) => s.n === 5)!;
  assert.equal(five.linking, "line");
  assert.equal(activeWordFor(lyricSequence(hymn.text, five)[0], cursor, five, hymn.text), null, "verzonnen woordtiming bij regelkoppeling");
});

test("scrollen: past het couplet, dan nooit; staat de regel in beeld, dan niet; anders rustig naar ~30%, zodat er ruim vooruit gelezen kan worden", () => {
  const view = { viewTop: 80, viewBottom: 700 };
  assert.equal(scrollDelta({ ...view, lineTop: 600, lineBottom: 640, contentHeight: 400 }), 0, "hele couplet past, toch gescrold");
  assert.equal(scrollDelta({ ...view, lineTop: 300, lineBottom: 340, contentHeight: 1200 }), 0, "regel stond al in beeld");
  const down = scrollDelta({ ...view, lineTop: 800, lineBottom: 840, contentHeight: 1200 });
  assert.ok(down > 400 && down < 700, `naar beneden: ${down}`);
  const up = scrollDelta({ ...view, lineTop: 20, lineBottom: 60, contentHeight: 1200 });
  assert.ok(up < 0);
  assert.equal(scrollDelta({ viewTop: 80, viewBottom: 70, lineTop: 0, lineBottom: 10, contentHeight: 900 }), 0, "geen zichtbaar gebied");
});

test("voorkeuren: standaardwaarden, geldige keuzes en kapotte opslag", () => {
  assert.deepEqual(parseHymnPrefs(null), DEFAULT_HYMN_PREFS);
  assert.deepEqual(parseHymnPrefs("{kapot"), DEFAULT_HYMN_PREFS);
  assert.deepEqual(parseHymnPrefs(JSON.stringify({ view: "karaoke", size: "xlarge", autoScroll: false, calm: true })), { view: "karaoke", size: "xlarge", autoScroll: false, calm: true, sheetZoom: 100 });
  assert.deepEqual(parseHymnPrefs(JSON.stringify({ view: "iets", size: 5, autoScroll: "ja" })), DEFAULT_HYMN_PREFS);
  assert.equal(DEFAULT_HYMN_PREFS.view, "stanza", "volledig couplet is de standaard");
});

test("voorkeuren: een eigen laag buiten de engine die alleen vijf weergavekeuzes bewaart", () => {
  const prefs = read("src/lib/hymnPrefs.ts");
  assert.match(prefs, /localStorage/);
  assert.equal(/fetch\(|sessionStorage|indexedDB|getUserMedia|AudioContext/.test(prefs), false);
  assert.deepEqual([...prefs.matchAll(/^\s{2}(view|size|autoScroll|calm|sheetZoom):/gm)].map((m) => m[1]).sort(), ["autoScroll", "calm", "sheetZoom", "size", "view"]);
  // de engine en de meezingcomponenten importeren de opslag niet rechtstreeks; alleen de client gebruikt de hook
  for (const file of ["src/lib/hymns/live.ts", "src/lib/hymns/follow/session.ts", "src/components/hymns-poc/LyricsView.tsx", "src/components/hymns-poc/TechnicalPanel.tsx"]) {
    // alleen het type van een keuze (import type) is toegestaan, nooit de opslag zelf
    assert.equal(/import\s+(?!type\b)[^;]*hymnPrefs/.test(read(file)), false, `${file} importeert de voorkeurenopslag`);
  }
});

test("ontwerp: actief woord = accentkleur zonder achtergrond, geen scrollIntoView, geen vaste px-tekst", () => {
  const lyrics = read("src/components/hymns-poc/LyricsView.tsx");
  assert.match(lyrics, /text-vs-accent/);
  assert.equal(/bg-vs-accent|bg-vs-accent-soft/.test(lyrics), false, "achtergrondmarkering achter het woord");
  assert.match(lyrics, /hymn-word/);
  for (const file of ["LyricsView.tsx", "HymnsPocClient.tsx", "useReadingScroll.ts", "TechnicalPanel.tsx"]) {
    const code = read(`src/components/hymns-poc/${file}`);
    assert.equal(/scrollIntoView/.test(code), false, `${file} gebruikt scrollIntoView`);
    assert.equal(/window\.(scrollBy|scrollTo|scroll)\(/.test(code), false, `${file} scrolt het venster`);
    assert.equal(/text-\[\d+px\]/.test(code), false, `${file} gebruikt een px-tekstgrootte`);
  }
  const css = read("src/app/globals.css");
  assert.match(css, /\.hymn-word::after[\s\S]*?font-weight: 700/);
});

test("weergavewissel raakt de engine niet: de keuzeknoppen roepen alleen setPrefs aan", () => {
  const client = read("src/components/hymns-poc/HymnsPocClient.tsx");
  assert.match(client, /setPrefs\(\{ view: v\.id \}\)/);
  assert.match(client, /setPrefs\(\{ size: s\.id \}\)/);
  assert.match(client, /data-hymns-view-toggle[\s\S]*?setPrefs\(\{ view: nextView \}\)/, "snelle weergavewissel in de kop");
  assert.match(client, /const nextView: HymnView = prefs\.view === "stanza" \? "karaoke" : prefs\.view === "karaoke" \? "sheet" : "stanza"/, "drieweg-wissel couplet, karaoke, bladmuziek");
  // geen herstart van de engine of microfoon bij een voorkeur
  const prefHandlers = [...client.matchAll(/onChange=\{[^}]*setPrefs[^}]*\}/g)].map((m) => m[0]).join("\n");
  assert.equal(/restart|startListening|followHymn|startRecognizing|MicListener/.test(prefHandlers), false);
  assert.equal(/restart\(\)/.test(client.slice(client.indexOf("setPrefs({ view"))), false, "voorkeurscode herstart de engine");
});

test("layout: één werkruimte met flex-kolom, een eigen scrollende leesruimte en een bediening die niet over de tekst ligt", () => {
  const client = read("src/components/hymns-poc/HymnsPocClient.tsx");
  const css = read("src/app/globals.css");
  assert.match(client, /className="hymns-workspace"/);
  // de bedieningszone is een gewone flex-kind (shrink-0), geen sticky of fixed laag
  assert.match(client, /data-hymns-controls className="flex shrink-0/);
  assert.match(client, /data-hymns-bar className="ml-auto flex/);
  for (const file of ["HymnsPocClient.tsx", "LyricsView.tsx", "TechnicalPanel.tsx"]) {
    const code = read(`src/components/hymns-poc/${file}`);
    assert.equal(/\b(sticky|fixed|absolute inset)\b/.test(code.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n")), false, `${file} gebruikt sticky/fixed positionering`);
  }
  assert.match(css, /\.hymns-workspace\s*\{[^}]*100dvh[^}]*--header-height/s, "werkruimte rekent met de gemeten terugbalk");
  assert.match(css, /\.hymns-workspace\s*\{[^}]*--vs-safe-area-bottom/s, "werkruimte houdt de safe area onderaan vrij");
  assert.match(css, /\[data-shell-mode="focus"\] main:has\(\.hymns-workspace\)/);
  // de leesruimte scrolt zelf en is toetsenbordbereikbaar
  assert.match(client, /data-hymns-scroll/);
  assert.match(client, /role="region"[\s\S]{0,120}tabIndex=\{0\}/);
});

test("instellingen, couplettvolgorde en technische gegevens openen als paneel over de weergave, niet inline", () => {
  const client = read("src/components/hymns-poc/HymnsPocClient.tsx");
  assert.match(client, /sheet === "settings"/);
  assert.match(client, /sheet === "order"/);
  assert.match(client, /sheet === "tech" && isAdmin/);
  assert.equal(/settingsOpen|techOpen|orderMode/.test(client), false, "inline uitklapstaat gevonden");
  const sheet = read("src/components/hymns-poc/Sheet.tsx");
  assert.match(sheet, /showModal\(\)/);
  assert.match(sheet, /onCancel/);
  assert.match(sheet, /vs-safe-area-bottom/);
  assert.match(sheet, /overflow-y-auto/);
  // geen engine in het paneel
  assert.equal(/HymnLiveEngine|MicListener|restart|followHymn/.test(sheet), false);
});

test("beginscherm en kop: geen introductie of privacyblok boven de tekst, privacy achter de infoknop", () => {
  const client = read("src/components/hymns-poc/HymnsPocClient.tsx");
  const heading = client.slice(client.indexOf("<header"), client.indexOf("</header>"));
  assert.equal(/COPY\.intro|COPY\.privacy\b/.test(heading), false, "uitleg staat in de kop");
  // de volledige uitleg staat alleen in het instellingenpaneel
  const sheetPart = client.slice(client.indexOf('sheet === "settings"'), client.indexOf('sheet === "order"'));
  assert.match(sheetPart, /COPY\.privacy\}/);
  assert.match(sheetPart, /COPY\.intro/);
  assert.equal(client.indexOf("COPY.privacy}") > client.indexOf('sheet === "settings"'), true);
});

test("bediening per toestand: maximaal één primaire actie", () => {
  const client = read("src/components/hymns-poc/HymnsPocClient.tsx");
  const bar = client.slice(client.indexOf("data-hymns-bar"), client.indexOf("{sheet === \"settings\""));
  // per tak van de bediening hoogstens één primaryButton
  const branches = bar.split(/\)\s*:\s*choosing\s*\?|\)\s*:\s*\(/);
  for (const branch of branches) assert.ok((branch.match(/className=\{primaryButton\}/g) ?? []).length <= 1, "meer dan één primaire actie in één toestand");
  assert.match(bar, /COPY\.stop/);
  assert.match(bar, /COPY\.singingStarts/);
  assert.match(bar, /COPY\.resync/);
});

test("aanraakdoelen: coupletknoppen en icoonknoppen zijn minstens 44 px, ook bij grote tekst", () => {
  const client = read("src/components/hymns-poc/HymnsPocClient.tsx");
  assert.match(client, /min-h-\[44px\] min-w-\[44px\]/);
  assert.match(client, /!h-\[44px\] !w-\[44px\]/);
});

test("status: handmatig begonnen zang heet 'Handmatig volgen'", () => {
  const s = snap({ phase: "singing" });
  s.phase.startReason = "manual";
  assert.equal(describeStatus("listening", live({ snapshot: s }))?.label, "Handmatig volgen");
});
