export interface CanonicalScriptureLocation {
  work: string;
  editionKey: string;
  bookKey: string;
  chapter: number;
  verse: number;
}

export function canonicalLocationId(location: CanonicalScriptureLocation): string {
  return `${location.work}:${location.editionKey}:${location.bookKey}:${location.chapter}:${location.verse}`;
}

export function sameCanonicalLocation(a: CanonicalScriptureLocation, b: CanonicalScriptureLocation): boolean {
  return canonicalLocationId(a) === canonicalLocationId(b);
}
