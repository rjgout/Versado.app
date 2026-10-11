import { createHash, randomInt } from "node:crypto";
import { z } from "zod";

export const WORD_GAME_HINT_COOLDOWN_MS = 60 * 60 * 1000;
const limits = [180, 50, 15, 5];

/** Kleinere toekomstige woordenlijsten krijgen nooit een schijnverkleining. */
export function wordGameHintCounts(total: number): number[] {
  const counts = [total];
  for (const limit of limits) {
    const previous = counts.at(-1)!;
    if (previous <= 1) break;
    counts.push(Math.max(1, Math.min(limit, previous - 1)));
  }
  return counts;
}

const poolSchema = z.object({
  version: z.literal(1),
  dictionaryHash: z.string(),
  lists: z.array(z.array(z.string().regex(/^[a-z]{5}$/))).min(1).max(5),
}).strict();
export type WordGameHintPools = z.infer<typeof poolSchema>;
export interface WordGameHintPurchase { actionId: string; level: number; at: string }

/** Eén willekeurige keten wordt betaald en opgeslagen; nooit opnieuw loten. */
export function createWordGameHintPools(words: readonly string[], target: string): WordGameHintPools {
  const all = [...new Set(words)].sort();
  if (!all.includes(target) || all.some((word) => !/^[a-z]{5}$/.test(word))) throw new Error("Ongeldige doelwoordenlijst");
  const lists = [all];
  for (const count of wordGameHintCounts(all.length).slice(1)) {
    const others = lists.at(-1)!.filter((word) => word !== target);
    for (let i = others.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [others[i], others[j]] = [others[j], others[i]];
    }
    lists.push([...others.slice(0, count - 1), target].sort());
  }
  return { version: 1, dictionaryHash: createHash("sha256").update(JSON.stringify(all)).digest("hex"), lists };
}

export function readWordGameHintPools(raw: string, target: string): WordGameHintPools {
  const pools = poolSchema.parse(JSON.parse(raw));
  const expected = wordGameHintCounts(pools.lists[0].length);
  if (pools.lists.length !== expected.length) throw new Error("Ongeldige hintprogressie");
  pools.lists.forEach((list, index) => {
    const previous = new Set(pools.lists[index - 1] ?? list);
    if (list.length !== expected[index] || new Set(list).size !== list.length || !list.includes(target)
      || list.some((word) => !previous.has(word)) || JSON.stringify([...list].sort()) !== JSON.stringify(list)) {
      throw new Error("Ongeldige hintselectie");
    }
  });
  if (createHash("sha256").update(JSON.stringify(pools.lists[0])).digest("hex") !== pools.dictionaryHash) throw new Error("Ongeldige woordenlijstversie");
  return pools;
}

export interface WordGameHintsView {
  level: number;
  candidates: string[];
  nextCount: number | null;
  nextHintAt: string | null;
}

export function wordGameHintsView(game: { word: string; hintLevel: number; hintPools: string | null }, lastHintAt: Date | null, wordCount: number): WordGameHintsView {
  const pools = game.hintPools ? readWordGameHintPools(game.hintPools, game.word) : null;
  const counts = pools ? pools.lists.map((list) => list.length) : wordGameHintCounts(wordCount);
  if (game.hintLevel < 0 || game.hintLevel > counts.length || (game.hintLevel > 0 && !pools)) throw new Error("Ongeldige hintstatus");
  return {
    level: game.hintLevel,
    candidates: game.hintLevel > 0 ? pools!.lists[game.hintLevel - 1] : [],
    nextCount: counts[game.hintLevel] ?? null,
    nextHintAt: lastHintAt ? new Date(lastHintAt.getTime() + WORD_GAME_HINT_COOLDOWN_MS).toISOString() : null,
  };
}
