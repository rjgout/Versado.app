"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSocket } from "@/lib/socketClient";
import UserAvatar from "@/components/UserAvatar";
import { useT } from "@/components/I18nProvider";
import { translateServerText } from "@/lib/i18n/serverTexts";
import type { TFunction } from "@/lib/i18n/core";
import { Bell } from "lucide-react";
import {
  IN_APP_NOTIFICATION_EVENT,
  type InAppNotification,
} from "@/lib/notificationEvents";

interface Invite {
  code: string;
  fromDisplayName: string;
  fromUserId?: string;
  gameLabel?: string;
  // Waar tikken naartoe gaat; zonder = de lobby van een live spel (/live/<code>).
  // Bv. een woordspeluitnodiging gaat naar /scrabble, geen live spel.
  href?: string;
}

function inviteHref(invite: Invite): string {
  return invite.href ?? `/live/${invite.code}`;
}

type Notice =
  | ({ kind: "invite" } & Invite)
  | { kind: "notification"; item: InAppNotification }
  // Vrienden die (vrijwel) tegelijk online kwamen, in één melding.
  | { kind: "online"; friends: { userId: string; name: string }[] };

function joinNames(names: string[], t: TFunction): string {
  return names.length > 1
    ? t("friendPicker.namesAnd", { names: names.slice(0, -1).join(", "), last: names[names.length - 1] })
    : (names[0] ?? "");
}

const AUTO_HIDE_MS = 8000;
const DISMISS_DISTANCE_PX = 40;
const TAP_TOLERANCE_PX = 6;

/**
 * Melding binnen de app in de stijl van een systeemmelding: schuift van boven
 * in, omhoog vegen = negeren, tikken = openen. Voor een live-uitnodiging
 * (tikken = meedoen; negeren is niet weigeren: de uitnodiging blijft bij
 * Spelen staan tot de host start of annuleert, en is de app dicht dan komt
 * hij als pushmelding binnen) en voor een vriend die online komt (zie
 * announceCameOnline in src/lib/presence.ts; bewust zonder pushmelding), en
 * voor nieuwe meldingen uit het centrale meldingencentrum. Een uitnodiging
 * gaat altijd voor: die wordt nooit door een andere banner vervangen.
 */
export default function InviteListener() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [offsetY, setOffsetY] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const drag = useRef<{ startY: number; moved: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const dismiss = useCallback(() => {
    clearHideTimer();
    setLeaving(true);
    setTimeout(() => {
      setNotice(null);
      setLeaving(false);
      setOffsetY(0);
    }, 250);
  }, []);

  const startHideTimer = useCallback(() => {
    clearHideTimer();
    hideTimer.current = setTimeout(dismiss, AUTO_HIDE_MS);
  }, [dismiss]);

  useEffect(() => {
    const socket = getSocket();
    function onInvite(data: Invite) {
      setLeaving(false);
      setOffsetY(0);
      setNotice({ kind: "invite", ...data });
    }
    function onRevoked({ code }: { code: string }) {
      setNotice((current) => (current?.kind === "invite" && current.code === code ? null : current));
    }
    function onFriendOnline(friend: { userId: string; name: string }) {
      setNotice((current) => {
        if (current?.kind === "invite" || current?.kind === "notification") return current;
        const others = current?.kind === "online" ? current.friends.filter((f) => f.userId !== friend.userId) : [];
        return { kind: "online", friends: [...others, friend] };
      });
      setLeaving(false);
      setOffsetY(0);
    }
    function onNotification(event: Event) {
      const item = (event as CustomEvent<InAppNotification>).detail;
      if (!item) return;
      setNotice((current) => (current?.kind === "invite" ? current : { kind: "notification", item }));
      setLeaving(false);
      setOffsetY(0);
    }
    socket.on("game_invite", onInvite);
    socket.on("game_invite_revoked", onRevoked);
    socket.on("friend_online", onFriendOnline);
    window.addEventListener(IN_APP_NOTIFICATION_EVENT, onNotification);
    return () => {
      socket.off("game_invite", onInvite);
      socket.off("game_invite_revoked", onRevoked);
      socket.off("friend_online", onFriendOnline);
      window.removeEventListener(IN_APP_NOTIFICATION_EVENT, onNotification);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    startHideTimer();
    return clearHideTimer;
  }, [notice, startHideTimer]);

  if (!notice || (notice.kind === "invite" && pathname === inviteHref(notice))) return null;

  function open() {
    if (!notice) return;
    clearHideTimer();
    setNotice(null);
    if (notice.kind === "invite") {
      // Dezelfde uitnodiging staat ook in het meldingencentrum: die is nu afgehandeld.
      fetch("/api/notifications", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: inviteHref(notice) }),
      })
        .then(() => window.dispatchEvent(new Event("jehova:notifications-changed")))
        .catch(() => {});
    } else if (notice.kind === "notification") {
      fetch("/api/notifications", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [notice.item.id] }),
      })
        .then(() => window.dispatchEvent(new Event("jehova:notifications-changed")))
        .catch(() => {});
    }
    router.push(
      notice.kind === "invite"
        ? inviteHref(notice)
        : notice.kind === "notification"
          ? notice.item.url
          : "/friends"
    );
  }

  const names = notice.kind === "online" ? joinNames(notice.friends.map((f) => f.name), t) : "";
  const inviteText =
    notice.kind === "invite"
      ? notice.gameLabel
        ? t("inviteBanner.invitesYouFor", { name: translateServerText(notice.fromDisplayName, t), game: translateServerText(notice.gameLabel, t) })
        : t("inviteBanner.invitesYou", { name: notice.fromDisplayName })
      : "";
  const onlineText =
    notice.kind === "online"
      ? notice.friends.length > 1
        ? t("inviteBanner.areOnline", { names })
        : t("inviteBanner.isOnline", { names })
      : "";
  const content =
    notice.kind === "invite"
      ? {
          person: notice.fromUserId ? { id: notice.fromUserId, name: notice.fromDisplayName } : null,
          icon: "🎮",
          iconClass: "from-brand-500 to-brand-700",
          title: notice.href ? t("inviteBanner.invitation") : t("inviteBanner.liveInvitation"),
          text: `${inviteText}${t("inviteBanner.tapToJoin")}`,
          label: `${inviteText}${t("inviteBanner.tapToJoinOrSwipe")}`,
        }
      : notice.kind === "notification"
        ? {
            person: null,
            icon: <Bell className="h-5 w-5" aria-hidden />,
            iconClass: "from-brand-500 to-brand-700 text-white",
            title: notice.item.title,
            text: `${notice.item.body}${t("inviteBanner.tapToOpen")}`,
            label: `${notice.item.title}. ${notice.item.body}${t("inviteBanner.tapToOpenOrSwipe")}`,
          }
        : {
            // Bij meerdere vrienden tegelijk: de avatar van wie het laatst online kwam.
            person: {
              id: notice.friends[notice.friends.length - 1].userId,
              name: notice.friends[notice.friends.length - 1].name,
            },
            icon: "👋",
            iconClass: "from-green-500 to-green-700",
            title: notice.friends.length > 1 ? t("inviteBanner.friendsOnline") : t("inviteBanner.friendOnline"),
            text: `${onlineText}${t("inviteBanner.tapToFriends")}`,
            label: `${onlineText}${t("inviteBanner.tapToFriendsOrSwipe")}`,
          };

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, moved: 0 };
    clearHideTimer();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    drag.current.moved = Math.max(drag.current.moved, Math.abs(dy));
    // Omhoog volgt de vinger één op één, omlaag alleen met veel weerstand.
    setOffsetY(dy < 0 ? dy : dy * 0.2);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    const moved = drag.current.moved;
    drag.current = null;
    if (dy < -DISMISS_DISTANCE_PX) {
      dismiss();
    } else if (moved <= TAP_TOLERANCE_PX) {
      open();
    } else {
      setOffsetY(0);
      startHideTimer();
    }
  }

  const translate = leaving ? "translateY(-150%)" : `translateY(${offsetY}px)`;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex justify-center px-2 pointer-events-none"
      style={{ paddingTop: "calc(var(--vs-safe-area-top) + 0.5rem)" }}
    >
      <div className="w-full max-w-md animate-slide-down">
        <div
          role="button"
          tabIndex={0}
          aria-label={content.label}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
            setOffsetY(0);
            startHideTimer();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") open();
            if (e.key === "Escape") dismiss();
          }}
          className="pointer-events-auto select-none touch-none cursor-pointer rounded-[1.75rem] bg-white/85 dark:bg-slate-800/85 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 px-3.5 pt-3 pb-2"
          style={{
            transform: translate,
            opacity: leaving ? 0 : 1,
            transition: drag.current ? "none" : "transform 0.25s ease-out, opacity 0.25s ease-out",
          }}
        >
          <div className="flex items-start gap-3">
            {content.person ? (
              <UserAvatar id={content.person.id} handle={content.person.name} size="md" className="shadow-sm" />
            ) : (
              <div
                className={`h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br ${content.iconClass} flex items-center justify-center text-xl shadow-sm`}
              >
                {content.icon}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100 truncate">{content.title}</p>
                <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">{t("inviteBanner.now")}</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug">{content.text}</p>
            </div>
          </div>
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden />
        </div>
      </div>
    </div>
  );
}
