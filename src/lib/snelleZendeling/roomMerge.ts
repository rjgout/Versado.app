import type { RoomPayload } from "./match";
import { mergeParticipantState } from "./ghostState";

/**
 * Voegt een nieuwe room-stand samen met de vorige bij de client. Berichten kunnen
 * niet terugdraaien wat definitief is: een oudere stand (lager `seq`) wordt
 * genegeerd, en wie al ELIMINATED/FINISHED was blijft dat. Een afgesloten
 * wedstrijd blijft afgesloten.
 */
export function mergeRoomPayload(previous: RoomPayload | null, next: RoomPayload): RoomPayload {
  if (!previous) return next;
  if (next.seq < previous.seq) return previous;
  if (previous.phase === "ended" && next.phase !== "ended") return previous;
  if (!previous.match || !next.match) return next;
  const before = new Map(previous.match.participants.map((p) => [p.userId, p.state]));
  return {
    ...next,
    match: {
      ...next.match,
      participants: next.match.participants.map((p) => {
        const state = mergeParticipantState(before.get(p.userId), p.state);
        return state === p.state ? p : { ...p, state, eliminatedSeq: previous.match?.participants.find((q) => q.userId === p.userId)?.eliminatedSeq ?? p.eliminatedSeq };
      }),
    },
  };
}
