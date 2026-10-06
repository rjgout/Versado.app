/**
 * Canonieke Bijbelboeken in de upstreamvolgorde. De lokaleizede map- en
 * bestandsnamen van OTB worden bewust nergens als identiteit gebruikt.
 */
export const OTB_BOOKS = [
  [1, "gen"], [2, "exo"], [3, "lev"], [4, "num"], [5, "deu"], [6, "jos"],
  [7, "jdg"], [8, "rut"], [9, "1sa"], [10, "2sa"], [11, "1ki"], [12, "2ki"],
  [13, "1ch"], [14, "2ch"], [15, "ezr"], [16, "neh"], [17, "est"], [18, "job"],
  [19, "psa"], [20, "pro"], [21, "ecc"], [22, "sng"], [23, "isa"], [24, "jer"],
  [25, "lam"], [26, "ezk"], [27, "dan"], [28, "hos"], [29, "joe"], [30, "amo"],
  [31, "oba"], [32, "jon"], [33, "mic"], [34, "nah"], [35, "hab"], [36, "zep"],
  [37, "hag"], [38, "zac"], [39, "mal"], [40, "mat"], [41, "mrk"], [42, "luk"],
  [43, "jhn"], [44, "act"], [45, "rom"], [46, "1co"], [47, "2co"], [48, "gal"],
  [49, "eph"], [50, "php"], [51, "col"], [52, "1th"], [53, "2th"], [54, "1ti"],
  [55, "2ti"], [56, "tit"], [57, "phm"], [58, "heb"], [59, "jas"], [60, "1pe"],
  [61, "2pe"], [62, "1jo"], [63, "2jo"], [64, "3jo"], [65, "jud"], [66, "rev"],
] as const;

export const OTB_BOOK_KEY_BY_NUMBER = new Map<number, string>(OTB_BOOKS);

export const OTB_LOCALES = ["nl-NL", "en-GB", "es-ES", "fr-FR", "de-DE"] as const;
export type OtbLocale = typeof OTB_LOCALES[number];

export const OTB_LANGUAGE_BY_LOCALE = {
  "nl-NL": "nl",
  "en-GB": "en",
  "es-ES": "es",
  "fr-FR": "fr",
  "de-DE": "de",
} as const;
