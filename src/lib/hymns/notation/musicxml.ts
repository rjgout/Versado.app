import type { HymnNotation, NotationNote, SheetProblem, SheetSyllable } from "./types";

// Bouwt uit de notatielaag en de lettergrepen van één couplet een MusicXML-partituur (één partij, twee balken: G en F).
// Puur en deterministisch: dezelfde invoer geeft dezelfde uitvoer. Er wordt niets verzonnen: een duur, balk of lettergreep die niet
// zonder gok te plaatsen is, wordt als probleem gemeld (`problems`) en de aanroeper kiest dan de terugvaloptie (PDF).

export const DIVISIONS = 24; // ondersteunt triolen (1/3) en 32e noten
const EPS = 1e-3;
const STEPS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const TYPES: [number, string][] = [[4, "whole"], [2, "half"], [1, "quarter"], [0.5, "eighth"], [0.25, "16th"], [0.125, "32nd"], [0.0625, "64th"]];
const ACCIDENTALS: Record<number, string> = { [-1]: "flat", 0: "natural", 1: "sharp" };
const close = (a: number, b: number) => Math.abs(a - b) < EPS;

interface Ev {
  t: number;
  dur: number;
  notes: NotationNote[]; // leeg bij een rust
  rest: boolean;
  wholeMeasure: boolean;
  staff: 0 | 1;
  voice: number;
  // afgeleid
  type?: string;
  dots?: number;
  tuplet?: boolean;
}

export interface MusicXmlResult {
  xml: string;
  problems: SheetProblem[];
  measureCount: number;
  /** Aantal lettergrepen dat aan een noot gehangen is. */
  lyricsPlaced: number;
}

export interface MusicXmlOptions {
  syllables: SheetSyllable[];
  tempoLabel?: string | null;
  tempoQuarterBpm?: [number, number] | null;
}

function typeOf(dur: number): { type: string; dots: number } | null {
  for (const [value, name] of TYPES) {
    if (close(dur, value)) return { type: name, dots: 0 };
    if (close(dur, value * 1.5)) return { type: name, dots: 1 };
    if (close(dur, value * 1.75)) return { type: name, dots: 2 };
  }
  return null;
}

/** Afleiden van type, punten en triool uit de duur (en, voor noten, de gelezen basisduur en punten). */
function describe(ev: Ev, problems: SheetProblem[]) {
  const first = ev.notes[0];
  if (first && first.base > 0) {
    const nominal = first.base * (first.dots === 0 ? 1 : first.dots === 1 ? 1.5 : 1.75);
    const t = typeOf(nominal);
    if (t && close(ev.dur, nominal)) { ev.type = t.type; ev.dots = first.dots; ev.tuplet = false; return; }
    if (t && close(ev.dur, (nominal * 2) / 3)) { ev.type = t.type; ev.dots = first.dots; ev.tuplet = true; return; }
  }
  const direct = typeOf(ev.dur);
  if (direct) { ev.type = direct.type; ev.dots = direct.dots; ev.tuplet = false; return; }
  const triplet = typeOf((ev.dur * 3) / 2);
  if (triplet) { ev.type = triplet.type; ev.dots = triplet.dots; ev.tuplet = true; return; }
  problems.push({ code: "duur", message: `Onbekende duur ${ev.dur} op beat ${ev.t}` });
  ev.type = "quarter"; ev.dots = 0; ev.tuplet = false;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const units = (beats: number) => Math.round(beats * DIVISIONS);

function pitchXml(n: NotationNote): string {
  const step = STEPS[((n.dia % 7) + 7) % 7];
  const octave = Math.floor(n.dia / 7);
  return `<pitch><step>${step}</step>${n.alt ? `<alter>${n.alt}</alter>` : ""}<octave>${octave}</octave></pitch>`;
}

export function buildMusicXml(notation: HymnNotation, options: MusicXmlOptions): MusicXmlResult {
  const problems: SheetProblem[] = [];
  const measures = notation.measures;
  const measureOf = (t: number) => {
    let lo = 0, hi = measures.length - 1, found = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (measures[mid].start <= t + EPS) { found = mid; lo = mid + 1; } else hi = mid - 1; }
    return found;
  };

  // --- per maat: noten en rusten verdelen over stemmen (G-balk 1-4, F-balk 5-8) op stokrichting
  const perMeasure: Ev[][] = measures.map(() => []);
  const voiceBase = (staff: 0 | 1) => 1 + staff * 4;
  const free = (events: Ev[], voice: number, t: number, dur: number) => events.every((e) => e.voice !== voice || e.t + e.dur <= t + EPS || t + dur <= e.t + EPS);
  const orderedNotes = [...notation.notes].sort((a, b) => a.t - b.t || b.midi - a.midi);
  for (const n of orderedNotes) {
    const m = measureOf(n.t);
    const events = perMeasure[m];
    const pref = n.stem === "down" ? 1 : 0;
    const order = n.stem === null ? [0, 1, 2, 3] : [pref, 1 - pref, 2, 3];
    let placed = false;
    for (const slot of order) {
      const voice = voiceBase(n.staff) + slot;
      const same = events.find((e) => e.voice === voice && !e.rest && close(e.t, n.t) && close(e.dur, n.dur));
      if (same && (n.stem === null || same.notes[0].stem === n.stem || same.notes[0].stem === null)) { same.notes.push(n); placed = true; break; }
      if (n.stem !== null && n.stem === (slot === 0 ? "up" : slot === 1 ? "down" : n.stem) && free(events, voice, n.t, n.dur)) { events.push({ t: n.t, dur: n.dur, notes: [n], rest: false, wholeMeasure: false, staff: n.staff, voice }); placed = true; break; }
      if (n.stem === null && free(events, voice, n.t, n.dur)) { events.push({ t: n.t, dur: n.dur, notes: [n], rest: false, wholeMeasure: false, staff: n.staff, voice }); placed = true; break; }
    }
    if (!placed) {
      // laatste redmiddel: de eerste stem met ruimte, ongeacht de richting (blijft zichtbaar en muzikaal juist)
      for (let slot = 0; slot < 4 && !placed; slot++) {
        const voice = voiceBase(n.staff) + slot;
        if (free(events, voice, n.t, n.dur)) { events.push({ t: n.t, dur: n.dur, notes: [n], rest: false, wholeMeasure: false, staff: n.staff, voice }); placed = true; }
      }
    }
    if (!placed) problems.push({ code: "stem", message: `Noot op beat ${n.t} past in geen enkele stem` });
  }
  for (const r of notation.rests) {
    const m = measureOf(r.t);
    const events = perMeasure[m];
    let voice = 0;
    for (let slot = 0; slot < 4; slot++) { if (free(events, voiceBase(r.staff) + slot, r.t, r.dur)) { voice = voiceBase(r.staff) + slot; break; } }
    if (!voice) { problems.push({ code: "rust", message: `Rust op beat ${r.t} past in geen enkele stem` }); continue; }
    events.push({ t: r.t, dur: r.dur, notes: [], rest: true, wholeMeasure: close(r.dur, measures[m].length) && close(r.t, measures[m].start), staff: r.staff, voice });
  }
  for (const events of perMeasure) for (const e of events) {
    // akkoord: bovenste noot eerst (de tekst hangt aan de bovenste noot van de G-balk)
    e.notes.sort((a, b) => b.midi - a.midi);
    describe(e, problems);
  }

  // --- bogen en overbindingen: per noot (beat, midi, balk)
  const key = (t: number, midi: number, staff: number) => `${Math.round(t * 1000)}:${midi}:${staff}`;
  const tieStart = new Set<string>(), tieStop = new Set<string>();
  for (const x of notation.ties) { tieStart.add(key(x.t, x.midi, x.staff)); tieStop.add(key(x.toT, x.toMidi, x.staff)); }
  const slurStart = new Map<string, number[]>(), slurStop = new Map<string, number[]>();
  const active: Record<number, { stopT: number; num: number }[]> = { 0: [], 1: [] };
  for (const x of [...notation.slurs].sort((a, b) => a.t - b.t || a.toT - b.toT)) {
    // nummer: het kleinste vrije (1-6) voor bogen die nog lopen op dezelfde balk
    active[x.staff] = active[x.staff].filter((a) => a.stopT > x.t + EPS);
    const used = new Set(active[x.staff].map((a) => a.num));
    let num = 1; while (used.has(num) && num < 6) num++;
    active[x.staff].push({ stopT: x.toT, num });
    const k1 = key(x.t, x.midi, x.staff), k2 = key(x.toT, x.toMidi, x.staff);
    slurStart.set(k1, [...(slurStart.get(k1) ?? []), num]);
    slurStop.set(k2, [...(slurStop.get(k2) ?? []), num]);
  }

  // --- tekst: de bovenste noot van de G-balk op de beat van de lettergreep
  const lyricOf = new Map<NotationNote, SheetSyllable>();
  let lyricsPlaced = 0;
  for (const s of options.syllables) {
    const m = measureOf(s.beat);
    const candidates = perMeasure[m].filter((e) => !e.rest && e.staff === 0 && close(e.t, s.beat));
    if (!candidates.length) { problems.push({ code: "lettergreep", message: `Geen noot in de G-balk op beat ${s.beat} voor "${s.text}"` }); continue; }
    const target = candidates.sort((a, b) => b.notes[0].midi - a.notes[0].midi)[0].notes[0];
    if (lyricOf.has(target)) { problems.push({ code: "lettergreep", message: `Twee lettergrepen op dezelfde noot (beat ${s.beat})` }); continue; }
    lyricOf.set(target, s); lyricsPlaced++;
  }

  // --- fermates: bovenste noot (boven) of onderste noot (eronder) van de balk op die beat
  const fermataOn = new Map<NotationNote, "upright" | "inverted">();
  for (const f of notation.fermatas) {
    const evs = perMeasure[measureOf(f.t)].filter((e) => !e.rest && e.staff === f.staff && close(e.t, f.t));
    if (!evs.length) { problems.push({ code: "fermate", message: `Geen noot voor de fermate op beat ${f.t}` }); continue; }
    const pick = f.inverted ? evs.sort((a, b) => a.notes[a.notes.length - 1].midi - b.notes[b.notes.length - 1].midi)[0] : evs.sort((a, b) => b.notes[0].midi - a.notes[0].midi)[0];
    fermataOn.set(f.inverted ? pick.notes[pick.notes.length - 1] : pick.notes[0], f.inverted ? "inverted" : "upright");
  }

  // --- XML
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<score-partwise version="3.1"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">');
  let prevSig = "";
  measures.forEach((m, mi) => {
    const events = perMeasure[mi];
    const nominalBar = (m.beats * 4) / m.beatType;
    const implicit = mi === 0 && m.length < nominalBar - EPS;
    out.push(`<measure number="${mi + 1}"${implicit ? ' implicit="yes"' : ""}>`);
    const sig = `${m.beats}/${m.beatType}`;
    if (mi === 0 || sig !== prevSig) {
      out.push("<attributes>");
      if (mi === 0) out.push(`<divisions>${DIVISIONS}</divisions><key><fifths>${notation.fifths}</fifths></key>`);
      out.push(`<time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time>`);
      if (mi === 0) out.push('<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>');
      out.push("</attributes>");
      if (mi === 0 && options.tempoLabel) {
        out.push(`<direction placement="above"><direction-type><words>${esc(options.tempoLabel)}</words></direction-type>${options.tempoQuarterBpm ? `<sound tempo="${Math.round((options.tempoQuarterBpm[0] + options.tempoQuarterBpm[1]) / 2)}"/>` : ""}</direction>`);
      }
      prevSig = sig;
    }
    const voices = [...new Set(events.map((e) => e.voice))].sort((a, b) => a - b);
    // Positie waar de vorige stem eindigde: terug naar het begin van de maat is precies zoveel, nooit de volle maatlengte
    // (een stem die eerder stopt zou anders onder het begin van de maat uitkomen).
    let previousEnd = 0;
    voices.forEach((voice, vi) => {
      const list = events.filter((e) => e.voice === voice).sort((a, b) => a.t - b.t);
      // balken per niveau: opeenvolgende gebeurtenissen met dezelfde balk
      const beamTag = new Map<Ev, string[]>();
      const maxLevel = Math.max(0, ...list.map((e) => (e.notes[0]?.beams.length ?? 0)));
      for (let level = 1; level <= maxLevel; level++) {
        let run: Ev[] = [];
        const flush = () => {
          if (run.length >= 2) run.forEach((e, i) => { const t = beamTag.get(e) ?? []; t[level - 1] = i === 0 ? "begin" : i === run.length - 1 ? "end" : "continue"; beamTag.set(e, t); });
          else if (run.length === 1 && level >= 2) {
            // losse tweede balk: haak naar de buur
            const e = run[0]; const idx = list.indexOf(e);
            const prev = list[idx - 1]; const sameGroup = prev && !prev.rest && prev.notes[0]?.beams[0] !== undefined && prev.notes[0].beams[0] === e.notes[0].beams[0];
            const t = beamTag.get(e) ?? []; t[level - 1] = sameGroup ? "backward hook" : "forward hook"; beamTag.set(e, t);
          }
          run = [];
        };
        let prevId: number | undefined;
        for (const e of list) {
          const id = e.rest ? undefined : e.notes[0]?.beams[level - 1];
          if (id === undefined) { flush(); prevId = undefined; continue; }
          if (prevId !== undefined && id !== prevId) flush();
          run.push(e); prevId = id;
        }
        flush();
      }
      // triolen: groepen van opeenvolgende drieling-gebeurtenissen tot 1, 2 of 4 beats
      const tupletMark = new Map<Ev, "start" | "stop">();
      let group: Ev[] = []; let acc = 0;
      for (const e of list) {
        if (!e.tuplet) { group = []; acc = 0; continue; }
        group.push(e); acc += e.dur;
        if ([1, 2, 4].some((t) => close(acc, t))) { tupletMark.set(group[0], "start"); tupletMark.set(e, group.length === 1 ? "start" : "stop"); group = []; acc = 0; }
      }
      if (group.length) problems.push({ code: "triool", message: `Onvolledige triool in maat ${mi + 1}` });

      if (vi > 0 && previousEnd > EPS) out.push(`<backup><duration>${units(previousEnd)}</duration></backup>`);
      let cursor = 0;
      for (const e of list) {
        const gap = e.t - m.start - cursor;
        if (gap > EPS) { out.push(`<forward><duration>${units(gap)}</duration></forward>`); cursor += gap; }
        const stemDir = (n: NotationNote) => (n.stem ? `<stem>${n.stem}</stem>` : "");
        if (e.rest) {
          out.push(`<note>${e.wholeMeasure ? '<rest measure="yes"/>' : "<rest/>"}<duration>${units(e.dur)}</duration><voice>${e.voice}</voice>${e.wholeMeasure ? "" : `<type>${e.type}</type>${"<dot/>".repeat(e.dots ?? 0)}`}${e.tuplet ? "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" : ""}<staff>${e.staff + 1}</staff></note>`);
        } else {
          e.notes.forEach((n, ci) => {
            const k = key(n.t, n.midi, n.staff);
            const parts: string[] = ["<note>"];
            if (ci > 0) parts.push("<chord/>");
            parts.push(pitchXml(n), `<duration>${units(e.dur)}</duration>`);
            if (tieStop.has(k)) parts.push('<tie type="stop"/>');
            if (tieStart.has(k)) parts.push('<tie type="start"/>');
            parts.push(`<voice>${e.voice}</voice><type>${e.type}</type>${"<dot/>".repeat(e.dots ?? 0)}`);
            if (n.accidental !== null && ACCIDENTALS[n.accidental]) parts.push(`<accidental>${ACCIDENTALS[n.accidental]}</accidental>`);
            if (e.tuplet) parts.push("<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>");
            parts.push(stemDir(n), `<staff>${e.staff + 1}</staff>`);
            if (ci === 0) (beamTag.get(e) ?? []).forEach((b, i) => { if (b) parts.push(`<beam number="${i + 1}">${b}</beam>`); });
            const notations: string[] = [];
            if (ci === 0 && tupletMark.get(e)) notations.push(`<tuplet type="${tupletMark.get(e)}" bracket="no"/>`);
            if (tieStop.has(k)) notations.push('<tied type="stop"/>');
            if (tieStart.has(k)) notations.push('<tied type="start"/>');
            for (const num of slurStop.get(k) ?? []) notations.push(`<slur type="stop" number="${num}"/>`);
            for (const num of slurStart.get(k) ?? []) notations.push(`<slur type="start" number="${num}"/>`);
            const fer = fermataOn.get(n); if (fer) notations.push(`<fermata type="${fer}"/>`);
            if (notations.length) parts.push(`<notations>${notations.join("")}</notations>`);
            const syl = lyricOf.get(n);
            if (syl) parts.push(`<lyric number="1"><syllabic>${syl.syllabic}</syllabic><text>${esc(syl.text)}</text></lyric>`);
            parts.push("</note>");
            out.push(parts.join(""));
          });
        }
        cursor = e.t - m.start + e.dur;
      }
      previousEnd = cursor;
    });
    out.push("</measure>");
  });
  out.push("</part></score-partwise>");
  return { xml: out.join(""), problems, measureCount: measures.length, lyricsPlaced };
}
