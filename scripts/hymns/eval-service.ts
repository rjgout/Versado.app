// Metingen voor voorspel en zangbegin op synthetische "diensten" met bekende tijdlijn (voorspel, eventueel een
// pauze, dan de samenzang). Uitvoer is Markdown voor docs/hymns/05-TEST-RESULTS.md.
// Aanroep: npx tsx scripts/hymns/eval-service.ts [fase|herken|bibliotheek <nummers> <conditie-van-tot>]
import { constantTempo, type SynthOptions } from "../../src/lib/hymns/eval/synth";
import { POC_LIBRARY, listHymns } from "../../src/lib/hymns/library";
import { HymnLiveEngine } from "../../src/lib/hymns/live";
import { loadRecognitionBundle, loadResolvedHymn } from "../../src/lib/hymns/library/server";
import { candidatesFromBundle } from "../../src/lib/hymns/recognize/candidates";
import { SAMPLE_RATE, follow, makeService, type ServicePart } from "../../tests/helpers/hymnScenario";

const what = process.argv[2] ?? "fase";
const HYMNS = listHymns(POC_LIBRARY);

interface Condition {
  name: string;
  /** Opties voor de hele dienst (instrument, omgeving). */
  shared: (cycle: number) => Partial<SynthOptions>;
  /** Extra opties voor het voorspel (bijv. een pauze midden in het voorspel). */
  prelude?: (cycle: number, startBeat: number) => Partial<SynthOptions>;
  singersDb?: number;
}

const base = (bpm: number) => ({ tempoSegments: constantTempo(bpm) });
const changing = (cycle: number) => [90, 70, 100, 60, 95, 75].map((b, i) => ({ fromBeat: (i * cycle) / 6, bps: b / 60 }));

const CONDITIONS: Condition[] = [
  { name: "1 alleen piano", shared: () => base(90) },
  { name: "2 alleen orgel", shared: () => ({ ...base(90), timbre: "organ" as const }) },
  { name: "3 piano met pratende kinderen", shared: () => ({ ...base(90), chatterDb: -8 }) },
  { name: "4 orgel met achtergrondgesprekken", shared: () => ({ ...base(90), timbre: "organ" as const, chatterDb: -10, noiseDb: -24 }) },
  { name: "5 muziek met gemeentezang (-6 dB)", shared: () => base(90), singersDb: -6 },
  { name: "6 kind roept plotseling", shared: () => ({ ...base(90), shoutsAt: [4, 9, 16] }) },
  { name: "7 kerkakoestiek (nagalm 2,5 s)", shared: () => ({ ...base(90), timbre: "organ" as const, reverbSeconds: 2.5 }) },
  { name: "8 langzaam orgelspel (55/min)", shared: () => ({ ...base(55), timbre: "organ" as const }) },
  { name: "9 snelle tempowisselingen", shared: (c) => ({ tempoSegments: changing(c) }) },
  { name: "10 stilte tijdens het voorspel (2 s)", shared: () => base(90), prelude: (_c, s) => ({ pauses: [{ atBeat: s + 14, seconds: 2, ringOut: true }] }) },
];

type Kind = "staart" | "heel" | "heel+pauze";

function parts(cond: Condition, kind: Kind, cycle: number): ServicePart[] {
  const startBeat = kind === "staart" ? cycle * 0.66 : 0;
  const shared = cond.shared(cycle);
  const sung: Partial<SynthOptions> = { ...shared, singersDb: cond.singersDb ?? -6, laps: 1 };
  const prelude: Partial<SynthOptions> = { ...shared, startBeat, ...(cond.prelude?.(cycle, startBeat) ?? {}) };
  return [{ options: prelude }, { gapBefore: kind === "heel+pauze" ? 2.5 : 0, options: sung }];
}

if (what === "fase") {
  console.log("| Omstandigheid | Voorspel | 24 | 36 | 82 |");
  console.log("|---|---|---|---|---|");
  for (const cond of CONDITIONS) {
    for (const kind of ["staart", "heel", "heel+pauze"] as Kind[]) {
      const cells: string[] = [];
      for (const h of HYMNS) {
        const cycle = h.composition.totalBeats;
        const sv = makeService(h.number, parts(cond, kind, cycle), {}, 1.5);
        const run = follow(sv.hymn, sv.frames);
        const start = run.session.events.find((e) => e.type === "phase" && e.phaseEvent === "start");
        const early = run.snapshots.some((s) => s.time < sv.partStart[1] - 0.3 && s.cursor.line >= 0);
        const last = run.session.snapshotNow;
        const tag = start ? `start ${(start.time - sv.partStart[1] >= 0 ? "+" : "")}${(start.time - sv.partStart[1]).toFixed(1)} s` : last.phase.waiting ? "wacht" : "geen";
        cells.push(`${tag}${early ? " VROEGE MARKERING" : ""}`);
      }
      console.log(`| ${cond.name} | ${kind} | ${cells.join(" | ")} |`);
    }
  }
}

if (what === "herken") {
  console.log("| Omstandigheid | 24 | 36 | 82 |");
  console.log("|---|---|---|---|");
  for (const cond of CONDITIONS) {
    const cells: string[] = [];
    for (const h of HYMNS) {
      const cycle = h.composition.totalBeats;
      const sv = makeService(h.number, parts(cond, "heel+pauze", cycle), {}, 1.5);
      const engine = new HymnLiveEngine(HYMNS);
      engine.startRecognizing();
      let at: number | null = null;
      let wrong = false;
      for (let i = 0; i < sv.samples.length; i += 4096) {
        engine.pushAudio(sv.samples.subarray(i, Math.min(sv.samples.length, i + 4096)), SAMPLE_RATE, Infinity);
        if (at === null && engine.currentStage === "following") {
          at = (i + 4096) / SAMPLE_RATE - 1.5;
          wrong = engine.currentHymn?.number !== h.number;
        }
      }
      cells.push(at === null ? "niet herkend" : wrong ? `VERKEERD (${engine.currentHymn?.number}) na ${at.toFixed(1)} s` : `${at.toFixed(1)} s`);
    }
    console.log(`| ${cond.name} | ${cells.join(" | ")} |`);
  }
}

// Herkennen tegen de HELE bibliotheek in een synthetische dienst (voorspel, pauze, samenzang): de engine kiest zelf, de tekst
// wordt pas opgehaald als de lofzang herkend is (bibliotheekmodus). Eerste uitspraak telt.
if (what === "bibliotheek") {
  const numbers = (process.argv[3] ?? "24,36,82").split(",").map(Number);
  const [from, to] = (process.argv[4] ?? `1-${CONDITIONS.length}`).split("-").map(Number);
  const candidates = candidatesFromBundle(loadRecognitionBundle());
  console.log(`| Omstandigheid | ${numbers.join(" | ")} |`);
  console.log(`|---|${numbers.map(() => "---").join("|")}|`);
  for (const cond of CONDITIONS.slice(from - 1, to)) {
    const cells: string[] = [];
    for (const n of numbers) {
      const target = loadResolvedHymn(n)!;
      const sv = makeService(n, parts(cond, "heel+pauze", target.composition.totalBeats), {}, 1.5);
      const engine = new HymnLiveEngine([]);
      engine.setCandidates(candidates);
      engine.startRecognizing();
      let at: number | null = null;
      let got: number | null = null;
      for (let i = 0; i < sv.samples.length; i += 4096) {
        engine.pushAudio(sv.samples.subarray(i, Math.min(sv.samples.length, i + 4096)), SAMPLE_RATE, Infinity);
        const need = engine.state().needHymn;
        if (need !== null) engine.registerHymn(loadResolvedHymn(need)!);
        if (at === null && engine.currentStage === "following") {
          at = (i + 4096) / SAMPLE_RATE - 1.5;
          got = engine.currentHymn?.number ?? null;
        }
      }
      cells.push(at === null ? "niet herkend" : got !== n ? `VERKEERD (${got}) na ${at.toFixed(1)} s` : `${at.toFixed(1)} s`);
    }
    console.log(`| ${cond.name} | ${cells.join(" | ")} |`);
  }
}
