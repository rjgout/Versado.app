import type { MessageKey } from "@/lib/i18n/core";

// De onderdelen van het profiel. Elk heeft een eigen adres
// (/profile?view=...), zodat terug en vooruit van de browser ertussen werken.
// De terugbalk (SubpageBackBar) haalt hier de titel vandaan; ProfileClient
// toont de inhoud.

export const PROFILE_VIEWS = {
  competition: { title: "nav.competition", subtitle: "profile.thisWeek" },
  achievements: { title: "profile.achievements" },
  reading: { title: "profile.readingProgress" },
  language: { title: "languageSettings.title" },
  readAloud: { title: "profile.readAloud" },
  notifications: { title: "profile.notifications" },
  privacy: { title: "profile.privacy" },
  presence: { title: "profile.onlineActivity" },
  about: { title: "profile.whatsNew" },
  twoFactor: { title: "profile.twoFactor" },
} satisfies Record<string, { title: MessageKey; subtitle?: MessageKey }>;

export type ProfileView = keyof typeof PROFILE_VIEWS;

export function parseProfileView(value: string | null | undefined): ProfileView | null {
  return value && Object.hasOwn(PROFILE_VIEWS, value) ? (value as ProfileView) : null;
}

export function profileViewHref(view: ProfileView): string {
  return `/profile?view=${view}`;
}

/**
 * Alleen het overzicht (/profile zonder onderdeel) is de hoofdprofielpagina.
 * Elke andere pagina binnen de profielshell is een onderliggende pagina: een
 * onderdeel (?view=...) of een losse route zoals /feedback. Daarom is dit de
 * enige plek die bepaalt of de profielfooter getoond wordt, en tonen nieuwe
 * profielonderdelen hem standaard niet.
 */
export function isProfileOverview(pathname: string | null | undefined, view: ProfileView | null): boolean {
  return pathname === "/profile" && view === null;
}
