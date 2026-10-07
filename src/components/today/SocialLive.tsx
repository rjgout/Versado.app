"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import UserAvatar from "@/components/UserAvatar";
import { getSocket } from "@/lib/socketClient";
import { focusRing, primaryButton } from "@/components/versado/styles";
import type { TodayData } from "@/lib/today";

// Wie er nu online is, live bijgewerkt: dezelfde socketberichten als de
// vriendenpagina (zie FriendsClient.tsx). De server stuurt alleen wat een
// vriend zelf deelt (presence.ts, ook incognito) en alleen aan wie de eigen
// status deelt, dus hier wordt niets gefilterd of afgeleid.
const MAX_SHOWN = 6;

interface StatusUpdate {
  userId: string;
  hidden: boolean;
  online?: boolean;
  activity?: { icon: string; label: string };
}

export default function SocialLive({ social }: { social: TodayData["social"] }) {
  const t = useT();
  const [online, setOnline] = useState(social.online);

  // Na router.refresh (bv. een nieuwe vriend) komt er een nieuwe beginstand.
  useEffect(() => setOnline(social.online), [social.online]);

  useEffect(() => {
    const socket = getSocket();
    function onStatusUpdate(payload: StatusUpdate) {
      setOnline((prev) => {
        const next = { ...prev };
        if (payload.hidden || !payload.online) delete next[payload.userId];
        else next[payload.userId] = payload.activity?.label ?? null;
        return next;
      });
    }
    function onStatusReset() {
      setOnline({});
    }
    // Een nieuw verzoek of een geaccepteerde vriendschap ververst de hele pagina via de
    // live-data-laag (friends_changed → friendsChanged → LiveRefresh op Vandaag).
    // De activiteit van vrienden kent alleen de socketserver; vraag de
    // actuele stand op bij openen en bij terugkeren naar de app.
    function requestStatuses() {
      if (document.visibilityState === "visible") socket.emit("friend_statuses_request");
    }
    socket.on("friend_status_update", onStatusUpdate);
    socket.on("friend_status_reset", onStatusReset);
    socket.on("connect", requestStatuses);
    document.addEventListener("visibilitychange", requestStatuses);
    requestStatuses();
    return () => {
      socket.off("friend_status_update", onStatusUpdate);
      socket.off("friend_status_reset", onStatusReset);
      socket.off("connect", requestStatuses);
      document.removeEventListener("visibilitychange", requestStatuses);
    };
  }, []);

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
