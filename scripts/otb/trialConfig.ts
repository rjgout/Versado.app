import { OTB_LANGUAGE_BY_LOCALE, OTB_LOCALES, type OtbLocale } from "./bookMapping";

export const OTB_TRIAL_BOOK_NUMBERS = [1, 19, 43] as const;

export interface TrialCollectionConfig {
  id: string;
  slug: string;
  language: "nl" | "en" | "es" | "fr" | "de";
  locale: OtbLocale;
  order: number;
  visibleToUsers: false;
}

export const OTB_TRIAL_COLLECTIONS: TrialCollectionConfig[] = OTB_LOCALES.map((locale, index) => {
  const language = OTB_LANGUAGE_BY_LOCALE[locale];
  return {
    id: `content_bible_otb_${language}`,
    slug: `bijbel-otb-${language}`,
    language,
    locale,
    order: 1000 + index,
    visibleToUsers: false,
  };
});
