"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import FocusLayout from "@/components/versado/FocusLayout";
import { Puzzle, type MatchContext } from "@/components/JigsawV2Client";
import { useT } from "@/components/I18nProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import { useSetBackTarget } from "@/lib/backTarget";
import type { MatchView } from "@/lib/puzzle/match";

type PuzzleState = Parameters<typeof Puzzle>[0]["initial"];

const post = <T,>(body: object) => fetchJson<T>("/api/puzzle/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const formatTime = (ms: number | null) => { if (ms === null) return "–"; const total = Math.floor(ms / 1000); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`; };

// Wedstrijdscherm: lobby, eigen poging en uitslag. De server bepaalt klok, fase en
// wat zichtbaar mag zijn; dit scherm toont alleen wat getMatch teruggeeft.
export default function MatchClient({ initial, meId }: { initial: MatchView; meId: string }) {
  const t = useT(); const router = useRouter();
  const query = useLiveQuery<MatchView>(["puzzle", "match", initial.id], () => post<{ match: MatchView }>({ action: "state", matchId: initial.id }).then((r) => r.match), { scopes: ["games"], staleTime: 3000, initialData: initial });
  const match = query.data ?? initial;
  const received = useRef(Date.now()); const [offset, setOffset] = useState(match.serverNow - Date.now());
  useEffect(() => { setOffset(match.serverNow - Date.now()); received.current = Date.now(); }, [match.serverNow]);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => { const handle = window.setInterval(() => setNow(Date.now() + offset), 250); return () => window.clearInterval(handle); }, [offset]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const goBack = useCallback(() => router.push("/jigsaw"), [router]);
  useSetBackTarget("/jigsaw", "/jigsaw", "", goBack);

  const act = async (body: object) => {
    setBusy(true); setError("");
    try { await jsonMutation("/api/puzzle/match", { json: body }, { invalidates: "gamesChanged" }); await query.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : t("jigsaw.failed")); }
    finally { setBusy(false); }
  };

  const me = match.participants.find((p) => p.userId === meId);
  const startsAt = match.startsAt ? Date.parse(match.startsAt) : null;
  const countdown = startsAt !== null && startsAt > now ? Math.ceil((startsAt - now) / 1000) : 0;
  const playing = match.me.status === "PLAYING" && match.status === "RUNNING" && countdown === 0;
  const startedAt = match.me.startedAt ? Date.parse(match.me.startedAt) : null;

  // Wanneer de aftelling afloopt of de status verandert, haalt de live-datalaag de actuele stand op.
  const wasCounting = useRef(false);
  useEffect(() => { if (countdown > 0) wasCounting.current = true; else if (wasCounting.current) { wasCounting.current = false; void query.refetch(); } }, [countdown, query]);

  // Eigen puzzel ophalen zodra die gespeeld mag worden.
  useEffect(() => {
    if (!playing || puzzle) return;
    let cancelled = false;
    void post<PuzzleState>({ action: "resume", matchId: match.id }).then((state) => { if (!cancelled) setPuzzle(state); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : t("jigsaw.failed")); });
    return () => { cancelled = true; };
  }, [playing, puzzle, match.id, t]);

  if (playing && puzzle && startedAt !== null) {
    const context: MatchContext = { id: match.id, startedAt, serverOffsetMs: offset, onAnswered: () => { setPuzzle(null); void query.refetch(); } };
    return <Puzzle key={puzzle.id} initial={puzzle} setOuter={() => {}} onChooseAnother={goBack} onReplay={goBack} match={context} />;
  }

  const names = (list: typeof match.participants) => list.map((p) => p.handle).join(", ");
  const finished = match.me.visibleResults;
  const ranked = [...match.participants].filter((p) => p.result).sort((a, b) => (a.result!.rank ?? 99) - (b.result!.rank ?? 99));
  const isOrganizer = match.organizerId === meId;
  const accepted = match.participants.filter((p) => p.status !== "INVITED" && p.status !== "DECLINED");
  const waiting = match.participants.filter((p) => p.status === "INVITED");
  const button = "btn-primary min-h-12 w-full max-w-[440px] self-center";

  return (
    <FocusLayout className="page-fill mx-auto max-w-2xl justify-center gap-5 py-4">
      <header className="flex items-center gap-4">
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-vs-surface"><NextImage src={match.image} alt="" fill unoptimized className="object-cover" /></div>
        <div><h1 className="text-2xl font-extrabold text-vs-fg">{t("puzzleTogether.match.title")}</h1><p className="text-vs-fg-2">{match.pieceCount} · {t(match.kind === "LIVE" ? "puzzleTogether.setup.live" : "puzzleTogether.setup.async")}</p></div>
      </header>
      {match.status === "CANCELLED" && <p className="card">{t("puzzleTogether.match.cancelled")}</p>}

      {match.me.status === "INVITED" && match.status !== "CANCELLED" && (
        <section className="card space-y-3">
          <p>{t("puzzleTogether.overview.withNames", { names: names(match.participants) })}</p>
          <p className="text-sm text-vs-fg-2">{t("puzzleTogether.match.joinBy", { time: new Date(match.joinDeadline).toLocaleString() })}</p>
          <div className="flex gap-2">
            <button type="button" className="btn-primary min-h-12 flex-1" disabled={busy} onClick={() => void act({ action: "respond", matchId: match.id, accept: true })}>{t("puzzleTogether.match.accept")}</button>
            <button type="button" className="btn-secondary min-h-12 flex-1" disabled={busy} onClick={() => void act({ action: "respond", matchId: match.id, accept: false }).then(goBack)}>{t("puzzleTogether.match.decline")}</button>
          </div>
        </section>
      )}

      {match.status === "LOBBY" && match.me.status !== "INVITED" && (
        <section className="card space-y-3">
          <h2 className="font-bold">{t("puzzleTogether.match.lobby")}</h2>
          <p className="text-sm text-vs-fg-2">{t("puzzleTogether.match.lobbyHelp")}</p>
          <ul className="space-y-1">{match.participants.map((p) => <li key={p.userId} className="flex justify-between"><span>{p.handle}{p.userId === meId ? ` (${t("puzzleTogether.match.you")})` : ""}{p.userId === match.organizerId ? ` · ${t("puzzleTogether.match.organizer")}` : ""}</span><span className="text-vs-fg-2">{t(`puzzleTogether.match.status.${p.status}` as "puzzleTogether.match.status.INVITED")}</span></li>)}</ul>
          {waiting.length > 0 && <p className="text-sm text-vs-fg-2">{t("puzzleTogether.match.waitingFor", { names: names(waiting) })}</p>}
          {isOrganizer ? (
            <div className="flex flex-col gap-2">
              <button type="button" className={button} disabled={busy || accepted.length < 2} onClick={() => void act({ action: "start", matchId: match.id })}>{t("puzzleTogether.match.start")}</button>
              {accepted.length < 2 && <p className="text-sm text-vs-fg-2">{t("puzzleTogether.match.needTwo")}</p>}
              <button type="button" className="btn-secondary min-h-12 w-full max-w-[440px] self-center" disabled={busy} onClick={() => void act({ action: "cancel", matchId: match.id }).then(goBack)}>{t("puzzleTogether.match.cancel")}</button>
            </div>
          ) : <p className="text-vs-fg-2">{t("puzzleTogether.match.acceptedWait")}</p>}
        </section>
      )}

      {match.status === "RUNNING" && countdown > 0 && (
        <section className="card text-center" aria-live="polite"><p className="text-5xl font-extrabold tabular-nums">{countdown}</p><p>{t("puzzleTogether.match.countdown", { n: countdown })}</p></section>
      )}

      {match.status === "RUNNING" && match.kind === "ASYNC" && match.me.canBegin && (
        <section className="card space-y-3">
          <p>{t("puzzleTogether.match.beginHelp")}</p>
          <p className="text-sm text-vs-fg-2">{t("puzzleTogether.match.closes", { time: new Date(match.playDeadline).toLocaleString() })}</p>
          <button type="button" className={button} disabled={busy} onClick={() => void act({ action: "begin", matchId: match.id })}>{t("puzzleTogether.match.beginConfirm")}</button>
        </section>
      )}

      {match.status === "RUNNING" && match.me.status === "PLAYING" && countdown === 0 && !puzzle && !error && <p className="text-vs-fg-2" aria-live="polite">…</p>}

      {match.status === "RUNNING" && match.kind === "LIVE" && match.me.status === "ACCEPTED" && countdown === 0 && <p className="card">{t("puzzleTogether.match.expiredStart")}</p>}

      {(match.status === "RUNNING" || match.status === "LOBBY") && !finished && match.participants.some((p) => p.progress !== null) && (
        <section className="card space-y-1">
          {match.participants.filter((p) => p.progress !== null).map((p) => <div key={p.userId} className="flex justify-between text-sm"><span>{p.handle}</span><span>{t("puzzleTogether.match.progress", { n: p.progress ?? 0, total: match.pieceCount })}</span></div>)}
        </section>
      )}

      {match.status === "RUNNING" && match.me.status !== "INVITED" && match.me.status !== "PLAYING" && !finished && (
        <p className="text-sm text-vs-fg-2">{t("puzzleTogether.match.doneCount", { n: match.participants.filter((p) => p.done).length, total: accepted.length })}</p>
      )}

      {finished && match.me.status !== "INVITED" && (
        <section className="card space-y-3">
          <h2 className="text-xl font-bold">{match.me.status === "FINISHED" ? t("puzzleTogether.match.rightTitle") : match.me.status === "INVALID" ? t("puzzleTogether.match.wrongTitle") : t("puzzleTogether.match.result")}</h2>
          {match.me.status === "INVALID" && <p>{t("puzzleTogether.match.invalidText")}</p>}
          {match.me.status === "DNF" && <p>{t("puzzleTogether.match.dnfText")}</p>}
          {match.status !== "FINISHED" && <p className="text-sm text-vs-fg-2">{t("puzzleTogether.match.doneCount", { n: match.participants.filter((p) => p.done).length, total: accepted.length })}</p>}
          <ol className="space-y-1">
            {ranked.map((p) => (
              <li key={p.userId} className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{p.result?.valid && p.result.rank ? `${p.result.rank}. ` : ""}{p.handle}{p.userId === meId ? ` (${t("puzzleTogether.match.you")})` : ""}{match.winnerId === p.userId ? ` · ${t("puzzleTogether.match.winner")}` : ""}</span>
                <span>{p.result?.valid ? formatTime(p.result.elapsedMs) : t(`puzzleTogether.match.status.${p.status}` as "puzzleTogether.match.status.INVALID")}{p.result && p.result.extraHintsUsed > 0 ? ` · ${t("puzzleTogether.match.hintsExtra", { n: p.result.extraHintsUsed })}` : ""}</span>
              </li>
            ))}
          </ol>
          {match.status === "FINISHED" && <p className="text-xs text-vs-fg-2">{t("puzzleTogether.match.tie")}</p>}
        </section>
      )}

      {!finished && match.me.status !== "INVITED" && match.status !== "LOBBY" && match.me.status !== "PLAYING" && match.me.status === "ACCEPTED" && match.kind === "ASYNC" && !match.me.canBegin && <p className="card">{t("puzzleTogether.match.expiredStart")}</p>}

      {error && <p role="alert" className="text-red-600">{error}</p>}
      <button type="button" className="btn-secondary min-h-12 w-full max-w-[440px] self-center" onClick={goBack}>{t("puzzleTogether.match.back")}</button>
    </FocusLayout>
  );
}
