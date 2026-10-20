import { z } from "zod";

/** Leeswijze van de persoonlijke studie. In de URL heten ze "vrij" en "stappen", in de database FREE en STEPS. */
export const personalStudyModeSchema = z.enum(["FREE", "STEPS"]);
export type PersonalStudyModeValue = z.infer<typeof personalStudyModeSchema>;
export const personalStudyModeRequestSchema = z.object({ mode: personalStudyModeSchema }).strict();

export const DEFAULT_PERSONAL_STUDY_MODE: PersonalStudyModeValue = "STEPS";

export function modeFromParam(value: string | null | undefined): PersonalStudyModeValue | null {
  return value === "stappen" ? "STEPS" : value === "vrij" ? "FREE" : null;
}
export function modeParam(mode: PersonalStudyModeValue): "vrij" | "stappen" {
  return mode === "STEPS" ? "stappen" : "vrij";
}
/**
 * Een expliciete deeplink (URL-parameter) gaat altijd voor; daarna de opgeslagen voorkeur; zonder voorkeur de standaard.
 * De standaard is Stap voor stap, zoals het eerste cursuskaartje in Leren; wie nooit koos had nog geen CFM-voorkeur (de functie is nieuw).
 */
export function resolvePersonalStudyMode(param: string | null | undefined, saved: PersonalStudyModeValue | null): PersonalStudyModeValue {
  return modeFromParam(param) ?? saved ?? DEFAULT_PERSONAL_STUDY_MODE;
}
