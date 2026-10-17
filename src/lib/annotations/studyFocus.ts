import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { safeReturnPath } from "@/lib/returnTo";
import { selectorSchema, validatePassageSelector, type AnnotationKind } from "./contract";

export type AnnotationFocus =
  | { status: "exact"; sectionAnchor: string; blockIds: string[] }
  | { status: "revision" | "missing"; quote: string | null };

const param = z.string().regex(/^(bookmark|highlight|note):[A-Za-z0-9_-]{1,128}$/);

/** Terugkeer naar Mijn studiemap, met filters; elk ander pad is geen studiemapterugweg. */
export function studyFolderReturn(raw: string | null | undefined): string | null {
  const path = safeReturnPath(raw);
  return path && /^\/study-folder(\?|$)/.test(path) ? path : null;
}

/**
 * Bepaalt server-side of een eigen annotatie exact in de nu gepinde revisie terug te vinden is.
 * Nooit fuzzy matchen of naar een vergelijkbare passage springen: bij een andere revisie of een niet
 * valide selector blijft het bij een melding met de eigen opgeslagen quote (herstel hoort bij fase 4D).
 */
export async function resolveAnnotationFocus(
  actor: { id: string },
  raw: string | null | undefined,
  lesson: { editionId: string; revisionId: string; body: Parameters<typeof validatePassageSelector>[0] },
  client: PrismaClient = prisma,
): Promise<AnnotationFocus | null> {
  const parsed = param.safeParse(raw);
  if (!parsed.success) return null;
  const [kind, id] = parsed.data.split(":") as [AnnotationKind, string];
  const where = { id, userId: actor.id, deletedAt: null };
  const select = { lessonEditionId: true, revisionId: true, selector: true } as const;
  const row = kind === "bookmark" ? await client.bookmark.findFirst({ where, select })
    : kind === "highlight" ? await client.highlight.findFirst({ where, select }) : await client.note.findFirst({ where, select });
  if (!row || row.lessonEditionId !== lesson.editionId) return { status: "missing", quote: null };
  const selector = selectorSchema.safeParse(row.selector);
  if (!selector.success) return { status: "missing", quote: null };
  if (row.revisionId !== lesson.revisionId) return { status: "revision", quote: selector.data.exact };
  try {
    const valid = validatePassageSelector(lesson.body, selector.data);
    return { status: "exact", sectionAnchor: valid.sectionAnchor, blockIds: [...new Set(valid.ranges.map((range) => range.blockId))] };
  } catch {
    return { status: "missing", quote: selector.data.exact };
  }
}
