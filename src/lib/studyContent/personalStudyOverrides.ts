import { z } from "zod";
import cfmOldTestament2026 from "../../../data/study-content/cfm-2026-nl/personal-study-overrides.json";
import { LEGACY_PERSONAL_STUDY, planPersonalStudy, validatePersonalPlan, type PersonalStudyOverrides, type PersonalStudyPlan } from "./personalStudy";
import type { ReaderDocument } from "./readingPositionContract";

const schema = z.record(
  z.string(),
  z
    .object({
      hide: z.array(z.object({ id: z.string(), text8: z.string().length(8), reason: z.string().min(1) }).strict()).optional(),
      cuts: z.array(z.string()).length(5).optional(),
    })
    .strict(),
);
/**
 * Handmatige correcties per programma en les (bronsleutel), gebonden aan de brontekst via `text8`. Een wijziging van de
 * officiële tekst maakt een override vanzelf ongeldig; de brontekst zelf wordt nooit aangepast. Een volgend CFM-jaar
 * voegt hier alleen een eigen bestand toe.
 */
const REGISTRY: Record<string, z.infer<typeof schema>> = {
  "cfm-old-testament-2026": schema.parse(cfmOldTestament2026),
};

/** Alleen "Kom dan en volg Mij"-programma's hebben een persoonlijke studieroute; FSY en andere programma's niet. */
export function isPersonalStudyWork(workKey: string) {
  // "synthetic-study-cfm-" bestaat alleen in het geïsoleerde syntheticprofiel (testfixture), nooit in productie.
  return workKey.startsWith("cfm-") || workKey.startsWith("synthetic-study-cfm-");
}
export function loadPersonalStudyOverrides(workKey: string, sourceKey: string): PersonalStudyOverrides {
  return REGISTRY[workKey]?.[sourceKey] ?? {};
}
export function personalStudyFor(lesson: { workKey: string; sourceKey: string; body: ReaderDocument }): PersonalStudyPlan {
  if (!isPersonalStudyWork(lesson.workKey)) return { supported: false, reason: "Dit programma heeft geen persoonlijke studieroute." };
  return planPersonalStudy(lesson.body, loadPersonalStudyOverrides(lesson.workKey, lesson.sourceKey));
}

/** De zevenstappenindeling van versie 1, uitsluitend om bestaande stapvoortgang inhoudelijk te kunnen dekken. */
export function legacyPersonalPlan(lesson: { workKey: string; sourceKey: string; body: ReaderDocument }): PersonalStudyPlan {
  if (!isPersonalStudyWork(lesson.workKey)) return { supported: false, reason: "Dit programma heeft geen persoonlijke studieroute." };
  return planPersonalStudy(lesson.body, loadPersonalStudyOverrides(lesson.workKey, lesson.sourceKey), LEGACY_PERSONAL_STUDY);
}

/**
 * Een plan dat de onveranderlijke regels schendt (dubbele of ontbrekende blokken, lege stap) wordt nooit getoond: de lezer valt
 * terug op de volledige, ongewijzigde les en de fout komt in het serverlog. Annotaties en bronidentiteiten blijven daardoor intact.
 */
export function safePersonalPlan(lesson: Parameters<typeof personalStudyFor>[0]): PersonalStudyPlan {
  const plan = personalStudyFor(lesson);
  if (!plan.supported) return plan;
  const problems = validatePersonalPlan(lesson.body, plan);
  if (problems.length) {
    console.error(`[persoonlijke studie] ongeldige indeling voor ${lesson.workKey}/${lesson.sourceKey}: ${problems.join(" | ")}`);
    return { supported: false, reason: "De indeling is niet geldig; de volledige les wordt getoond." };
  }
  for (const issue of plan.issues) console.warn(`[persoonlijke studie] ${lesson.workKey}/${lesson.sourceKey}: ${issue.code} ${issue.message}`);
  return plan;
}

