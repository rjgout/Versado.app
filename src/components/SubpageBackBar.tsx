"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useBackTargetOverride } from "@/lib/backTarget";
import { useBackNavigation } from "@/lib/navigationHistory";
import { parseProfileView, PROFILE_VIEWS } from "@/lib/profileViews";
import { useT } from "@/components/I18nProvider";
import type { MessageKey } from "@/lib/i18n/core";
import { useCompanion } from "@/components/versado/PersonalMascot";
import { quickMissionaryTitle } from "@/lib/gameCatalog";
import { PLAY_ROUTE } from "@/lib/navigation";

interface DetailPage {
  /** Alleen gebruikt zonder vorige pagina in de app (een deeplink). */
  fallback: string;
  title: MessageKey;
  subtitle?: MessageKey;
  /** Gebruik de semantische parent, ook als toevallige history beschikbaar is. */
  forceFallback?: boolean;
}

// De onderliggende pagina's van Hulpmiddelen. Bladwijzers staat bewust op
// /bookmarks (ouder dan de hulpmiddelenpagina), maar hoort daar wel bij.
const TOOL_SUBPAGES: Record<string, MessageKey> = {
  "/tools/dictionary": "pages.dictionary",
  "/bookmarks": "pages.bookmarks",
  "/tools/xp-guide": "pages.xpGuide",
  "/tools/persons": "pages.persons",
};

// Pagina's die je vanuit het profiel opent (zie docs/VERSADO-DESIGN.md).
const PROFILE_SUBPAGES: Record<string, MessageKey> = {
  "/feedback": "pages.feedback",
  "/shop": "nav.shop",
  "/xp": "header.xp",
  "/streak": "header.streak",
  "/change-password": "profile.changePassword",
};

// De spellen op Spelen (/live, zie LiveLobbyForm.tsx). Een lopend spel houdt
// dezelfde contextbalk als andere focusflows zodat de gebruiker veilig kan
// terugkeren zonder de globale navigatie te hoeven openen.
const GAME_PAGES: Record<string, MessageKey> = {
  "/jigsaw": "jigsaw.title",
  "/word-game": "pages.wordOfTheDay",
  "/word-search": "pages.wordSearch",
  "/scrabble": "pages.wordGame",
  "/alleskenner": "pages.alleskenner",
  "/gezinsavond": "pages.familyNight",
  "/chapter-guess": "pages.chapterGuess",
  "/challenges": "pages.challenges",
  "/snelle-zendeling": "pages.quickMissionary",
  "/mysteries": "pages.mystery",
  "/mysteries/001": "pages.mystery001a",
  "/mysteries/001a": "pages.mystery001a",
  "/mysteries/002": "pages.mystery002",
};

const LESSON_PAGES: [RegExp, MessageKey][] = [
  [/^\/lesson\/[^/]+$/, "pages.lesson"],
  [/^\/reading-lesson\/[^/]+$/, "pages.step"],
  [/^\/podcast\/[^/]+\/[^/]+$/, "pages.podcastLesson"],
  [/^\/kids\/[^/]+$/, "pages.kidsStory"],
  [/^\/intro\/[^/]+$/, "pages.introLesson"],
];

const MYSTERY_PLAY_TITLES: Record<string, MessageKey> = {
  "001": "pages.mystery001a",
  "002": "pages.mystery002",
  "003": "mystery003.title",
  "004": "mystery004.title",
  "005": "mystery005.title",
  "006": "mystery006.title",
};

function detailPageFor(pathname: string, profileView: string | null, hash: string): DetailPage | null {
  if (pathname === "/profile") {
    const view = parseProfileView(profileView);
    return view ? { fallback: "/profile", ...PROFILE_VIEWS[view] } : null;
  }
  const profileSubpage = PROFILE_SUBPAGES[pathname];
  if (profileSubpage) return { fallback: "/profile", title: profileSubpage };
  const tool = TOOL_SUBPAGES[pathname];
  if (tool) return { fallback: "/tools", title: tool };
  const game = GAME_PAGES[pathname];
  if (game) {
    const isLeaderboard = pathname === "/snelle-zendeling" && (profileView === "leaderboard" || hash === "#quick-missionary-leaderboard");
    return { fallback: PLAY_ROUTE, title: game, forceFallback: isLeaderboard };
  }
  const mysteryPlay = /^\/mysteries\/(\d{3})[a-z]\/play$/.exec(pathname);
  if (mysteryPlay) {
    const number = mysteryPlay[1];
    // Een toekomstige mystery krijgt direct dezelfde terugbalk; zolang er
    // nog geen vertaalde titel in de catalogus staat, blijft de game-identiteit
    // zichtbaar in plaats van dat focus mode zonder terugnavigatie opent.
    return { fallback: `/mysteries/${number}`, title: MYSTERY_PLAY_TITLES[number] ?? "pages.mystery" };
  }
  // Groepen (Samen) horen bij Vrienden.
  if (pathname === "/groups") return { fallback: "/friends", title: "together.pages.groups" };
  if (pathname === "/acties") return { fallback: "/dashboard", title: "actionCenter.title" };
  if (pathname === "/groups/new") return { fallback: "/groups", title: "together.pages.newGroup" };
  if (pathname === "/groups/leaderboard") return { fallback: "/groups", title: "together.pages.groupLeaderboard" };
  const groupSettings = /^\/groups\/([^/]+)\/settings$/.exec(pathname);
  if (groupSettings) return { fallback: `/groups/${groupSettings[1]}`, title: "together.pages.groupSettings" };
  if (/^\/groups\/[^/]+$/.test(pathname)) return { fallback: "/groups", title: "together.pages.group" };
  if (pathname === "/alleskenner/alleen") return { fallback: "/alleskenner", title: "pages.playAlone" };
  if (/^\/alleskenner\/alleen\/[^/]+$/.test(pathname)) return { fallback: "/alleskenner/alleen", title: "pages.playAlone" };
  if (pathname === "/alleskenner/seizoen") return { fallback: "/alleskenner", title: "pages.seasons" };
  if (/^\/alleskenner\/seizoen\/[^/]+$/.test(pathname)) return { fallback: "/alleskenner/seizoen", title: "pages.season" };
  if (/^\/chapter-guess\/solo\/[^/]+$/.test(pathname)) return { fallback: "/chapter-guess", title: "pages.playAlone" };
  if (/^\/snelle-zendeling\/run\/[^/]+$/.test(pathname)) return { fallback: "/snelle-zendeling", title: "pages.quickMissionary" };
  if (/^\/scrabble\/[^/]+$/.test(pathname)) return { fallback: "/scrabble", title: "pages.wordGame" };
  if (/^\/word-search\/[^/]+$/.test(pathname)) return { fallback: "/word-search", title: "pages.wordSearch" };
  if (/^\/live\/[^/]+$/.test(pathname)) return { fallback: "/live", title: "pages.play" };
  if (/^\/fsy\/[^/]+$/.test(pathname)) return { fallback: "/courses", title: "pages.lesson" };
  // Lessen uit een cursus. Weet de pagina uit welke cursus de les komt, dan
  // geeft hij die door (zie CourseBackTarget) als terugval en ondertitel.
  const lesson = LESSON_PAGES.find(([pattern]) => pattern.test(pathname));
  if (lesson) return { fallback: "/courses", title: lesson[1] };
  const chapter = /^\/courses\/([^/]+)\/chapter\/[^/]+$/.exec(pathname);
  if (chapter) return { fallback: `/courses/${chapter[1]}`, title: "pages.chapter" };
  if (/^\/courses\/[^/]+$/.test(pathname)) return { fallback: "/courses", title: "pages.course" };
  return null;
}

/**
 * De kop van elke detailpagina: "← Paginatitel" met eventueel een
 * ondertitel, in de vaste bovenbalk (StickyHeader in layout.tsx), direct
 * onder de header en boven eventuele miniplayers. Telt vanzelf mee in
 * --header-height.
 *
 * De pijl en paginatitel vormen samen één terugknop (useBackNavigation): je
 * komt terug waar je vandaan kwam, ook als dat Vandaag of een melding was.
 * Alleen bij een rechtstreeks geopende link gaat hij naar de logische
 * bovenliggende pagina (`fallback`).
 */
export default function SubpageBackBar() {
  const pathname = usePathname();
  const profileView = useSearchParams().get("view");
  const hash = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("hashchange", onChange);
      return () => window.removeEventListener("hashchange", onChange);
    },
    () => window.location.hash,
    () => "",
  );
  const t = useT();
  const { character } = useCompanion();
  const override = useBackTargetOverride(pathname);
  const page = detailPageFor(pathname, profileView, hash);
  const goBack = useBackNavigation(override?.href ?? page?.fallback ?? "/dashboard", { forceFallback: page?.forceFallback || Boolean(override) });
  if (!page) return null;
  // Een cursusnaam (override) komt al als tekst uit de database.
  const subtitle = override?.parent ?? (page.subtitle ? t(page.subtitle) : null);
  const title = pathname === "/snelle-zendeling" ? quickMissionaryTitle(t, character) : t(page.title);

  return (
    <div data-subpage-back-bar className="border-b border-vs-line bg-vs-elevated">
      <div className="mx-auto flex max-w-5xl min-w-0 items-center gap-1 px-4 py-1">
        <button
          type="button"
          onClick={goBack}
          aria-label={t("common.back")}
          className="group -ml-3 flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded-xl pr-2 text-left transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-vs-fg-2 transition group-hover:text-vs-fg" aria-hidden>
            <ArrowLeft className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-extrabold text-vs-fg">{title}</span>
            {subtitle && <span className="block truncate text-xs font-semibold text-vs-fg-2">{subtitle}</span>}
          </span>
        </button>
      </div>
    </div>
  );
}
