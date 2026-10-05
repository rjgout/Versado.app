import type { MessageKey } from "@/lib/i18n/core";

// De vier primaire bestemmingen (zie docs/VERSADO-DESIGN.md) en welke
// bestaande routes eronder vallen, voor de actieve markering in de
// onderbalk en de desktopnavigatie. Routes zelf veranderen niet: een pagina
// hoort alleen visueel bij een bestemming. Profiel zit achter de avatar.

export type PrimaryDestination = "today" | "learn" | "play" | "friends";

/** Centrale parentroute voor pagina's die vanuit Spelen worden geopend. */
export const PLAY_ROUTE = "/live" as const;

/** De normale leaderboardweergave van het persoonlijke vliegspel. */
export const QUICK_MISSIONARY_RANKING_HREF = "/snelle-zendeling?view=leaderboard#quick-missionary-leaderboard" as const;

export interface PrimaryNavItem {
  id: PrimaryDestination;
  href: string;
  labelKey: MessageKey;
  /** Routeprefixen die bij deze bestemming horen. */
  match: string[];
}

export const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: "today", href: "/dashboard", labelKey: "nav.today", match: ["/dashboard"] },
  {
    id: "learn",
    href: "/courses",
    labelKey: "nav.learn",
    match: ["/courses", "/lesson", "/reading-lesson", "/intro", "/kids", "/fsy", "/podcast", "/bookmarks", "/tools", "/practice"],
  },
  {
    id: "play",
    href: PLAY_ROUTE,
    labelKey: "nav.play",
    match: ["/live", "/scrabble", "/word-game", "/word-search", "/jigsaw", "/alleskenner", "/chapter-guess", "/gezinsavond", "/snelle-zendeling", "/mysteries"],
  },
  { id: "friends", href: "/friends", labelKey: "nav.friends", match: ["/friends", "/groups", "/competition", "/activity", "/challenges"] },
];

export function activeDestination(pathname: string | null): PrimaryDestination | null {
  if (!pathname) return null;
  const hit = PRIMARY_NAV.find((item) => item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)));
  return hit?.id ?? null;
}

/** Onderdelen van Vrienden die elk een eigen route hebben; getoond als tabs. */
export const SOCIAL_TABS: { href: string; labelKey: MessageKey }[] = [
  { href: "/friends", labelKey: "nav.friends" },
  { href: "/competition", labelKey: "nav.competition" },
  { href: "/activity", labelKey: "nav.activity" },
];
