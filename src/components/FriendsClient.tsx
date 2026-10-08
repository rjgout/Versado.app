"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock3, MoreHorizontal } from "lucide-react";
import { formatTag } from "@/lib/handle";
import { getSocket } from "@/lib/socketClient";
import UserTag from "@/components/UserTag";
import UserAvatar from "@/components/UserAvatar";
import FriendInviteCard from "@/components/FriendInviteCard";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { translateServerText } from "@/lib/i18n/serverTexts";
import { rich } from "@/lib/i18n/rich";
import { iconButton } from "@/components/versado/styles";
import SystemIcon from "@/components/versado/SystemIcon";
import GroupsEntryCard from "@/components/social/GroupsEntryCard";
import FriendStreaksSection, { type FriendStreaksData } from "@/components/social/FriendStreaksSection";
import { socialRequest } from "@/components/social/shared";
import { useLiveQuery } from "@/lib/data/hooks";
import { ApiRequestError, fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";
import { invalidateData } from "@/lib/data/client";

interface FriendUser {
  id: string;
  handle: string;
  discriminator: string;
  xpTotal: number;
  currentStreak: number;
  avatarEmoji: string | null;
}

interface FriendStatus {
  online: boolean;
  activity?: { icon: string; label: string };
  lastSeenLabel?: string;
}

interface FriendsData {
  friends: { friendshipId: string; user: FriendUser }[];
  incoming: { friendshipId: string; from: FriendUser }[];
  outgoing: { friendshipId: string; to: FriendUser }[];
  statusByUserId: Record<string, FriendStatus>;
  nudge: { availableAt: Record<string, string>; disabled: string[] };
}

interface SearchResult {
  id: string;
  handle: string;
  discriminator: string;
  friendshipStatus: "PENDING" | "ACCEPTED" | "DECLINED" | null;
}

interface MenuAction {
  label: string;
  onSelect: () => void;
}

function FriendOverflowMenu({ actions, onRemove }: { actions: MenuAction[]; onRemove: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        className={iconButton}
        aria-label={t("friends.moreOptions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-10 mt-1 min-w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-vs-fg hover:bg-vs-subtle"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            {t("friends.unfriend")}
          </button>
        </div>
      )}
    </div>
  );
}

/** De foutmelding van de server (al vertaald), of niets bij een technische fout. */
function serverMessage(error: unknown): string | null {
  return error instanceof ApiRequestError && !error.message.startsWith("HTTP ") ? error.message : null;
}

export default function FriendsClient({ appName }: { appName: string }) {
  const t = useT();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [giftedTo, setGiftedTo] = useState<string | null>(null);
  const [pendingFreeze, setPendingFreeze] = useState<FriendUser | null>(null);
  const [confirmingFreeze, setConfirmingFreeze] = useState(false);

  // Vriendenlijst en vriendenreeksen zijn twee datasets van dezelfde scope: een vriendschapswijziging
  // (eigen actie, of een seintje van de server via friends_changed) ververst ze, en de live-data-laag
  // controleert ze bij openen, terugnavigeren en focus. Korte staleTime: verzoeken worden ook elders
  // (Vandaag, meldingen) afgehandeld zonder deze dataset te kennen. Een iPhone-app die je terughaalt laadt
  // de pagina niet opnieuw; de laag vangt dat op.
  const friendsQuery = useLiveQuery<FriendsData>(
    ["friends", "list"],
    async () => {
      const result = await fetchJson<FriendsData>("/api/friends");
      // /api/friends kent de huidige activiteit van vrienden niet (die leeft
      // alleen in de socketserver); die vult hem via friend_status_update aan.
      getSocket().emit("friend_statuses_request");
      return result;
    },
    { scopes: ["friends"], staleTime: 1_000 }
  );
  const streaksQuery = useLiveQuery<FriendStreaksData>(["friends", "streaks"], () => fetchJson<FriendStreaksData>("/api/friend-streaks"), {
    scopes: ["friends", "streak"],
    staleTime: 1_000,
  });
  const data = friendsQuery.data ?? null;
  const streaks = streaksQuery.data ?? null;
  const setData = friendsQuery.setData;

  // Live aanwezigheid: dezelfde altijd-open socketverbinding die ook uitnodigingen binnenkrijgt
  // (zie InviteListener.tsx) — de server pusht hierop al naar `user:${jouwId}` zodra een vriend van
  // status verandert. Dit is geen verversing van de lijst maar een directe statusupdate erin.
  useEffect(() => {
    const socket = getSocket();
    function onStatusUpdate(payload: { userId: string; hidden: boolean } & Partial<FriendStatus>) {
      setData((prev) => {
        if (!prev) return prev;
        const next = { ...prev.statusByUserId };
        if (payload.hidden) {
          delete next[payload.userId];
        } else {
          next[payload.userId] = {
            online: !!payload.online,
            activity: payload.activity,
            lastSeenLabel: payload.lastSeenLabel,
          };
        }
        return { ...prev, statusByUserId: next };
      });
    }
    function onStatusReset() {
      setData((prev) => (prev ? { ...prev, statusByUserId: {} } : prev));
    }
    socket.on("friend_status_update", onStatusUpdate);
    socket.on("friend_status_reset", onStatusReset);
    return () => {
      socket.off("friend_status_update", onStatusUpdate);
      socket.off("friend_status_reset", onStatusReset);
    };
  }, [setData]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const timeout = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.results));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  async function sendRequest(target: SearchResult) {
    setMessage(null);
    try {
      await liveMutation(
        () =>
          fetchJson("/api/friends/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetUserId: target.id }),
          }),
        { invalidates: "friendsChanged" }
      );
      setMessage(t("friends.requestSent", { tag: formatTag(target.handle, target.discriminator) }));
      setSentTo((prev) => new Set(prev).add(target.id));
      getSocket().emit("friendship_changed", { otherUserId: target.id });
    } catch (error) {
      setMessage(serverMessage(error) ?? t("wordOfTheDay.somethingWrong"));
    }
  }

  async function removeFriendship(friendshipId: string, kind: "request" | "friendship") {
    if (!(await confirm(t(kind === "request" ? "friends.confirmRemoveRequest" : "friends.confirmRemoveFriendship")))) return;
    try {
      await liveMutation(() => fetchJson(`/api/friends/${friendshipId}`, { method: "DELETE" }), { invalidates: "friendsChanged" });
    } catch (error) {
      setMessage(serverMessage(error) ?? t("friends.removeFailed"));
    }
  }

  async function giftFreeze(toUserId: string) {
    setMessage(null);
    try {
      // Een geschonken bevriezing kost jou er één: reeks en profiel kloppen daarna niet meer.
      await liveMutation(
        () =>
          fetchJson("/api/freezes/gift", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toUserId }),
          }),
        { invalidates: ["streak", "profile", "today"] }
      );
      setGiftedTo(toUserId);
      setMessage(t("friends.freezeSent"));
      setTimeout(() => setGiftedTo(null), 2000);
    } catch (error) {
      setMessage(serverMessage(error) ?? t("friends.freezeFailed"));
    }
  }

  async function startFriendStreak(friend: FriendUser) {
    setMessage(null);
    const result = await socialRequest("/api/friend-streaks", { friendId: friend.id });
    setMessage(result.ok ? t("together.friendStreaks.started") : (result.error ?? t("together.common.error")));
    // Ook bij een fout de werkelijke stand tonen (bv. de limiet was net bereikt).
    invalidateData(["friends", "today", "activity"]);
  }

  async function nudgeFriend(friend: FriendUser) {
    setMessage(null);
    const result = await socialRequest("/api/nudges", { recipientId: friend.id, context: { kind: "general" } });
    setMessage(result.ok ? t("together.nudge.given") : (result.error ?? t("together.common.error")));
    if (result.ok) invalidateData("friendsChanged");
  }

  if (!data) return <p className="text-slate-400 dark:text-slate-500">{t("common.loading")}</p>;

  // Vrienden met een open of lopende vriendenreeks (dan geen "start"-actie).
  const streakFriendIds = new Set((streaks?.streaks ?? []).map((s) => s.friend.id));
  const streakSlotsFull = !!streaks && streaks.activeCount >= streaks.limit;
  function menuActions(friend: FriendUser): MenuAction[] {
    const actions: MenuAction[] = [];
    if (streaks && !streakFriendIds.has(friend.id) && !streakSlotsFull) actions.push({ label: t("together.friendStreaks.start"), onSelect: () => startFriendStreak(friend) });
    const waitUntil = data?.nudge.availableAt[friend.id];
    if (!data?.nudge.disabled.includes(friend.id) && !(waitUntil && Date.parse(waitUntil) > Date.now())) {
      actions.push({ label: t("together.nudge.give"), onSelect: () => nudgeFriend(friend) });
    }
    return actions;
  }

  const onlineCount = Object.values(data.statusByUserId).filter((s) => s.online).length;
  // Houd actieve vrienden direct zichtbaar; de volgorde binnen online en
  // offline blijft gelijk aan de volgorde die de API aanlevert.
  const sortedFriends = [...data.friends].sort(
    (a, b) => Number(data.statusByUserId[b.user.id]?.online ?? false) - Number(data.statusByUserId[a.user.id]?.online ?? false)
  );

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300 flex items-center gap-2">
            <span aria-hidden>👥</span> {t("nav.friends")}
          </h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("friends.intro")}
        </p>
      </div>

      {data.friends.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card !py-3 flex flex-col items-center gap-0.5">
            <div className="text-xl font-extrabold text-brand-600 dark:text-brand-300">👥 {data.friends.length}</div>
            <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("nav.friends")}</div>
          </div>
          <div className="card !py-3 flex flex-col items-center gap-0.5">
            <div className="text-xl font-extrabold text-green-600 dark:text-green-400">🟢 {onlineCount}</div>
            <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("friendPicker.onlineNow")}</div>
          </div>
        </div>
      )}

      <GroupsEntryCard />

      <div className="card flex flex-col gap-2.5 sm:gap-3">
        <p className="font-bold text-sm dark:text-slate-100 flex items-center gap-2">
          <span aria-hidden>➕</span> {t("friends.addFriend")}
        </p>
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          <input
            className="input flex-1"
            placeholder={t("friends.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {results && results.length === 0 && query.trim().length >= 2 && (
          <p className="text-sm text-slate-400 dark:text-slate-500">{t("friends.nobodyFound")}</p>
        )}
        {results && results.length > 0 && (
          <div className="flex flex-col gap-2">
            {results.map((r) => (
              <div
                key={r.id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-xl px-2 !py-2 hover:bg-brand-50 dark:hover:bg-slate-700"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2 dark:text-slate-100">
                  <UserAvatar id={r.id} handle={r.handle} size="sm" />
                  <UserTag handle={r.handle} discriminator={r.discriminator} className="block min-w-0 truncate" />
                </span>
                <button
                  className="btn-secondary shrink-0 !px-3 !py-1.5"
                  disabled={sentTo.has(r.id) || r.friendshipStatus === "PENDING" || r.friendshipStatus === "ACCEPTED"}
                  onClick={() => sendRequest(r)}
                  aria-label={
                    r.friendshipStatus === "ACCEPTED"
                      ? t("friends.alreadyFriends")
                      : r.friendshipStatus === "PENDING"
                        ? t("friends.requestPending")
                        : undefined
                  }
                >
                  {r.friendshipStatus === "ACCEPTED"
                    ? "✅"
                    : r.friendshipStatus === "PENDING"
                      ? "⏳"
                      : sentTo.has(r.id)
                        ? t("friends.sent")
                        : t("courses.add")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {message && <p className="text-sm font-semibold text-brand-600">{message}</p>}

      <FriendInviteCard appName={appName} />

      {data.incoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            {t("friends.requests")}
            <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-gold-50 dark:bg-slate-700 text-gold-700 dark:text-gold-400 text-xs font-extrabold">
              {data.incoming.length}
            </span>
          </h2>
          <div className="flex flex-col gap-2">
            {data.incoming.slice(0, 3).map(({ friendshipId, from }) => (
              <div
                key={friendshipId}
                className="card !py-3 !bg-gold-50 dark:!bg-slate-800 !border-gold-400/30 dark:!border-slate-700 flex items-center justify-between gap-3 flex-wrap"
              >
                <span className="flex items-center gap-2 font-bold dark:text-slate-100">
                  <UserAvatar id={from.id} handle={from.handle} avatarEmoji={from.avatarEmoji} size="md" />
                  <UserTag handle={from.handle} discriminator={from.discriminator} />
                </span>
                <Link href="/acties" className="btn-primary !px-3 !py-1.5">{t("today.cta.view")}</Link>
              </div>
            ))}
          </div>
          <Link href="/acties" className="self-start text-sm font-extrabold text-vs-accent hover:underline">{t("actionCenter.viewAllRequests", { n: data.incoming.length })}</Link>
        </section>
      )}

      {data.outgoing.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-extrabold text-slate-700 dark:text-slate-200">{t("friends.sentRequests")}</h2>
          <div className="flex flex-col gap-2">
            {data.outgoing.map(({ friendshipId, to }) => (
              <div key={friendshipId} className="card flex items-center gap-3 !py-3 text-slate-500 dark:text-slate-400">
                <UserAvatar id={to.id} handle={to.handle} avatarEmoji={to.avatarEmoji} size="sm" />
                <span aria-hidden>⏳</span>
                <span className="min-w-0 flex-1">
                  {rich(t("friends.waitingFor"), { tag: <UserTag handle={to.handle} discriminator={to.discriminator} /> })}
                </span>
                <button className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={() => removeFriendship(friendshipId, "request")}>{t("activeGames.cancel")}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {streaks && (data.friends.length > 0 || streaks.streaks.length > 0) && (
        <FriendStreaksSection data={streaks} nudge={data.nudge} onChanged={() => invalidateData(["friends", "today", "activity"])} />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-extrabold text-slate-700 dark:text-slate-200">
          {t("friends.yourFriends")}
        </h2>
        {data.friends.length === 0 && <p className="text-slate-400 dark:text-slate-500">{t("friends.none")}</p>}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          {sortedFriends.map(({ friendshipId, user: f }) => {
            const status = data.statusByUserId[f.id];
            return (
              <div key={f.id} className="card !p-3 sm:!p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="relative shrink-0">
                    <UserAvatar id={f.id} handle={f.handle} avatarEmoji={f.avatarEmoji} size="md" />
                    {status?.online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-green-500 dark:border-slate-800" aria-label={t("friendPicker.online")} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold dark:text-slate-100">
                      <UserTag handle={f.handle} discriminator={f.discriminator} className="truncate" />
                    </div>
                    {status?.online ? (
                      <div className="truncate text-xs font-semibold text-green-600 dark:text-green-400">
                        {status.activity ? `${t("friendPicker.online")} · ${status.activity.icon} ${translateServerText(status.activity.label, t)}` : t("friendPicker.online")}
                      </div>
                    ) : status?.lastSeenLabel ? (
                      <div className="flex min-w-0 items-center gap-1 truncate text-xs text-slate-500 dark:text-slate-400">
                        <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{t("friends.lastActive", { when: translateServerText(status.lastSeenLabel, t) })}</span>
                      </div>
                    ) : null}
                    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="no-select inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-0.5 text-xs font-bold text-gold-700 dark:bg-slate-700 dark:text-gold-400">
                        <SystemIcon kind="streak" className="h-3.5 w-3.5" aria-hidden /> {f.currentStreak}
                      </span>
                      <span className="no-select inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700 dark:bg-slate-700 dark:text-brand-300">
                        <SystemIcon kind="xp" className="h-3.5 w-3.5" fill="currentColor" aria-hidden /> {f.xpTotal} XP
                      </span>
                      <button
                        className="btn-ice inline-flex !min-h-9 shrink-0 items-center gap-1 !px-2 !py-1 !text-xs"
                        onClick={() => setPendingFreeze(f)}
                        disabled={giftedTo === f.id}
                        aria-label={giftedTo === f.id ? t("friends.sentExcl") : t("friends.giveFreeze")}
                      >
                        <SystemIcon kind="freeze" className="h-3.5 w-3.5" aria-hidden />
                        {giftedTo === f.id ? t("friends.sentExcl") : t("friends.giveFreeze")}
                      </button>
                    </div>
                  </div>
                  <FriendOverflowMenu actions={menuActions(f)} onRemove={() => removeFriendship(friendshipId, "friendship")} />
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {pendingFreeze && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="freeze-confirm-title"
        >
          <div className="card w-full max-w-sm !p-5 shadow-xl">
            <h2 id="freeze-confirm-title" className="text-lg font-extrabold text-slate-800 dark:text-slate-100">
              {t("friends.freezeTitle")}
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {rich(t("friends.freezeConfirm"), {
                tag: <UserTag handle={pendingFreeze.handle} discriminator={pendingFreeze.discriminator} className="font-bold" />,
              })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary !px-3 !py-2" onClick={() => setPendingFreeze(null)}>
                {t("activeGames.cancel")}
              </button>
              <button
                className="btn-ice !px-3 !py-2"
                disabled={confirmingFreeze}
                onClick={async () => {
                  setConfirmingFreeze(true);
                  await giftFreeze(pendingFreeze.id);
                  setConfirmingFreeze(false);
                  setPendingFreeze(null);
                }}
              >
                {confirmingFreeze ? t("friends.sending") : t("friends.yesGiveFreeze")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
