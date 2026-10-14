import { PLAY_ROUTE } from "@/lib/navigation";

// Eén navigatiecontract voor Legpuzzel 2.0. Terug hangt hier nooit van de browsergeschiedenis af:
// de bestemming volgt uit de werkelijke route (en binnen een route uit de huidige stap). Zo werkt terug
// ook na een rechtstreeks geopende link, een uitnodiging, een refresh of in een Capacitor-WebView, en
// ontstaan er geen extra geschiedenisitems of lussen. Teruggaan verlaat nooit een sessie of wedstrijd
// (geen annulering, geen reset, de serverklok loopt door); alleen een expliciete actie met bevestiging doet dat.

/** Persoonlijke records; een vriendenranglijst per variant hangt daaronder. */
export const RECORDS_ROUTE = "/jigsaw/records" as const;

/** De puzzelcatalogus en het overzicht met uitnodigingen, lopende en afgeronde puzzels. */
export const JIGSAW_ROUTE = "/jigsaw" as const;

export type PuzzleRoute =
  | { kind: "catalog"; parent: typeof PLAY_ROUTE }
  | { kind: "coop"; id: string; parent: typeof JIGSAW_ROUTE }
  | { kind: "match"; id: string; parent: typeof JIGSAW_ROUTE }
  | { kind: "records"; parent: typeof JIGSAW_ROUTE }
  | { kind: "leaderboard"; id: string; parent: typeof RECORDS_ROUTE };

/** Herkent de puzzelroutes; alles buiten Legpuzzel 2.0 geeft null. */
export function classifyPuzzleRoute(pathname: string): PuzzleRoute | null {
  if (pathname === JIGSAW_ROUTE) return { kind: "catalog", parent: PLAY_ROUTE };
  if (pathname === RECORDS_ROUTE) return { kind: "records", parent: JIGSAW_ROUTE };
  const board = /^\/jigsaw\/records\/([^/]+)$/.exec(pathname);
  if (board) return { kind: "leaderboard", id: board[1], parent: RECORDS_ROUTE };
  const coop = /^\/jigsaw\/samen\/([^/]+)$/.exec(pathname);
  if (coop) return { kind: "coop", id: coop[1], parent: JIGSAW_ROUTE };
  const match = /^\/jigsaw\/wedstrijd\/([^/]+)$/.exec(pathname);
  if (match) return { kind: "match", id: match[1], parent: JIGSAW_ROUTE };
  return null;
}

/**
 * De stappen binnen een wedstrijdpoging waarvan terug naar de vorige stap gaat in plaats van naar het overzicht.
 * De vraag gaat terug naar de voltooide afbeelding (het vastgelegde resultaat); daarna naar het overzicht.
 */
export type PuzzleStage = "BOARD" | "COMPLETE" | "QUESTION" | "RESULT";
export function previousPuzzleStage(stage: PuzzleStage): PuzzleStage | null {
  return stage === "QUESTION" ? "COMPLETE" : null;
}
