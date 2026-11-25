// Basis-XP voor de oefeningen van een stuk inhoud (een hoofdstuk), ongeacht
// de route. Puur rekenwerk; de service (contentProgress.ts) houdt de stand
// per gebruiker en per inhoud bij en roept dit binnen een vergrendelde
// transactie aan.
//
// Een stuk inhoud met een oefenset van N vragen is hoogstens
// N × XP_PER_CORRECT + COMPLETION_BONUS basis-XP waard, in welke route of
// taal je die vragen ook maakt. XP komt alleen voor vragen die voor deze
// inhoud nog niet goed beantwoord waren; de bonus één keer, zodra alle N
// goed zijn. Wat daarna nog komt, is herhaling: die levert alleen de
// herhalingskorting op (xpRules.ts), zodat opnieuw oefenen wel iets waard is
// maar nooit opnieuw de volle beloning.

import { XP_PER_CORRECT_STANDARD, XP_PERFECT_BONUS_STANDARD, applyRepeatDiscount } from "@/lib/xpRules";

export const XP_PER_CORRECT = XP_PER_CORRECT_STANDARD;
export const COMPLETION_BONUS = XP_PERFECT_BONUS_STANDARD;

export function maxContentBaseXp(total: number): number {
  return total <= 0 ? 0 : total * XP_PER_CORRECT + COMPLETION_BONUS;
}

export interface RewardState {
  /** Verschillende vragen van deze inhoud die de gebruiker ooit maakte (historisch maximum blijft bij lager N). */
  answered: number;
  /** Verschillende vragen die goed zijn beantwoord en al XP opleverden (historisch maximum blijft bij lager N). */
  rewardCorrect: number;
  bonusAwarded: boolean;
}

export interface AttemptCounts {
  /** Vragen in deze poging die voor deze inhoud nog nooit gemaakt waren. */
  newAnswered: number;
  /** Vragen in deze poging die goed zijn en voor deze inhoud nog geen XP gaven. */
  newCorrect: number;
  /** Alle goede antwoorden in deze poging. */
  correct: number;
}

export interface RewardOutcome {
  next: RewardState;
  baseXp: number;
  bonusXp: number;
  repeatXp: number;
  /** De oefenset is met deze poging voor het eerst helemaal gemaakt. */
  completedNow: boolean;
}

export function applyAttempt(state: RewardState, total: number, attempt: AttemptCounts): RewardOutcome {
  // Een contentrevisie kan N verlagen. Historisch verdiende credits mogen
  // daardoor nooit verdwijnen of later opnieuw basis-XP opleveren.
  const answered = Math.max(state.answered, Math.min(total, state.answered + Math.max(0, attempt.newAnswered)));
  const rewardCorrect = Math.max(state.rewardCorrect, Math.min(total, state.rewardCorrect + Math.max(0, attempt.newCorrect)));
  const baseXp = (rewardCorrect - state.rewardCorrect) * XP_PER_CORRECT;
  const bonusXp = !state.bonusAwarded && total > 0 && rewardCorrect >= total ? COMPLETION_BONUS : 0;
  const repeatXp = baseXp + bonusXp === 0 ? applyRepeatDiscount(Math.max(0, attempt.correct) * XP_PER_CORRECT) : 0;
  return {
    next: { answered, rewardCorrect, bonusAwarded: state.bonusAwarded || bonusXp > 0 },
    baseXp,
    bonusXp,
    repeatXp,
    completedNow: total > 0 && state.answered < total && answered >= total,
  };
}

export interface LegacyProgress {
  /** XP die onder het oude systeem al voor deze inhoud is verdiend. */
  legacyXp: number;
  /** Het hoofdstuk gold toen als afgerond. */
  legacyCompleted: boolean;
}

/**
 * Voortgang van vóór dit systeem (ChapterProgress en de stappen, zie de
 * migratie) kende nog geen vast aantal vragen per hoofdstuk. Pas zodra N
 * bekend is, rekenen we die om: de XP die toen al voor deze inhoud is
 * uitbetaald, telt als al beloonde goede antwoorden, en een toen afgerond
 * hoofdstuk heeft een gemaakte oefenset. Zo kan niemand dezelfde basis-XP
 * nog eens verdienen, en raakt ook niemand iets kwijt: wat de nieuwe
 * oefenset méér waard is dan toen, blijft gewoon te verdienen.
 */
export function withLegacy(state: RewardState, legacy: LegacyProgress, total: number): RewardState {
  if (total <= 0 || (legacy.legacyXp <= 0 && !legacy.legacyCompleted)) return state;
  const paidCorrect = Math.min(total, Math.floor(Math.max(0, legacy.legacyXp) / XP_PER_CORRECT));
  return {
    answered: Math.max(state.answered, legacy.legacyCompleted ? total : paidCorrect),
    rewardCorrect: Math.max(state.rewardCorrect, paidCorrect),
    bonusAwarded: state.bonusAwarded || legacy.legacyXp >= maxContentBaseXp(total),
  };
}
