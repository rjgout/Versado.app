import { createPuzzleGeometry } from "@/lib/puzzle/geometry";
import type { PuzzleGeometry, PuzzlePieceCount } from "@/lib/puzzle/types";

// De geometrie is een pure functie van (aantal, seed, versie). Bij 150 en 300
// stukken is opnieuw opbouwen per actie onnodig duur, dus een kleine cache.
const cache = new Map<string, PuzzleGeometry>();
const LIMIT = 64;

export function cachedPuzzleGeometry(count: PuzzlePieceCount, seed: string, version: number): PuzzleGeometry {
  const key = `${version}:${seed}:${count}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const created = createPuzzleGeometry(count, seed, version);
  cache.set(key, created);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value as string);
  return created;
}
