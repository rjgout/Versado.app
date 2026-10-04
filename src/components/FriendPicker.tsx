"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { getSocket } from "@/lib/socketClient";
import UserAvatar from "@/components/UserAvatar";
import UserTag from "@/components/UserTag";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { translateServerText } from "@/lib/i18n/serverTexts";
import { getLanguage } from "@/lib/languages";
import type { TFunction } from "@/lib/i18n/core";

export interface PickerFriend {
  id: string;
  handle: string;
  discriminator: string;
  avatarEmoji: string | null;
}

interface FriendStatus {
  online: boolean;
  activity?: { icon: string; label: string };
}

type FriendState = "invite" | "invited" | "joined";

const RECENT_LIMIT = 5;
// Omlaag vegen sluit het paneel (zoals een paneel op een telefoon): verder dan
// dit, of een snelle veeg, sluit; minder veert terug.
const CLOSE_DISTANCE_PX = 110;
const CLOSE_VELOCITY = 0.6; // px per ms
const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function sinceLabel(iso: string, t: TFunction): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days < 1) return t("friendPicker.playedToday");
  if (days === 1) return t("friendPicker.playedYesterday");
  return t("friendPicker.playedDaysAgo", { n: days });
}

/**
 * Het ene vriendenpaneel voor alle spellen: zoeken, en eerst wie nu online is,
 * dan met wie je onlangs speelde, dan de rest op naam — zodat je ook met een
 * lange vriendenlijst meteen de goede vindt. Als paneel van onder (telefoon)
 * of als venster (groter scherm), boven de pagina.
 *
 * - `onPick`: één vriend kiezen (woordspel, uitdaging); het paneel sluit na
 *   een geslaagde keuze. Geef een foutmelding terug om hem te tonen.
 * - `onInvite` met `stateFor`: meerdere vrienden uitnodigen (lobby's,
 *   seizoen); per vriend "Nodig uit", "Uitgenodigd ✓" of "Doet mee".
 */
export default function FriendPicker({
  open,
  onClose,
  title,
  subtitle,
  onPick,
  onInvite,
  stateFor,
  inviteLabel,
  joinedLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  onPick?: (friend: PickerFriend) => Promise<string | null | void>;
  onInvite?: (friend: PickerFriend) => void;
  stateFor?: (friendId: string) => FriendState;
  inviteLabel?: string;
  joinedLabel?: string;
}) {
  const t = useT();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const [friends, setFriends] = useState<PickerFriend[] | null>(null);
  const [status, setStatus] = useState<Record<string, FriendStatus>>({});
  const [lastPlayed, setLastPlayed] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  // Via een ref: een nieuwe onClose bij elke render van de ouder mag het
  // laden hieronder niet steeds opnieuw laten beginnen.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    fetch("/api/friends")
      .then((r) => r.json())
      .then((d: { friends?: { user: PickerFriend }[]; statusByUserId?: Record<string, FriendStatus> }) => {
        setFriends((d.friends ?? []).map((entry) => entry.user));
        setStatus(d.statusByUserId ?? {});
        // Activiteit ("Leest Alma 32") kent alleen de socketserver.
        getSocket().emit("friend_statuses_request");
      })
      .catch(() => setFriends([]));
    fetch("/api/friends/recent")
      .then((r) => r.json())
      .then((d: { lastPlayed?: Record<string, string> }) => setLastPlayed(d.lastPlayed ?? {}))
      .catch(() => {});

    const socket = getSocket();
    const onStatus = (payload: { userId: string; hidden: boolean } & Partial<FriendStatus>) => {
      setStatus((current) => {
        const next = { ...current };
        if (payload.hidden) delete next[payload.userId];
        else next[payload.userId] = { online: !!payload.online, activity: payload.activity };
        return next;
      });
    };
    socket.on("friend_status_update", onStatus);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    // Ook <html>: alleen <body> vastzetten houdt de pagina op iOS niet stil.
    const previous = { body: document.body.style.overflow, html: document.documentElement.style.overflow };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      socket.off("friend_status_update", onStatus);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous.body;
      document.documentElement.style.overflow = previous.html;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setDragY(0);
      setClosing(false);
    }
  }, [open]);

  // Omlaag vegen om te sluiten. Met native listeners (niet passief), zodat
  // preventDefault de pagina eronder echt stil houdt. Vanuit de lijst alleen
  // als die al helemaal bovenaan staat: anders is het gewoon scrollen.
  useEffect(() => {
    const sheet = sheetRef.current;
    const backdrop = backdropRef.current;
    if (!open || !mounted || !sheet || !backdrop) return;
    let start: { y: number; t: number; fromList: boolean } | null = null;
    let dragging = false;
    let distance = 0;

    const onStart = (e: TouchEvent) => {
      const list = listRef.current;
      start = { y: e.touches[0].clientY, t: Date.now(), fromList: !!list && list.contains(e.target as Node) };
      dragging = false;
      distance = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      // Buiten de lijst (greep, titel, zoekveld) valt er niets te scrollen:
      // nooit de pagina eronder laten bewegen.
      if (!start.fromList) e.preventDefault();
      const dy = e.touches[0].clientY - start.y;
      if (!dragging) {
        const listAtTop = (listRef.current?.scrollTop ?? 0) <= 0;
        if (dy > 6 && (!start.fromList || listAtTop)) dragging = true;
        else return;
      }
      e.preventDefault();
      distance = Math.max(0, dy);
      setDragY(distance);
    };
    const onEnd = () => {
      if (!start) return;
      const velocity = distance / Math.max(1, Date.now() - start.t);
      if (dragging && (distance > CLOSE_DISTANCE_PX || velocity > CLOSE_VELOCITY)) {
        setClosing(true);
        setTimeout(() => onCloseRef.current(), 200);
      } else {
        setDragY(0);
      }
      start = null;
      dragging = false;
    };
    // Vegen op de donkere achtergrond mag de pagina eronder niet laten scrollen.
    const onBackdropMove = (e: TouchEvent) => {
      if (e.target === backdrop) e.preventDefault();
    };

    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onEnd);
    backdrop.addEventListener("touchmove", onBackdropMove, { passive: false });
    return () => {
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onEnd);
      backdrop.removeEventListener("touchmove", onBackdropMove);
    };
  }, [open, mounted]);

  const sections = useMemo(() => {
    if (!friends) return [];
    const byName = (a: PickerFriend, b: PickerFriend) => a.handle.localeCompare(b.handle, intlLocale, { sensitivity: "base" });
    const recentAt = (f: PickerFriend) => (lastPlayed[f.id] ? new Date(lastPlayed[f.id]).getTime() : 0);
    const needle = query.trim().toLowerCase().replace(/^@/, "");
    if (needle) {
      // Zoeken: één lijst, maar nog steeds online en recent voorop.
      const hits = friends.filter((f) => `${f.handle}#${f.discriminator}`.toLowerCase().includes(needle));
      hits.sort(
        (a, b) =>
          Number(!!status[b.id]?.online) - Number(!!status[a.id]?.online) || recentAt(b) - recentAt(a) || byName(a, b)
      );
      // Geen treffers = geen sectie, zodat "Geen vriend gevonden" verschijnt.
      return hits.length > 0 ? [{ label: null as string | null, list: hits }] : [];
    }
    const online = friends.filter((f) => status[f.id]?.online).sort((a, b) => recentAt(b) - recentAt(a) || byName(a, b));
    const recent = friends
      .filter((f) => !status[f.id]?.online && recentAt(f) > Date.now() - RECENT_WINDOW_MS)
      .sort((a, b) => recentAt(b) - recentAt(a))
      .slice(0, RECENT_LIMIT);
    const shown = new Set([...online, ...recent].map((f) => f.id));
    const rest = friends.filter((f) => !shown.has(f.id)).sort(byName);
    return [
      { label: t("friendPicker.onlineNow"), list: online },
      { label: t("friendPicker.recent"), list: recent },
      { label: online.length + recent.length > 0 ? t("friendPicker.all") : null, list: rest },
    ].filter((s) => s.list.length > 0);
  }, [friends, status, lastPlayed, query, t, intlLocale]);

  async function pick(friend: PickerFriend) {
    if (!onPick || busyId) return;
    setBusyId(friend.id);
    setError(null);
    const result = await onPick(friend);
    setBusyId(null);
    if (typeof result === "string" && result) setError(result);
    else onClose();
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-sheet-down overscroll-none"
      style={{ opacity: closing ? 0 : 1, transition: "opacity 0.2s ease-out" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        className="flex w-full max-h-[85vh] sm:max-w-md flex-col rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 shadow-2xl"
        style={{
          paddingBottom: "var(--vs-safe-area-bottom)",
          transform: closing ? "translateY(100%)" : `translateY(${dragY}px)`,
          transition: dragY > 0 && !closing ? "none" : "transform 0.2s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Greep: laat zien dat je het paneel omlaag kunt vegen om te sluiten. */}
        <div className="flex justify-center pt-2 pb-1 sm:hidden" aria-hidden>
          <div className="h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold dark:text-slate-100">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        <div className="px-5 pt-3">
          <input
            className="input"
            type="search"
            placeholder={t("friendPicker.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("friendPicker.search")}
          />
          {error && <p className="mt-2 text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-2" style={{ touchAction: "pan-y" }}>
          {friends === null ? (
            <p className="px-2 py-6 text-center text-sm text-slate-400">{t("common.loading")}</p>
          ) : friends.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              <p>{t("friendPicker.noFriends")}</p>
              <Link href="/friends" className="font-bold text-brand-600 dark:text-brand-300 hover:underline" onClick={onClose}>
                {t("friendPicker.addFriends")}
              </Link>
            </div>
          ) : sections.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {t("friendPicker.noMatch", { query: query.trim() })}
            </p>
          ) : (
            sections.map((section, index) => (
              <div key={section.label ?? index} className="mt-2">
                {section.label && (
                  <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {section.label}
                  </p>
                )}
                <ul className="flex flex-col">
                  {section.list.map((friend) => {
                    const s = status[friend.id];
                    const state = stateFor?.(friend.id) ?? "invite";
                    const detail = s?.activity
                      ? `${s.activity.icon} ${translateServerText(s.activity.label, t)}`
                      : s?.online
                        ? t("friendPicker.online")
                        : lastPlayed[friend.id]
                          ? sinceLabel(lastPlayed[friend.id], t)
                          : null;
                    const rowContent = (
                      <>
                        <UserAvatar
                          id={friend.id}
                          handle={friend.handle}
                          avatarEmoji={friend.avatarEmoji}
                          className={s?.online ? "ring-2 ring-green-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-900" : ""}
                        />
                        <span className="min-w-0 flex-1 text-left">
                          <UserTag
                            handle={friend.handle}
                            discriminator={friend.discriminator}
                            className="block truncate font-bold dark:text-slate-100"
                          />
                          {detail && (
                            <span className={`block truncate text-xs ${s?.online ? "text-green-600 dark:text-green-400" : "text-slate-400"}`}>
                              {detail}
                            </span>
                          )}
                        </span>
                      </>
                    );
                    return (
                      <li key={friend.id}>
                        {onPick ? (
                          <button
                            type="button"
                            className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 hover:bg-brand-50 dark:hover:bg-slate-800 disabled:opacity-50"
                            disabled={busyId !== null}
                            onClick={() => pick(friend)}
                          >
                            {rowContent}
                            <span className="shrink-0 text-sm font-bold text-brand-600 dark:text-brand-300">
                              {busyId === friend.id ? t("courses.busy") : t("friendPicker.pick")}
                            </span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-3 rounded-2xl px-2 py-2">
                            {rowContent}
                            {state === "joined" ? (
                              <span className="shrink-0 rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700 dark:bg-slate-800 dark:text-green-400">
                                {joinedLabel ?? t("friendPicker.joined")}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="btn-secondary shrink-0 !px-3 !py-1.5 !text-xs"
                                disabled={state === "invited"}
                                onClick={() => onInvite?.(friend)}
                              >
                                {state === "invited" ? t("friendPicker.invited") : (inviteLabel ?? t("friendPicker.invite"))}
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
