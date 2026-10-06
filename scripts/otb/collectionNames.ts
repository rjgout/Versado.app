import type { OtbWork } from "./trialConfig";

type OtbLanguage = "nl" | "en" | "es" | "fr" | "de";

const OTB_COLLECTION_NAMES: Record<OtbWork, Record<OtbLanguage, string>> = {
  "old-testament": {
    nl: "Oude Testament",
    en: "Old Testament",
    es: "Antiguo Testamento",
    fr: "Ancien Testament",
    de: "Altes Testament",
  },
  "new-testament": {
    nl: "Nieuwe Testament",
    en: "New Testament",
    es: "Nuevo Testamento",
    fr: "Nouveau Testament",
    de: "Neues Testament",
  },
};

export function otbCollectionName(work: OtbWork, language: OtbLanguage): string {
  return OTB_COLLECTION_NAMES[work][language];
}
