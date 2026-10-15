"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import FinishedPuzzleRow from "@/components/puzzle/FinishedPuzzleRow";
import type { HistoryItem } from "@/lib/puzzle/history";
import { HISTORY_ROUTE } from "@/lib/puzzle/navigation";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";

interface Overview {
  meId: string;
  invites: { id: string; sessionId: string; from: string; pieceCount: number }[];
  sent: { id: string; sessionId: string; to: string; toId: string }[];
  sessions: { id: string; status: string; pieceCount: number; players: string[]; max: number }[];
  finished: HistoryItem[];
  hasHistory: boolean;
  matches: { id: string; kind: "LIVE" | "ASYNC"; status: string; me: string; questionOpen?: boolean; organizer: string; organizerId: string; pieceCount: number; players: string[] }[];
}

// Uitnodigingen, lopende gezamenlijke puzzels en wedstrijden op één plek. Alles
// komt uit de live-datalaag (scope "games"), dus ook een uitnodiging van
// iemand anders verschijnt zonder verversen.
export default function PuzzleTogetherOverview() {
  const t = useT(); const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const query = useLiveQuery<Overview>(["puzzle", "overview"], () => fetchJson<Overview>("/api/puzzle/overview"), { scopes: ["games"], staleTime: 5000 });
  const data = query.data;
  if (!data) return null;
  // Eén indeling voor alle weergaven: uitnodiging → actief (verder) → wachten (klaar, anderen nog bezig) → afgerond.
  const matchInvites = data.matches.filter((m) => m.me === "INVITED");
  const matchRest = data.matches.filter((m) => m.me !== "INVITED");
  const activeSessions = data.sessions.filter((session) => session.status === "ACTIVE");
  const activeMatches = matchRest.filter((m) => m.status !== "FINISHED" && m.status !== "CANCELLED" && (m.me === "ACCEPTED" || m.me === "PLAYING"));
  const waitingMatches = matchRest.filter((m) => m.status !== "FINISHED" && m.status !== "CANCELLED" && (m.me === "FINISHED" || m.me === "INVALID" || m.me === "DNF"));
  if (!data.invites.length && !matchInvites.length && !activeSessions.length && !activeMatches.length && !waitingMatches.length && !data.finished.length && !data.hasHistory) return null;

  const post = async (url: string, json: unknown) => {
    setError(null);
    try { await jsonMutation(url, { json }, { invalidates: "gamesChanged" }); } catch (e) { setError(e instanceof Error ? e.message : t("apiErrors.invalidInput")); throw e; }
  };
  const row = "flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800";
  const btn = "inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold";

  return (
    <section className="mx-auto mt-8 w-full max-w-2xl space-y-4" aria-label={t("puzzleTogether.overview.title")} data-kompas-target="puzzle-together">
      <h2 className="text-lg font-bold">{t("puzzleTogether.overview.title")}</h2>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {(data.invites.length > 0 || matchInvites.length > 0) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-500">{t("puzzleTogether.overview.invites")}</h3>
          {data.invites.map((invite) => (
            <div key={invite.id} className={row}>
              <span className="text-sm">{t("puzzleTogether.overview.coopInvite", { name: invite.from })}</span>
              <span className="flex gap-2">
                <button type="button" className={`${btn} bg-emerald-600 text-white`} onClick={() => void post("/api/puzzle/coop", { action: "respond", inviteId: invite.id, accept: true }).then(() => { router.push(`/jigsaw/samen/${invite.sessionId}`); }).catch(() => {})}>{t("puzzleTogether.overview.accept")}</button>
                <button type="button" className={`${btn} border border-slate-300`} onClick={() => void post("/api/puzzle/coop", { action: "respond", inviteId: invite.id, accept: false }).catch(() => {})}>{t("puzzleTogether.overview.decline")}</button>
              </span>
            </div>
          ))}
          {matchInvites.map((match) => (
            <div key={match.id} className={row}>
              <span className="text-sm">{t(match.kind === "LIVE" ? "puzzleTogether.overview.matchInviteLive" : "puzzleTogether.overview.matchInvite", { name: match.organizer })}</span>
              <span className="flex gap-2">
                <button type="button" className={`${btn} bg-emerald-600 text-white`} onClick={() => void post("/api/puzzle/match", { action: "respond", matchId: match.id, accept: true }).then(() => { router.push(`/jigsaw/wedstrijd/${match.id}`); }).catch(() => {})}>{t("puzzleTogether.overview.accept")}</button>
                <button type="button" className={`${btn} border border-slate-300`} onClick={() => void post("/api/puzzle/match", { action: "respond", matchId: match.id, accept: false }).catch(() => {})}>{t("puzzleTogether.overview.decline")}</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {(activeSessions.length > 0 || activeMatches.length > 0) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-500">{t("puzzleTogether.overview.sessions")}</h3>
          {activeSessions.map((session) => (
            <div key={session.id} className={row}>
              <span className="text-sm">{t("puzzleTogether.overview.coopLabel")} · {session.pieceCount} · {t("puzzleTogether.overview.withNames", { names: session.players.join(", ") })}</span>
              <Link className={`${btn} bg-sky-600 text-white`} href={`/jigsaw/samen/${session.id}`}>{t("puzzleTogether.overview.continue")}</Link>
            </div>
          ))}
          {activeMatches.map((match) => (
            <div key={match.id} className={row}>
              <span className="text-sm">{t("puzzleTogether.overview.matchLabel")} · {match.pieceCount} · {t("puzzleTogether.overview.withNames", { names: match.players.join(", ") })}</span>
              <Link className={`${btn} bg-sky-600 text-white`} href={`/jigsaw/wedstrijd/${match.id}`}>
                {match.status === "LOBBY" ? t("puzzleTogether.overview.liveLobby") : match.me === "ACCEPTED" && match.kind === "ASYNC" ? t("puzzleTogether.overview.begin") : t("puzzleTogether.overview.continue")}
              </Link>
            </div>
          ))}
        </div>
      )}
      {waitingMatches.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-500">{t("puzzleTogether.overview.waiting")}</h3>
          {waitingMatches.map((match) => (
            <div key={match.id} className={row}>
              <span className="text-sm">{t("puzzleTogether.overview.matchLabel")} · {match.pieceCount} · {t("puzzleTogether.overview.withNames", { names: match.players.join(", ") })}</span>
              <Link className={`${btn} border border-slate-300`} href={`/jigsaw/wedstrijd/${match.id}`}>{match.questionOpen ? t("puzzleTogether.overview.answerQuestion") : t("puzzleTogether.overview.viewResult")}</Link>
            </div>
          ))}
        </div>
      )}
      {(data.finished.length > 0 || data.hasHistory) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-500">{t("puzzleTogether.overview.finishedTitle")}</h3>
          {/* Maximaal de drie laatst afgeronde (Samen en Tegen elkaar samen); de rest staat in de geschiedenis. */}
          {data.finished.length > 0 && <ul className="space-y-2">{data.finished.map((item) => <FinishedPuzzleRow key={item.key} item={item} />)}</ul>}
          {data.hasHistory && <Link className={`${btn} border border-slate-300`} href={HISTORY_ROUTE}>{t("puzzleTogether.overview.viewAllFinished")}</Link>}
        </div>
      )}
    </section>
  );
}
