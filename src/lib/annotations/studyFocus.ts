import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { safeReturnPath } from "@/lib/returnTo";
import { selectorSchema, validatePassageSelector, type AnnotationKind, type PassageSelector } from "./contract";
import { placeAnnotation } from "./revisionResolution";

export type AnnotationRef = { kind: AnnotationKind; id: string; mutationVersion: number };
export type AnnotationFocus =
  | { status: "exact"; sectionAnchor: string; blockIds: string[] }
  /** Alleen een voorstel (fase 4D): wordt pas een koppeling na bewuste bevestiging; nooit als bestaande markering getoond. */
  | { status: "proposal"; quote: string; proposalQuote: string; proposal: PassageSelector; annotation: AnnotationRef }
  /** Geen veilige plaats in de huidige revisie: oorspronkelijke quote blijft, de gebruiker kan zelf een passage kiezen. */
  | { status: "orphaned"; quote: string; annotation: AnnotationRef }
  | { status: "missing"; quote: string | null };

const param = z.string().regex(/^(bookmark|highlight|note):[A-Za-z0-9_-]{1,128}$/);

/** Terugkeer naar Mijn studiemap, met filters; elk ander pad is geen studiemapterugweg. */
export function studyFolderReturn(raw: string | null | undefined): string | null {
  const path = safeReturnPath(raw);
  return path && /^\/study-folder(\?|$)/.test(path) ? path : null;
}

/**
 * Bepaalt server-side waar een eigen annotatie in de nu gepinde revisie hoort (revisionResolution.placeAnnotation).
 * Nooit fuzzy matchen of naar een vergelijkbare passage springen: alleen een bewezen exacte plaats wordt gefocust,
 * een unieke kandidaat in dezelfde sectie is een voorstel, en anders blijft het bij de eigen opgeslagen quote.
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
  const select = {
    lessonEditionId: true, revisionId: true, selector: true, mutationVersion: true, resolvedRevisionId: true, resolvedSelector: true,
  } as const;
  const row = kind === "bookmark" ? await client.bookmark.findFirst({ where, select })
    : kind === "highlight" ? await client.highlight.findFirst({ where, select }) : await client.note.findFirst({ where, select });
  if (!row || row.lessonEditionId !== lesson.editionId) return { status: "missing", quote: null };
  const selector = selectorSchema.safeParse(row.selector);
  if (!selector.success) return { status: "missing", quote: null };
  const placement = placeAnnotation(lesson, row);
  const annotation: AnnotationRef = { kind, id, mutationVersion: row.mutationVersion };
  if (placement.status === "EXACT") return { status: "exact", sectionAnchor: placement.selector.sectionAnchor, blockIds: [...new Set(placement.selector.ranges.map((range) => range.blockId))] };
  if (placement.status === "NEEDS_REVIEW") return { status: "proposal", quote: selector.data.exact, proposalQuote: placement.proposal.exact, proposal: placement.proposal, annotation };
  return { status: "orphaned", quote: selector.data.exact, annotation };
}
