import { z } from "zod";
import { studyWorkKeySchema } from "@/lib/studyContextContract";

/** Bronadapter levert blijvende ankers; nooit hashes, vertaalde titels of array-indexen. */
export const studyAnchorSchema = z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/);
const text = z.string().min(1).max(20_000).refine(value => value.trim().length > 0 && !/<\/?[a-z][^>]*>/i.test(value), "Geen HTML in semantische tekst");
export const safeStudyUrlSchema = z.string().max(2048).refine(value => {
  if (/[\u0000-\u0020\\]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}, "Alleen absolute HTTPS-bronlinks zonder credentials");
export const studySourceKeySchema = z.string().min(1).max(512).refine(value => value.trim().length > 0 && !/[\u0000-\u001f]/.test(value), "Geldige officiële bronsleutel vereist");
const referenceTarget = z.object({
  sourceKey: studySourceKeySchema,
  workKey: studyWorkKeySchema.optional(),
  editionKey: z.string().min(1).max(128).optional(),
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  externalUrl: safeStudyUrlSchema.optional(),
}).strict();
const reference = z.object({ type: z.literal("reference"), id: studyAnchorSchema, label: text, target: referenceTarget }).strict();
const inline = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text, marks: z.array(z.enum(["emphasis", "strong"])).max(2).optional() }).strict(),
  z.object({ type: z.literal("link"), text, href: safeStudyUrlSchema }).strict(),
  reference,
]);
const inlines = z.array(inline).min(1).max(200);
const listItem = z.object({ id: studyAnchorSchema, content: inlines,
  // Eén extra lijstniveau; geen onbegrensde recursie of rauwe blokken.
  children: z.array(z.object({ id: studyAnchorSchema, content: inlines }).strict()).min(1).max(100).optional(),
}).strict();
const prose = { id: studyAnchorSchema, content: inlines };
export const studyBlockSchema = z.discriminatedUnion("type", [
  z.object({ ...prose, type: z.literal("heading"), level: z.number().int().min(2).max(6) }).strict(),
  z.object({ ...prose, type: z.literal("paragraph") }).strict(),
  z.object({ id: studyAnchorSchema, type: z.literal("list"), ordered: z.boolean(), items: z.array(listItem).min(1).max(100) }).strict(),
  z.object({ ...prose, type: z.literal("quote"), attribution: inlines.optional() }).strict(),
  z.object({ ...prose, type: z.literal("question"), items: z.array(listItem).min(1).max(100).optional() }).strict(),
  z.object({ ...prose, type: z.literal("assignment"), items: z.array(listItem).min(1).max(100).optional() }).strict(),
  z.object({ id: studyAnchorSchema, type: z.literal("figure"), mediaKey: studyAnchorSchema, alt: text,
    caption: inlines.optional(), width: z.number().int().min(1).max(16_384), height: z.number().int().min(1).max(16_384) }).strict(),
  reference,
  z.object({ id: studyAnchorSchema, type: z.literal("divider") }).strict(),
]);
export const studyDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  sections: z.array(z.object({ id: studyAnchorSchema, blocks: z.array(studyBlockSchema).min(1).max(200) }).strict()).min(1).max(200),
}).strict().superRefine((document, ctx) => {
  const ids = new Set<string>();
  function walk(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && "id" in value && typeof value.id === "string") {
      if (ids.has(value.id)) ctx.addIssue({ code: "custom", message: `Dubbel anker: ${value.id}` });
      ids.add(value.id);
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(document);
});
export type StudyDocument = z.infer<typeof studyDocumentSchema>;

/** Eerst begrenzen: corrupte/cyclische/diep geneste JSON mag Zod niet overbelasten. */
export function parseStudyDocument(value: unknown): StudyDocument {
  const stack: Array<{ value: unknown; depth: number; exit?: boolean }> = [{ value, depth: 0 }];
  const seen = new Set<object>(); let nodes = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.exit) { seen.delete(entry.value as object); continue; }
    if (++nodes > 100_000 || entry.depth > 12) throw new Error("STUDY_DOCUMENT_LIMIT");
    if (entry.value && typeof entry.value === "object") {
      if (seen.has(entry.value)) throw new Error("STUDY_DOCUMENT_CYCLE");
      seen.add(entry.value);
      stack.push({ ...entry, exit: true });
      for (const child of Object.values(entry.value)) stack.push({ value: child, depth: entry.depth + 1 });
    }
  }
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 2_000_000) throw new Error("STUDY_DOCUMENT_LIMIT");
  return studyDocumentSchema.parse(value);
}
