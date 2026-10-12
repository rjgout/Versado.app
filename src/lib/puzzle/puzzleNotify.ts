import { notifyPuzzle } from "@/lib/notify";

// Eén dunne laag tussen de puzzelservices en de centrale notificatiearchitectuur.
// Aanroepers sturen uitsluitend na een geslaagde commit en alleen bij een echte
// statusovergang (nieuwe uitnodiging, reactie, start, afronding), nooit per
// puzzelactie. Fouten in meldingen mogen een puzzelactie nooit laten mislukken.
export type PuzzleNotice =
  | { type: "COOP_INVITE"; fromHandle: string; sessionId: string }
  | { type: "COOP_ACCEPTED" | "COOP_DECLINED" | "COOP_REVOKED"; fromHandle: string; sessionId: string }
  | { type: "COOP_COMPLETED"; sessionId: string }
  | { type: "MATCH_INVITE"; fromHandle: string; matchId: string; live: boolean }
  | { type: "MATCH_ACCEPTED" | "MATCH_DECLINED" | "MATCH_REVOKED"; fromHandle: string; matchId: string }
  | { type: "MATCH_STARTED"; matchId: string }
  | { type: "MATCH_RESULT"; matchId: string };

export function sendPuzzleNotice(userId: string, notice: PuzzleNotice): void {
  void notifyPuzzle(userId, notice).catch(() => {});
}
