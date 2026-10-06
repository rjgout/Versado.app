import { OTB_LANGUAGE_BY_LOCALE, OTB_LOCALES, type OtbLocale } from "./bookMapping";

export const OTB_TRIAL_BOOK_NUMBERS = [1, 19, 43] as const;

export type OtbWork = "old-testament" | "new-testament";

export function otbWorkForBookNumber(bookNumber: number): OtbWork {
  if (bookNumber >= 1 && bookNumber <= 39) return "old-testament";
  if (bookNumber >= 40 && bookNumber <= 66) return "new-testament";
  throw new Error(`Ongeldig OTB-boeknummer: ${bookNumber}.`);
}

export interface TrialCollectionConfig {
  id: string;
  slug: string;
  work: OtbWork;
  editionKey: "otb";
  language: "nl" | "en" | "es" | "fr" | "de";
  locale: OtbLocale;
  order: number;
  visibleToUsers: false;
}

const OTB_WORKS = ["old-testament", "new-testament"] as const;

export const OTB_TRIAL_COLLECTIONS: TrialCollectionConfig[] = OTB_WORKS.flatMap((work, workIndex) =>
  OTB_LOCALES.map((locale, languageIndex) => {
    const language = OTB_LANGUAGE_BY_LOCALE[locale];
    return {
      id: `content_${work === "old-testament" ? "old_testament" : "new_testament"}_otb_${language}`,
      slug: `${work}-otb-${language}`,
      work,
      editionKey: "otb",
      language,
      locale,
      order: 1000 + workIndex * 10 + languageIndex,
      visibleToUsers: false,
    };
  }),
);
