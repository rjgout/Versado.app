"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowRight, Gamepad2, X } from "lucide-react";
import { getSocket } from "@/lib/socketClient";
import UserAvatar from "@/components/UserAvatar";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { ApiRequestError, fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";

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
export default function ActiveGamesBanner() {
  const t = useT();
  const confirm = useConfirm();
  // Voorkomt dubbel annuleren terwijl het verzoek nog loopt.
  const [cancelling, setCancelling] = useState<string | null>(null);

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

  async function cancelInvite(item: ActivityItem) {
    if (item.kind === "live") {
      if (!(await confirm(t("activeGames.confirmEnd")))) return;
      // De banner ververst zichzelf pas via het "game_cancelled"-event
      // hierboven, zodra de server het spel écht heeft verwijderd.
      getSocket().emit("cancel_game", { code: item.code });
      return;
    }
    if (!(await confirm(t("activeGames.confirmCancel", { name: item.opponentName ?? "" })))) return;
    setCancelling(item.id);
    const url = item.kind === "scrabble" ? `/api/scrabble/${item.id}/cancel` : `/api/challenges/${item.id}/cancel`;
    try {
      await liveMutation(() => fetchJson(url, { method: "POST" }), { invalidates: "gamesChanged" });
    } catch (error) {
      // Meestal: de ander heeft net geaccepteerd. Toon dan de actuele stand.
      const message = error instanceof ApiRequestError && !error.message.startsWith("HTTP ") ? error.message : null;
      window.alert(message ?? t("activeGames.cancelFailed"));
      void query.refetch();
    }
    setCancelling(null);
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

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-vs-line bg-vs-surface px-4 py-3 shadow-sm">
      {heading}
      {liveInvitesReceived.length > 0 && (
        <div className="flex flex-col gap-1">
          {liveInvitesReceived.map((item) => (
            <Link
              key={`live-invite-${item.id}`}
              href={item.link}
              onClick={(event) => openGame(item, event)}
              className="animate-invite-glow flex min-h-14 items-center gap-3 rounded-2xl border border-brand-300 bg-gradient-to-r from-brand-50 to-gold-50 px-2.5 py-2 transition active:scale-[0.99] dark:from-slate-800 dark:to-slate-800 dark:border-brand-600"
            >
              {item.opponentId ? (
                <UserAvatar id={item.opponentId} handle={item.opponentName ?? ""} />
              ) : (
                <Gamepad2 className="h-8 w-8 shrink-0 rounded-full bg-white/60 p-1.5 text-brand-700 dark:bg-slate-700 dark:text-brand-300" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-extrabold text-brand-800 dark:text-brand-200 leading-snug">{item.opponentName ?? item.label}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400 leading-snug">{t("activeGames.invitedLabel")} · {item.label}</span>
              </span>
              <span className="btn-primary !px-3 !py-1.5 !text-xs shrink-0">{t("activeGames.join")}</span>
            </Link>
          ))}
        </div>
      )}

      {invitesReceived.length > 0 && (
        <div className="flex flex-col gap-1">
          {invitesReceived.map((item) => (
            <ActivityRow key={`${item.kind}-${item.id}`} item={item} invitation />
          ))}
        </div>
      )}

      {activeGames.length > 0 && (
        <div className="flex flex-col gap-1">
          {[...activeGames].sort((a, b) => Number(b.myTurn === true) - Number(a.myTurn === true)).map((item) => (
            <ActivityRow key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </div>
      )}

      {invitesSent.length > 0 && (
        <div className="flex flex-col gap-1">
          {invitesSent.map((item) => (
            // Een verstuurde uitnodiging blijft anders eindeloos wachten; daarom
            // naast de knop naar het spel altijd een knop om in te trekken.
            <div key={`sent-${item.kind}-${item.id}-${item.opponentId}`} className="flex min-h-14 items-center gap-2 rounded-2xl px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/70">
              <Link
                href={item.link}
                onClick={(event) => openGame(item, event)}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                {item.opponentId ? (
                  <UserAvatar id={item.opponentId} handle={item.opponentName ?? ""} size="sm" />
                ) : (
                  <Gamepad2 className="h-8 w-8 shrink-0 rounded-full bg-slate-100 p-1.5 text-slate-500 dark:bg-slate-700 dark:text-slate-300" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">{item.opponentName ?? item.label}</span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{t("activeGames.waitingLabel", { name: item.opponentName ?? "" })} · {item.label}</span>
                </span>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
              </Link>
              <button
                onClick={() => cancelInvite(item)}
                disabled={cancelling === item.id}
                aria-label={
                  item.kind === "live"
                    ? t("activeGames.endAria", { name: item.opponentName ?? "" })
                    : t("activeGames.cancelAria", { name: item.opponentName ?? "" })
                }
                title={item.kind === "live" ? t("activeGames.end") : t("activeGames.cancel")}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-red-500 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
