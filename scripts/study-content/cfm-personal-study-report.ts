// Controleverslag van de persoonlijke-studie-indeling van "Kom dan en volg Mij" (alle 52 lessen, offline).
//   npx tsx scripts/study-content/cfm-personal-study-report.ts [--lesson 10] [--steps] [--doubtful]
// Controleert per les: elk bronblok precies één keer en in volgorde, de zeven stappen vormen exact de persoonlijke
// blokken, geen lege stap, bronteksten onveranderd (de planner leest alleen). Twijfelgevallen staan expliciet in de uitvoer.
import { loadCfmLesson } from "../../src/lib/studyContent/cfm2026Import";
import { cfmOldTestament2026NlManifest as manifest } from "../../src/lib/studyContent/cfm2026Manifest";
import { readingBlockText } from "../../src/lib/studyContent/readingPositionContract";
import { planPersonalStudy, validatePersonalPlan, text8 } from "../../src/lib/studyContent/personalStudy";
import { loadPersonalStudyOverrides } from "../../src/lib/studyContent/personalStudyOverrides";

const only = process.argv.includes("--lesson") ? process.argv[process.argv.indexOf("--lesson") + 1] : null;
const showSteps = process.argv.includes("--steps");
const showDoubtful = process.argv.includes("--doubtful");
// Hulpmiddel voor de eigenaar: stelt overrides voor op basis van een expliciete lijst beginzinnen (geen automatische keuze).
//   npx tsx scripts/study-content/cfm-personal-study-report.ts --suggest-overrides > data/study-content/cfm-2026-nl/personal-study-overrides.json
const SUGGEST: Array<[string, string]> = [
  ["Zie voor meer ideeën de ", "Verwijzing naar een externe tijdschriftactiviteit; niet essentieel voor de persoonlijke studie."],
  ...[
    "Help leerlingen om", "Geef leerlingen de kans", "Help de cursisten", "Leer je leerlingen kennen", "Help anderen hun leerproces",
    "Probeer iedereen erbij te betrekken", "Spoor mensen aan elkaar", "Gebruik visuele middelen om te onderwijzen", "Bevorder deelname",
    "Gebruik aanschouwelijk onderwijs",
  ].map((prefix): [string, string] => [prefix, "Onderwijstip voor een leerkracht of groepsleider; niet voor de persoonlijke studie."]),
];
if (process.argv.includes("--suggest-overrides")) {
  const out: Record<string, { hide: Array<{ id: string; text8: string; reason: string }> }> = {};
  for (const lesson of manifest.lessons) {
    const parsed = await loadCfmLesson(lesson.sourceKey);
    const plan = planPersonalStudy(parsed.document);
    if (!plan.supported) continue;
    const hide = plan.blocks.flatMap((b) => {
      if (!b.doubtful) return [];
      const block = parsed.document.sections[0].blocks.find((x) => x.id === b.id)!;
      const match = SUGGEST.find(([prefix]) => readingBlockText(block).startsWith(prefix));
      return match ? [{ id: b.id, text8: text8(block), reason: match[1] }] : [];
    });
    if (hide.length) out[lesson.sourceKey] = { hide };
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}
let failures = 0;
let unsupported = 0;
const totals = { personal: 0, other: 0, doubtful: 0, hiddenByOverride: 0 };
for (const lesson of manifest.lessons) {
  if (only && lesson.sourceKey !== only) continue;
  const parsed = await loadCfmLesson(lesson.sourceKey);
  const before = JSON.stringify(parsed.document);
  const overrides = loadPersonalStudyOverrides(lesson.sourceKey);
  const plan = planPersonalStudy(parsed.document, overrides);
  if (JSON.stringify(parsed.document) !== before) {
    failures++;
    console.log(`${lesson.sourceKey}: FOUT — de planner heeft het brondocument gewijzigd`);
  }
  if (!plan.supported) {
    unsupported++;
    console.log(`${lesson.sourceKey}: niet ondersteund — ${plan.reason}`);
    continue;
  }
  const problems = [...validatePersonalPlan(parsed.document, plan), ...plan.issues.map((i) => i.message)];
  failures += problems.length;
  totals.personal += plan.blocks.filter((b) => b.personal).length;
  totals.other += plan.blocks.filter((b) => !b.personal).length;
  totals.doubtful += plan.blocks.filter((b) => b.doubtful).length;
  totals.hiddenByOverride += plan.blocks.filter((b) => b.role === "OVERRIDE_HIDDEN").length;
  const chars = plan.steps.map((s) => s.chars);
  console.log(
    `${lesson.sourceKey}: ${plan.steps.length} stappen, tekens ${chars.join("/")}, twijfel ${plan.blocks.filter((b) => b.doubtful).length}${problems.length ? ` — PROBLEMEN: ${problems.join("; ")}` : ""}`,
  );
  if (showSteps)
    for (const s of plan.steps) console.log(`   Stap ${s.index}: ${s.title}${s.continued ? " (vervolg)" : ""} [${s.blockIds.length} blokken, ${s.chars} tekens]`);
  if (showDoubtful)
    for (const b of plan.blocks.filter((x) => x.doubtful)) {
      const block = parsed.document.sections[0].blocks.find((x) => x.id === b.id)!;
      console.log(`   twijfel ${b.id} [${b.role}] ${text8(block)} — ${readingBlockText(block).slice(0, 90)}`);
    }
}
console.log(`\nTotaal: persoonlijk ${totals.personal} blokken, daarbuiten ${totals.other}, twijfelgevallen ${totals.doubtful} (waarvan door override verborgen ${totals.hiddenByOverride}); niet ondersteund ${unsupported}; problemen ${failures}.`);
process.exit(failures || unsupported ? 1 : 0);
