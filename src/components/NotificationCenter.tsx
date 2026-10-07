"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { invalidateData } from "@/lib/data/client";
import { notificationGroup } from "@/lib/notificationGroups";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { getLanguage } from "@/lib/languages";
import type { TFunction } from "@/lib/i18n/core";
import {
  IN_APP_NOTIFICATION_EVENT,
  type InAppNotification as NotificationItem,
} from "@/lib/notificationEvents";

// Vangnet voor een gemist realtime-bericht; het eigenlijke ververs-ritme (focus, terugkeer,
// socket, verborgen tab) beheert de live-data-laag.
const POLL_MS = 60_000;
interface NotificationsView {
  notifications: NotificationItem[];
  count: number;
}

const DISMISS_DISTANCE_PX = 90;
const TAP_TOLERANCE_PX = 6;

function timeLabel(iso: string, now: number, t: TFunction, intlLocale: string): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return t("notifications.timeNow");
  if (minutes < 60) return t("notifications.timeMinutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("notifications.timeHours", { n: hours });
  if (hours < 48) return t("notifications.timeYesterday");
  return new Date(iso).toLocaleDateString(intlLocale, { day: "numeric", month: "short" });
}

// Het getal op het app-icoon is het aantal meldingen hier (zie notifyUser).
function syncAppBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (count > 0) nav.setAppBadge?.(count).catch(() => {});
  else nav.clearAppBadge?.().catch(() => {});
}

/**
 * Het meldingencentrum: een bel in de header met het aantal meldingen, en
 * een overlay (geen aparte pagina) met de meldingen per groep, zoals het
 * meldingencentrum van een telefoon. Een groep met meerdere meldingen staat
 * ingeklapt als stapel; tikken klapt hem uit. Tikken op een melding opent
 * hem en haalt hem weg; opzij vegen of ✕ wist hem zonder iets te doen.
 *
 * Nieuwe meldingen komen live binnen via de socket (DATA_EVENTS.notificationsChanged
 * in de live-data-laag). Bij openen, terugkeren naar de app en met een rustig
 * vangnet synchroniseren we ook, zodat een tijdelijk gemist realtime-event
 * vanzelf wordt hersteld.
 */
export default function NotificationCenter() {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  const seenNotificationIds = useRef<Set<string> | null>(null);

  const query = useLiveQuery<NotificationsView>(["notifications"], () => fetchJson<NotificationsView>("/api/notifications"), {
    scopes: ["notifications"],
    staleTime: 30_000,
    pollMs: POLL_MS,
  });
  const { data, setData, refetch } = query;
  // De tijdlabels rekenen vanaf het moment van de laatste synchronisatie.
  const now = query.updatedAt ?? 0;
  const items = useMemo(() => data?.notifications ?? [], [data]);
  const count = data?.count ?? 0;

  // Een nieuw binnengekomen melding krijgt de live presentatie; wat er al was bij het
  // openen van de app niet, en het app-icoon volgt het aantal.
  useEffect(() => {
    if (!data) return;
    if (seenNotificationIds.current === null) {
      // Bestaande meldingen bij het openen van de app zijn geen nieuwe
      // banners; alleen wat daarna binnenkomt krijgt de live presentatie.
      seenNotificationIds.current = new Set(data.notifications.map((item) => item.id));
    } else {
      const seen = seenNotificationIds.current;
      const newestUnseen = data.notifications.find((item) => !seen.has(item.id));
      for (const item of data.notifications) seen.add(item.id);
      if (newestUnseen) {
        window.dispatchEvent(new CustomEvent(IN_APP_NOTIFICATION_EVENT, { detail: newestUnseen }));
      }
    }
    syncAppBadge(data.count);
  }, [data]);

  useEffect(() => {
    setMounted(true);
    // Een push die binnenkomt terwijl de app open is (zie public/sw.js).
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "jehova:notifications-changed") invalidateData("notificationsChanged");
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    // Elders in de app afgehandeld (bv. de uitnodiging bovenin geopend).
    const onLocalChange = () => invalidateData("notificationsChanged");
    window.addEventListener("jehova:notifications-changed", onLocalChange);
    return () => {
      window.removeEventListener("jehova:notifications-changed", onLocalChange);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    void refetch();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, refetch]);

  async function remove(body: { ids: string[] } | { kind: string } | { all: true }) {
    // Meteen uit beeld; de server bevestigt het aantal.
    const next =
      "all" in body
        ? []
        : "kind" in body
          ? items.filter((n) => n.kind !== body.kind)
          : items.filter((n) => !body.ids.includes(n.id));
    setData({ notifications: next, count: next.length });
    syncAppBadge(next.length);
    try {
      const result = await fetchJson<{ count: number }>("/api/notifications", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setData({ notifications: next, count: result.count });
      syncAppBadge(result.count);
    } catch {
      void refetch();
    }
  }

  function openItem(item: NotificationItem) {
    remove({ ids: [item.id] });
    setOpen(false);
    router.push(item.url);
  }

  const groups = useMemo(() => {
    const byKind = new Map<string, NotificationItem[]>();
    for (const item of items) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
    // Groep met de nieuwste melding bovenaan; binnen een groep nieuwste eerst.
    return [...byKind.entries()]
      .map(([kind, list]) => ({ kind, list }))
      .sort((a, b) => new Date(b.list[0].createdAt).getTime() - new Date(a.list[0].createdAt).getTime());
  }, [items]);

  function toggleGroup(kind: string, value: boolean) {
    setExpanded((current) => {
      const next = new Set(current);
      if (value) next.add(kind);
      else next.delete(kind);
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-vs-fg-2 transition-colors hover:bg-vs-subtle hover:text-vs-fg"
        aria-label={count > 0 ? t("notifications.titleWithCount", { count }) : t("notifications.title")}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[1.15rem] h-[1.15rem] rounded-full bg-red-500 px-1 text-[10px] font-extrabold leading-[1.15rem] text-white text-center ring-2 ring-white dark:ring-slate-900">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] bg-slate-900/60 dark:bg-slate-950/70 backdrop-blur-2xl animate-sheet-down"
            role="dialog"
            aria-modal="true"
            aria-label={t("notifications.title")}
            onClick={() => setOpen(false)}
          >
            <div
              className="mx-auto flex h-full max-w-md flex-col px-3"
              style={{ paddingTop: "calc(var(--vs-safe-area-top) + 1rem)" }}
            >
              <div className="flex items-center justify-between gap-3 px-1 pb-3" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-3xl font-extrabold text-white drop-shadow">{t("notifications.title")}</h2>
                <div className="flex items-center gap-2">
                  {items.length > 0 && (
                    <button
                      type="button"
                      className="rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/30"
                      onClick={() => remove({ all: true })}
                    >
                      {t("notifications.clearAll")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
                    onClick={() => setOpen(false)}
                    aria-label={t("common.close")}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div
                className="flex-1 overflow-y-auto overscroll-contain pb-[calc(2rem+var(--vs-safe-area-bottom))] flex flex-col gap-3"
              >
                {groups.length === 0 ? (
                  <div className="mt-20 flex flex-col items-center gap-2 text-center text-white/80" onClick={(e) => e.stopPropagation()}>
                    <span className="text-4xl" aria-hidden>
                      🔔
                    </span>
                    <p className="font-bold">{t("notifications.empty")}</p>
                    <p className="text-sm text-white/60">{t("notifications.emptyHint")}</p>
                  </div>
                ) : (
                  groups.map(({ kind, list }) => {
                    const group = { ...notificationGroup(kind), label: t(notificationGroup(kind).labelKey) };
                    const isExpanded = expanded.has(kind) || list.length === 1;
                    return (
                      <section key={kind} className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                        {list.length > 1 && isExpanded && (
                          <div className="flex items-center justify-between px-1">
                            <h3 className="text-sm font-extrabold text-white drop-shadow">{group.label}</h3>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white hover:bg-white/30"
                                onClick={() => toggleGroup(kind, false)}
                              >
                                {t("notifications.showLess")}
                              </button>
                              <button
                                type="button"
                                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-xs text-white hover:bg-white/30"
                                onClick={() => remove({ kind })}
                                aria-label={t("notifications.clearGroupAria", { group: group.label })}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        )}
                        {isExpanded ? (
                          list.map((item) => (
                            <NotificationCard
                              key={item.id}
                              item={item}
                              icon={group.icon}
                              now={now}
                              onOpen={() => openItem(item)}
                              onDismiss={() => remove({ ids: [item.id] })}
                            />
                          ))
                        ) : (
                          // Ingeklapt: de nieuwste melding met de rest als stapel eronder.
                          <div className="relative">
                            <NotificationCard
                              item={list[0]}
                              icon={group.icon}
                              now={now}
                              more={list.length - 1}
                              onOpen={() => toggleGroup(kind, true)}
                              onDismiss={() => remove({ kind })}
                            />
                            <div className="mx-3 -mt-3 h-4 rounded-b-[1.25rem] bg-white/60 dark:bg-slate-800/60 shadow" aria-hidden />
                            {list.length > 2 && (
                              <div className="mx-6 -mt-3 h-4 rounded-b-[1.25rem] bg-white/40 dark:bg-slate-800/40 shadow" aria-hidden />
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * Eén melding. Tikken = `onOpen`; naar links vegen (of ✕) = `onDismiss`.
 * touch-action: pan-y, zodat verticaal scrollen door de lijst gewoon werkt.
 */
function NotificationCard({
  item,
  icon,
  now,
  more = 0,
  onOpen,
  onDismiss,
}: {
  item: NotificationItem;
  icon: string;
  now: number;
  more?: number;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const uiLanguage = useUiLanguage();
  const [offsetX, setOffsetX] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const drag = useRef<{ startX: number; startY: number; moved: number } | null>(null);

  function dismiss() {
    setLeaving(true);
    setTimeout(onDismiss, 200);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="group relative select-none cursor-pointer rounded-[1.25rem] bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl shadow-lg ring-1 ring-black/5 dark:ring-white/10 px-3.5 py-3"
      style={{
        touchAction: "pan-y",
        transform: leaving ? "translateX(-110%)" : `translateX(${offsetX}px)`,
        opacity: leaving ? 0 : 1,
        transition: drag.current ? "none" : "transform 0.2s ease-out, opacity 0.2s ease-out",
      }}
      onPointerDown={(e) => {
        drag.current = { startX: e.clientX, startY: e.clientY, moved: 0 };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.startX;
        const dy = e.clientY - drag.current.startY;
        drag.current.moved = Math.max(drag.current.moved, Math.abs(dx), Math.abs(dy));
        // Alleen naar links, en alleen als het echt een horizontale veeg is.
        if (Math.abs(dx) > Math.abs(dy)) setOffsetX(Math.min(0, dx));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.startX;
        const moved = drag.current.moved;
        drag.current = null;
        if (dx < -DISMISS_DISTANCE_PX) dismiss();
        else if (moved <= TAP_TOLERANCE_PX) onOpen();
        setOffsetX(0);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setOffsetX(0);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
        if (e.key === "Delete" || e.key === "Backspace") dismiss();
      }}
    >
      <div className="flex items-start gap-3">
        {/* Lichte tegel: een blauwe emoji (👥) viel weg op een blauwe tegel. */}
        <div className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-xl shadow-sm" aria-hidden>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100 truncate">{item.title}</p>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">{timeLabel(item.createdAt, now, t, getLanguage(uiLanguage).intlLocale)}</span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug">{item.body}</p>
          {more > 0 && (
            <p className="mt-1 text-xs font-bold text-slate-400 dark:text-slate-500">
              +{more} {more === 1 ? "melding" : "meldingen"}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        className="absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600 shadow opacity-0 transition group-hover:opacity-100 focus:opacity-100 dark:bg-slate-600 dark:text-slate-100"
        onClick={(e) => {
          e.stopPropagation();
          dismiss();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        aria-label={more > 0 ? t("notifications.clearGroup") : t("notifications.clearOne")}
      >
        ✕
      </button>
    </div>
  );
}
