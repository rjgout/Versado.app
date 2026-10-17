import { z } from "zod";
import { studyAnchorSchema } from "@/lib/studyContent/schema";
import { ANNOTATION_COLORS } from "./clientContract";

const id = z.string().min(1).max(128);
export const annotationKind = z.enum(["bookmark", "highlight", "note"]);
export type AnnotationKind = z.infer<typeof annotationKind>;
export const annotationColor = z.enum(ANNOTATION_COLORS);
export const selectorSchema = z.object({
  normalizationVersion: z.literal(1),
  originalRevisionId: id,
  sectionAnchor: studyAnchorSchema,
  ranges: z.array(z.object({
    blockId: studyAnchorSchema,
    start: z.number().int().min(0).max(100_000),
    end: z.number().int().positive().max(100_000),
  }).strict()).min(1).max(32),
  exact: z.string().min(1).max(12_000),
  prefix: z.string().max(64),
  suffix: z.string().max(64),
}).strict();
export type PassageSelector = z.infer<typeof selectorSchema>;
export const annotationTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("verse"), verseId: id }).strict(),
  z.object({ type: z.literal("lesson"), lessonEditionId: id, revisionId: id, selector: selectorSchema }).strict()
    .refine(t => t.revisionId === t.selector.originalRevisionId),
]);
export type AnnotationTarget = z.infer<typeof annotationTargetSchema>;
const mutation = {
  kind: annotationKind,
  target: annotationTargetSchema,
  expectedVersion: z.number().int().min(0).max(2_147_483_646),
  actionId: z.uuid().transform(v => v.toLowerCase()),
};
export const annotationPutSchema = z.object({
  ...mutation,
  text: z.string().trim().min(1).max(2000).optional(),
  color: annotationColor.optional(),
}).strict().refine(v => v.kind === "note" ? !!v.text && v.color === undefined
  : v.kind === "highlight" ? v.text === undefined : v.text === undefined && v.color === undefined);
export const annotationDeleteSchema = z.object(mutation).strict();
export type AnnotationAction = z.infer<typeof annotationPutSchema>;

/** v1: NFC, Unicode-witruimte → één spatie, trim; offsets tellen Unicode-codepunten. */
export function normalizeAnnotationText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}
/** Inline-fragmenten sluiten direct aan; structurele eenheden behouden hun eigen stabiele ID. */
type PassageDocument = { readonly sections: readonly { readonly id: string; readonly blocks: readonly unknown[] }[] };
export function passageBlocks(document: PassageDocument, sectionAnchor: string) {
  const result: Array<{ id: string; text: string }> = [];
  const section = document.sections.find(s => s.id === sectionAnchor);
  function inline(values: unknown): string {
    if (!Array.isArray(values)) return "";
    return values.map(v => v.type === "reference" ? v.label : v.text ?? "").join("");
  }
  function walk(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const v = value as Record<string, unknown>;
    let text = inline(v.content);
    if (v.type === "quote" && v.attribution) text += "\n" + inline(v.attribution);
    if (v.type === "figure") text = inline(v.caption);
    if (v.type === "reference") text = String(v.label);
    text = normalizeAnnotationText(text);
    if (text && typeof v.id === "string") result.push({ id: v.id, text });
    for (const key of ["items", "blocks", "children", "rows", "cells"]) walk(v[key]);
  }
  walk(section?.blocks);
  return result;
}
/** Geen fuzzy matching: volgorde, offsets, quote en context moeten exact overeenkomen. */
export function validatePassageSelector(document: PassageDocument, input: PassageSelector): PassageSelector {
  const selector = selectorSchema.parse(input);
  const blocks = passageBlocks(document, selector.sectionAnchor);
  let previousIndex = -1, previousEnd = -1;
  const pieces: string[] = [];
  for (const range of selector.ranges) {
    const index = blocks.findIndex(b => b.id === range.blockId);
    if (index < 0 || index < previousIndex || (index === previousIndex && range.start <= previousEnd)) throw Error("ANNOTATION_SELECTOR");
    const chars = [...blocks[index].text];
    if (range.start >= range.end || range.end > chars.length) throw Error("ANNOTATION_SELECTOR");
    pieces.push(chars.slice(range.start, range.end).join(""));
    previousIndex = index; previousEnd = range.end;
  }
  const first = selector.ranges[0], last = selector.ranges.at(-1)!;
  const prefix = [...blocks.find(b => b.id === first.blockId)!.text].slice(Math.max(0, first.start - 32), first.start).join("");
  const suffix = [...blocks.find(b => b.id === last.blockId)!.text].slice(last.end, last.end + 32).join("");
  if (selector.exact !== pieces.join("\n") || selector.prefix !== prefix || selector.suffix !== suffix) throw Error("ANNOTATION_SELECTOR");
  return selector;
}
