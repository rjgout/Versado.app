"use client";

import { useEffect, useState } from "react";
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
  reactions: Reaction[];
  myReaction: string | null;
  canReact: boolean;
}

export default function ActivityFeedClient() {
  const t = useT();
  const uiLanguage = useUiLanguage();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [openReactions, setOpenReactions] = useState<string | null>(null);
  const [expandedReactions, setExpandedReactions] = useState<Record<string, { reactions: Reaction[]; nextCursor: string | null; loading: boolean }>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/activity-feed", { cache: "no-store" });
    if (!response.ok) {
      setError(t("activityFeed.loadFailed"));
      return;
    }
    setItems((await response.json()).items);
  }

  useEffect(() => {
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  async function react(item: FeedItem, emoji: string) {
    if (!item.canReact) return;
    setOpenReactions(null);
    const response = await fetch(`/api/activity-feed/${encodeURIComponent(item.id)}/reaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (!response.ok) return;
    setExpandedReactions((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    await load();
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

  if (!items) return <p className="text-slate-400 dark:text-slate-500">{error ?? t("common.loading")}</p>;

  const locale = getLanguage(uiLanguage).intlLocale;
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
          <div className="aspect-square w-[clamp(6rem,28vw,7.5rem)] shrink-0 sm:w-32">
            <PersonalMascot state="idle" size={128} fill />
          </div>
          <p>{t("activityFeed.empty")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => {
            const fullReactions = expandedReactions[item.id];
            const displayedReactions = fullReactions?.reactions ?? item.reactions;
            return (
              <article id={`activity-${item.id}`} key={item.id} className="card !bg-vs-subtle dark:!bg-vs-surface flex flex-col gap-2 !p-3 sm:!p-4 sm:gap-2.5 scroll-mt-20">
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

                {fullReactions && <p className="text-xs font-bold text-vs-fg-2">{t("activityFeed.allReactions")}</p>}
                <div className="flex min-h-9 flex-wrap items-center gap-1.5" aria-label={t("activityFeed.reactions")}>
                  {displayedReactions.map((reaction) => {
                    const label = `${reaction.handle}#${reaction.discriminator}`;
                    const content = (
                      <>
                        <UserAvatar id={reaction.id} handle={reaction.handle} avatarEmoji={reaction.avatarEmoji} size="xs" className="!h-6 !w-6" />
                        <span className="max-w-[10rem] truncate">{label}</span>
                        <span aria-hidden>{reaction.emoji}</span>
                      </>
                    );
                    return item.canReact ? (
                      <button
                        key={`${reaction.id}-${reaction.createdAt}`}
                        type="button"
                        onClick={() => react(item, reaction.emoji)}
                        className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-xs dark:border-slate-600"
                        aria-label={t("activityFeed.reactWith", { emoji: reaction.emoji })}
                      >
                        {content}
                      </button>
                    ) : (
                      <span key={`${reaction.id}-${reaction.createdAt}`} className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-xs dark:border-slate-600">
                        {content}
                      </span>
                    );
                  })}
                  {displayedReactions.length === 0 && <span className="text-xs text-vs-fg-3">{t("activityFeed.noReactions")}</span>}
                  {!fullReactions && item.reactionCount > item.reactions.length && (
                    <button type="button" className="min-h-9 rounded-full px-2 text-xs font-bold text-vs-accent hover:bg-vs-accent-soft" onClick={() => loadAllReactions(item.id)}>
                      {t(item.reactionCount - item.reactions.length === 1 ? "activityFeed.viewOtherReaction" : "activityFeed.viewOtherReactions", { count: item.reactionCount - item.reactions.length })}
                    </button>
                  )}
                  {fullReactions?.nextCursor && (
                    <button type="button" className="min-h-9 rounded-full px-2 text-xs font-bold text-vs-accent hover:bg-vs-accent-soft" disabled={fullReactions.loading} onClick={() => loadAllReactions(item.id, fullReactions.nextCursor)}>
                      {fullReactions.loading ? t("common.loading") : t("activityFeed.loadMoreReactions")}
                    </button>
                  )}
                  {item.canReact && (
                    <div className="relative ml-auto">
                      <button
                        type="button"
                        className="btn-secondary !min-h-9 !border !border-vs-line !bg-transparent !px-2.5 !py-1 text-xs !shadow-none text-vs-accent hover:!bg-vs-accent-soft dark:!border-vs-line dark:!bg-transparent dark:text-vs-accent dark:hover:!bg-vs-accent-soft"
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
    </div>
  );
}
