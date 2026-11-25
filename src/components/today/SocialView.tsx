"use client";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { UserPlus } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { TodayAvatar as UserAvatar } from "./TodayInteractions";
import { focusRing, primaryButton } from "@/components/versado/styles";
import type { TodayData } from "@/lib/today";
const MAX_SHOWN = 6;
export default function SocialView({ social }: { social: TodayData["social"] }) {
  const t = useT(), online = social.online;
  if (social.friends.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-vs-fg-2">{t("today.social.noFriends")}</p>
        <Link href="/friends" className={primaryButton}>
          <UserPlus className="h-4 w-4" aria-hidden />
          {t("today.social.findFriends")}
        </Link>
      </div>
    );
  }
  if (!social.viewerSharesOnline) {
    return (
      <p className="text-sm text-vs-fg-2">
        {t("today.social.shareOff")}{" "}
        <Link href="/profile" className={`font-bold text-vs-accent hover:underline ${focusRing}`}>
          {t("today.social.shareOffCta")}
        </Link>
      </p>
    );
  }

  const onlineFriends = social.friends.filter((friend) => friend.id in online);
  return (
    // aria-live: wie een schermlezer gebruikt, hoort het ook als iemand online komt.
    <div aria-live="polite">
      {onlineFriends.length === 0 ? (
        <p className="text-sm text-vs-fg-2">{t("today.social.noneOnline")}</p>
      ) : (
        <>
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-vs-fg">
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full rounded-full bg-vs-success opacity-40 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-vs-success" />
            </span>
            {onlineFriends.length === 1 ? t("today.social.onlineOne") : t("today.social.onlineMany", { n: onlineFriends.length })}
          </p>
          <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-1">
            {onlineFriends.slice(0, MAX_SHOWN).map((friend) => (
              <li key={friend.id} className="flex min-w-0 items-center gap-3">
                <span className="relative shrink-0">
                  <UserAvatar id={friend.id} handle={friend.handle} avatarEmoji={friend.avatarEmoji} size="sm" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-vs-surface bg-vs-success" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-vs-fg">{friend.handle}</p>
                  <p className="truncate text-xs text-vs-fg-3">{online[friend.id] ?? t("today.social.online")}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
