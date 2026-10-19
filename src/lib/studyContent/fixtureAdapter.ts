import { z } from "zod";
import { createHash } from "node:crypto";
import {
  parseStudyDocument,
  safeStudyUrlSchema,
  studyAnchorSchema,
  studySourceKeySchema,
  type StudyDocument,
} from "./schema";
import { studyObjectHash, StudyPublishingError } from "./policy";
import { referenceEvidenceVersion } from "@/lib/references/evidence";
import { validateStudyRevision, type StudyRevisionInput } from "./revisions";
import { cfmPersonalFixtureItem } from "./cfmPersonalFixture";

export const STUDY_FIXTURES = [
  "sample",
  "updated",
  "unresolved",
  "invalid",
  "batch-error",
  "rights-conflict",
  "references",
  "cfm-personal",
] as const;
export type StudyFixtureKey = (typeof STUDY_FIXTURES)[number];
export const FIXTURE_IMAGE =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQYlWPYcuLOf3yYYWQoAAAf2tXBn5xYFQAAAABJRU5ErkJggg==";
export interface SnapshotAsset {
  mediaKey: string;
  base64: string;
  mimeType: string;
  checksum: string;
  sourceKey: string;
  rights: StudyRevisionInput["rightsMetadata"];
}
export interface SnapshotItem extends StudyRevisionInput {
  startsOn?: string;
  endsOn?: string;
  sourceKey: string;
  slug: string;
  order: number;
  media: SnapshotAsset[];
  expectedAnchors: string[];
  expectedMedia: string[];
  expectedReferences: string[];
  evidence: Array<{ occurrenceKey: string; url: string; evidenceKey: string }>;
}
export interface StudySnapshot {
  workKey: string;
  editionKey: string;
  language: "nl";
  adapterName: "synthetic-v1" | "cfm-2026-nl-v1" | "fsy-legacy-v1";
  adapterVersion: "1" | "2";
  sourceVersion: string;
  synthetic: boolean;
  period: { sourceKey: string; label: string; year: number };
  items: SnapshotItem[];
}
export function studyFixture(
  key: StudyFixtureKey,
  workKey = "synthetic-study-fixture",
): StudySnapshot {
  if (!STUDY_FIXTURES.includes(key)) throw new StudyPublishingError("INVALID");
  const updated = key === "updated",
    unresolved = key === "unresolved";
  const content = [
    {
      type: "text",
      text: updated
        ? "Bijgewerkte synthetische uitleg."
        : "Synthetische uitleg voor een geïsoleerde test.",
    },
  ];
  const body = {
    schemaVersion: 1,
    sections: [
      {
        id: "section-intro",
        blocks: [
          {
            type: "heading",
            id: "heading-intro",
            level: 2,
            content: [{ type: "text", text: "Synthetische les" }],
          },
          { type: "paragraph", id: "paragraph-intro", content },
          {
            type: "list",
            id: "list-intro",
            ordered: false,
            items: [
              {
                id: "item-first",
                content: [{ type: "text", text: "Synthetisch lijstitem" }],
              },
            ],
          },
          {
            type: "quote",
            id: "quote-intro",
            content: [{ type: "text", text: "Een synthetisch citaat." }],
          },
          {
            type: "question",
            id: "question-intro",
            content: [
              {
                type: "text",
                text: updated
                  ? "Bijgewerkte synthetische vraag?"
                  : "Een synthetische vraag?",
              },
            ],
          },
          {
            type: "assignment",
            id: "assignment-intro",
            content: [{ type: "text", text: "Een synthetische opdracht." }],
          },
          {
            type: "figure",
            id: "figure-intro",
            mediaKey: "media-diagram",
            width: 8,
            height: 8,
            alt: "Synthetisch testvlak",
            caption: [{ type: "text", text: "Uitsluitend testmateriaal" }],
          },
          {
            type: "reference",
            id: "reference-intro",
            label: "Synthetische verwijzing",
            target: {
              sourceKey: "fixture:reference",
              externalUrl: "https://example.invalid/fixture-reference",
            },
          },
          { type: "divider", id: "divider-intro" },
        ],
      },
    ],
  };
  const rights = {
    holder: "Versado-testfixture",
    permission:
      "Synthetische fixture; uitsluitend geïsoleerde tests, geen officiële les.",
  };
  const item: SnapshotItem = {
    schemaVersion: 1,
    title: updated
      ? "Synthetische les — versie twee"
      : "Synthetische les — versie één",
    body,
    sourceMetadata: {
      sourceKey: "fixture:lesson",
      name: "Gecontroleerde synthetische fixture",
    },
    rightsMetadata: rights,
    sourceKey: "fixture:lesson",
    slug: "synthetic-lesson",
    order: 0,
    media: [
      {
        mediaKey: "media-diagram",
        base64: FIXTURE_IMAGE,
        mimeType: "image/png",
        checksum: createHash("sha256")
          .update(Buffer.from(FIXTURE_IMAGE, "base64"))
          .digest("hex"),
        sourceKey: "fixture:diagram",
        rights:
          key === "rights-conflict"
            ? { ...rights, permission: "Synthetische fixture met afwijkende mediarechten." }
            : rights,
      },
    ],
    expectedAnchors: [
      "section-intro",
      "heading-intro",
      "paragraph-intro",
      "list-intro",
      "item-first",
      "quote-intro",
      "question-intro",
      "assignment-intro",
      "figure-intro",
      "reference-intro",
      "divider-intro",
    ],
    expectedMedia: ["media-diagram"],
    expectedReferences: ["reference-intro"],
    evidence: unresolved
      ? []
      : [
          {
            occurrenceKey: "reference-intro",
            url: "https://example.invalid/fixture-reference",
            evidenceKey: "synthetic-reviewed-reference-v1",
          },
        ],
  };
  if (key === "invalid")
    (body.sections[0].blocks[0] as { type: string }).type =
      "unknown-meaningful-block";
  const items = [key === "cfm-personal" ? cfmPersonalFixtureItem() : item];
  if(key==="references"){
    const block=(body.sections[0].blocks.find(b=>b.type==="reference") as {label:string;target:Record<string,string>});
    block.label="1 Nephi 1:1–3";
    const url="https://www.churchofjesuschrist.org/study/scriptures/bofm/1-ne/1?lang=nld&id=p1-p3";
    block.target={sourceKey:url,workKey:"bofm",editionKey:"bofm",language:"nl",externalUrl:url};
    item.evidence=[{occurrenceKey:"reference-intro",url,evidenceKey:referenceEvidenceVersion}];
  }
  if (key === "batch-error")
    items.push({
      ...JSON.parse(JSON.stringify(item)),
      sourceKey: "fixture:broken-lesson",
      slug: "synthetic-broken-lesson",
      body: { schemaVersion: 1, sections: [] },
    });
  return {
    workKey,
    editionKey: "fixture-v1",
    language: "nl",
    adapterName: "synthetic-v1",
    adapterVersion: "1",
    sourceVersion: `synthetic-${key}-v1`,
    synthetic: true,
    period: {
      sourceKey: "fixture:period",
      label: "Synthetische testperiode",
      year: 2026,
    },
    items,
  };
}
export function snapshotIdentity(snapshot: StudySnapshot) {
  return studyObjectHash(snapshot);
}

export function studyDocumentInventory(body: StudyDocument) {
  let unanchoredLinks = 0, blockCount = 0, emptyAltFigures = 0;
  const anchors: string[] = [],
    figures: Array<{ mediaKey: string; width: number; height: number }> = [],
    references: Array<{
      occurrenceKey: string;
      label: string;
      target: Record<string, unknown>;
    }> = [];
  function walk(value: unknown) {
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (Array.isArray(row.blocks)) blockCount += row.blocks.length;
    if (typeof row.id === "string") anchors.push(row.id);
    if (row.type === "link") unanchoredLinks++;
    if (row.type === "figure" && typeof row.alt === "string" && !row.alt.trim()) emptyAltFigures++;
    if (row.type === "figure")
      figures.push({
        mediaKey: row.mediaKey as string,
        width: row.width as number,
        height: row.height as number,
      });
    if (row.type === "reference")
      references.push({
        occurrenceKey: row.id as string,
        label: row.label as string,
        target: row.target as Record<string, unknown>,
      });
    for (const child of Object.values(value)) walk(child);
  }
  walk(body);
  return { anchors, figures, references, unanchoredLinks, blockCount, emptyAltFigures };
}
const rightsSchema = z
  .object({
    holder: z.string().min(1).max(500),
    permission: z.string().min(1).max(5000),
    licenseUrl: safeStudyUrlSchema.optional(),
  })
  .strict();
const itemSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().min(1).max(500),
    body: z.unknown(),
    sourceMetadata: z
      .object({
        sourceKey: studySourceKeySchema,
        name: z.string().max(500).optional(),
        url: safeStudyUrlSchema.optional(),
      })
      .strict(),
    rightsMetadata: rightsSchema,
    sourceKey: studySourceKeySchema,
    slug: z
      .string()
      .max(256)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    order: z.number().int().nonnegative(),
    startsOn: z.iso.date().optional(),
    endsOn: z.iso.date().optional(),
    media: z
      .array(
        z
          .object({
            mediaKey: studyAnchorSchema,
            base64: z.string().max(14_000_000),
            mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
            checksum: z.string().regex(/^[a-f0-9]{64}$/),
            sourceKey: studySourceKeySchema,
            rights: rightsSchema,
          })
          .strict(),
      )
      .max(100),
    expectedAnchors: z.array(studyAnchorSchema).min(1).max(20_000),
    expectedMedia: z.array(studyAnchorSchema).max(100),
    expectedReferences: z.array(studyAnchorSchema).max(1000),
    evidence: z
      .array(
        z
          .object({
            occurrenceKey: studyAnchorSchema,
            url: safeStudyUrlSchema,
            evidenceKey: studySourceKeySchema,
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export function validateSnapshotItem(input: SnapshotItem) {
  const item = itemSchema.parse(input);
  const metadata = {
    sourceKey: item.sourceKey,
    slug: item.slug,
    order: item.order,
  };
  const revision = validateStudyRevision({
    schemaVersion: item.schemaVersion,
    title: item.title,
    body: item.body,
    sourceMetadata: item.sourceMetadata,
    rightsMetadata: item.rightsMetadata,
  });
  const inventory = studyDocumentInventory(parseStudyDocument(item.body));
  if (new Set(item.media.map((m) => m.mediaKey)).size !== item.media.length)
    throw new StudyPublishingError("INCOMPLETE");
  if (
    new Set(item.evidence.map((e) => e.occurrenceKey)).size !==
      item.evidence.length ||
    item.evidence.some(
      (e) =>
        !inventory.references.some(
          (r) =>
            r.occurrenceKey === e.occurrenceKey &&
            r.target.externalUrl === e.url,
        ),
    )
  )
    throw new StudyPublishingError("REFERENCES");
  if (inventory.unanchoredLinks) throw new StudyPublishingError("REFERENCES");
  const same = (a: string[], b: string[]) =>
    JSON.stringify([...new Set(a)].sort()) ===
      JSON.stringify([...new Set(b)].sort()) && new Set(b).size === b.length;
  if (
    !same(inventory.anchors, item.expectedAnchors) ||
    !same(
      inventory.figures.map((f) => f.mediaKey),
      item.expectedMedia,
    ) ||
    !same(
      inventory.references.map((r) => r.occurrenceKey),
      item.expectedReferences,
    ) ||
    !same(
      item.media.map((m) => m.mediaKey),
      item.expectedMedia,
    )
  )
    throw new StudyPublishingError("INCOMPLETE");
  return { ...metadata, revision, inventory };
}

/** Het 2A-inhoudshashcontract blijft leidend; pin media via additieve bronmetadata. */
export function snapshotRevisionInput(item: SnapshotItem) {
  const normalized = validateSnapshotItem(item);
  const mediaManifest = item.media
    .map((asset) => {
      const figure = normalized.inventory.figures.find(
        (f) => f.mediaKey === asset.mediaKey,
      );
      if (!figure) throw new StudyPublishingError("MEDIA");
      return {
        mediaKey: asset.mediaKey,
        checksum: asset.checksum,
        mimeType: asset.mimeType as "image/png" | "image/jpeg" | "image/webp",
        width: figure.width,
        height: figure.height,
        rightsHash: studyObjectHash(asset.rights),
      };
    })
    .sort((a, b) =>
      a.mediaKey < b.mediaKey ? -1 : a.mediaKey > b.mediaKey ? 1 : 0,
    );
  return {
    ...normalized.revision,
    sourceMetadata: {
      ...normalized.revision.sourceMetadata,
      mediaManifest,
      referenceAuditHash: studyObjectHash(
        [...item.evidence].sort((a, b) =>
          a.occurrenceKey < b.occurrenceKey
            ? -1
            : a.occurrenceKey > b.occurrenceKey
              ? 1
              : 0,
        ),
      ),
    },
  };
}
