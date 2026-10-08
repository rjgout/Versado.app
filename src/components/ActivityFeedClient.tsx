"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";
import UserAvatar from "@/components/UserAvatar";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { getLanguage } from "@/lib/languages";
import PersonalMascot from "@/components/versado/PersonalMascot";

const REACTIONS = ["🫶🏻", "❤️", "🎉", "🔥", "🙌"] as const;
type Reaction = { id: string; handle: string; discriminator: string; avatarEmoji: string | null; emoji: string; createdAt: string };

interface FeedItem {
  id: string;
  kind: "XP" | "ACHIEVEMENT";
  xpAmount: number;
  achievementIcon: string | null;
  createdAt: string;
  actor: { id: string; handle: string; discriminator: string; avatarEmoji: string | null };
  text: string;
  reactionCount: number;
  uniqueReactionCount: number;
  reactions: Reaction[];
  myReaction: string | null;
  canReact: boolean;
}

export default function ActivityFeedClient() {
  const t = useT();
  const uiLanguage = useUiLanguage();
  const [openReactions, setOpenReactions] = useState<string | null>(null);
  const [reactionDetailsItemId, setReactionDetailsItemId] = useState<string | null>(null);
  const [expandedReactions, setExpandedReactions] = useState<Record<string, { reactions: Reaction[]; nextCursor: string | null; loading: boolean }>>({});

  // Reacties en nieuwe activiteit van vrienden: realtime (friendsChanged) is er niet voor, dus
  // fetch bij openen, bij terugkeer (staleTime) en na eigen reacties; geen polling.
  const feed = useLiveQuery<{ items: FeedItem[] }>(["activity", "feed"], () => fetchJson<{ items: FeedItem[] }>("/api/activity-feed"), {
    scopes: ["activity"],
    staleTime: 30_000,
  });
  const items = feed.data?.items ?? null;
  const error = !items && feed.error ? t("activityFeed.loadFailed") : null;

  useEffect(() => {
    if (!reactionDetailsItemId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReactionDetailsItemId(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [reactionDetailsItemId]);

  async function react(item: FeedItem, emoji: string) {
    if (!item.canReact) return;
    setOpenReactions(null);
    try {
      await liveMutation(
        () =>
          fetchJson(`/api/activity-feed/${encodeURIComponent(item.id)}/reaction`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emoji }),
          }),
        { invalidates: ["activity"] }
      );
    } catch {
      return;
    }
    setExpandedReactions((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  }

  async function loadAllReactions(itemId: string, cursor?: string | null) {
    const current = expandedReactions[itemId];
    setExpandedReactions((state) => ({
      ...state,
      [itemId]: { reactions: cursor ? current?.reactions ?? [] : [], nextCursor: current?.nextCursor ?? null, loading: true },
    }));
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await fetch(`/api/activity-feed/${encodeURIComponent(itemId)}/reactions${suffix}`, { cache: "no-store" });
    if (!response.ok) {
      setExpandedReactions((state) => ({ ...state, [itemId]: { ...(state[itemId] ?? { reactions: [], nextCursor: null }), loading: false } }));
      return;
    }
    const data = (await response.json()) as { reactions: Reaction[]; nextCursor: string | null };
    setExpandedReactions((state) => {
      const previous = state[itemId];
      return {
        ...state,
        [itemId]: {
          reactions: cursor ? [...(previous?.reactions ?? []), ...data.reactions] : data.reactions,
          nextCursor: data.nextCursor,
          loading: false,
        },
      };
    });
  }

  function openReactionDetails(itemId: string) {
    setReactionDetailsItemId(itemId);
    if (!expandedReactions[itemId]) void loadAllReactions(itemId);
  }

  if (!items) return <p className="text-slate-400 dark:text-slate-500">{error ?? t("common.loading")}</p>;

  const locale = getLanguage(uiLanguage).intlLocale;
  const detailsItem = items.find((item) => item.id === reactionDetailsItemId) ?? null;
  const details = detailsItem ? expandedReactions[detailsItem.id] : null;
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4 sm:gap-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300 flex items-center gap-1.5">
          <span className="text-base leading-none" aria-hidden>✨</span> {t("pages.activity")}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t("activityFeed.intro")}</p>
      </div>

      {items.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 text-center text-slate-500 dark:text-slate-400">
          <div className="aspect-square w-[clamp(96px,28vw,7.5rem)] shrink-0 sm:w-32 vs-decor">
            <PersonalMascot state="idle" size={128} fill />
          </div>
          <p>{t("activityFeed.empty")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => {
            const names = item.reactions.slice(0, 3).map((reaction) => `${reaction.handle}#${reaction.discriminator}`);
            // Bij grotere groepen noemen we twee mensen en vat de teller de
            // rest samen; de derde avatar blijft als visuele context staan.
            const otherReactors = Math.max(0, item.uniqueReactionCount - 2);
            let reactionSummary: string | null = null;
            if (item.uniqueReactionCount === 1 && names[0] && item.reactions[0]) {
              reactionSummary = t("activityFeed.reactionSummaryOne", { name: names[0], emoji: item.reactions[0].emoji });
            } else if (item.uniqueReactionCount === 2 && names.length >= 2) {
              reactionSummary = t("activityFeed.reactionSummaryTwo", { first: names[0], second: names[1] });
            } else if (item.uniqueReactionCount === 3 && names.length >= 3) {
              reactionSummary = t("activityFeed.reactionSummaryThree", { first: names[0], second: names[1], third: names[2] });
            } else if (otherReactors === 1 && names.length >= 2) {
              reactionSummary = t("activityFeed.reactionSummaryMoreOne", { first: names[0], second: names[1] });
            } else if (otherReactors > 1 && names.length >= 2) {
              reactionSummary = t("activityFeed.reactionSummaryMore", { first: names[0], second: names[1], others: otherReactors });
            }
            return (
              <article id={`activity-${item.id}`} key={item.id} className="card !bg-vs-subtle dark:!bg-vs-surface flex flex-col gap-1.5 !p-3 sm:!p-4 sm:gap-2 scroll-mt-20">
                <div className="flex items-start gap-3">
                  <UserAvatar id={item.actor.id} handle={item.actor.handle} avatarEmoji={item.actor.avatarEmoji} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm dark:text-slate-100">
                      <span className="font-extrabold">{item.actor.handle}#{item.actor.discriminator}</span>{" "}
                      {item.text}
                    </p>
                    <time className="text-xs text-slate-400 dark:text-slate-500" dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
                    </time>
                  </div>
                  {item.achievementIcon && <span className="text-2xl" aria-hidden>{item.achievementIcon}</span>}
                </div>

                <div className="flex min-w-0 items-center gap-2">
                  {reactionSummary && (
                    <button
                      type="button"
                      className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left text-xs text-vs-fg-2 transition-colors hover:bg-vs-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent"
                      onClick={() => openReactionDetails(item.id)}
                      aria-label={reactionSummary}
                    >
                      <span className="flex shrink-0 -space-x-2" aria-hidden>
                        {item.reactions.slice(0, 3).map((reaction) => (
                          <UserAvatar
                            key={reaction.id}
                            id={reaction.id}
                            handle={reaction.handle}
                            avatarEmoji={reaction.avatarEmoji}
                            size="xs"
                            className="!h-6 !w-6 ring-2 ring-vs-subtle dark:ring-vs-surface"
                          />
                        ))}
                      </span>
                      <span className="min-w-0 truncate">{reactionSummary}</span>
                    </button>
                  )}
                  {item.canReact && (
                    <div className="relative ml-auto shrink-0">
                      <button
                        type="button"
                        className="btn-secondary !min-h-9 !border-0 !bg-transparent !px-2 !py-1 text-xs !shadow-none text-vs-accent hover:!bg-vs-accent-soft dark:!border-0 dark:!bg-transparent dark:text-vs-accent dark:hover:!bg-vs-accent-soft"
                        onClick={() => setOpenReactions(openReactions === item.id ? null : item.id)}
                        aria-expanded={openReactions === item.id}
                      >
                        {item.myReaction ?? "🫶🏻"} {t("activityFeed.react")}
                      </button>
                      {openReactions === item.id && (
                        <div className="absolute right-0 bottom-full mb-2 z-10 flex gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 shadow-lg">
                          {REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="h-9 w-9 rounded-lg text-xl hover:bg-slate-100 dark:hover:bg-slate-700"
                              onClick={() => react(item, emoji)}
                              aria-label={t("activityFeed.reactWith", { emoji })}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {detailsItem && reactionDetailsItemId && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 px-0 backdrop-blur-sm sm:items-center sm:px-4"
          role="presentation"
          onClick={() => setReactionDetailsItemId(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-3xl"
            style={{ paddingBottom: "var(--vs-safe-area-bottom)" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`activity-reactions-title-${detailsItem.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-center pb-1 pt-2 sm:hidden" aria-hidden>
              <div className="h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>
            <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
              <h2 id={`activity-reactions-title-${detailsItem.id}`} className="text-xl font-extrabold text-vs-fg">
                {t("activityFeed.allReactions")}
              </h2>
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-vs-subtle text-vs-fg-2 hover:bg-vs-accent-soft"
                onClick={() => setReactionDetailsItemId(null)}
                aria-label={t("common.close")}
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
              {!details || details.loading ? (
                <p className="py-8 text-center text-sm text-vs-fg-3">{t("common.loading")}</p>
              ) : (
                <div className="flex flex-col divide-y divide-vs-line">
                  {details.reactions.map((reaction) => (
                    <div key={`${reaction.id}-${reaction.createdAt}`} className="flex min-h-14 items-center gap-3 py-2.5">
                      <UserAvatar id={reaction.id} handle={reaction.handle} avatarEmoji={reaction.avatarEmoji} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-vs-fg">{reaction.handle}#{reaction.discriminator}</p>
                        <time className="text-xs text-vs-fg-3" dateTime={reaction.createdAt}>
                          {new Date(reaction.createdAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
                        </time>
                      </div>
                      <span className="text-xl" aria-label={t("activityFeed.reactionBy", { name: `${reaction.handle}#${reaction.discriminator}`, emoji: reaction.emoji })}>{reaction.emoji}</span>
                    </div>
                  ))}
                  {details.nextCursor && (
                    <button
                      type="button"
                      className="mx-auto mt-3 min-h-10 rounded-full px-3 text-sm font-bold text-vs-accent hover:bg-vs-accent-soft"
                      disabled={details.loading}
                      onClick={() => loadAllReactions(detailsItem.id, details.nextCursor)}
                    >
                      {details.loading ? t("common.loading") : t("activityFeed.loadMoreReactions")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
