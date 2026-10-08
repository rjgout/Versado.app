"use client";

import { type MouseEvent } from "react";
import Link from "next/link";
import { ArrowRight, Gamepad2 } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { useT } from "@/components/I18nProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { ApiRequestError, fetchJson } from "@/lib/data/fetchJson";

interface ActivityItem {
  kind: "challenge" | "scrabble" | "live" | "chapter-guess-solo";
  id: string;
  opponentName: string | null;
  opponentId: string | null;
  label: string;
  link: string;
  myTurn: boolean | null;
  contentCollectionId?: string;
  code?: string;
}

interface ActivityStatus {
  liveInvitesReceived: ActivityItem[];
  invitesReceived: ActivityItem[];
  invitesSent: ActivityItem[];
  activeGames: ActivityItem[];
  activeContentCollectionId: string;
}

// Blok "Actieve spellen" bovenaan /live ("Spelen"): openstaande
// uitnodigingen en lopende spellen (Uitdagingen, Woordspel, Live spel), zodat
// je die ziet zonder eerst naar de spelpagina's zelf te gaan. Toont bewust
// ook een lege staat en een foutmelding: voorheen verdween het blok stil bij
// een mislukte fetch, waardoor "geen spellen" en "kon niet laden" (zoals in
// de geïnstalleerde webapp) niet van elkaar te onderscheiden waren.
// Intrekken gebeurt vanuit /acties via liveMutation({ invalidates: "gamesChanged" });
// De compacte kaart houdt daardoor hooguit drie rijen zonder functionaliteit
// te dupliceren.
export default function ActiveGamesBanner() {
  const t = useT();

  // Lopende spellen en uitnodigingen veranderen buiten deze pagina om (de ander accepteert, een
  // beurt, een ingetrokken uitnodiging). De server meldt dat via de bestaande socket-gebeurtenissen
  // (game_invite, game_cancelled, game_left, game_invite_revoked, scrabble_updated), die de
  // live-data-laag naar `gamesChanged` vertaalt; verder ververst de laag bij openen, terugnavigeren en
  // focus. Korte staleTime: andere spelpagina's starten spellen zonder deze dataset te kennen.
  const query = useLiveQuery<ActivityStatus>(["games", "activity"], () => fetchJson<ActivityStatus>("/api/activity-status"), {
    scopes: ["games"],
    contentScoped: true,
    staleTime: 1_000,
  });
  const status = query.data ?? null;
  // Alleen een foutmelding als er nog niets te tonen is; een mislukte stille controle laat de laatste stand staan.
  const error = !status && query.error
    ? query.error instanceof ApiRequestError && query.error.message.startsWith("HTTP ")
      ? t("activeGames.errorStatus", { status: query.error.status })
      : query.error instanceof Error
        ? query.error.message
        : t("activeGames.unknownError")
    : null;
  const reload = () => void query.refetch();

  async function openGame(item: ActivityItem, event: MouseEvent<HTMLAnchorElement>) {
    if (!item.contentCollectionId || item.contentCollectionId === status?.activeContentCollectionId) return;

    event.preventDefault();
    const response = await fetch("/api/content-context", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentCollectionId: item.contentCollectionId }),
    });
    if (!response.ok) return;

    // Een volledige navigatie is hier bewust: de contentswitcher bepaalt via
    // serverdata ook welke cursussen, spellen en andere menu's zichtbaar zijn.
    // router.refresh() alleen kan bestaande client-state laten staan.
    window.location.assign(item.link);
  }

  const heading = <h2 className="text-sm font-extrabold text-vs-fg">{t("activeGames.title")}</h2>;

  function statusLabel(item: ActivityItem, invitation = false) {
    if (invitation) return t("activeGames.invitedLabel");
    if (item.myTurn === true) return t("activeGames.turnLabel");
    if (item.myTurn === false && item.opponentName) return t("activeGames.waitingLabel", { name: item.opponentName });
    return null;
  }

  function ActivityRow({ item, invitation = false }: { item: ActivityItem; invitation?: boolean }) {
    const statusLabelText = statusLabel(item, invitation);
    return (
      <Link
        href={item.link}
        onClick={(event) => openGame(item, event)}
        className={`flex min-h-14 items-center gap-3 rounded-2xl px-2.5 py-2 transition active:scale-[0.99] motion-reduce:transition-none ${
          item.myTurn === true
            ? "bg-brand-50 text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100 dark:bg-slate-800 dark:text-brand-200 dark:ring-brand-700 dark:hover:bg-slate-700"
            : "hover:bg-slate-50 dark:hover:bg-slate-800/70"
        }`}
      >
        {item.opponentId ? <UserAvatar id={item.opponentId} handle={item.opponentName ?? ""} size="sm" /> : <Gamepad2 className="h-8 w-8 shrink-0 rounded-full bg-slate-100 p-1.5 text-slate-500 dark:bg-slate-700 dark:text-slate-300" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">
            {item.opponentName ?? item.label}
          </span>
          {(item.opponentName ? item.label : statusLabelText) && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{item.opponentName ? item.label : statusLabelText}</span>}
          {item.opponentName && statusLabelText && <span className={`block truncate text-xs font-bold ${item.myTurn ? "text-brand-600 dark:text-brand-300" : "text-slate-500 dark:text-slate-400"}`}>{statusLabelText}</span>}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
      </Link>
    );
  }

  if (!status) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-vs-line bg-vs-surface px-4 py-3 shadow-sm">
        {heading}
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            {t("activeGames.loadFailed", { error })}{" "}
            <button className="font-bold underline" onClick={reload}>
              {t("activeGames.retry")}
            </button>
          </p>
        ) : (
          <p className="text-sm text-slate-400 dark:text-slate-500">{t("common.loading")}</p>
        )}
      </div>
    );
  }
  const { invitesReceived, invitesSent, activeGames } = status;
  const liveInvitesReceived = status.liveInvitesReceived ?? [];
  if (
    liveInvitesReceived.length === 0 &&
    invitesReceived.length === 0 &&
    invitesSent.length === 0 &&
    activeGames.length === 0
  ) {
    return (
      <div className="flex flex-col gap-1 rounded-2xl border border-vs-line bg-vs-surface px-4 py-3 shadow-sm">
        {heading}
        <p className="text-sm text-vs-fg-2">{t("activeGames.empty")}</p>
      </div>
    );
  }

  const actionItems = [
    ...liveInvitesReceived.map((item) => ({ item, invitation: true })),
    ...invitesReceived.map((item) => ({ item, invitation: true })),
    ...activeGames.filter((item) => item.myTurn === true).map((item) => ({ item, invitation: false })),
  ];
  const otherCount = invitesSent.length + activeGames.filter((item) => item.myTurn !== true).length;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-vs-line bg-vs-surface px-4 py-3 shadow-sm">
      {heading}
      {actionItems.length > 0 ? (
        <>
          <p className="text-sm font-bold text-vs-fg-2">{t("activeGames.attentionCount", { n: actionItems.length })}</p>
          <div className="flex flex-col gap-1">{actionItems.slice(0, 3).map(({ item, invitation }) => <ActivityRow key={`${item.kind}-${item.id}`} item={item} invitation={invitation} />)}</div>
          <Link href="/acties" className="inline-flex items-center gap-1 self-start text-sm font-extrabold text-vs-accent">{t("activeGames.viewAllActions", { n: actionItems.length })}<ArrowRight className="h-4 w-4" /></Link>
        </>
      ) : <p className="text-sm font-bold text-vs-fg">{t("activeGames.allCaughtUp")}</p>}
      {otherCount > 0 && <><p className="text-sm text-vs-fg-2">{t("activeGames.otherActive", { n: otherCount })}</p><Link href="/acties?tab=continue" className="inline-flex items-center gap-1 self-start text-sm font-extrabold text-vs-accent">{t("activeGames.viewAllActive")}<ArrowRight className="h-4 w-4" /></Link></>}
    </div>
  );
}
