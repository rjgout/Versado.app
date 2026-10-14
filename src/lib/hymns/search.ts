import type { HymnIndexEntry } from "./types";

// Lokaal zoeken in de bibliotheek: op nummer, volledige titel, een deel van de titel en de eerste regel. Puur en snel
// (honderden lofzangen, geen verzoek per toetsaanslag).

export function normalizeQuery(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Prepared {
  entry: HymnIndexEntry;
  title: string;
  titleWords: string[];
  first: string;
  number: string;
}

export function prepareIndex(entries: HymnIndexEntry[]): Prepared[] {
  return entries.map((entry) => {
    const title = normalizeQuery(entry.title);
    return { entry, title, titleWords: title.split(" "), first: normalizeQuery(entry.firstLine), number: String(entry.number) };
  });
}

/** Rang (lager = beter) van een lofzang voor een zoekopdracht, of null als hij niet past. */
function score(p: Prepared, q: string, tokens: string[]): number | null {
  if (/^\d+$/.test(q)) {
    if (p.number === q) return 0;
    if (p.number.startsWith(q)) return 1 + p.entry.number / 1000;
    return null;
  }
  if (p.title === q) return 2;
  if (p.title.startsWith(q)) return 3;
  if (p.titleWords.some((w) => w.startsWith(q))) return 4;
  if (tokens.every((t) => p.titleWords.some((w) => w.startsWith(t)))) return 5;
  if (p.title.includes(q)) return 6;
  if (p.first.startsWith(q)) return 7;
  if (p.first.includes(q)) return 8;
  if (tokens.every((t) => p.title.includes(t) || p.first.includes(t))) return 9;
  return null;
}

export function searchHymns(prepared: Prepared[], query: string): HymnIndexEntry[] {
  const q = normalizeQuery(query);
  if (!q) return prepared.map((p) => p.entry);
  const tokens = q.split(" ");
  const hits: { rank: number; entry: HymnIndexEntry }[] = [];
  for (const p of prepared) {
    const rank = score(p, q, tokens);
    if (rank !== null) hits.push({ rank, entry: p.entry });
  }
  hits.sort((a, b) => a.rank - b.rank || a.entry.number - b.entry.number);
  return hits.map((h) => h.entry);
}
