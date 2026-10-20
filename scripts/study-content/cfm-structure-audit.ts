// Fase 0-audit van "CFM Persoonlijke Studie 2.0": hoe is de gepubliceerde CFM-lesdocumentstructuur opgebouwd en is die in alle 52
// lessen gelijk? Alleen lezen: laadt de gepinde bronbestanden (data/study-content/cfm-2026-nl) via dezelfde adapter als de import.
//   npx tsx scripts/study-content/cfm-structure-audit.ts [--json]
import { loadCfmLesson } from "../../src/lib/studyContent/cfm2026Import";
import { cfmOldTestament2026NlManifest as manifest } from "../../src/lib/studyContent/cfm2026Manifest";
import { readingBlockText } from "../../src/lib/studyContent/readingPositionContract";

const STUDY = "Studietips voor thuis en in de kerk";
const KIDS = "Ideeën voor onderwijs aan kinderen";
const META = /^b-(reference|short_reference|title_number|scripture_title)\d*$|^b-source-/;
const FOR_TEACHER = /^b-figure\d+_p\d+$/;

interface Row {
  lesson: string; sections: number; blocks: number; regular: boolean; introBlocks: number | null; personalBlocks: number;
  personalChars: number; topics: number; contentUnits: number; forTeacherInPersonal: number; videosInPersonal: number; childrenBlocks: number | null;
}
const rows: Row[] = [];
for (const lesson of manifest.lessons) {
  const parsed = await loadCfmLesson(lesson.sourceKey);
  const blocks = parsed.document.sections.flatMap((s) => s.blocks);
  const h2 = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.type === "heading" && b.level === 2);
  const study = h2.filter(({ b }) => readingBlockText(b) === STUDY).map(({ i }) => i);
  const kids = h2.filter(({ b }) => readingBlockText(b) === KIDS).map(({ i }) => i);
  const regular = study.length === 1 && kids.length === 1 && study[0] < kids[0] && h2.length === 3;
  const personal = regular ? blocks.slice(study[0], kids[0]) : [];
  const unit = (b: (typeof blocks)[number]) => ["paragraph", "list", "quote", "question", "assignment", "table"].includes(b.type) && !META.test(b.id) && !FOR_TEACHER.test(b.id);
  rows.push({
    lesson: lesson.sourceKey,
    sections: parsed.document.sections.length,
    blocks: blocks.length,
    regular,
    introBlocks: regular ? study[0] : null,
    personalBlocks: personal.length,
    personalChars: personal.reduce((n, b) => n + readingBlockText(b).length, 0),
    topics: personal.filter((b) => b.type === "heading" && b.level === 3).length,
    contentUnits: (regular ? blocks.slice(0, study[0]) : []).filter(unit).length + personal.filter(unit).length,
    forTeacherInPersonal: personal.filter((b) => FOR_TEACHER.test(b.id)).length,
    videosInPersonal: personal.filter((b) => b.id.startsWith("video-")).length,
    childrenBlocks: regular ? blocks.length - kids[0] : null,
  });
}
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 1));
else {
  const min = (f: (r: Row) => number) => Math.min(...rows.map(f));
  const max = (f: (r: Row) => number) => Math.max(...rows.map(f));
  console.log(`lessen ${rows.length}; allemaal één sectie: ${rows.every((r) => r.sections === 1)}; regelmatige structuur (titel, Studietips, Ideeën voor kinderen): ${rows.filter((r) => r.regular).length}`);
  console.log(`onderwerpen (h3) in persoonlijke studie: ${min((r) => r.topics)}–${max((r) => r.topics)}; lessen met < 7 onderwerpen: ${rows.filter((r) => r.topics < 7).length}`);
  console.log(`inhoudseenheden persoonlijk (incl. inleiding): ${min((r) => r.contentUnits)}–${max((r) => r.contentUnits)}; tekens: ${min((r) => r.personalChars)}–${max((r) => r.personalChars)}`);
  console.log(`for-teacher-alinea's in persoonlijke regio: ${rows.reduce((n, r) => n + r.forTeacherInPersonal, 0)}; video's: ${rows.reduce((n, r) => n + r.videosInPersonal, 0)}`);
}
