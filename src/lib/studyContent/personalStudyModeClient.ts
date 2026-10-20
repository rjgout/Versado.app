"use client";
import { jsonMutation } from "@/lib/data/mutation";
import type { PersonalStudyModeValue } from "./personalStudyMode";

/** Bewaart de gekozen leeswijze server-side; een mislukte opslag mag de navigatie nooit blokkeren. */
export async function rememberMode(mode: PersonalStudyModeValue) {
  try {
    await jsonMutation("/api/study-preference", { method: "PUT", json: { mode } }, { invalidates: "studyContextChanged" });
  } catch {
    /* De keuze geldt dan alleen voor deze weergave. */
  }
}
