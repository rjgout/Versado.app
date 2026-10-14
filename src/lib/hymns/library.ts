import type { HymnComposition, HymnLibrary, HymnText, ResolvedHymn } from "./types";
import poc from "./library/nld-poc.json";

// De proefbibliotheek is een lokaal JSON-bestand: geen database, geen migratie, geen server.
// De JSON bevat bewust alleen arrays/velden met vaste namen (zie CLAUDE.md over tsx en JSON).
export const POC_LIBRARY = poc as unknown as HymnLibrary;

export function resolveHymn(library: HymnLibrary, number: number): ResolvedHymn | null {
  const entry = library.edition.entries.find((e) => e.number === number);
  if (!entry) return null;
  const text = library.texts.find((t) => t.id === entry.textId);
  const composition = library.compositions.find((c) => c.id === entry.compositionId);
  if (!text || !composition) return null;
  return { number, edition: library.edition, text, composition };
}

export function listHymns(library: HymnLibrary): ResolvedHymn[] {
  return library.edition.entries.map((e) => resolveHymn(library, e.number)).filter((h): h is ResolvedHymn => h !== null);
}

export type { HymnComposition, HymnText };
