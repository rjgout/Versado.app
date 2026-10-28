// Readonly triage van gepinde bronnen. Geen database, publicatie of inhoudelijk goedkeuringsbesluit.
import { writeFileSync } from "node:fs";
import catalogue from "../../data/study-content/cfm-reading-question-sources.json";
import { CFM_SOURCES } from "../../src/lib/studyContent/cfmSources";
import { loadCfmLesson } from "../../src/lib/studyContent/cfm2026Import";
import { personalStudyFor } from "../../src/lib/studyContent/personalStudyOverrides";
import { readingBlockText } from "../../src/lib/studyContent/readingPositionContract";
import {
  preparedStudyQuestions,
  studyExercisePlan,
  validStudyQuestionSource,
} from "../../src/lib/studyContent/exercisePlan";

function scriptureReferences(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value))
    return value.reduce((n, item) => n + scriptureReferences(item), 0);
  const node = value as Record<string, unknown>;
  if (
    node.type === "reference" &&
    node.target &&
    typeof node.target === "object"
  ) {
    const target = node.target as Record<string, unknown>;
    try {
      const url = new URL(String(target.externalUrl ?? target.sourceKey));
      return Number(
        url.hostname === "www.churchofjesuschrist.org" &&
          /^\/study\/scriptures\/(ot|nt|bofm|dc-testament|pgp)\//.test(
            url.pathname,
          ),
      );
    } catch {
      return 0;
    }
  }
  return Object.values(node).reduce<number>(
    (n, item) => n + scriptureReferences(item),
    0,
  );
}
async function main() {
  const rows: Array<{
    work: string;
    week: string;
    step: number;
    triage: number;
    quotes: number;
    pairedQuotes: number;
    catalogue: number;
    validated: number;
    generated: number;
    offered: number;
  }> = [];
  let rejectedSources = 0,
    sources = 0;
  for (const volume of CFM_SOURCES)
    for (const item of volume.manifest.lessons) {
      const parsed = await loadCfmLesson(item.sourceKey, volume);
      const lesson = {
        workKey: volume.manifest.workKey,
        sourceKey: item.sourceKey,
        language: volume.manifest.language,
        editionId: "readonly-audit",
        body: parsed.document,
      };
      const personal = personalStudyFor(lesson);
      if (!personal.supported)
        throw new Error(
          `${lesson.workKey}/${lesson.sourceKey}: niet ondersteund`,
        );
      const prepared = preparedStudyQuestions(lesson),
        plan = studyExercisePlan(lesson, prepared)!;
      const citations =
        (
          catalogue.sources as Record<
            string,
            Array<{
              blockId: string;
              blockTextHash: string;
              quote: string;
              verseRef: string;
              sourceUrl: string;
              seed: number;
            }>
          >
        )[`${lesson.workKey}/${lesson.sourceKey}`] ?? [];
      for (const step of personal.steps) {
        const blocks = lesson.body.sections
          .flatMap((s) => s.blocks)
          .filter((b) => step.blockIds.includes(b.id));
        // Dit detecteert ook liedtitels, toespraaktitels en aangepaste citaten: nooit automatisch goedkeuren.
        const signals = blocks.map((b) => ({
          quotes: [
            ...readingBlockText(b).matchAll(/[‘“"]([^‘’“"”]{20,600})[’”"]/g),
          ].length,
          refs: scriptureReferences(b),
        }));
        const quotes = signals.reduce((n, b) => n + b.quotes, 0),
          pairedQuotes = signals.reduce(
            (n, b) => n + (b.refs ? b.quotes : 0),
            0,
          );
        const declared = citations.filter((c) =>
          step.blockIds.includes(c.blockId),
        );
        const validated = declared.filter((c) =>
          validStudyQuestionSource(lesson, { ...c, type: "FILL_BLANK" }),
        );
        sources += declared.length;
        rejectedSources += declared.length - validated.length;
        const generated = prepared.filter((q) =>
          step.blockIds.includes(q.studySource.blockId),
        ).length;
        const offered = plan.parts[step.index - 1].questions.length;
        const triage =
          offered === 3
            ? 0
            : declared.length
              ? validated.length
                ? 4
                : 3
              : !quotes
                ? 1
                : !pairedQuotes
                  ? 2
                  : 5;
        rows.push({
          work: lesson.workKey,
          week: lesson.sourceKey,
          step: step.index,
          triage,
          quotes,
          pairedQuotes,
          catalogue: declared.length,
          validated: validated.length,
          generated,
          offered,
        });
      }
    }
  const counts = Object.fromEntries(
    [0, 1, 2, 3, 4, 5].map((category) => [
      category,
      rows.filter((r) => r.triage === category).length,
    ]),
  );
  const pairedEveryStep = CFM_SOURCES.flatMap((v) =>
    v.manifest.lessons.map((item) => `${v.manifest.workKey}/${item.sourceKey}`),
  ).filter((key) =>
    rows
      .filter((r) => `${r.work}/${r.week}` === key)
      .every((r) => r.pairedQuotes > 0),
  );
  const result = {
    scope: "104 gepinde Nederlandse lessen; geen productie-inventaris",
    warning:
      "Triage 1/2/5 zijn tekstsignalen, geen bewezen inhoudelijke beschikbaarheid. Citaat naast verwijzing bewijst geen schriftcitaat.",
    steps: rows.length,
    counts,
    catalogueSources: sources,
    rejectedCatalogueSources: rejectedSources,
    missingWithoutCatalogue: rows.filter(
      (r) => r.offered < 3 && r.catalogue === 0,
    ).length,
    pairedEveryStep,
  };
  console.log(JSON.stringify(result, null, 2));
  const arg = process.argv.indexOf("--csv");
  if (arg >= 0) {
    const columns = [
      "work",
      "week",
      "step",
      "triage",
      "quotes",
      "pairedQuotes",
      "catalogue",
      "validated",
      "generated",
      "offered",
    ] as const;
    writeFileSync(
      process.argv[arg + 1],
      [
        columns.join(","),
        ...rows.map((r) => columns.map((c) => r[c]).join(",")),
        "",
      ].join("\n"),
    );
  }
}
void main();
