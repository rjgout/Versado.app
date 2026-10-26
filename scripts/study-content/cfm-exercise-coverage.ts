// Readonly dekking van alle gepinde jaargangen. Geen DB, vraagpublicatie of import.
import { writeFileSync } from "node:fs";
import { CFM_SOURCES } from "../../src/lib/studyContent/cfmSources";
import { loadCfmLesson } from "../../src/lib/studyContent/cfm2026Import";
import {
  preparedStudyQuestions,
  studyExercisePlan,
} from "../../src/lib/studyContent/exercisePlan";
async function main() {
  const rows = [
    "# CFM-vraagdekking — fase A",
    "",
    "Gegenereerd uit de gepinde bronbestanden en de expliciet gecontroleerde citaten. Geen productie-inventaris.",
    "",
    "Een 0 betekent: geen goedgekeurde vraagdekking; verwijzingen alleen zijn onvoldoende. Het rapport beweert niet dat ieder ontbrekend citaat individueel inhoudelijk is beoordeeld.",
    "",
    "| Jaargang | Les | Stap 1 | Stap 2 | Stap 3 | Stap 4 | Stap 5 | Stap 6 | Volledige week |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  let steps = 0,
    weeks = 0;
  for (const volume of CFM_SOURCES)
    for (const item of volume.manifest.lessons) {
      const parsed = await loadCfmLesson(item.sourceKey, volume),
        lesson = {
          workKey: volume.manifest.workKey,
          sourceKey: item.sourceKey,
          language: volume.manifest.language,
          editionId: "coverage-" + volume.manifest.workKey,
          body: parsed.document,
        },
        plan = studyExercisePlan(lesson, preparedStudyQuestions(lesson));
      const counts = plan?.parts.map((p) => p.questions.length) ?? [
        0, 0, 0, 0, 0, 0,
      ];
      steps += counts.filter((n) => n === 3).length;
      const full = counts.every((n) => n === 3);
      if (full) weeks++;
      rows.push(
        `| ${volume.manifest.workKey} | ${item.sourceKey} | ${counts.join(" | ")} | ${full ? 18 : 0} |`,
      );
    }
  rows.push(
    "",
    `Beschikbaar: ${steps} stappen met drie vragen; ${weeks} volledige weken met achttien vragen.`,
    "",
    "De volledige-weekflow is technisch met een expliciete synthetische 18-vragenfixture getest; dit is geen claim van officiële weekdekking. Meer officiële dekking vraagt gecontroleerde schriftcitaten binnen de bestaande leesinhoud, zonder de officiële les te wijzigen.",
    "",
  );
  const arg = process.argv.indexOf("--output");
  if (arg >= 0) writeFileSync(process.argv[arg + 1], rows.join("\n"));
  else console.log(rows.join("\n"));
}
void main();
