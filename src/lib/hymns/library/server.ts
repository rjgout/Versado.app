import fs from "node:fs";
import path from "node:path";
import { decodeNotation } from "../notation/decode";
import { buildMusicXml } from "../notation/musicxml";
import { syllablesOf } from "../notation/lyrics";
import { reconstructMelody, type MelodyResult } from "../score/melody";
import type { RawHymnNotation, SheetData, SheetStanzaStatus } from "../notation/types";
import type { HymnCapabilities, HymnComposition, HymnIndexEntry, HymnLine, HymnStanza, HymnText, HymnbookEdition, ReadableHymn, ResolvedHymn } from "../types";

// Server-kant van de Nederlandse lofzangenbibliotheek: leest de statische, in git versioneerde gegevens uit
// src/lib/hymns/library/data (gemaakt door scripts/hymns/*.py) en voegt per lofzang tekst, koppeling en compositie samen.
// Geen database en geen migratie. Alleen vanuit routes (admin-only API), nooit vanuit de eager-keten van server.ts.

const DATA = path.join(process.cwd(), "src/lib/hymns/library/data");

export const NLD_EDITION_ID = "nld-lofzangen";

interface ManifestHymn {
  number: number;
  title: string;
  textStatus: string;
  capabilities: HymnCapabilities;
  textIssues?: string[];
  music: { status: string; compositionId: string | null; reasons?: string[] };
}

interface Manifest {
  dataVersion: string;
  counts: Record<string, unknown>;
  hymns: ManifestHymn[];
}

interface LinkLine {
  start: number | null;
  words: (number | null)[];
  syl: ([string, number][] | null)[];
}

interface LinkFile {
  compositionId: string;
  stanzas: { n: number; linking: "word" | "line"; lines: LinkLine[] }[];
  chorus: { linking: "word" | "line"; lines: LinkLine[] } | null;
}

interface TextFile {
  title: string;
  subtitle: string | null;
  tempoLabel: string | null;
  stanzas: { n: number; lines: string[]; belowMusic?: boolean }[];
  choruses: string[][];
  textCredit: string | null;
  musicCredit: string | null;
  notices: string[];
  rights: NonNullable<HymnText["rights"]>;
  scriptureRefs: string[];
  source: NonNullable<HymnText["source"]>;
}

const cache = new Map<string, unknown>();

function readJson<T>(rel: string): T | null {
  const hit = cache.get(rel);
  if (hit) return hit as T;
  const file = path.join(DATA, rel);
  if (!fs.existsSync(file)) return null;
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as T;
  cache.set(rel, value);
  return value;
}

export function readManifest(): Manifest {
  const m = readJson<Manifest>("manifest.json");
  if (!m) throw new Error("Lofzangenmanifest ontbreekt");
  return m;
}

export const NLD_EDITION: HymnbookEdition = {
  id: NLD_EDITION_ID,
  language: "nld",
  title: "Lofzangen (huidige Nederlandstalige zangboek)",
  sourceUrl: "https://www.churchofjesuschrist.org/study/manual/hymns?lang=nld",
  entries: [],
};

function words(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

function mergeLines(texts: string[], link: LinkLine[] | undefined): HymnLine[] {
  return texts.map((text, j) => {
    const ws = words(text);
    const l = link?.[Math.min(j, (link?.length ?? 1) - 1)];
    const exact = l && link && j < link.length && l.words.length === ws.length;
    return {
      text,
      words: ws.map((w, k) => {
        const b = exact ? (l.words[k] ?? null) : null;
        const syl = exact ? l.syl[k] : null;
        return syl && b !== null ? { w, b, syl } : { w, b };
      }),
      startBeat: l ? l.start : null,
    };
  });
}

/** De tekst met (indien beschikbaar) de koppeling aan de muziek. Zonder koppeling zijn alle beats null: dan is het een leesweergave. */
export function loadText(number: number): { text: HymnText; link: LinkFile | null } | null {
  const pad = String(number).padStart(3, "0");
  const t = readJson<TextFile>(`text/${pad}.json`);
  if (!t) return null;
  const link = readJson<LinkFile>(`link/${pad}.json`);
  const stanzas: HymnStanza[] = t.stanzas.map((s) => {
    const l = link?.stanzas.find((x) => x.n === s.n);
    return { n: s.n, linking: l ? l.linking : "line", lines: mergeLines(s.lines, l?.lines) };
  });
  const chorusTexts = t.choruses[0];
  const chorus = chorusTexts ? { linking: link?.chorus ? link.chorus.linking : ("line" as const), lines: mergeLines(chorusTexts, link?.chorus?.lines) } : null;
  const text: HymnText = {
    id: `nld:${number}`,
    compositionId: link?.compositionId ?? "",
    language: "nld",
    title: t.title,
    subtitle: t.subtitle,
    tempoLabel: t.tempoLabel,
    textCredit: t.textCredit,
    musicCredit: t.musicCredit,
    notices: t.notices,
    rights: t.rights,
    scriptureRefs: t.scriptureRefs,
    source: t.source,
    stanzas,
    chorus,
    extraChorusVariants: Math.max(0, t.choruses.length - 1),
  };
  return { text, link };
}

export function loadComposition(compositionId: string): HymnComposition | null {
  const slug = compositionId.replace(/^comp:/, "");
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  return readJson<HymnComposition>(`music/${slug}.json`);
}

const melodyCache = new Map<string, MelodyResult | null>();

/**
 * De betrouwbare melodie van een compositie (score/melody.ts), afgeleid van de notatielaag met de lettergrepen van couplet 1 als
 * controle. Wordt per proces één keer uitgerekend; zonder notatie of bij twijfel is de status "uncertain" en blijft de melodie ongebruikt.
 */
export function loadMelody(compositionId: string): MelodyResult | null {
  if (melodyCache.has(compositionId)) return melodyCache.get(compositionId) ?? null;
  const composition = loadComposition(compositionId);
  let result: MelodyResult | null = null;
  if (composition) {
    const slug = compositionId.replace(/^comp:/, "");
    const raw = /^[a-z0-9-]+$/.test(slug) ? readJson<RawHymnNotation>(`notation/${slug}.json`) : null;
    const first = readManifest().hymns.find((h) => h.music.compositionId === compositionId);
    const stanza = first ? loadText(first.number)?.text.stanzas[0] : undefined;
    const syllableBeats =
      stanza && stanza.linking === "word"
        ? stanza.lines.flatMap((l) => l.words).flatMap((w) => (w.syl ? w.syl.map((x) => x[1]) : w.b !== null ? [w.b] : []))
        : [];
    result = reconstructMelody(composition, raw ? decodeNotation(raw) : null, { syllableBeats });
  }
  melodyCache.set(compositionId, result);
  return result;
}

/** Alleen de betrouwbare melodie (status "ok") als [beat, duur, midi]; anders null. */
export function loadReliableMelody(compositionId: string): [number, number, number][] | null {
  const m = loadMelody(compositionId);
  return m && m.status === "ok" ? m.notes : null;
}

export function loadReadableHymn(number: number): ReadableHymn | null {
  const manifest = readManifest();
  const entry = manifest.hymns.find((h) => h.number === number);
  if (!entry) return null;
  const loaded = loadText(number);
  const composition = entry.capabilities.scoreValidated && entry.music.compositionId ? loadComposition(entry.music.compositionId) : null;
  return {
    number,
    title: entry.title,
    text: loaded?.text ?? null,
    composition,
    melody: composition ? loadReliableMelody(composition.id) : null,
    edition: NLD_EDITION,
    capabilities: entry.capabilities,
    unavailableReason: loaded ? null : "license",
  };
}

/** Een lofzang zoals de engine hem nodig heeft; alleen als de muziek gevalideerd is. */
export function loadResolvedHymn(number: number): ResolvedHymn | null {
  const r = loadReadableHymn(number);
  if (!r || !r.text || !r.composition) return null;
  return { number, edition: r.edition, text: { ...r.text, compositionId: r.composition.id }, composition: r.composition, melody: r.melody ?? null };
}

export function listIndex(): HymnIndexEntry[] {
  const manifest = readManifest();
  const search = readJson<[number, string, string][]>("search.json") ?? [];
  const first = new Map(search.map(([n, , f]) => [n, f]));
  return manifest.hymns.map((h) => ({
    number: h.number,
    title: h.title,
    firstLine: first.get(h.number) ?? "",
    textAvailable: h.textStatus === "volledig",
    capabilities: h.capabilities,
  }));
}

/** Alle gevalideerde composities met de nummers die ze delen (één melodie kan onder meerdere nummers staan). */
export function loadRecognitionBundle(): {
  compositions: HymnComposition[];
  members: { compositionId: string; number: number; title: string }[];
  calibration: Record<string, { t: number[]; mean: number[]; std: number[] }>;
  /** Betrouwbare melodieën per compositie-id (alleen waar ze gecontroleerd zijn); ontbrekende composities herkennen alleen via chroma. */
  melodies: Record<string, [number, number, number][]>;
} {
  const manifest = readManifest();
  const members = manifest.hymns
    .filter((h) => h.capabilities.recognizable && h.music.compositionId)
    .map((h) => ({ compositionId: h.music.compositionId as string, number: h.number, title: h.title }));
  const ids = [...new Set(members.map((m) => m.compositionId))];
  const compositions = ids.map((id) => loadComposition(id)).filter((c): c is HymnComposition => c !== null);
  // z-normalisatie van het tracker-bewijs per compositie (scripts/hymns/calibrate-evidence.ts); ontbreekt bij een nieuwe bibliotheek tot de kalibratie draait
  const calibration = readJson<Record<string, { t: number[]; mean: number[]; std: number[] }>>("evidence-calibration.json") ?? {};
  const melodies: Record<string, [number, number, number][]> = {};
  for (const c of compositions) {
    const m = loadReliableMelody(c.id);
    if (m) melodies[c.id] = m.map(([t, d, n]) => [Math.round(t * 1000) / 1000, Math.round(d * 1000) / 1000, n] as [number, number, number]);
  }
  return { compositions, members, calibration, melodies };
}

export interface LibraryReport {
  dataVersion: string;
  counts: Record<string, unknown>;
  /** Per lofzang met een beperking: nummer, titel en de concrete reden(en). Volledig geïmporteerde lofzangen staan hier niet. */
  incomplete: { number: number; title: string; levels: string[]; problems: string[] }[];
}

/** Kwaliteitsoverzicht voor beheerders: exacte aantallen en per onvolledige lofzang de concrete reden. */
export function buildReport(): LibraryReport {
  const manifest = readManifest();
  const incomplete = manifest.hymns
    .map((h) => {
      const problems = [...(h.textIssues ?? []), ...(h.music.reasons ?? [])];
      if (h.textStatus === "niet-gepubliceerd") problems.unshift("tekst niet gepubliceerd door de kerk (licentiebeperking)");
      const levels: string[] = [];
      if (h.textStatus === "volledig") levels.push("tekst");
      if (h.capabilities.scoreValidated) levels.push("muziek");
      if (h.capabilities.wordFollowing) levels.push("woordvolging");
      if (h.capabilities.recognitionValidated) levels.push("herkenning gevalideerd");
      return { number: h.number, title: h.title, levels, problems, complete: h.textStatus === "volledig" && h.capabilities.scoreValidated };
    })
    .filter((h) => !h.complete)
    .map((h) => ({ number: h.number, title: h.title, levels: h.levels, problems: h.problems }));
  return { dataVersion: manifest.dataVersion, counts: manifest.counts, incomplete };
}

/**
 * De gegevens voor de bladmuziek van één lofzang: de ruwe notatie en per couplet een validatiestatus.
 * De MusicXML zelf wordt op het toestel gebouwd (puur, deterministisch); hier wordt alleen vastgesteld of die per couplet
 * klopt: lettergrepen aan elke noot gekoppeld, geen problemen bij het graveren. Zonder notatie: null (de tekst blijft leesbaar).
 */
export function loadSheetData(number: number): SheetData | null {
  const pad = String(number).padStart(3, "0");
  const link = readJson<LinkFile>(`link/${pad}.json`);
  if (!link) return null;
  const slug = link.compositionId.replace(/^comp:/, "");
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const raw = readJson<RawHymnNotation>(`notation/${slug}.json`);
  if (!raw) return null;
  const notation = decodeNotation(raw);
  const chorus = link.chorus ? syllablesOf(link.chorus) : null;
  const stanzas: SheetStanzaStatus[] = link.stanzas.map((s) => {
    const verse = syllablesOf(s);
    if (!verse.syllables) return { n: s.n, status: "geen-tekstkoppeling", reason: verse.problems[0]?.code ?? "geen-koppeling", lyrics: null };
    if (chorus && !chorus.syllables) return { n: s.n, status: "geen-tekstkoppeling", reason: chorus.problems[0]?.code ?? "refrein", lyrics: null };
    const syl = [...verse.syllables, ...(chorus?.syllables ?? [])];
    const built = buildMusicXml(notation, { syllables: syl });
    const ok = built.problems.length === 0 && built.lyricsPlaced === syl.length;
    return { n: s.n, status: ok ? "ok" : "mislukt", reason: ok ? null : (built.problems[0]?.code ?? "onvolledig"), lyrics: ok ? syl : null };
  });
  return { number, notation: raw, stanzas, chorus: link.chorus ? { linked: Boolean(chorus?.syllables) } : null };
}
