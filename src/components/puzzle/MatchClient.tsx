"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import FocusLayout from "@/components/versado/FocusLayout";
import { Puzzle, type MatchContext } from "@/components/JigsawV2Client";
import { useT } from "@/components/I18nProvider";
import { useServerNow } from "@/components/puzzle/serverClock";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import RecordNotice from "@/components/puzzle/RecordNotice";
import PuzzleBackTarget from "@/components/puzzle/PuzzleBackTarget";
import { JIGSAW_ROUTE } from "@/lib/puzzle/navigation";
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
  const { now, offset } = useServerNow(match.serverNow);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  // Terug = het puzzeloverzicht, altijd met replace: geen extra geschiedenisitem, geen annulering of reset.
  const goBack = useCallback(() => router.replace(JIGSAW_ROUTE), [router]);
  const [answerFeedback, setAnswerFeedback] = useState<{ correct: boolean; counted: boolean } | null>(null);
  const [flow, setFlow] = useState(0);
  const [initialStage, setInitialStage] = useState<"COMPLETE" | "QUESTION" | undefined>(undefined);

  const act = async (body: object) => {
    setBusy(true); setError("");
    try { await jsonMutation("/api/puzzle/match", { json: body }, { invalidates: "gamesChanged" }); await query.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : t("jigsaw.failed")); }
    finally { setBusy(false); }
  };

  const startsAt = match.startsAt ? Date.parse(match.startsAt) : null;
  const countdown = startsAt !== null && startsAt > now ? Math.ceil((startsAt - now) / 1000) : 0;
  const playing = match.me.status === "PLAYING" && match.status === "RUNNING" && countdown === 0;
  const startedAt = match.me.startedAt ? Date.parse(match.me.startedAt) : null;

  // Wanneer de aftelling afloopt of de status verandert, haalt de live-datalaag de actuele stand op.
  const wasCounting = useRef(false);
  useEffect(() => { if (countdown > 0) wasCounting.current = true; else if (wasCounting.current) { wasCounting.current = false; void query.refetch(); } }, [countdown, query]);

  // De poging blijft op het scherm zolang de speler speelt of nog in de voltooiings-/vraagstap zit. Een
  // realtime statusupdate die de deelnemer op FINISHED zet, haalt de voltooide afbeelding of vraag dus niet weg.
  const questionPending = match.resultRules >= 2 && match.me.status === "FINISHED" && !match.me.question.answered;
  const stageKey = `versado:match-stage:${match.id}`;
  const readStage = (): "COMPLETE" | "QUESTION" | null => { try { const value = window.sessionStorage.getItem(stageKey); return value === "COMPLETE" || value === "QUESTION" ? value : null; } catch { return null; } };
  const writeStage = (stage: "COMPLETE" | "QUESTION" | null) => { try { if (stage) window.sessionStorage.setItem(stageKey, stage); else window.sessionStorage.removeItem(stageKey); } catch { /* opslag mag uit staan */ } };

  // Eigen puzzel ophalen: tijdens het spelen, en bij een voltooide puzzel met open vraag zodra de speler daar
  // al in zat (refresh/reconnect) of er zelf om vraagt.
  useEffect(() => {
    if (puzzle) return;
    const stage = questionPending ? readStage() : null;
    if (!playing && !stage) return;
    let cancelled = false;
    void post<PuzzleState>({ action: "resume", matchId: match.id }).then((state) => { if (!cancelled) { setInitialStage(stage ?? undefined); setPuzzle(state); } }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : t("jigsaw.failed")); });
    return () => { cancelled = true; };
    // readStage leest alleen de sleutel van deze wedstrijd.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, questionPending, puzzle, match.id, flow, t]);

  if (puzzle && (playing || questionPending) && startedAt !== null) {
    const context: MatchContext = {
      id: match.id, startedAt, serverOffsetMs: offset, initialStage,
      onStage: writeStage,
      onAnswered: (result) => { writeStage(null); setAnswerFeedback({ correct: result.correct, counted: result.counted }); setPuzzle(null); void query.refetch(); },
      onLater: () => { writeStage(null); setPuzzle(null); },
    };
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
      <PuzzleBackTarget onBack={goBack} />
      <header className="flex flex-wrap items-center gap-4">
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-vs-surface"><NextImage src={match.image} alt="" fill unoptimized className="object-cover" /></div>
        <div className="min-w-0 flex-1 basis-40"><h1 className="break-words text-2xl font-extrabold text-vs-fg">{t("puzzleTogether.match.title")}</h1><p className="text-vs-fg-2">{match.pieceCount} · {t(match.kind === "LIVE" ? "puzzleTogether.setup.live" : "puzzleTogether.setup.async")}</p></div>
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
          <h2 className="text-xl font-bold">{match.me.status === "FINISHED" ? t(match.resultRules >= 2 ? "puzzleTogether.match.puzzleDone" : "puzzleTogether.match.rightTitle") : match.me.status === "INVALID" ? t("puzzleTogether.match.wrongTitle") : t("puzzleTogether.match.result")}</h2>
          {match.resultRules >= 2 && match.me.status === "FINISHED" && (
            <>
              <p data-official-time><span className="text-sm text-vs-fg-2">{t("puzzleTogether.match.officialTime")}</span> <span className="font-mono text-xl font-extrabold tabular-nums">{formatTime(match.participants.find((p) => p.userId === meId)?.result?.elapsedMs ?? null)}</span></p>
              {match.me.record && <RecordNotice mode="MATCH" variantId={match.variantId} hintCategory={match.me.record.hintCategory} elapsedMs={match.me.record.elapsedMs} />}
              {/* De vraag staat los van tijd en uitslag; hier de status en eventueel de weg ernaartoe. */}
              {questionPending ? (
                <div className="space-y-2">
                  <p className="text-sm text-vs-fg-2">{t("puzzleTogether.match.questionIndependent")}</p>
                  <button type="button" className="btn-primary min-h-12 w-full max-w-[440px]" onClick={() => { writeStage("COMPLETE"); setFlow((value) => value + 1); }}>{t("puzzleTogether.match.questionOpen")}</button>
                </div>
              ) : (
                <p className="text-sm text-vs-fg-2" data-question-status>{match.me.question.correct === false ? t("puzzleTogether.match.questionWrong") : match.me.question.correct === true ? `${t("puzzleTogether.match.questionRight")} ${answerFeedback?.counted ? t("puzzleTogether.match.questionStreak") : ""}` : t("puzzleTogether.match.questionDone")}</p>
              )}
            </>
          )}
          {match.me.status === "INVALID" && <p>{t("puzzleTogether.match.invalidText")}</p>}
          {match.me.status === "DNF" && <p>{t("puzzleTogether.match.dnfText")}</p>}
          {match.status !== "FINISHED" && <p className="text-sm text-vs-fg-2">{t("puzzleTogether.overview.waiting")} · {t("puzzleTogether.match.doneCount", { n: match.participants.filter((p) => p.done).length, total: accepted.length })}</p>}
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
