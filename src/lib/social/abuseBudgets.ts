import type { NextResponse } from "next/server";
import { authBudget, authBudgetKey } from "@/lib/authBudget";

/** Budgetten tegen misbruik van sociale endpoints. Delen de bestaande (Redis-)teller van `authBudget`:
 * geen tweede limiter. Ruim genoeg voor normaal gebruik, krap genoeg tegen opsommen en spammen. */
export const SOCIAL_BUDGETS = {
  friendRequest: { max: 20, windowMs: 10 * 60_000 },
  userSearch: { max: 60, windowMs: 60_000 },
  inviteLookup: { max: 60, windowMs: 60_000 },
  inviteAccept: { max: 20, windowMs: 10 * 60_000 },
} as const;

type Kind = keyof typeof SOCIAL_BUDGETS;
/** `subject` is een gebruikers-id (ingelogd) of een client-IP (publieke uitnodigingslink). */
export function socialBudget(kind: Kind, subject: string): Promise<NextResponse | null> {
  const { max, windowMs } = SOCIAL_BUDGETS[kind];
  return authBudget(authBudgetKey(`social-${kind}`, subject), max, windowMs);
}
