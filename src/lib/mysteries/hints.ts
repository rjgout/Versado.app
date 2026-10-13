import { actOnMystery } from "./attempts";

/** Betaal uitsluitend binnen de vastgelegde poging en dezelfde transactie. */
export function consumeMysteryHint(userId: string, attemptId: string, expectedRevision: number, actionId: string) {
  return actOnMystery(userId, { action: "hint", attemptId, expectedRevision, actionId });
}
