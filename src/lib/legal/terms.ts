export interface LegalDocument {
  title: string;
  /** ISO-datum van de laatste wijziging, zoals de eigenaar die vaststelt. */
  updated: string;
  sections: { heading: string; paragraphs: string[] }[];
}

/**
 * De gebruiksvoorwaarden zijn een juridisch product van de eigenaar. Zolang hier `null` staat, bestaat de pagina
 * /voorwaarden niet (404) en verzint de code geen tekst. De eigenaar levert de definitieve tekst aan; daarna
 * vervangt een PR deze waarde en sluit de readiness-blokkade `terms-of-use`.
 */
export const TERMS: LegalDocument | null = null;
