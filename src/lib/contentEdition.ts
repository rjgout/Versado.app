/**
 * Identiteit van een schriftuitgave. De taal mag verschillen, maar werk en
 * editionKey moeten gelijk zijn om vertalingen als dezelfde uitgavefamilie
 * te behandelen.
 */
export interface ContentEditionIdentity {
  work: string | null;
  editionKey: string;
  language: string;
}

export function sameEditionFamily(a: ContentEditionIdentity, b: ContentEditionIdentity): boolean {
  return a.work !== null && a.work === b.work && a.editionKey === b.editionKey;
}

/** Kies alleen een kandidaat uit dezelfde vertaling-/uitgavefamilie. */
export function pickEditionInFamily<T extends ContentEditionIdentity>(
  candidates: T[],
  source: ContentEditionIdentity,
  language: string,
): T | undefined {
  return candidates.find((candidate) => candidate.language === language && sameEditionFamily(source, candidate));
}
