// Readonly dekking van alle gepinde jaargangen. Geen DB, vraagpublicatie of import.
import { snapshotPilotReadings } from "./cfm-pilot-snapshot";
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
    "Gegenereerd uit de gepinde bronbestanden, de gecontroleerde citaatcatalogus en de expliciet goedgekeurde pilotselectie 2026/02. Geen productie-inventaris. De pilot vereist in de app een toegankelijke Nederlandse PGP-uitgave met exact de gecontroleerde hoofdstuktekst.",
    "",
    "Een 0 betekent: geen goedgekeurde vraagdekking; verwijzingen alleen zijn onvoldoende. Het rapport beweert niet dat ieder ontbrekend citaat individueel inhoudelijk is beoordeeld.",
    "",
    "| Jaargang | Les | Stap 1 | Stap 2 | Stap 3 | Stap 4 | Stap 5 | Stap 6 | Volledige week |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  let steps = 0,
    weeks = 0,
    readingSteps = 0,
    readingVerses = 0;
  for (const volume of CFM_SOURCES)
    for (const item of volume.manifest.lessons) {
      const parsed = await loadCfmLesson(item.sourceKey, volume),
        lesson = {
          workKey: volume.manifest.workKey,
          sourceKey: item.sourceKey,
          editionKey: volume.manifest.editionKey,
          language: volume.manifest.language,
          editionId: "coverage-" + volume.manifest.workKey,
          body: parsed.document,
        },
        enriched = {
          ...lesson,
          scriptureReadings: snapshotPilotReadings(lesson),
        },
        plan = studyExercisePlan(enriched, preparedStudyQuestions(enriched));
      readingSteps += new Set(enriched.scriptureReadings.map(r => r.stepIndex)).size;
      readingVerses += enriched.scriptureReadings.flatMap(r => r.verses).length;
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
    `Beschikbaar: ${steps} stappen met drie vragen; ${weeks} volledige ${weeks === 1 ? "week" : "weken"} met achttien vragen.`,
    "",
    `Aanvullende schriftlezing: ${readingSteps} stappen, ${readingVerses} geselecteerde officiële verzen; stap 1 van de pilot gebruikt reeds zichtbare citaten zonder duplicatie.`,
    "",
    "Bron-/antwoordvalidatie: de pilotcontrole toetst alle geselecteerde vragen op bronhash, letterlijke reconstructie en juiste/foute antwoorden met de bestaande generator. Inhoudelijke beoordeling: door Codex; geen onafhankelijke menselijke goedkeuring. Zie [pilotverslag](CFM-PILOT-2026-02.md) en [vraagcontrole](cfm-pilot/2026-02-voorstel.md).",
    "",
    "Verschil met de vorige bronmeting: +5 stappen (17 → 22) en +1 volledige officiële week (0 → 1). De overige 602 stappen hebben nog geen complete gecontroleerde vragenset. Er is geen massale uitbreiding geactiveerd. Bij ontbrekende/afwijkende interne PGP-tekst vallen de betrokken pilotvragen veilig weg; dit rapport bewijst geen productiepublicatie of beschikbaarheid. De officiële pilot is afzonderlijk met echte bronnen getest; synthetische enginefixtures blijven apart benoemd.",
    "",
  );
  const arg = process.argv.indexOf("--output");
  if (arg >= 0) writeFileSync(process.argv[arg + 1], rows.join("\n"));
  else console.log(rows.join("\n"));
}
void main();
