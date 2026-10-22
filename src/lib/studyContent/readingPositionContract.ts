import { z } from "zod";
import { studyAnchorSchema } from "./schema";
import type { PublishedStudyDTO } from "./revisions";

export const readingPositionActionSchema = z
  .object({
    lessonEditionId: z.string().min(1).max(128),
    revisionId: z.string().min(1).max(128),
    sectionAnchor: studyAnchorSchema,
    blockAnchor: studyAnchorSchema,
    sectionFraction: z.number().finite().min(0).max(1),
    expectedVersion: z.number().int().min(0).max(2_147_483_646),
    actionId: z.uuid().transform((value) => value.toLowerCase()),
    intent: z.enum(["SAVE", "START_OVER"]),
    // Alleen nodig bij opslag voor een inmiddels historische, echt geopende revisie.
    visitProof: z.string().min(1).max(1500).optional(),
  })
  .strict();
export type ReadingPositionAction = z.infer<typeof readingPositionActionSchema>;
export type ReadingCoordinate = Pick<
  ReadingPositionAction,
  "revisionId" | "sectionAnchor" | "blockAnchor" | "sectionFraction"
>;
export interface ReadingPositionView extends ReadingCoordinate {
  lessonEditionId: string;
  quoteContext: string | null;
  version: number;
  updatedAt: string;
  lastActionId: string;
}
export interface ReadingPositionState {
  lessonEditionId: string;
  currentRevisionId: string;
  publicationVersion: number;
  position: ReadingPositionView | null;
}
export type ReaderDocument = PublishedStudyDTO["body"];
export function readingBlock(
  document: ReaderDocument,
  section: string,
  block: string,
) {
  return (
    document.sections
      .find((s) => s.id === section)
      ?.blocks.find((b) => b.id === block) ?? null
  );
}
/** Alleen broninhoud, geen notitie of vrij aangeleverde quote. */
export function readingBlockText(
  block: ReaderDocument["sections"][number]["blocks"][number],
): string {
  function text(value: unknown): string {
    if (Array.isArray(value)) return value.map(text).join(" ");
    if (!value || typeof value !== "object") return "";
    const v = value as Record<string, unknown>;
    if (v.type === "text") return String(v.text);
    if (v.type === "link") return String(v.text);
    if (v.type === "reference") return String(v.label);
    if (v.type === "video") return String(v.title);
    return [v.content, v.items, v.children, v.attribution, v.caption, v.rows, v.cells, v.blocks]
      .map(text)
      .filter(Boolean)
      .join(" ");
  }
  return text(block).replace(/\s+/g, " ").trim();
}
export function readingQuote(
  block: ReaderDocument["sections"][number]["blocks"][number],
) {
  const text = readingBlockText(block);
  return [...text].slice(0, 240).join("") || null;
}
export function readingStart(
  document: ReaderDocument,
  revisionId: string,
): ReadingCoordinate {
  const section = document.sections[0];
  return {
    revisionId,
    sectionAnchor: section.id,
    blockAnchor: section.blocks[0].id,
    sectionFraction: 0,
  };
}
export function sameReadingCoordinate(
  a: ReadingCoordinate | null,
  b: ReadingCoordinate | null,
) {
  return (
    !!a &&
    !!b &&
    a.revisionId === b.revisionId &&
    a.sectionAnchor === b.sectionAnchor &&
    a.blockAnchor === b.blockAnchor &&
    Math.abs(a.sectionFraction - b.sectionFraction) < 0.001
  );
}
export function resolveReadingAnchor(
  document: ReaderDocument,
  revisionId: string,
  position: ReadingPositionView | null,
): {
  kind: "NEW" | "EXACT" | "SECTION" | "QUOTE" | "LOST";
  coordinate: ReadingCoordinate | null;
} {
  if (!position)
    return { kind: "NEW", coordinate: readingStart(document, revisionId) };
  if (readingBlock(document, position.sectionAnchor, position.blockAnchor)) {
    return {
      kind: "EXACT",
      coordinate: {
        revisionId,
        sectionAnchor: position.sectionAnchor,
        blockAnchor: position.blockAnchor,
        sectionFraction: position.sectionFraction,
      },
    };
  }
  const section = document.sections.find(
    (s) => s.id === position.sectionAnchor,
  );
  if (section)
    return {
      kind: "SECTION",
      coordinate: {
        revisionId,
        sectionAnchor: section.id,
        blockAnchor: section.blocks[0].id,
        sectionFraction: 0,
      },
    };
  if (position.quoteContext && [...position.quoteContext].length >= 32) {
    const matches = document.sections.flatMap((s) =>
      s.blocks
        .filter((b) => readingBlockText(b).includes(position.quoteContext!))
        .map((b) => ({ s, b })),
    );
    if (matches.length === 1)
      return {
        kind: "QUOTE",
        coordinate: {
          revisionId,
          sectionAnchor: matches[0].s.id,
          blockAnchor: matches[0].b.id,
          sectionFraction: 0,
        },
      };
  }
  return { kind: "LOST", coordinate: null };
}
