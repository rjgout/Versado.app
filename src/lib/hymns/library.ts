import type { HymnComposition, HymnLibrary, HymnText, ResolvedHymn } from "./types";
import { NLD_EDITION, loadResolvedHymn } from "./library/server";

// Testselectie uit de volledige bibliotheek: de drie lofzangen waarop de engine-tests en meetscripts steunen (24 met refrein,
// 36 met fermate, 82 met zes coupletten). Gelezen uit dezelfde bestanden als de app (library/data); alleen voor Node
// (tests en scripts), nooit vanuit de browser. De app zelf laadt per lofzang via /api/hymns (zie hymnLibraryClient.ts).
export const POC_NUMBERS = [24, 36, 82] as const;

const hymns = POC_NUMBERS.map((n) => {
  const h = loadResolvedHymn(n);
  if (!h) throw new Error(`Testlofzang ${n} ontbreekt in de bibliotheek`);
  return h;
});

export const POC_LIBRARY: HymnLibrary = {
  schemaVersion: 1,
  rights: "Afgeleid van de officiële Nederlandse lofzangen met toestemming van de eigenaar van Versado; niet als losstaand bestand delen.",
  edition: { ...NLD_EDITION, entries: hymns.map((h) => ({ number: h.number, textId: h.text.id, compositionId: h.composition.id })) },
  compositions: hymns.map((h) => h.composition),
  texts: hymns.map((h) => h.text),
};

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
