/* Zuiver rendermodel van de studieles-spike: geen React, geen native code, volledig testbaar zonder toestel.
 *
 * Het bestaande lesdocument (`StudyDocument`, src/lib/studyContent/schema.ts) wordt in dezelfde volgorde doorlopen als
 * `passageBlocks` (src/lib/annotations/contract.ts), zodat blok-id's en genormaliseerde teksten van de selector overeenkomen met
 * wat het contract en de server verwachten. Aaneengesloten tekstblokken vormen één "run": één native tekstcomponent met één
 * selecteerbare string. Een figuur, tabel, streep of video onderbreekt een run (een selectie loopt dus niet over een afbeelding heen).
 *
 * De bedrijfsregels blijven in het contract (normalisatie, selectorvalidatie, plaatsing door de server); deze module vertaalt alleen
 * tussen native UTF-16-offsets in de weergegeven string en de codepunt-offsets per blok van het contract. */
import type { StudyDocument } from "@/lib/studyContent/schema";
import { normalizeAnnotationText, selectorSchema, validatePassageSelector, passageBlocks, type PassageSelector } from "@/lib/annotations/contract";
import { normalizedOffset, snap } from "@poc/reader/selectionModel";

type Block = StudyDocument["sections"][number]["blocks"][number];
type Inline = Extract<Block, { type: "paragraph" }>["content"][number];

export type UnitRole = "heading" | "paragraph" | "quote" | "item" | "subitem" | "question" | "cell" | "caption" | "reference";
/** Eén stuk lopende tekst met één opmaak (vet, cursief, verwijzing). */
export interface Part { text: string; strong?: boolean; emphasis?: boolean; ref?: { id: string; url: string | null }; attribution?: boolean }
export interface TextUnit {
  id: string;
  role: UnitRole;
  level?: number;
  /** Alleen weergave (opsommingsteken, nummer); nooit onderdeel van de brontekst en niet selecteerbaar als tekst van het blok. */
  prefix: string;
  indent: number;
  header?: boolean;
  parts: Part[];
  /** De ruwe brontekst van het blok zoals `passageBlocks` hem samenstelt (vóór normalisatie). */
  raw: string;
}
export type Item =
  | { type: "run"; key: string; units: TextUnit[] }
  | { type: "figure"; id: string; mediaKey: string; alt: string; width: number; height: number; caption: TextUnit | null }
  | { type: "table"; id: string; rows: { id: string; cells: { id: string; header: boolean; colSpan: number; unit: TextUnit }[] }[] }
  | { type: "video"; id: string; title: string; externalUrl: string }
  | { type: "divider"; id: string };

function parts(values: readonly Inline[]): Part[] {
  return values.map<Part>(v => v.type === "text"
    ? { text: v.text, strong: v.marks?.includes("strong"), emphasis: v.marks?.includes("emphasis") }
    : v.type === "reference" ? { text: v.label, ref: { id: v.id, url: v.target.externalUrl ?? null } }
    : { text: v.text });
}
const join = (ps: readonly Part[]) => ps.map(p => p.text).join("");
function unit(id: string, role: UnitRole, content: readonly Inline[], extra: Partial<TextUnit> = {}): TextUnit {
  const ps = parts(content);
  return { id, role, prefix: "", indent: 0, parts: ps, raw: join(ps), ...extra };
}

/** Een lijst of blok in documentvolgorde. Volgorde is gelijk aan `passageBlocks`: eerst de eigen tekst, dan items, blokken, kinderen. */
function flatten(blocks: readonly unknown[], out: (TextUnit | Exclude<Item, { type: "run" }>)[], indent: number) {
  for (const raw of blocks) {
    const b = raw as Block & { items?: unknown[]; blocks?: unknown[]; children?: unknown[] };
    switch (b.type) {
      case "heading": out.push(unit(b.id, "heading", b.content, { level: b.level })); break;
      case "paragraph": out.push(unit(b.id, "paragraph", b.content, { indent })); break;
      case "quote": {
        const u = unit(b.id, "quote", b.content, { indent });
        if (b.attribution) { u.parts.push({ text: "\n" }, ...parts(b.attribution).map(p => ({ ...p, attribution: true }))); u.raw = join(u.parts); }
        out.push(u); break;
      }
      case "question": case "assignment":
        out.push(unit(b.id, "question", b.content, { indent }));
        items(b.items as never, out, indent + 1, false); break;
      case "reference": out.push(unit(b.id, "reference", [{ type: "reference", id: b.id, label: b.label, target: b.target }], { indent })); break;
      case "list": items(b.items as never, out, indent, b.ordered); break;
      case "figure": out.push({ type: "figure", id: b.id, mediaKey: b.mediaKey, alt: b.alt, width: b.width, height: b.height, caption: b.caption ? unit(b.id, "caption", b.caption) : null }); break;
      case "video": out.push({ type: "video", id: b.id, title: b.title, externalUrl: b.externalUrl }); break;
      case "table": out.push({ type: "table", id: b.id, rows: b.rows.map(r => ({ id: r.id, cells: r.cells.map(c => ({ id: c.id, header: c.header, colSpan: c.colSpan, unit: unit(c.id, "cell", c.content, { header: c.header }) })) })) }); break;
      case "divider": out.push({ type: "divider", id: b.id }); break;
    }
  }
}
function items(list: { id: string; content: readonly Inline[]; blocks?: unknown[]; children?: { id: string; content: readonly Inline[] }[] }[] | undefined, out: (TextUnit | Exclude<Item, { type: "run" }>)[], indent: number, ordered: boolean) {
  (list ?? []).forEach((item, i) => {
    out.push(unit(item.id, "item", item.content, { indent, prefix: ordered ? `${i + 1}. ` : "• " }));
    if (item.blocks) flatten(item.blocks, out, indent + 1);
    item.children?.forEach(c => out.push(unit(c.id, "subitem", c.content, { indent: indent + 1, prefix: "– " })));
  });
}

/** Het document van één sectie als weergave-items; aaneengesloten tekstblokken zijn samengevoegd tot één run. */
export function buildItems(document: StudyDocument, sectionId: string): Item[] {
  const section = document.sections.find(s => s.id === sectionId);
  const flat: (TextUnit | Exclude<Item, { type: "run" }>)[] = [];
  flatten(section?.blocks ?? [], flat, 0);
  const result: Item[] = [];
  for (const entry of flat) {
    if ("role" in entry) {
      const last = result[result.length - 1];
      if (last?.type === "run") last.units.push(entry); else result.push({ type: "run", key: entry.id, units: [entry] });
    } else if (entry.type === "figure" && entry.caption) {
      // De bijschrifttekst is zelf selecteerbare tekst: eigen run direct onder de afbeelding.
      result.push(entry);
      result.push({ type: "run", key: `${entry.id}:caption`, units: [entry.caption] });
    } else result.push(entry);
  }
  return result;
}

export interface UnitSpan { unit: TextUnit; /** Begin van de ruwe tekst in de weergegeven string (UTF-16). */ start: number; end: number }
export interface RunLayout { text: string; spans: UnitSpan[] }
/** Eén lege regel tussen blokken, geen tussenruimte binnen een opsomming. De weergave moet exact `text` opbouwen. */
export function buildRunLayout(units: readonly TextUnit[]): RunLayout {
  let text = "";
  const spans: UnitSpan[] = [];
  units.forEach((u, i) => {
    if (i > 0) text += (u.role === "item" || u.role === "subitem") && (units[i - 1]!.role === "item" || units[i - 1]!.role === "subitem") ? "\n" : "\n\n";
    text += u.prefix;
    const start = text.length;
    text += u.raw;
    spans.push({ unit: u, start, end: text.length });
  });
  return { text, spans };
}

export interface LessonRange { blockId: string; /** UTF-16 in de ruwe blokttekst. */ from: number; to: number; /** Codepunten in de genormaliseerde blokttekst (contract). */ start: number; end: number; exact: string }
export function selectionToRanges(layout: RunLayout, selStart: number, selEnd: number): LessonRange[] {
  const a = Math.min(selStart, selEnd), b = Math.max(selStart, selEnd);
  if (a === b) return [];
  const ranges: LessonRange[] = [];
  for (const span of layout.spans) {
    const from = Math.max(a, span.start) - span.start, to = Math.min(b, span.end) - span.start;
    if (to <= from) continue;
    const raw = span.unit.raw, f = snap(raw, from, -1), t = snap(raw, to, 1);
    const start = normalizedOffset(raw, f), end = normalizedOffset(raw, t);
    if (end <= start) continue;
    ranges.push({ blockId: span.unit.id, from: f, to: t, start, end, exact: [...normalizeAnnotationText(raw)].slice(start, end).join("") });
  }
  return ranges;
}
export const rangesLabel = (ranges: readonly LessonRange[]) => ranges.length <= 1 ? "1 blok" : `${ranges.length} blokken`;
export const rangesText = (ranges: readonly LessonRange[]) => ranges.map(r => r.exact).join(" ");

/** De selectie als selector in het bestaande offsetmodel, gecontroleerd door `validatePassageSelector` (geen eigen validatie). */
export function rangesToLessonSelector(document: StudyDocument, sectionId: string, revisionId: string, ranges: readonly LessonRange[]): PassageSelector {
  if (!ranges.length) throw Error("SELECTION");
  const blocks = passageBlocks(document, sectionId);
  const text = (id: string) => [...(blocks.find(b => b.id === id)?.text ?? "")];
  const first = ranges[0]!, last = ranges[ranges.length - 1]!;
  return validatePassageSelector(document, selectorSchema.parse({
    normalizationVersion: 1, originalRevisionId: revisionId, sectionAnchor: sectionId,
    ranges: ranges.map(r => ({ blockId: r.blockId, start: r.start, end: r.end })),
    exact: ranges.map(r => r.exact).join("\n"),
    prefix: text(first.blockId).slice(Math.max(0, first.start - 32), first.start).join(""),
    suffix: text(last.blockId).slice(last.end, last.end + 32).join(""),
  }));
}

/** Omgekeerd: een (door de server geplaatste) selector terug naar UTF-16-bereiken in de ruwe blokttekst, om te markeren. */
const boundaryCache = new Map<string, { raw: number; norm: number }[]>();
function boundaries(raw: string) {
  let cached = boundaryCache.get(raw);
  if (cached) return cached;
  cached = [];
  for (let i = 0; i <= raw.length; i++) {
    if (i > 0 && i < raw.length && /[\uDC00-\uDFFF]/u.test(raw[i]!) && /[\uD800-\uDBFF]/u.test(raw[i - 1]!)) continue;
    try { cached.push({ raw: i, norm: normalizedOffset(raw, i) }); } catch { /* grens midden in een NFC-compositie */ }
  }
  if (boundaryCache.size > 500) boundaryCache.clear();
  boundaryCache.set(raw, cached);
  return cached;
}
export function normalizedRangeToRaw(raw: string, start: number, end: number): { from: number; to: number } | null {
  const b = boundaries(raw);
  // Begin: laatste grens met deze offset (voorbij witruimte); einde: eerste grens (direct na het laatste teken).
  let from = -1, to = -1;
  for (const x of b) { if (x.norm === start) from = x.raw; }
  for (const x of b) { if (x.norm === end) { to = x.raw; break; } }
  return from >= 0 && to > from ? { from, to } : null;
}
export interface Mark { from: number; to: number; color: string | null; note: boolean }
/** Per blok-id de bereiken (UTF-16) van alle eigen annotaties die de server als EXACT geplaatst heeft. */
export function marksByBlock(units: readonly TextUnit[], annotations: readonly { kind: string; deleted: boolean; color?: string | null; placement?: { status: string; selector?: PassageSelector } }[]): Map<string, Mark[]> {
  const byId = new Map(units.map(u => [u.id, u]));
  const out = new Map<string, Mark[]>();
  for (const a of annotations) {
    if (a.deleted || a.kind === "bookmark" || a.placement?.status !== "EXACT" || !a.placement.selector) continue;
    for (const r of a.placement.selector.ranges) {
      const u = byId.get(r.blockId);
      if (!u) continue;
      const raw = normalizedRangeToRaw(u.raw, r.start, r.end);
      if (!raw) continue;
      (out.get(u.id) ?? out.set(u.id, []).get(u.id)!).push({ ...raw, color: a.kind === "highlight" ? a.color ?? "yellow" : null, note: a.kind === "note" });
    }
  }
  return out;
}

export interface Segment { text: string; part: Part; color: string | null; note: boolean }
/** Splitst een eenheid op de grenzen van opmaak en annotaties; de segmenten samen zijn exact `unit.raw`. */
export function segments(unit: TextUnit, marks: readonly Mark[] = []): Segment[] {
  const out: Segment[] = [];
  let offset = 0;
  for (const part of unit.parts) {
    const cuts = new Set<number>([0, part.text.length]);
    for (const m of marks) for (const edge of [m.from - offset, m.to - offset]) if (edge > 0 && edge < part.text.length) cuts.add(edge);
    const sorted = [...cuts].sort((x, y) => x - y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const s = sorted[i]!, e = sorted[i + 1]!;
      const covering = marks.filter(m => m.from <= offset + s && m.to >= offset + e);
      const color = [...covering].reverse().find(m => m.color)?.color ?? null;
      out.push({ text: part.text.slice(s, e), part, color, note: covering.some(m => m.note) });
    }
    offset += part.text.length;
  }
  return out;
}
