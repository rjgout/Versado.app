"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Crown, Headphones, LogOut, Play, SkipForward, Square, Trophy, Users } from "lucide-react";
import { getSocket } from "@/lib/socketClient";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { ExerciseCard, ReaderView, type Exercise } from "@/components/LessonFlow";
import LobbyInviteCard from "@/components/LobbyInviteCard";
import LobbyClosedNotice from "@/components/LobbyClosedNotice";
import UserAvatar from "@/components/UserAvatar";
import { announceXpChanged } from "@/lib/xpBroadcast";
import { clockDuration } from "@/lib/timeFormat";
import { primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";
import type { MessageKey } from "@/lib/i18n/core";
import type { StudyUnitContent } from "@/lib/study/units";
import { usePodcastPlayer } from "@/lib/podcastPlayerContext";
import type { PodcastChapter } from "@/lib/podcastChapters";

// Samen studeren (zie src/server/study.ts): de lobby tussen de stappen, het
// aftellen, de vragen in eigen tempo met de voortgang van de anderen, en de
// uitslag per stap plus de totaalstand. De server is de enige bron van
// waarheid: dit scherm toont alleen de staat die hij stuurt, en een antwoord
// telt pas als de server het heeft vastgelegd (met tijdstip).

interface Member {
  userId: string;
  handle: string;
  online: boolean;
}

interface RoundResult {
  userId: string;
  handle: string;
  correct: number;
  total: number;
  finished: boolean;
  timeMs: number | null;
  finishPosition: number | null;
  points: number;
  rank: number;
}

interface Standing {
  userId: string;
  handle: string;
  rounds: number;
  average: number;
  rank: number;
}

interface RoundState {
  id: string;
  number: number;
  label: string;
  phase: "READING" | "QUESTIONS";
  content: StudyUnitContent | null;
  total: number;
  startsInMs: number;
  participating: boolean;
  questions: Exercise[];
  myAnswers: { index: number; correct: boolean }[];
  progress: { userId: string; handle: string; answered: number; finished: boolean; finishPosition: number | null }[];
}

interface StudyState {
  code: string;
  status: "open" | "ended";
  hostId: string;
  courseId: string;
  members: Member[];
  round: RoundState | null;
  lastResults: { number: number; label: string; results: RoundResult[] } | null;
  standings: Standing[];
  roundsPlayed: number;
}

interface UnitGroup {
  label: string;
  units: { key: string; label: string }[];
}

export default function StudyRoom({ code, myUserId, courseName }: { code: string; myUserId: string; courseName: string }) {
  const t = useT();
  const confirm = useConfirm();
  const socket = getSocket();
  const [state, setState] = useState<StudyState | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [startAt, setStartAt] = useState<number | null>(null);
  // Het starttijdstip ligt per stap één keer vast. Opnieuw uitrekenen bij elke
  // update (als een ander antwoordt) liet het aftellen heel even terugkomen en
  // haalde de vraagkaart met een half gekozen antwoord weg.
  const startRoundId = useRef<string | null>(null);
  // De laatst bekende stap. Wie met het laatste antwoord de stap afrondt, ziet
  // anders de controle van dat antwoord niet meer: de uitslag komt dan pas na
  // "Doorgaan".
  const lastRound = useRef<RoundState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [viewIndex, setViewIndex] = useState<{ roundId: string; index: number } | null>(null);
  const [friends, setFriends] = useState<{ id: string; handle: string }[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  useEffect(() => {
    const join = () => socket.emit("st:join", { code });
    function onState(next: StudyState) {
      if (next.code !== code) return;
      if (next.round?.phase === "QUESTIONS") lastRound.current = next.round;
      setState(next);
      setErrorKey(null);
      if (!next.round) {
        startRoundId.current = null;
        setStartAt(null);
      } else if (next.round.phase === "QUESTIONS" && startRoundId.current !== next.round.id) {
        startRoundId.current = next.round.id;
        setStartAt(Date.now() + next.round.startsInMs);
        setNow(Date.now());
      }
      // Bij een nieuwe vraagronde (of na opnieuw verbinden) verder waar je was.
      setViewIndex((prev) => (next.round && prev?.roundId !== next.round.id ? { roundId: next.round.id, index: next.round.myAnswers.length } : prev));
    }
    function onError({ key }: { key: string }) {
      setErrorKey(key);
    }
    function onCancelled({ code: cancelled }: { code: string }) {
      if (cancelled === code) setClosed(true);
    }
    function onAwarded({ code: awardedCode }: { code: string }) {
      if (awardedCode === code) announceXpChanged();
    }
    join();
    socket.on("connect", join);
    socket.on("st:state", onState);
    socket.on("st:error", onError);
    socket.on("st:awarded", onAwarded);
    socket.on("game_cancelled", onCancelled);
    return () => {
      socket.off("connect", join);
      socket.off("st:state", onState);
      socket.off("st:error", onError);
      socket.off("st:awarded", onAwarded);
      socket.off("game_cancelled", onCancelled);
    };
  }, [code, socket]);

  useEffect(() => {
    fetch("/api/friends")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setFriends((d?.friends ?? []).map((entry: { user: { id: string; handle: string } }) => entry.user)))
      .catch(() => {});
  }, []);

  // Aftellen: alleen tikken zolang dat nodig is.
  useEffect(() => {
    if (startAt === null || startAt <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= startAt) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [startAt]);

  const onCheck = useCallback(
    (roundId: string, index: number) => (given: string[]) =>
      new Promise<{ correct: boolean; correctAnswer: string[] | null }>((resolve) => {
        socket.timeout(10_000).emit("st:answer", { roundId, index, given }, (err: Error | null, res?: { ok: boolean; correct?: boolean; correctAnswer?: string[] }) => {
          if (err || !res?.ok) resolve({ correct: false, correctAnswer: null });
          else resolve({ correct: Boolean(res.correct), correctAnswer: res.correctAnswer ?? null });
        });
      }),
    [socket]
  );

  if (closed) return <LobbyClosedNotice />;
  if (errorKey && !state) {
    return (
      <div className={`${surfaceCard} mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center`}>
        <p className="font-bold text-vs-danger">{t(errorKey as MessageKey)}</p>
        <Link href="/courses" className={secondaryButton}>
          {t("study.backToCourse")}
        </Link>
      </div>
    );
  }
  if (!state) return <p className="text-center text-vs-fg-3">{t("lobby.connecting")}</p>;

  const isHost = state.hostId === myUserId;
  const host = state.members.find((m) => m.userId === state.hostId);
  const recent = lastRound.current;
  const lingering =
    !state.round &&
    state.status === "open" &&
    recent !== null &&
    viewIndex?.roundId === recent.id &&
    viewIndex.index < recent.total &&
    recent.myAnswers.some((a) => a.index === viewIndex.index);
  const round = state.round ?? (lingering ? recent : null);
  const countdown = startAt !== null ? Math.max(0, Math.ceil((startAt - now) / 1000)) : 0;

  const header = (
    <header className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-vs-accent">
        <Users className="h-4 w-4" aria-hidden />
        {t("study.title")}
      </p>
      <h1 className="text-2xl font-extrabold text-vs-fg">{courseName}</h1>
    </header>
  );

  // --- Afgelopen ----------------------------------------------------------------
  if (state.status === "ended") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {header}
        <p className="text-sm font-bold text-vs-fg-2">{t("study.ended")}</p>
        <Standings title={t("study.finalStandings")} standings={state.standings} myUserId={myUserId} />
        {state.lastResults && <RoundResults data={state.lastResults} myUserId={myUserId} />}
        <Link href={`/courses/${state.courseId}`} className={`${secondaryButton} self-start`}>
          {t("study.backToCourse")}
        </Link>
      </div>
    );
  }

  // --- Een stap is bezig -----------------------------------------------------------
  if (round) {
    if (round.phase === "READING" && round.content) {
      return <SharedReading round={round} isHost={isHost} hostName={host?.handle ?? ""} code={code} courseName={courseName} />;
    }
    const index = viewIndex?.roundId === round.id ? viewIndex.index : round.myAnswers.length;
    const question = round.questions[index];
    const iAmDone = round.participating && index >= round.total;
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {header}
        <p className="text-sm font-bold text-vs-fg-2">{t("study.roundLabel", { n: round.number, step: round.label })}</p>

        {!round.participating ? (
          <p className={`${surfaceCard} p-4 text-sm text-vs-fg-2`}>{t("study.waitingNextRound")}</p>
        ) : countdown > 0 ? (
          <div className={`${surfaceCard} flex flex-col items-center gap-2 p-8 text-center`} role="status" aria-live="assertive">
            <span className="text-5xl font-extrabold tabular-nums text-vs-accent">{countdown}</span>
            <span className="text-sm font-bold text-vs-fg-2">{t("study.countdown", { n: countdown })}</span>
          </div>
        ) : iAmDone || !question ? (
          <p className={`${surfaceCard} flex items-center gap-2 p-4 font-bold text-vs-fg`} role="status">
            <CheckCircle2 className="h-5 w-5 text-vs-success" aria-hidden />
            {t("study.youAreDone")}
          </p>
        ) : (
          <>
            <p className="text-sm font-bold text-vs-fg-3">{t("study.questionOf", { n: index + 1, total: round.total })}</p>
            <ExerciseCard
              key={`${round.id}-${index}`}
              exercise={question}
              disabled={false}
              showHint={false}
              onCheck={onCheck(round.id, index)}
              onDone={() => setViewIndex({ roundId: round.id, index: index + 1 })}
            />
          </>
        )}

        <Progress round={round} myUserId={myUserId} />

        {isHost && !lingering && (
          <button
            type="button"
            className={`${secondaryButton} self-start`}
            onClick={async () => {
              if (await confirm(t("study.confirmCloseRound"))) socket.emit("st:close_round");
            }}
          >
            <Square className="h-4 w-4" aria-hidden />
            {t("study.closeRound")}
          </button>
        )}
      </div>
    );
  }

  // --- Tussen de stappen (en de lobby vóór de eerste) ------------------------------
  const onlineCount = state.members.filter((m) => m.online).length;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {header}
      {state.roundsPlayed === 0 && <p className="text-sm text-vs-fg-2">{t("study.intro")}</p>}
      {errorKey && <p className="text-sm font-bold text-vs-danger">{t(errorKey as MessageKey)}</p>}

      {state.lastResults && <RoundResults data={state.lastResults} myUserId={myUserId} />}
      {state.roundsPlayed > 0 && <Standings title={t("study.standings")} hint={t("study.standingsHint")} standings={state.standings} myUserId={myUserId} />}

      {isHost ? (
        <StepPicker code={code} roundsPlayed={state.roundsPlayed} soloHint={onlineCount <= 1} onStart={(unitKey) => socket.emit("st:start_round", { unitKey })} />
      ) : (
        <p className={`${surfaceCard} p-4 text-sm text-vs-fg-2`} role="status">
          {t("study.waitingForHost", { name: host?.handle ?? "" })}
        </p>
      )}

      <section className={`${surfaceCard} flex flex-col gap-3 p-4 sm:p-5`}>
        <h2 className="font-extrabold text-vs-fg">{t("study.members", { n: state.members.length })}</h2>
        <ul className="flex flex-col gap-2">
          {state.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2.5">
              <span className="relative shrink-0">
                <UserAvatar id={m.userId} handle={m.handle} size="xs" />
                {m.online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-vs-surface bg-vs-success" aria-hidden />}
              </span>
              <span className="font-bold text-vs-fg">{m.handle}</span>
              {m.userId === state.hostId && <Crown className="h-4 w-4 text-vs-xp" aria-label={t("lobby.host")} />}
              {m.userId === myUserId && <span className="text-sm text-vs-fg-3">{t("lobby.you")}</span>}
              {!m.online && <span className="text-xs text-vs-fg-3">{t("study.offline")}</span>}
            </li>
          ))}
        </ul>
      </section>

      <LobbyInviteCard
        friends={friends}
        invitedIds={invited}
        joinedIds={state.members.map((m) => m.userId)}
        onInvite={(friendId) => {
          socket.emit("st:invite", { toUserId: friendId });
          setInvited((prev) => new Set(prev).add(friendId));
        }}
      />

      <p className="text-xs text-vs-fg-3">{t("study.scoring")}</p>

      {isHost ? (
        <button
          type="button"
          className={`${secondaryButton} self-start`}
          onClick={async () => {
            if (await confirm(t("study.confirmEnd"))) socket.emit("st:end");
          }}
        >
          <Square className="h-4 w-4" aria-hidden />
          {t("study.end")}
        </button>
      ) : (
        <button
          type="button"
          className={`${secondaryButton} self-start`}
          onClick={async () => {
            if (!(await confirm(t("study.confirmLeave")))) return;
            socket.emit("st:leave");
            window.location.href = `/courses/${state.courseId}`;
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          {t("study.leave")}
        </button>
      )}
    </div>
  );
}

function SharedReading({
  round,
  isHost,
  hostName,
  code,
  courseName,
}: {
  round: RoundState;
  isHost: boolean;
  hostName: string;
  code: string;
  courseName: string;
}) {
  const t = useT();
  const confirm = useConfirm();
  const socket = getSocket();
  const content = round.content!;
  const listening = content.kind === "podcast";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-vs-accent">
          {listening ? <Headphones className="h-4 w-4" aria-hidden /> : <BookOpen className="h-4 w-4" aria-hidden />}
          {listening ? t("study.listening") : t("study.reading")}
        </p>
        <h1 className="text-2xl font-extrabold text-vs-fg">{round.label}</h1>
        <p className="text-sm font-bold text-vs-fg-2">{courseName}</p>
      </header>

      <StudyContentView content={content} courseName={courseName} />

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-vs-line bg-vs-surface px-4 pb-[calc(1rem+var(--vs-safe-area-bottom))] pt-3">
        {isHost ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              className={`${primaryButton} w-full sm:w-auto`}
              onClick={async () => {
                if (await confirm(t("study.confirmToQuestions"))) socket.emit("st:begin_questions", { code });
              }}
            >
              <Play className="h-4 w-4" aria-hidden />
              {t("study.toQuestions")}
            </button>
            <button
              type="button"
              className={`${secondaryButton} w-full sm:w-auto`}
              onClick={async () => {
                if (await confirm(t("study.confirmSkipReading"))) socket.emit("st:skip_reading", { code });
              }}
            >
              <SkipForward className="h-4 w-4" aria-hidden />
              {t("study.skipReading")}
            </button>
          </div>
        ) : (
          <p className={`${surfaceCard} p-3 text-sm font-bold text-vs-fg-2`} role="status">
            {t("study.waitingForQuestions", { name: hostName })}
          </p>
        )}
      </div>
    </div>
  );
}

function StudyContentView({ content, courseName }: { content: StudyUnitContent; courseName: string }) {
  const t = useT();
  if (content.kind === "scripture") {
    return (
      <ReaderView
        chapterId={content.chapterId}
        bookName={content.bookName}
        chapterNumber={content.chapterNumber}
        verses={content.verses.map((verse) => ({ ...verse, bookmarked: false, highlighted: false, note: "" }))}
        language={content.language}
        focus
        preview
      />
    );
  }
  if (content.kind === "kids") {
    return (
      <section className={`${surfaceCard} flex flex-col gap-5 p-4 sm:p-6`}>
        <p className="text-xs font-bold uppercase tracking-wide text-vs-accent">{t("misc.storyN", { n: content.number })}</p>
        {content.images.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {content.images.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" className="h-auto w-full rounded-xl" />
            ))}
          </div>
        )}
        <p className="whitespace-pre-line text-lg leading-relaxed text-vs-fg">{content.text}</p>
      </section>
    );
  }
  if (content.kind === "podcast") return <StudyPodcastContent content={content} courseName={courseName} />;

  return <StudyIntroContent content={content} />;
}

function StudyPodcastContent({ content, courseName }: { content: Extract<StudyUnitContent, { kind: "podcast" }>; courseName: string }) {
  const t = useT();
  const player = usePodcastPlayer();
  const chapters = (() => {
    try {
      return content.chapters ? (JSON.parse(content.chapters) as PodcastChapter[]) : [];
    } catch {
      return [];
    }
  })();
  const isCurrent = player.episode?.id === content.episodeId;
  return (
    <section className={`${surfaceCard} flex flex-col gap-4 p-4 sm:p-6`}>
      <p className="text-xs font-bold uppercase tracking-wide text-vs-accent">{t("courseViews.podcast.episode", { n: content.number })}</p>
      <h2 className="text-xl font-extrabold text-vs-fg">{content.title}</h2>
      {content.summary && <p className="whitespace-pre-line leading-relaxed text-vs-fg-2">{content.summary}</p>}
      {content.audioUrl ? (
        <button
          type="button"
          className={`${secondaryButton} self-start`}
          onClick={() => {
            if (isCurrent) player.togglePlay();
            else player.playEpisode({ id: content.episodeId, number: content.number, title: content.title, audioUrl: content.audioUrl!, podcastName: courseName, chapters });
          }}
        >
          <Headphones className="h-4 w-4" aria-hidden />
          {isCurrent && player.isPlaying ? t("courseViews.podcast.pause") : t("courseViews.podcast.play")}
        </button>
      ) : (
        <p className="text-sm text-vs-fg-3">{t("study.noAudio")}</p>
      )}
    </section>
  );
}

function StudyIntroContent({ content }: { content: Extract<StudyUnitContent, { kind: "intro" }> }) {
  const t = useT();
  const blocks: { type?: string; [key: string]: unknown }[] = (() => {
    try {
      const parsed = JSON.parse(content.content);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  return (
    <section className={`${surfaceCard} flex flex-col gap-4 p-4 sm:p-6`}>
      <p className="text-xs font-bold uppercase tracking-wide text-vs-accent">{t("lessonFlows.lessonNumber", { n: content.number })}</p>
      <h2 className="text-xl font-extrabold text-vs-fg">{content.title}</h2>
      {blocks.map((block, index) => <IntroBlock key={index} block={block} />)}
    </section>
  );
}

function IntroBlock({ block }: { block: { type?: string; [key: string]: unknown } }) {
  if (block.type === "text" && typeof block.body === "string") return <p className="whitespace-pre-line leading-relaxed text-vs-fg">{block.body}</p>;
  if ((block.type === "poll" || block.type === "reflection") && typeof block.question === "string") return <p className="rounded-xl bg-vs-subtle p-4 font-bold text-vs-fg">{block.question}</p>;
  if (block.type === "steps" && Array.isArray(block.steps)) {
    return <ol className="flex list-decimal flex-col gap-2 pl-5 text-vs-fg">{block.steps.map((step, index) => <li key={index}>{typeof step === "object" && step && "label" in step ? String(step.label) : ""}</li>)}</ol>;
  }
  if (block.type === "scripture" && typeof block.label === "string") return <p className="rounded-xl border border-vs-line p-4 font-bold text-vs-fg">{block.label}</p>;
  return null;
}

function StepPicker({ code, roundsPlayed, soloHint, onStart }: { code: string; roundsPlayed: number; soloHint: boolean; onStart: (unitKey: string) => void }) {
  const t = useT();
  const [groups, setGroups] = useState<UnitGroup[] | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [unitKey, setUnitKey] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Na elke stap opnieuw: het voorstel schuift dan door naar de volgende stap.
  useEffect(() => {
    let cancelled = false;
    setStarting(false);
    fetch(`/api/study/${code}/units`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { groups: UnitGroup[]; suggested: string | null } | null) => {
        if (cancelled || !d) return;
        setGroups(d.groups);
        const g = Math.max(0, d.groups.findIndex((group) => group.units.some((u) => u.key === d.suggested)));
        setGroupIndex(g);
        setUnitKey(d.suggested ?? d.groups[0]?.units[0]?.key ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, roundsPlayed]);

  const units = useMemo(() => groups?.[groupIndex]?.units ?? [], [groups, groupIndex]);
  const showGroups = (groups?.length ?? 0) > 1 || (groups?.[0]?.label ?? "") !== "";

  if (groups === null) return <p className="text-sm text-vs-fg-3">{t("lobby.connecting")}</p>;
  if (groups.length === 0) return <p className={`${surfaceCard} p-4 text-sm text-vs-fg-2`}>{t("study.noSteps")}</p>;

  return (
    <section className={`${surfaceCard} flex flex-col gap-3 p-4 sm:p-5`}>
      <h2 className="font-extrabold text-vs-fg">{roundsPlayed > 0 ? t("study.nextStep") : t("study.pickStep")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {showGroups && (
          <label className="flex flex-col gap-1 text-sm font-bold text-vs-fg-2">
            {t("study.group")}
            <select
              className="input"
              value={groupIndex}
              onChange={(e) => {
                const next = Number(e.target.value);
                setGroupIndex(next);
                setUnitKey(groups[next]?.units[0]?.key ?? null);
              }}
            >
              {groups.map((group, i) => (
                <option key={`${group.label}-${i}`} value={i}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={`flex flex-col gap-1 text-sm font-bold text-vs-fg-2 ${showGroups ? "" : "sm:col-span-2"}`}>
          {t("study.step")}
          <select className="input" value={unitKey ?? ""} onChange={(e) => setUnitKey(e.target.value)}>
            {units.map((unit) => (
              <option key={unit.key} value={unit.key}>
                {unit.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {soloHint && <p className="text-xs text-vs-fg-3">{t("study.soloHint")}</p>}
      <button
        type="button"
        className={`${primaryButton} self-start`}
        disabled={!unitKey || starting}
        onClick={() => {
          if (!unitKey) return;
          setStarting(true);
          onStart(unitKey);
        }}
      >
        <Play className="h-4 w-4" aria-hidden />
        {t("study.startStep")}
      </button>
    </section>
  );
}

function Progress({ round, myUserId }: { round: RoundState; myUserId: string }) {
  const t = useT();
  return (
    <ul className={`${surfaceCard} flex flex-col gap-3 p-4`} aria-live="polite">
      {round.progress.map((p) => (
        <li key={p.userId} className="flex items-center gap-3">
          <UserAvatar id={p.userId} handle={p.handle} size="xs" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-bold text-vs-fg">
                {p.handle}
                {p.userId === myUserId && <span className="font-normal text-vs-fg-3"> {t("lobby.you")}</span>}
              </span>
              {p.finished ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-vs-success">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  {t("study.done")}
                  {p.finishPosition !== null ? ` · #${p.finishPosition}` : ""}
                </span>
              ) : (
                <span className="shrink-0 text-xs font-semibold tabular-nums text-vs-fg-3">{t("study.progress", { n: p.answered, total: round.total })}</span>
              )}
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-vs-subtle">
              <div className="vs-motion h-full rounded-full bg-vs-accent transition-[width] duration-300" style={{ width: `${round.total ? (p.answered / round.total) * 100 : 0}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RoundResults({ data, myUserId }: { data: NonNullable<StudyState["lastResults"]>; myUserId: string }) {
  const t = useT();
  return (
    <section className={`${surfaceCard} flex flex-col gap-3 p-4 sm:p-5`}>
      <h2 className="flex items-center gap-2 font-extrabold text-vs-fg">
        <Trophy className="h-5 w-5 text-vs-xp" aria-hidden />
        {t("study.roundResults", { step: data.label })}
      </h2>
      <ol className="flex flex-col gap-2.5">
        {data.results.map((r) => (
          <li key={r.userId} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${r.userId === myUserId ? "bg-vs-accent-soft" : ""}`}>
            <span className="w-6 shrink-0 text-center text-sm font-extrabold tabular-nums text-vs-fg-2">{r.rank}</span>
            <UserAvatar id={r.userId} handle={r.handle} size="xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-vs-fg">{r.handle}</p>
              <p className="text-xs text-vs-fg-3">
                {t("study.correctOf", { correct: r.correct, total: r.total })} ·{" "}
                {r.timeMs !== null ? clockDuration(r.timeMs / 1000) : t("study.notFinished")}
                {r.finishPosition === 1 && <span className="font-bold text-vs-success"> · {t("study.firstDone")}</span>}
              </p>
            </div>
            <span className="shrink-0 text-sm font-extrabold tabular-nums text-vs-fg">{t("study.points", { n: r.points })}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Standings({ title, hint, standings, myUserId }: { title: string; hint?: string; standings: Standing[]; myUserId: string }) {
  const t = useT();
  return (
    <section className={`${surfaceCard} flex flex-col gap-3 p-4 sm:p-5`}>
      <div>
        <h2 className="font-extrabold text-vs-fg">{title}</h2>
        {hint && <p className="text-xs text-vs-fg-3">{hint}</p>}
      </div>
      <ol className="flex flex-col gap-2.5">
        {standings.map((s) => (
          <li key={s.userId} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${s.userId === myUserId ? "bg-vs-accent-soft" : ""}`}>
            <span className="w-6 shrink-0 text-center text-sm font-extrabold tabular-nums text-vs-fg-2">{s.rank}</span>
            <UserAvatar id={s.userId} handle={s.handle} size="xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-vs-fg">{s.handle}</p>
              <p className="text-xs text-vs-fg-3">{s.rounds === 1 ? t("study.stepsOne") : t("study.stepsMany", { n: s.rounds })}</p>
            </div>
            <span className="shrink-0 text-sm font-extrabold tabular-nums text-vs-fg">{t("study.average", { n: s.average })}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
