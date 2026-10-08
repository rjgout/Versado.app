"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, Gamepad2, UsersRound, X } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { useConfirm } from "@/components/ConfirmProvider";
import { useT } from "@/components/I18nProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";
import { getSocket } from "@/lib/socketClient";
import type { OpenAction, OpenActionTab } from "@/lib/openActions";
import { primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";

interface Response {
  tab: OpenActionTab;
  counts: Record<OpenActionTab, number>;
  activeContentCollectionId: string;
  items: OpenAction[];
  nextOffset: number | null;
}

const validTabs = new Set<OpenActionTab>(["required", "continue", "waiting"]);

function actionText(action: OpenAction, t: ReturnType<typeof useT>) {
  if (action.kind === "friend-request") return { title: t("actionCenter.friendRequest", { name: action.person?.handle ?? "" }), detail: "" };
  if (action.kind === "group-invite") return { title: t("actionCenter.groupInvite", { name: action.subject }), detail: action.person?.handle ?? "" };
  if (action.kind === "group-request") return { title: t("actionCenter.groupRequest", { name: action.person?.handle ?? "" }), detail: "" };
  if (action.kind === "live-invite") return { title: t("actionCenter.liveInvite", { name: action.person?.handle ?? "" }), detail: action.subject };
  if (action.kind === "game-invite") return { title: t("actionCenter.gameInvite", { name: action.person?.handle ?? "" }), detail: action.subject };
  if (action.kind === "game-turn") return { title: t("activeGames.turnLabel"), detail: action.person?.handle ? `${action.person.handle} · ${action.subject}` : action.subject };
  if (action.kind === "game-waiting") return { title: t("actionCenter.waiting"), detail: action.person?.handle ? `${action.person.handle} · ${action.subject}` : action.subject };
  return { title: t("actionCenter.continue"), detail: action.subject };
}

export default function ActionsClient() {
  const t = useT();
  const confirm = useConfirm();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const paramTab = params.get("tab");
  const tab: OpenActionTab = validTabs.has(paramTab as OpenActionTab) ? (paramTab as OpenActionTab) : "required";
  const query = useLiveQuery<Response>(["open-actions", tab], () => fetchJson<Response>(`/api/open-actions?tab=${tab}`), {
    scopes: ["games", "friends", "groups"], contentScoped: true, staleTime: 1_000,
  });
  const [more, setMore] = useState<OpenAction[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { setMore([]); setNextOffset(query.data?.nextOffset ?? null); }, [tab, query.updatedAt, query.data?.nextOffset]);
  const data = query.data;
  const items = [...(data?.items ?? []), ...more];

  function switchTab(next: OpenActionTab) {
    const nextParams = new URLSearchParams(params.toString());
    if (next === "required") nextParams.delete("tab"); else nextParams.set("tab", next);
    router.replace(`${pathname}${nextParams.size ? `?${nextParams}` : ""}`, { scroll: false });
  }

  async function openGame(action: OpenAction, event: MouseEvent<HTMLAnchorElement>) {
    if (!action.contentCollectionId || action.contentCollectionId === data?.activeContentCollectionId) return;
    event.preventDefault();
    const response = await fetch("/api/content-context", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentCollectionId: action.contentCollectionId }) });
    if (response.ok) window.location.assign(action.href);
  }

  async function respond(action: OpenAction, accept: boolean) {
    if (!action.actionId) return;
    if (action.kind === "friend-request") {
      await liveMutation(() => fetchJson(`/api/friends/${action.actionId}/${accept ? "accept" : "decline"}`, { method: "POST" }), { invalidates: "friendsChanged" });
    } else if (action.kind === "group-invite") {
      await liveMutation(() => fetchJson(`/api/group-invites/${action.actionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept }) }), { invalidates: "groupsChanged" });
    }
  }

  async function cancel(action: OpenAction) {
    if (!action.actionId || !(await confirm(action.game === "live" ? t("activeGames.confirmEnd") : t("activeGames.confirmCancel", { name: action.person?.handle ?? "" })))) return;
    if (action.game === "live") {
      getSocket().emit("cancel_game", { code: action.gameCode });
      return;
    }
    const url = action.game === "scrabble" ? `/api/scrabble/${action.actionId}/cancel` : `/api/challenges/${action.actionId}/cancel`;
    await liveMutation(() => fetchJson(url, { method: "POST" }), { invalidates: "gamesChanged" });
  }

  async function loadMore() {
    if (!data || nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchJson<Response>(`/api/open-actions?tab=${tab}&offset=${nextOffset}`);
      setMore((previous) => [...previous, ...next.items]);
      setNextOffset(next.nextOffset);
      // De teller blijft uit de serverbron komen; een volgende invalidering haalt opnieuw de eerste pagina op.
    } finally { setLoadingMore(false); }
  }

  return (
    <div className="vs-motion mx-auto flex max-w-5xl flex-col gap-5 sm:gap-6">
      <header><h1 className="text-2xl font-extrabold tracking-tight text-vs-fg">{t("actionCenter.title")}</h1></header>
      <div className="flex rounded-2xl bg-vs-subtle p-1" role="tablist" aria-label={t("actionCenter.title")}>
        {(["required", "continue", "waiting"] as const).map((candidate) => (
          <button key={candidate} type="button" role="tab" aria-selected={tab === candidate} onClick={() => switchTab(candidate)} className={`min-h-10 min-w-0 flex-1 rounded-xl px-2 text-xs font-extrabold sm:text-sm ${tab === candidate ? "bg-vs-elevated text-vs-fg shadow-sm" : "text-vs-fg-3"}`}>
            {t(`actionCenter.tabs.${candidate}`)} <span className="tabular-nums">({data?.counts[candidate] ?? 0})</span>
          </button>
        ))}
      </div>
      {!data ? <p className="text-sm text-vs-fg-3">{t("common.loading")}</p> : items.length === 0 ? (
        <div className={`${surfaceCard} flex flex-col gap-1 p-5 text-center`}><p className="font-extrabold text-vs-fg">{tab === "required" ? t("actionCenter.allCaughtUp") : t("actionCenter.empty")}</p>{tab === "required" && <p className="text-sm text-vs-fg-2">{t("actionCenter.allCaughtUpHint")}</p>}</div>
      ) : (
        <ul className={`${surfaceCard} divide-y divide-vs-line overflow-hidden`}>
          {items.map((action) => {
            const text = actionText(action, t);
            return <li key={action.key} className="flex min-w-0 items-center gap-3 px-4 py-3">
              {action.person ? <UserAvatar id={action.person.id} handle={action.person.handle} size="md" /> : action.kind.startsWith("group") ? <UsersRound className="h-10 w-10 shrink-0 rounded-full bg-vs-accent-soft p-2 text-vs-accent" /> : <Gamepad2 className="h-10 w-10 shrink-0 rounded-full bg-vs-accent-soft p-2 text-vs-accent" />}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold text-vs-fg">{text.title}</p>{text.detail && <p className="truncate text-sm text-vs-fg-2">{text.detail}</p>}</div>
              {action.kind === "friend-request" || action.kind === "group-invite" ? <div className="flex shrink-0 gap-1"><button className={primaryButton} onClick={() => respond(action, true)} aria-label={t("challenges.accept")}><Check className="h-4 w-4" /></button><button className={secondaryButton} onClick={() => respond(action, false)} aria-label={t("challenges.decline")}><X className="h-4 w-4" /></button></div> : <div className="flex shrink-0 gap-1"><Link href={action.href} onClick={(event) => openGame(action, event)} className={primaryButton}>{action.kind === "game-turn" || action.kind === "game-continue" ? t("today.cta.continue") : t("today.cta.view")}<ArrowRight className="h-4 w-4" /></Link>{action.kind === "game-waiting" && <button className={secondaryButton} onClick={() => cancel(action)} aria-label={t("activeGames.cancel")}><X className="h-4 w-4" /></button>}</div>}
            </li>;
          })}
        </ul>
      )}
      {nextOffset !== null && <button type="button" className={`${secondaryButton} self-center`} disabled={loadingMore} onClick={loadMore}>{loadingMore ? t("common.loading") : t("actionCenter.loadMore")}</button>}
    </div>
  );
}
