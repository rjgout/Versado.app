import type { MessageKey } from "@/lib/i18n/core";
import type { ResumeReason } from "./weekSelection";

/**
 * Het label van de hervatweek op Vandaag, in de CFM-cursuskaart en het weekpad: alleen de kalenderweek heet "Deze week", een zelf
 * gekozen week "Laatst gekozen week" en alleen aantoonbare studieactiviteit "Laatst bestudeerd". Zonder hervatweek is er geen label.
 */
export function weekLabelKey(reason: ResumeReason | null): MessageKey | null {
  if (reason === "calendar") return "cfmStudy.currentWeek";
  if (reason === "selected") return "cfmToday.lastChosen";
  if (reason === "studied") return "cfmToday.lastStudied";
  return null;
}

/** De hervatknop in het weekpad ("Naar mijn week" / "…laatst gekozen week" / "…laatst bestudeerde week"). */
export function myWeekKind(reason: ResumeReason | null): "week" | "chosenWeek" | "studiedWeek" {
  return reason === "selected" ? "chosenWeek" : reason === "studied" ? "studiedWeek" : "week";
}
