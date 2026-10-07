import { isActivityRoute } from "@/lib/focusMode";

/**
 * Een viering die uit het afronden van een activiteit volgt, mag nooit de
 * primaire resultaatervaring van die activiteit verdringen. De primaire
 * completion-flow heeft voorrang; secundaire vieringen volgen pas daarna.
 *
 * "Behaald" en "getoond" zijn twee aparte momenten. De reeksdag is al
 * opgeslagen zodra de activiteit klaar is; `StreakDay.celebrationShownAt`
 * blijft leeg totdat de viering daadwerkelijk wordt geclaimd. Dat lege veld is
 * dus de uitgestelde viering, en overleeft vernieuwen en heropenen. Pas als de
 * gebruiker de activiteit verlaat wordt geclaimd en getoond.
 */
export function celebrationDeferredOn(pathname: string): boolean {
  return isActivityRoute(pathname);
}

export interface StreakCelebrationClaimInput {
  pathname: string;
  status: "ACTIVE" | "INTERRUPTED" | null;
  studiedToday: boolean;
  claiming: boolean;
}

/** Mag de reeksviering nu worden geclaimd? De server blijft de bron van "nog niet getoond". */
export function shouldClaimStreakCelebration(input: StreakCelebrationClaimInput): boolean {
  if (input.claiming) return false;
  if (input.status !== "ACTIVE" || !input.studiedToday) return false;
  return !celebrationDeferredOn(input.pathname);
}

/** Een al geclaimde viering wordt nooit getoond zolang de gebruiker in een activiteit zit. */
export function visibleCelebration<T>(celebration: T | null, pathname: string): T | null {
  return celebration !== null && !celebrationDeferredOn(pathname) ? celebration : null;
}
