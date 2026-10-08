import Link from "next/link";
import { ArrowRight, Gamepad2 } from "lucide-react";
import { getT } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import { relativeTime } from "@/lib/timeFormat";
import UserAvatar from "@/components/UserAvatar";
import SectionHeader from "@/components/today/SectionHeader";
import FriendRequestButtons from "@/components/today/FriendRequestButtons";
import { primaryButton, surfaceCard } from "@/components/versado/styles";
import type { OpenAction } from "@/lib/today";
import type { MessageKey } from "@/lib/i18n/core";

// Wat nu op jou wacht, bovenaan Vandaag. Alleen getoond als er iets is.
// Per regel: wie, wat, wanneer en één duidelijke knop.

function describe(action: OpenAction): { titleKey: MessageKey; ctaKey: MessageKey } {
  switch (action.kind) {
    case "friend-request":
      return { titleKey: "today.action.friendRequest", ctaKey: "today.cta.accept" };
    case "group-invite":
    case "group-request":
      return { titleKey: "today.action.gameInvite", ctaKey: "today.cta.view" };
    case "live-invite":
      return { titleKey: "today.action.liveInvite", ctaKey: "today.cta.join" };
    case "game-invite":
      return action.game === "challenge"
        ? { titleKey: "today.action.challengeInvite", ctaKey: "today.cta.play" }
        : { titleKey: "today.action.gameInvite", ctaKey: "today.cta.view" };
    case "game-turn":
      return { titleKey: "today.action.yourTurn", ctaKey: "today.cta.continue" };
    case "game-continue":
      return { titleKey: "today.action.soloActive", ctaKey: "today.cta.continue" };
    case "game-waiting":
      return { titleKey: "today.action.gameInvite", ctaKey: "today.cta.view" };
  }
}

export default function OpenActions({ actions, total, language }: { actions: OpenAction[]; total: number; language: string }) {
  const t = getT(language);
  const locale = getLanguage(language).intlLocale;
  return (
    <section aria-labelledby="today-actions" className="vs-rise">
      <SectionHeader id="today-actions" title={t("today.actionsTitle")} count={total} href="/acties" linkLabel={t("activeGames.viewAllActions", { n: total })} />
      <ul className={`${surfaceCard} divide-y divide-vs-line overflow-hidden`}>
        {actions.map((action) => {
          const { titleKey, ctaKey } = describe(action);
          const name = action.person?.handle ?? "";
          const when = relativeTime(action.at, locale);
          const detail = [action.subject, when].filter(Boolean).join(" · ");
          return (
            <li key={action.key} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
              {action.person ? (
                <UserAvatar id={action.person.id} handle={action.person.handle} size="md" />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-vs-accent-soft text-vs-accent" aria-hidden>
                  <Gamepad2 className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[15px] font-bold leading-snug text-vs-fg">{t(titleKey, { name })}</p>
                {detail && <p className="truncate text-sm text-vs-fg-3">{detail}</p>}
              </div>
              {action.kind === "friend-request" && action.actionId && action.person ? (
                <FriendRequestButtons friendshipId={action.actionId} otherUserId={action.person.id} name={name} />
              ) : (
                <Link href={action.href} className={primaryButton}>
                  <span className="hidden min-[400px]:inline">{t(ctaKey)}</span>
                  <ArrowRight className="h-4 w-4 min-[400px]:hidden" aria-hidden />
                  <span className="sr-only min-[400px]:hidden">{t(ctaKey)}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
