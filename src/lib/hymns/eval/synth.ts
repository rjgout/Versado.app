import type { HymnComposition } from "../types";
import { mulberry32 } from "../follow/tracker";

// Synthetische testopnamen uit de partituur, met een EXACT bekende tijdlijn. Zo hoeft een test niet af te
// hangen van een echte microfoon of van een opname waarvan de "waarheid" alleen geschat kan worden.
// De klank is bewust eenvoudig (additieve synthese); realisme komt uit de verstoringen: tempowisselingen,
// pauzes, verkeerde noten, gemeentezang, ruis en nagalm. Zie docs/hymns/05-TEST-RESULTS.md voor de grenzen.

/** Anker in de tijdlijn: op `beat` (uitgerolde partituur) wordt het `seconds` seconden. Lineair ertussen. */
export interface TimeAnchor {
  beat: number;
  seconds: number;
}

export interface SynthOptions {
  sampleRate: number;
  laps: number;
  timbre: "piano" | "organ";
  /** Tempo als lijst van (beat, beats per seconde) segmenten; geldt vanaf die beat. */
  tempoSegments: { fromBeat: number; bps: number }[];
  /** Pauzes: op `atBeat` staat de tijd `seconds` stil (stilte of een uitklinkend akkoord). */
  pauses?: { atBeat: number; seconds: number; ringOut?: boolean }[];
  /** Stilte aan het begin (seconden). */
  leadInSeconds?: number;
  /** Kans per noot dat die door een verkeerde noot (±1..2 halve tonen) wordt vervangen. */
  wrongNoteProbability?: number;
  /** Alleen verkeerde noten binnen dit beat-interval (bijv. één maat). */
  wrongNoteRange?: [number, number];
  /** Gemeentezang: niveau t.o.v. het instrument in dB (bijv. -8), nul/undefined = geen. */
  singersDb?: number;
  /** Achtergrondruis (roze-achtig) t.o.v. het instrument in dB. */
  noiseDb?: number;
  /** Pratende of spelende kinderen: korte, hoge stembursten zonder verband met de melodie, in dB t.o.v. het instrument. */
  chatterDb?: number;
  /** Tijdstippen (s) van een plotselinge roep, 12 dB luider dan het gemiddelde gebabbel. */
  shoutsAt?: number[];
  /** Nagalmtijd in seconden (0 = droog). */
  reverbSeconds?: number;
  /** Stemming van het instrument in halve tonen t.o.v. A=440. */
  tuningSemitones?: number;
  seed?: number;
  /** Alleen deze noten (bijv. een andere melodie) in plaats van de partituur. */
  notesOverride?: HymnComposition["notes"];
  /** Begin- en eindbeat van het te spelen deel binnen de uitgerolde cyclus (standaard alles). */
  startBeat?: number;
}

export interface SynthResult {
  samples: Float32Array;
  sampleRate: number;
  /** Duur in seconden. */
  duration: number;
  /** Exacte partituurpositie (beats in de uitgerolde cyclus) op tijd t; tijdens een pauze de vastgehouden positie. */
  beatAt(seconds: number): number;
  /** Tijdstip waarop de partituur `beat` bereikt (begin van die beat). */
  timeAt(beat: number): number;
  /** True als er op dit tijdstip een expliciete pauze/stilte in de tijdlijn zit. */
  inPause(seconds: number): boolean;
  anchors: TimeAnchor[];
}

function midiHz(m: number, tuning: number): number {
  return 440 * 2 ** ((m + tuning - 69) / 12);
}

/** Bouwt de tijdlijn (monotone stuksgewijs lineaire beat -> seconden). */
function buildTimeline(totalBeats: number, startBeat: number, o: SynthOptions) {
  const anchors: TimeAnchor[] = [];
  const segs = [...o.tempoSegments].sort((a, b) => a.fromBeat - b.fromBeat);
  const pauses = [...(o.pauses ?? [])].sort((a, b) => a.atBeat - b.atBeat);
  const events = new Set<number>([startBeat, totalBeats]);
  for (const s of segs) if (s.fromBeat > startBeat && s.fromBeat < totalBeats) events.add(s.fromBeat);
  for (const p of pauses) if (p.atBeat > startBeat && p.atBeat < totalBeats) events.add(p.atBeat);
  const sorted = [...events].sort((a, b) => a - b);
  let seconds = o.leadInSeconds ?? 0;
  const pauseIntervals: [number, number][] = [];
  const bpsAt = (beat: number) => {
    let bps = segs[0]?.bps ?? 1.3;
    for (const s of segs) if (s.fromBeat <= beat + 1e-9) bps = s.bps;
    return bps;
  };
  for (let i = 0; i < sorted.length; i += 1) {
    const beat = sorted[i];
    anchors.push({ beat, seconds });
    const pause = pauses.find((p) => Math.abs(p.atBeat - beat) < 1e-9);
    if (pause) {
      pauseIntervals.push([seconds, seconds + pause.seconds]);
      seconds += pause.seconds;
      anchors.push({ beat, seconds });
    }
    if (i + 1 < sorted.length) seconds += (sorted[i + 1] - beat) / bpsAt(beat);
  }
  const timeAt = (beat: number): number => {
    for (let i = anchors.length - 1; i >= 0; i -= 1) {
      if (anchors[i].beat <= beat + 1e-9) {
        // ná een pauze-anker volgt het tweede anker met dezelfde beat; kies het laatste
        const a = anchors[i];
        const b = anchors[i + 1];
        if (!b || b.beat === a.beat) return a.seconds;
        return a.seconds + ((beat - a.beat) / (b.beat - a.beat)) * (b.seconds - a.seconds);
      }
    }
    return anchors[0].seconds;
  };
  const beatAt = (t: number): number => {
    if (t <= anchors[0].seconds) return anchors[0].beat;
    for (let i = 0; i + 1 < anchors.length; i += 1) {
      const a = anchors[i];
      const b = anchors[i + 1];
      if (t >= a.seconds && t < b.seconds) {
        if (b.beat === a.beat) return a.beat; // pauze: positie ligt vast
        return a.beat + ((t - a.seconds) / (b.seconds - a.seconds)) * (b.beat - a.beat);
      }
    }
    return anchors[anchors.length - 1].beat;
  };
  // Eindtijd van een noot die precies op een pauzepunt eindigt: het begin van de pauze, niet het einde ervan.
  const timeAtEnd = (beat: number): number => {
    for (const a of anchors) if (Math.abs(a.beat - beat) < 1e-9) return a.seconds;
    return timeAt(beat);
  };
  return { anchors, timeAt, timeAtEnd, beatAt, pauseIntervals, end: seconds };
}

export function synthesizeHymn(comp: HymnComposition, o: SynthOptions): SynthResult {
  const rand = mulberry32(o.seed ?? 7);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
  const fs = o.sampleRate;
  const cycle = comp.totalBeats;
  const startBeat = o.startBeat ?? 0;
  const totalBeats = cycle * o.laps;
  const tl = buildTimeline(totalBeats, startBeat, o);
  const tail = (o.reverbSeconds ?? 0) + 2;
  const length = Math.ceil((tl.end + tail) * fs);
  const out = new Float32Array(length);
  const tuning = o.tuningSemitones ?? 0;
  const notes = o.notesOverride ?? comp.notes;
  const wrongP = o.wrongNoteProbability ?? 0;

  // --- instrument
  const render = (hz: number, t0: number, t1: number, amp: number, kind: "piano" | "organ" | "voice", buf: Float32Array) => {
    const startS = Math.floor(t0 * fs);
    const sustainEnd = Math.min(length - 1, Math.floor(t1 * fs));
    const releaseS = kind === "piano" ? 0.18 : kind === "organ" ? 0.07 : 0.1;
    const endS = Math.min(length - 1, sustainEnd + Math.floor(releaseS * fs));
    const nPartials = kind === "voice" ? 10 : kind === "piano" ? 12 : 9;
    const decay = kind === "piano" ? 1.4 / (0.4 + hz / 400) : 0;
    const phases: number[] = [];
    const amps: number[] = [];
    for (let h = 1; h <= nPartials; h += 1) {
      if (hz * h > fs * 0.45) break;
      phases.push(rand() * Math.PI * 2);
      let a: number;
      if (kind === "piano") a = Math.exp(-0.28 * (h - 1)) * (h % 2 === 0 ? 0.8 : 1);
      else if (kind === "organ") a = [1, 0.7, 0.45, 0.5, 0.2, 0.25, 0.1, 0.12, 0.05][h - 1] ?? 0.04;
      else a = 1 / h ** 1.1;
      amps.push(a);
    }
    const vibHz = 5 + rand();
    const vibDepth = kind === "voice" ? 0.008 : 0;
    const inharm = kind === "piano" ? 0.00012 : 0;
    for (let i = startS; i <= endS; i += 1) {
      const t = (i - startS) / fs;
      let env: number;
      const attack = kind === "piano" ? 0.004 : kind === "organ" ? 0.025 : 0.06;
      if (i <= sustainEnd) {
        env = Math.min(1, t / attack);
        if (kind === "piano") env *= Math.exp(-decay * t) * 0.85 + 0.15 * Math.exp(-0.25 * t);
      } else {
        const tr = (i - sustainEnd) / fs;
        let base = 1;
        if (kind === "piano") base = Math.exp(-decay * (sustainEnd - startS) / fs) * 0.85 + 0.15 * Math.exp(-0.25 * (sustainEnd - startS) / fs);
        env = base * Math.max(0, 1 - tr / releaseS);
      }
      const vib = vibDepth ? 1 + vibDepth * Math.sin(2 * Math.PI * vibHz * t) : 1;
      let v = 0;
      for (let h = 0; h < phases.length; h += 1) {
        const n = h + 1;
        const f = hz * n * Math.sqrt(1 + inharm * n * n) * vib;
        v += amps[h] * Math.sin(2 * Math.PI * f * t + phases[h]);
      }
      buf[i] += amp * env * v;
    }
  };

  const inst = new Float32Array(length);
  const voices = new Float32Array(length);
  for (let lap = 0; lap < o.laps; lap += 1) {
    for (const [t, dur, midi, staffIdx] of notes) {
      const b0 = lap * cycle + t;
      const b1 = b0 + dur;
      if (b1 <= startBeat) continue;
      let m = midi;
      const inWrong = !o.wrongNoteRange || (b0 >= o.wrongNoteRange[0] && b0 < o.wrongNoteRange[1]);
      if (wrongP > 0 && inWrong && rand() < wrongP) m += (rand() < 0.5 ? -1 : 1) * (1 + Math.floor(rand() * 2));
      const t0 = tl.timeAt(Math.max(b0, startBeat));
      let t1 = tl.timeAtEnd(b1);
      // Een pauze is stilte: noten die erdoorheen lopen stoppen aan het begin ervan. Met `ringOut` klinkt het
      // akkoord nog even door (zoals een orgel in een kerk), daarna is het stil.
      for (const p of o.pauses ?? []) {
        if (b0 < p.atBeat && b1 >= p.atBeat - 1e-9 && p.atBeat > startBeat) {
          t1 = tl.timeAtEnd(p.atBeat) + (p.ringOut ? Math.min(p.seconds, 2.5) : 0.02);
        }
      }
      const level = 0.18 / Math.sqrt(1 + 0.04 * Math.abs(midi - 60));
      render(midiHz(m, tuning), t0, Math.max(t0 + 0.05, t1 - (o.timbre === "piano" ? 0 : 0.03)), level, o.timbre, inst);
      // gemeente zingt de melodie (hoogste stem in de G-sleutel), met een lichte vertraging
      if (o.singersDb !== undefined && staffIdx === 0) {
        const isTop = !notes.some((n) => n[3] === 0 && Math.abs(n[0] - t) < 1e-6 && n[2] > midi);
        if (isTop) {
          const lag = 0.06 + rand() * 0.1;
          render(midiHz(m + (rand() < 0.15 ? 12 : 0), tuning + gauss() * 0.15), t0 + lag, t1 + lag, level * 0.9, "voice", voices);
        }
      }
    }
  }
  const instRms = rms(inst);
  const gainVoices = o.singersDb !== undefined && rms(voices) > 0 ? (instRms * 10 ** (o.singersDb / 20)) / rms(voices) : 0;
  for (let i = 0; i < length; i += 1) out[i] = inst[i] + voices[i] * gainVoices;

  // --- kinderstemmen: stemachtige bursts (grondtoon 250-450 Hz met glijdende toonhoogte en lettergreepritme)
  if (o.chatterDb !== undefined || (o.shoutsAt ?? []).length > 0) {
    const chat = new Float32Array(length);
    const burst = (buf: Float32Array, t0: number, dur: number, f0: number, amp: number) => {
      const i0 = Math.floor(t0 * fs);
      const i1 = Math.min(length - 1, Math.floor((t0 + dur) * fs));
      const glide = 0.15 + rand() * 0.25;
      const glideHz = 1 + rand() * 2;
      const syl = 3.5 + rand() * 2;
      const ph = rand() * Math.PI * 2;
      let phase = 0;
      for (let i = i0; i <= i1; i += 1) {
        const t = (i - i0) / fs;
        const f = f0 * (1 + glide * Math.sin(2 * Math.PI * glideHz * t + ph));
        phase += (2 * Math.PI * f) / fs;
        const env = Math.min(1, t / 0.03, (dur - t) / 0.05) * (0.55 + 0.45 * Math.sin(2 * Math.PI * syl * t + ph) ** 2);
        let v = 0;
        for (let h = 1; h <= 8; h += 1) if (f * h < 3800) v += Math.sin(h * phase) / h ** 0.9;
        buf[i] += amp * env * (v + 0.25 * gauss());
      }
    };
    if (o.chatterDb !== undefined) {
      let t = 0.3;
      while (t < tl.end) {
        const dur = 0.3 + rand() * 1.1;
        if (rand() < 0.75) burst(chat, t, dur, 250 + rand() * 200, 1);
        t += dur + 0.15 + rand() * 1.2;
      }
    }
    const instRms0 = rms(inst);
    const g = rms(chat) > 0 ? (instRms0 * 10 ** ((o.chatterDb ?? -6) / 20)) / rms(chat) : 0;
    for (let i = 0; i < length; i += 1) out[i] += chat[i] * g;
    // roepen: 12 dB boven het gemiddelde gebabbel
    if ((o.shoutsAt ?? []).length > 0) {
      const shout = new Float32Array(length);
      for (const at of o.shoutsAt ?? []) burst(shout, at, 0.9, 420 + rand() * 120, 1);
      const gs = rms(shout) > 0 ? (instRms0 * 10 ** (((o.chatterDb ?? -6) + 12) / 20)) / (rms(shout) * Math.sqrt(length / (0.9 * fs * (o.shoutsAt ?? []).length))) : 0;
      for (let i = 0; i < length; i += 1) out[i] += shout[i] * gs;
    }
  }

  // --- ruis
  if (o.noiseDb !== undefined) {
    const target = instRms * 10 ** (o.noiseDb / 20);
    let b0 = 0, b1 = 0, b2 = 0;
    const noise = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const white = rand() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      noise[i] = b0 + b1 + b2 + white * 0.1848;
    }
    const g = target / (rms(noise) || 1);
    for (let i = 0; i < length; i += 1) out[i] += noise[i] * g;
  }

  // --- nagalm (Schroeder: vier combfilters en twee allpass-filters)
  if ((o.reverbSeconds ?? 0) > 0) applyReverb(out, fs, o.reverbSeconds!);

  // normaliseren naar -3 dBFS piek
  let peak = 1e-9;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  const norm = 0.7 / peak;
  for (let i = 0; i < length; i += 1) out[i] *= norm;

  return {
    samples: out,
    sampleRate: fs,
    duration: tl.end,
    beatAt: tl.beatAt,
    timeAt: tl.timeAt,
    inPause: (s) => tl.pauseIntervals.some(([a, b]) => s >= a && s < b),
    anchors: tl.anchors,
  };
}

function rms(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
}

function applyReverb(x: Float32Array, fs: number, rt60: number): void {
  const combDelays = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.round(d * fs));
  const dry = Float32Array.from(x);
  const wet = new Float32Array(x.length);
  for (const delay of combDelays) {
    const g = 10 ** ((-3 * delay) / (rt60 * fs));
    const buf = new Float32Array(delay);
    let idx = 0;
    for (let i = 0; i < x.length; i += 1) {
      const y = dry[i] + g * buf[idx];
      buf[idx] = y;
      idx = (idx + 1) % delay;
      wet[i] += y / combDelays.length;
    }
  }
  for (const [d, g] of [[0.005, 0.7], [0.0017, 0.7]] as const) {
    const delay = Math.round(d * fs);
    const buf = new Float32Array(delay);
    let idx = 0;
    for (let i = 0; i < x.length; i += 1) {
      const bufOut = buf[idx];
      const v = wet[i] - g * bufOut;
      buf[idx] = v;
      wet[i] = bufOut + g * v;
      idx = (idx + 1) % delay;
    }
  }
  for (let i = 0; i < x.length; i += 1) x[i] = dry[i] * 0.6 + wet[i] * 0.55;
}

export function constantTempo(bpm: number): { fromBeat: number; bps: number }[] {
  return [{ fromBeat: 0, bps: bpm / 60 }];
}
