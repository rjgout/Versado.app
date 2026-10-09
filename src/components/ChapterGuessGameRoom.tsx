"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSocket } from "@/lib/socketClient";
import { useLobbyExit } from "@/lib/useLobbyExit";
import LobbyClosedNotice from "@/components/LobbyClosedNotice";
import { announceXpChanged } from "@/lib/xpBroadcast";
import UserAvatar from "@/components/UserAvatar";
import LobbyInviteCard from "@/components/LobbyInviteCard";
import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import { useConfirm } from "@/components/ConfirmProvider";
import { translateServerText } from "@/lib/i18n/serverTexts";
import IntroAudioButton from "@/components/IntroAudioButton";
import RankMedal from "@/components/versado/RankMedal";

interface LobbyPlayer {
  userId: string;
  displayName: string;
  score: number;
}

interface ChapterOptionView {
  id: string;
  label: string;
}

interface QuestionData {
  index: number;
  total: number;
  timeLimitMs: number;
  introText: string;
  introAudio?: { url: string; start: number; end: number } | null;
  options?: ChapterOptionView[];
}

interface ChapterOption {
  id: string;
  bookId: string;
  bookName: string;
  number: number;
}

interface Friend {
  id: string;
  handle: string;
}

interface HintResult {
  eliminatedChapterId?: string;
  bookId?: string;
  bookName?: string;
}

type Phase = "connecting" | "lobby" | "question" | "reveal" | "finished" | "error";
type Level = "BEGINNER" | "ADVANCED" | "EXPERT";

const LEVEL_KEYS = { BEGINNER: "beginner", ADVANCED: "advanced", EXPERT: "expert" } as const satisfies Record<Level, string>;

export default function ChapterGuessGameRoom({ code, myUserId }: { code: string; myUserId: string }) {
  const t = useT();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<Phase>("connecting");
  const [hostId, setHostId] = useState<string | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [question, setQuestion] = useState<QuestionData | null>(null);
  const [answeredCount, setAnsweredCount] = useState({ answered: 0, total: 0 });
  const [correctChapterId, setCorrectChapterId] = useState<string | null>(null);
  const [correctChapterLabel, setCorrectChapterLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [choice, setChoice] = useState("");
  const [pickedBookId, setPickedBookId] = useState("");
  const [pickedNumber, setPickedNumber] = useState<number | "">("");
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [hint, setHint] = useState<HintResult | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  const [forfeitedBy, setForfeitedBy] = useState<string | null>(null);

  const socket = getSocket();

  useEffect(() => {
    socket.emit("join_game", { code });

    function onLobby(data: { hostId: string; status: string; level: Level | null; players: LobbyPlayer[] }) {
      setHostId(data.hostId);
      setPlayers(data.players);
      setLevel(data.level);
      if (data.status === "LOBBY") setPhase((p) => (p === "connecting" ? "lobby" : p));
    }
    function onQuestion(data: QuestionData) {
      setQuestion(data);
      setCorrectChapterId(null);
      setCorrectChapterLabel(null);
      setSubmitted(false);
      setChoice("");
      setPickedBookId("");
      setPickedNumber("");
      setHint(null);
      setHintError(null);
      setAnsweredCount({ answered: 0, total: players.length });
      setPhase("question");
    }
    function onAnswerReceived(data: { answered: number; total: number }) {
      setAnsweredCount(data);
    }
    function onReveal(data: { correctAnswer: string[]; correctChapterLabel?: string; scoreboard: LobbyPlayer[] }) {
      setCorrectChapterId(data.correctAnswer[0] ?? null);
      setCorrectChapterLabel(data.correctChapterLabel ?? null);
      setPlayers(data.scoreboard);
      setPhase("reveal");
    }
    function onFinished(data: { scoreboard: LobbyPlayer[]; forfeitedBy?: string }) {
      setPlayers(data.scoreboard);
      setForfeitedBy(data.forfeitedBy ?? null);
      setPhase("finished");
      announceXpChanged();
    }
    function onError(data: { message: string }) {
      setErrorMessage(data.message);
      setPhase("error");
    }
    function onHintResult(data: HintResult) {
      setHint(data);
      if (data.bookId) setPickedBookId(data.bookId);
      setHintLoading(false);
    }
    function onHintError(data: { message: string }) {
      setHintError(data.message);
      setHintLoading(false);
    }

    socket.on("lobby_update", onLobby);
    socket.on("question", onQuestion);
    socket.on("answer_received", onAnswerReceived);
    socket.on("reveal", onReveal);
    socket.on("game_finished", onFinished);
    socket.on("error_message", onError);
    socket.on("hint_result", onHintResult);
    socket.on("hint_error", onHintError);

    return () => {
      socket.off("lobby_update", onLobby);
      socket.off("question", onQuestion);
      socket.off("answer_received", onAnswerReceived);
      socket.off("reveal", onReveal);
      socket.off("game_finished", onFinished);
      socket.off("error_message", onError);
      socket.off("hint_result", onHintResult);
      socket.off("hint_error", onHintError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    fetch("/api/friends")
      .then((r) => r.json())
      .then((d) => {
        const friendList = (d.friends ?? [])
          .map((entry: { user?: Friend }) => entry.user)
          .filter((friend: Friend | undefined): friend is Friend => Boolean(friend));
        setFriends(friendList);
      });
    fetch("/api/chapters")
      .then((r) => r.json())
      .then(setChapters);
  }, []);

  function startGame() {
    socket.emit("start_game");
  }

  function inviteFriend(friendId: string) {
    socket.emit("invite_friend", { toUserId: friendId, code });
    setInvited((prev) => new Set(prev).add(friendId));
  }

  async function cancelGame() {
    if (!(await confirm(t("activeGames.confirmEnd")))) return;
    socket.emit("cancel_game", { code });
  }

  function submitAnswer(chapterId: string) {
    if (submitted) return;
    setChoice(chapterId);
    socket.emit("submit_answer", { given: [chapterId] });
    setSubmitted(true);
  }

  function confirmAdvanced() {
    const match = chapters.find((c) => c.bookId === pickedBookId && c.number === pickedNumber);
    if (match) submitAnswer(match.id);
  }

  function requestHint() {
    if (hintLoading || hint) return;
    setHintError(null);
    setHintLoading(true);
    socket.emit("use_hint");
  }

  async function forfeit() {
    if (!(await confirm(t("lobby.confirmForfeit")))) return;
    socket.emit("forfeit");
  }

  const { closedByHost, leave: leaveLobby } = useLobbyExit(code, { isHost: hostId !== null && myUserId === hostId });

  if (closedByHost) return <LobbyClosedNotice />;

  if (phase === "error") {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
        <p className="text-red-600 dark:text-red-400 font-bold">{translateServerText(errorMessage ?? "", t)}</p>
        <Link href="/live" className="btn-secondary self-center">
          {t("wordOfTheDay.back")}
        </Link>
      </div>
    );
  }

  if (phase === "connecting") {
    return <p className="text-center text-slate-400 dark:text-slate-500">{t("lobby.connecting")}</p>;
  }

  if (phase === "lobby") {
    return (
      <div className="max-w-xl mx-auto flex flex-col gap-6">
        {level && (
          <span className="self-center text-xs font-bold uppercase text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-slate-700 rounded-full px-3 py-1">
            🔎 {t("pages.chapterGuess")} — {t(`chapterGuessLevels.${LEVEL_KEYS[level]}`)}
          </span>
        )}

        <div className="card">
          <h2 className="font-extrabold mb-3">{t("lobby.players", { n: players.length })}</h2>
          <ul className="flex flex-col gap-2">
            {players.map((p) => (
              <li key={p.userId} className="flex items-center gap-2">
                <UserAvatar id={p.userId} handle={p.displayName} size="xs" />
                <span className="font-bold">{p.displayName}</span>
                {p.userId === hostId && <span title={t("lobby.host")}>👑</span>}
                {p.userId === myUserId && <span className="text-brand-500 dark:text-brand-300 text-sm">{t("lobby.you")}</span>}
              </li>
            ))}
          </ul>
        </div>

        <LobbyInviteCard
          friends={friends}
          invitedIds={invited}
          joinedIds={players.map((p) => p.userId)}
          onInvite={inviteFriend}
        />

        {myUserId === hostId ? (
          <div className="flex flex-col items-center gap-2">
            <button className="btn-primary self-center" onClick={startGame} disabled={players.length === 0}>
              {t("lobby.start")}
            </button>
            <button
              className="btn-secondary !border-red-300 !text-red-600 dark:!border-red-800 dark:!text-red-400"
              onClick={cancelGame}
            >
              {t("lobby.end")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="text-center text-slate-400 dark:text-slate-500">{t("lobby.waitingForHost")}</p>
            <button className="text-slate-500 dark:text-slate-400 text-sm font-semibold hover:underline" onClick={leaveLobby}>
              {t("lobby.leave")}
            </button>
          </div>
        )}
      </div>
    );
  }

  if ((phase === "question" || phase === "reveal") && question) {
    const chaptersForBook = chapters.filter((c) => c.bookId === pickedBookId).sort((a, b) => a.number - b.number);
    const uniqueBooks = [...new Map(chapters.map((c) => [c.bookId, c.bookName])).entries()];
    const revealing = phase === "reveal";

    return (
      <div className="max-w-xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between text-sm font-bold text-slate-400 dark:text-slate-500">
          <span>
            {t("chapterGuess.questionOf", { n: question.index + 1, total: question.total })}
          </span>
          <div className="flex items-center gap-2">
            <span>{t("lobby.answered", { n: answeredCount.answered, total: players.length || answeredCount.total })}</span>
          </div>
        </div>
        <CountdownBar key={question.index} timeLimitMs={question.timeLimitMs} active={phase === "question"} />

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {level !== "EXPERT" && (
              <button className="btn-secondary !px-3 !py-1.5 !text-xs" disabled={hintLoading || hint !== null || submitted} onClick={requestHint}>
                💡 {t("chapterGuess.hint")}
              </button>
            )}
            <button className="btn-secondary !px-3 !py-1.5 !text-xs !text-red-500" onClick={forfeit}>
              🏳️ {t("challenges.forfeit")}
            </button>
          </div>
        </div>
        {hintError && <p className="text-red-600 dark:text-red-400 text-sm font-semibold">{translateServerText(hintError, t)}</p>}

        <div className="card flex flex-col gap-5">
          <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("chapterGuess.readHeading")}</p>
          <p className="text-xl leading-relaxed italic">&ldquo;{question.introText}&rdquo;</p>
          <IntroAudioButton audio={question.introAudio} />

          {hint?.bookName && !revealing && (
            <p className="text-sm bg-gold-50 dark:bg-slate-700 text-gold-600 dark:text-gold-400 rounded-xl px-3 py-2 font-bold">
              {t("chapterGuess.hintBook", { book: hint.bookName })}
            </p>
          )}

          {question.options ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {question.options.map((opt) => {
                const eliminated = hint?.eliminatedChapterId === opt.id;
                const isCorrectOption = revealing && correctChapterId === opt.id;
                const isWrongPick = revealing && choice === opt.id && !isCorrectOption;
                return (
                  <button
                    key={opt.id}
                    disabled={submitted || revealing || eliminated}
                    onClick={() => submitAnswer(opt.id)}
                    className={`btn text-left border-2 ${
                      isCorrectOption
                        ? "bg-brand-500 text-white border-brand-500"
                        : isWrongPick
                          ? "bg-red-100 text-red-600 border-red-400"
                          : eliminated
                            ? "opacity-30 line-through border-slate-200 dark:border-slate-700"
                            : "bg-white dark:bg-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-600 hover:border-brand-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <AppSelect
                className="input"
                value={pickedBookId}
                disabled={submitted || revealing}
                onChange={(value) => {
                  setPickedBookId(value);
                  setPickedNumber("");
                }}
                ariaLabel={t("chapterGuess.chooseBook")}
                options={[{ value: "", label: t("chapterGuess.chooseBook") }, ...uniqueBooks.map(([id, name]) => ({ value: id, label: name }))]}
              />
              <AppSelect
                className="input"
                value={pickedNumber === "" ? "" : String(pickedNumber)}
                disabled={submitted || revealing || !pickedBookId}
                onChange={(value) => setPickedNumber(value ? Number(value) : "")}
                ariaLabel={t("challenges.chooseChapter")}
                options={[{ value: "", label: t("challenges.chooseChapter") }, ...chaptersForBook.map((c) => ({ value: String(c.number), label: t("chapterGuess.chapterN", { n: c.number }) }))]}
              />
              {!submitted && !revealing && (
                <button className="btn-primary self-start" disabled={!pickedBookId || pickedNumber === ""} onClick={confirmAdvanced}>
                  {t("chapterGuess.confirmChoice")}
                </button>
              )}
            </div>
          )}

          {submitted && phase === "question" && (
            <p className="text-slate-400 dark:text-slate-500 text-sm self-end">{t("lobby.answerSent")}</p>
          )}
          {revealing && correctChapterLabel && (
            <p className="bg-brand-50 dark:bg-slate-700 text-brand-700 dark:text-brand-300 rounded-xl px-3 py-2 font-bold">
              {t("lobby.correctAnswer", { answer: correctChapterLabel })}
            </p>
          )}
        </div>

        {revealing && <Scoreboard players={players} myUserId={myUserId} />}
      </div>
    );
  }

  if (phase === "finished") {
    const forfeiter = players.find((p) => p.userId === forfeitedBy);
    return (
      <div className="max-w-xl mx-auto flex flex-col gap-6 items-center">
        <h1 className="text-3xl font-extrabold text-brand-800 dark:text-brand-300">{t("lobby.gameOver")}</h1>
        {forfeiter && (
          <p className="text-sm font-bold text-red-500 bg-red-50 dark:bg-slate-700 rounded-xl px-3 py-2">
            {forfeiter.userId === myUserId ? t("lobby.youGaveUp") : t("lobby.gaveUp", { name: forfeiter.displayName })}
          </p>
        )}
        <Scoreboard players={players} myUserId={myUserId} showMedals />
        <Link href="/chapter-guess" className="btn-primary">
          {t("lobby.newGame")}
        </Link>
      </div>
    );
  }

  return null;
}

function CountdownBar({ timeLimitMs, active }: { timeLimitMs: number; active: boolean }) {
  const [pct, setPct] = useState(100);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (!active) return;
    startRef.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      setPct(Math.max(0, 100 - (elapsed / timeLimitMs) * 100));
    }, 100);
    return () => clearInterval(interval);
  }, [active, timeLimitMs]);

  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
      <div
        className={`h-full transition-all duration-100 ${pct < 25 ? "bg-red-400" : "bg-brand-500"}`}
        style={{ width: `${active ? pct : 0}%` }}
      />
    </div>
  );
}

function Scoreboard({ players, myUserId, showMedals }: { players: LobbyPlayer[]; myUserId: string; showMedals?: boolean }) {
  const t = useT();
  return (
    <div className="card flex flex-col divide-y divide-slate-100 w-full">
      {players.map((p, i) => (
        <div key={p.userId} className={`flex items-center justify-between py-2 ${p.userId === myUserId ? "font-extrabold" : ""}`}>
          <span className="flex items-center gap-2">
            {showMedals && i < 3 ? (
              <RankMedal
                rank={(i + 1) as 1 | 2 | 3}
                label={i === 0 ? t("profile.medalGold") : i === 1 ? t("profile.medalSilver") : t("profile.medalBronze")}
              />
            ) : <span>{i + 1}.</span>}
            <UserAvatar id={p.userId} handle={p.displayName} size="xs" />
            {p.displayName} {p.userId === myUserId && t("lobby.you")}
          </span>
          <span className="text-gold-600 font-bold">{p.score}</span>
        </div>
      ))}
    </div>
  );
}
