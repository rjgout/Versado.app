"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSocket } from "@/lib/socketClient";
import { useLobbyExit } from "@/lib/useLobbyExit";
import LobbyClosedNotice from "@/components/LobbyClosedNotice";
import { normalizeAnswer } from "@/lib/exerciseGen";
import { announceXpChanged } from "@/lib/xpBroadcast";
import UserAvatar from "@/components/UserAvatar";
import LobbyInviteCard from "@/components/LobbyInviteCard";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { translateServerText } from "@/lib/i18n/serverTexts";
import PersonalMascot from "@/components/versado/PersonalMascot";

interface LobbyPlayer {
  userId: string;
  displayName: string;
  score: number;
}

interface QuestionData {
  id: string;
  index: number;
  total: number;
  type: "FILL_BLANK" | "WORD_BANK" | "MULTIPLE_CHOICE" | "SEQUENCE";
  verseRef: string;
  prompt: string;
  blanks: number;
  wordBank?: string[];
  options?: string[];
  timeLimitMs: number;
}

interface Friend {
  id: string;
  handle: string;
}

type Phase = "connecting" | "lobby" | "question" | "reveal" | "finished" | "error";

export default function GameRoom({ code, myUserId }: { code: string; myUserId: string }) {
  const t = useT();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<Phase>("connecting");
  const [hostId, setHostId] = useState<string | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [question, setQuestion] = useState<QuestionData | null>(null);
  const [answeredCount, setAnsweredCount] = useState({ answered: 0, total: 0 });
  const [correctAnswer, setCorrectAnswer] = useState<string[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [choice, setChoice] = useState("");
  const [placed, setPlaced] = useState<{ word: string; poolIndex: number }[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [forfeitedBy, setForfeitedBy] = useState<string | null>(null);

  const socket = getSocket();

  useEffect(() => {
    socket.emit("join_game", { code });

    function onLobby(data: { hostId: string; status: string; players: LobbyPlayer[] }) {
      setHostId(data.hostId);
      setPlayers(data.players);
      if (data.status === "LOBBY") setPhase((p) => (p === "connecting" ? "lobby" : p));
    }
    function onQuestion(data: QuestionData) {
      setQuestion(data);
      setCorrectAnswer(null);
      setSubmitted(false);
      setChoice("");
      setPlaced([]);
      setAnsweredCount({ answered: 0, total: players.length });
      setPhase("question");
    }
    function onAnswerReceived(data: { answered: number; total: number }) {
      setAnsweredCount(data);
    }
    function onReveal(data: { correctAnswer: string[]; scoreboard: LobbyPlayer[] }) {
      setCorrectAnswer(data.correctAnswer);
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

    socket.on("lobby_update", onLobby);
    socket.on("question", onQuestion);
    socket.on("answer_received", onAnswerReceived);
    socket.on("reveal", onReveal);
    socket.on("game_finished", onFinished);
    socket.on("error_message", onError);

    return () => {
      socket.off("lobby_update", onLobby);
      socket.off("question", onQuestion);
      socket.off("answer_received", onAnswerReceived);
      socket.off("reveal", onReveal);
      socket.off("game_finished", onFinished);
      socket.off("error_message", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    fetch("/api/friends")
      .then((r) => r.json())
      // /api/friends geeft per vriend { friendshipId, user } terug.
      .then((d) => setFriends((d.friends ?? []).map((entry: { user: Friend }) => entry.user)));
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

  async function forfeit() {
    if (!(await confirm(t("lobby.confirmForfeit")))) return;
    socket.emit("forfeit");
  }

  function submitAnswer() {
    if (!question) return;
    const given = question.type === "WORD_BANK" ? placed.map((p) => p.word) : [choice];
    socket.emit("submit_answer", { given });
    setSubmitted(true);
  }

  const pool = useMemo(() => question?.wordBank ?? [], [question]);
  const availablePool = pool
    .map((word, poolIndex) => ({ word, poolIndex }))
    .filter(({ poolIndex }) => !placed.some((p) => p.poolIndex === poolIndex));

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
            <button className="text-red-500 dark:text-red-400 text-sm font-semibold hover:underline" onClick={cancelGame}>
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
    const promptParts = question.prompt.split(/____/);
    return (
      <div className="max-w-xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between text-sm font-bold text-slate-400 dark:text-slate-500">
          <span>
            {t("chapterGuess.questionOf", { n: question.index + 1, total: question.total })}
          </span>
          {phase === "question" && (
            <span>
              {t("lobby.answered", { n: answeredCount.answered, total: players.length || answeredCount.total })}
            </span>
          )}
        </div>
        <CountdownBar key={question.index} timeLimitMs={question.timeLimitMs} active={phase === "question"} />

        {phase === "question" && (
          <button className="btn-secondary self-start !px-3 !py-1.5 !text-xs !text-red-500" onClick={forfeit}>
            🏳️ {t("challenges.forfeit")}
          </button>
        )}

        <div className="card flex flex-col gap-5">
          <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{question.verseRef}</p>

          {question.type === "FILL_BLANK" || question.type === "MULTIPLE_CHOICE" ? (
            <>
              <p className="text-xl leading-relaxed">
                {promptParts.map((part, i) => (
                  <span key={i}>
                    {part}
                    {i < promptParts.length - 1 && (
                      <span className="inline-block mx-1 px-3 py-0.5 rounded-lg border-b-2 border-dashed border-brand-400 font-bold text-brand-500">
                        {choice || "____"}
                      </span>
                    )}
                  </span>
                ))}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(question.options ?? []).map((opt) => {
                  const isCorrectOption = phase === "reveal" && correctAnswer && normalizeAnswer(opt) === normalizeAnswer(correctAnswer[0] ?? "");
                  const isWrongPick = phase === "reveal" && choice === opt && !isCorrectOption;
                  return (
                    <button
                      key={opt}
                      disabled={submitted || phase === "reveal"}
                      onClick={() => setChoice(opt)}
                      className={`btn text-left border-2 ${
                        isCorrectOption
                          ? "bg-brand-500 text-white border-brand-500"
                          : isWrongPick
                            ? "bg-red-100 text-red-600 border-red-400"
                            : choice === opt
                              ? "bg-brand-500 text-white border-brand-500"
                              : "bg-white dark:bg-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-600 hover:border-brand-300"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <p className="text-xl leading-relaxed">{question.prompt}</p>
              <div className="flex flex-wrap gap-2 min-h-[3rem] p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-700">
                {placed.map((p, i) => (
                  <button
                    key={i}
                    disabled={submitted || phase === "reveal"}
                    onClick={() => setPlaced(placed.filter((_, idx) => idx !== i))}
                    className="rounded-xl bg-brand-500 text-white px-3 py-1.5 font-bold"
                  >
                    {p.word}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {availablePool.map(({ word, poolIndex }) => (
                  <button
                    key={poolIndex}
                    disabled={submitted || phase === "reveal"}
                    onClick={() => setPlaced([...placed, { word, poolIndex }])}
                    className="rounded-xl bg-white dark:bg-slate-800 dark:text-slate-100 border-2 border-slate-200 dark:border-slate-600 px-3 py-1.5 font-bold hover:border-brand-300"
                  >
                    {word}
                  </button>
                ))}
              </div>
            </>
          )}

          {phase === "question" && !submitted && (
            <button
              className="btn-primary self-end"
              disabled={question.type === "WORD_BANK" ? placed.length !== question.blanks : choice.length === 0}
              onClick={submitAnswer}
            >
              {t("lobby.send")}
            </button>
          )}
          {submitted && phase === "question" && <p className="text-slate-400 dark:text-slate-500 text-sm self-end">{t("lobby.answerSent")}</p>}
          {phase === "reveal" && correctAnswer && (
            <p className="bg-brand-50 dark:bg-slate-700 text-brand-700 dark:text-brand-300 rounded-xl px-3 py-2 font-bold">
              {t("lobby.correctAnswer", { answer: correctAnswer.join(" ") })}
            </p>
          )}
        </div>

        {phase === "reveal" && <Scoreboard players={players} myUserId={myUserId} />}
      </div>
    );
  }

  if (phase === "finished") {
    const forfeiter = players.find((p) => p.userId === forfeitedBy);
    // De server levert het scorebord aflopend op score; alleen een echte
    // eigen overwinning is hier het grotere celebrate-moment.
    const resultState = players[0]?.userId === myUserId && forfeitedBy !== myUserId ? "celebrate" : "encourage";
    return (
      <div className="max-w-xl mx-auto flex flex-col gap-6 items-center">
        <div className="aspect-square w-[clamp(110px,30vw,8.125rem)] shrink-0 sm:w-36">
          <PersonalMascot state={resultState} size={144} fill />
        </div>
        <h1 className="text-3xl font-extrabold text-brand-800 dark:text-brand-300">{t("lobby.gameOver")}</h1>
        {forfeiter && (
          <p className="text-sm font-bold text-red-500 bg-red-50 dark:bg-slate-700 rounded-xl px-3 py-2">
            {forfeiter.userId === myUserId ? t("lobby.youGaveUp") : t("lobby.gaveUp", { name: forfeiter.displayName })}
          </p>
        )}
        <Scoreboard players={players} myUserId={myUserId} showMedals />
        <Link href="/live" className="btn-primary">
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
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="card flex flex-col divide-y divide-slate-100 w-full">
      {players.map((p, i) => (
        <div key={p.userId} className={`flex items-center justify-between py-2 ${p.userId === myUserId ? "font-extrabold" : ""}`}>
          <span className="flex items-center gap-2">
            {showMedals ? medals[i] ?? i + 1 : i + 1}.
            <UserAvatar id={p.userId} handle={p.displayName} size="xs" />
            {p.displayName} {p.userId === myUserId && t("lobby.you")}
          </span>
          <span className="text-gold-600 font-bold">{p.score}</span>
        </div>
      ))}
    </div>
  );
}
