"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getSocket } from "@/lib/socketClient";
import { getVoice } from "@/lib/readAloudPlayerContext";
import { getLanguage } from "@/lib/languages";
import { beginSpeechPlayback, endSpeechPlayback } from "@/lib/speechAudioSession";
import type { AkGridCell, AkPhase, AkStateView } from "@/lib/alleskenner/types";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import type { MessageKey } from "@/lib/i18n/core";
import { rich } from "@/lib/i18n/rich";

const ROUND_TITLE_KEY: Record<AkPhase, MessageKey> = {
  LOBBY: "akRoom.lobby",
  R369: "alleskenner.rounds.threeSixNine.title",
  OPEN_DEUR: "alleskenner.rounds.openDoor.title",
  PUZZLE: "alleskenner.rounds.puzzle.title",
  GALLERY: "alleskenner.rounds.gallery.title",
  MEMORY: "alleskenner.rounds.collectiveMemory.title",
  FINALE: "alleskenner.rounds.final.title",
  FINISHED: "akGame.end",
};

const GROUP_STYLES = [
  "bg-sky-200 dark:bg-sky-800 text-sky-950 dark:text-white",
  "bg-amber-200 dark:bg-amber-700 text-amber-950 dark:text-white",
  "bg-emerald-200 dark:bg-emerald-800 text-emerald-950 dark:text-white",
];

// Teamkleuren, in dezelfde volgorde als AK_TEAM_NAMES (blauw, oranje, groen, paars, rood).
export const TEAM_DOTS = ["bg-sky-500", "bg-orange-500", "bg-emerald-500", "bg-purple-500", "bg-red-500"];
const TEAM_BORDERS = ["border-sky-400", "border-orange-400", "border-emerald-400", "border-purple-400", "border-red-400"];

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

let speechId = 0;

/** Leest een vers voor in de taal van deze speler (alleen op één apparaat, zie hieronder). */
function speak(text: string, language: string, onDone?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    // Geen spraak op dit apparaat: niet eeuwig laten wachten op het voorlezen.
    onDone?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = getLanguage(language).intlLocale;
  const voice = getVoice(language);
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  // cancel() hierboven kan het vorige vers pas later laten afbreken: alleen
  // het laatste vers mag de afspeelsessie weer loslaten.
  const id = ++speechId;
  const release = () => {
    if (id === speechId) endSpeechPlayback();
  };
  // Alleen bij echt uitgesproken: een geblokkeerde automatische start (iOS
  // zonder tik) meldt geen einde; dan gebruikt de speler de knop Voorlezen.
  utterance.onend = () => {
    release();
    onDone?.();
  };
  utterance.onerror = release;
  beginSpeechPlayback();
  window.speechSynthesis.speak(utterance);
}

/**
 * Wat deze kijker nu mag. `canAct`: zijn tik telt als antwoord van de
 * deelnemer die aan de beurt is (zonder quizmaster). `canSilent`: bij teams
 * stil meekiezen voor persoonlijke punten. De server controleert dit opnieuw.
 */
interface Abilities {
  myTurn: boolean;
  inActiveTeam: boolean;
  isQuizmaster: boolean;
  tapMode: boolean;
  canAct: boolean;
  canSilent: boolean;
}

function abilities(state: AkStateView): Abilities {
  const isPlayer = state.me.role === "player";
  const myTurn = isPlayer && state.activeId !== null && state.me.contestantId === state.activeId && state.me.actsForContestant;
  const inActiveTeam = state.teamMode && state.me.contestantId === state.activeId && !state.me.actsForContestant;
  const tapMode = state.quizmasterId === null;
  return {
    myTurn,
    inActiveTeam,
    isQuizmaster: state.quizmasterId === state.me.userId,
    tapMode,
    canAct: myTurn && tapMode,
    canSilent: state.teamMode && isPlayer && !myTurn && state.activeId !== null,
  };
}

export default function AlleskennerGame({ state, receivedAt }: { state: AkStateView; receivedAt: number }) {
  const socket = getSocket();
  const t = useT();
  const confirm = useConfirm();
  const ticking = state.clockRunning || state.turnDeadline !== null;
  const now = useNow(ticking);
  const elapsed = ticking ? Math.max(0, (now - receivedAt) / 1000) : 0;
  const can = abilities(state);
  const active = state.contestants.find((c) => c.id === state.activeId) ?? null;
  const deadlineLeft =
    state.turnDeadline !== null ? Math.max(0, Math.ceil((state.turnDeadline - state.serverNow) / 1000 - elapsed)) : null;

  const displaySeconds = (id: string, seconds: number) =>
    state.clockRunning && state.activeId === id ? Math.max(0, seconds - elapsed) : seconds;

  const scoreboard =
    state.phase === "FINALE" && state.finalists
      ? state.contestants.filter((c) => state.finalists!.includes(c.id))
      : state.contestants;

  const choosingDoor = state.phase === "OPEN_DEUR" && state.openDeur?.choosing;
  const showPass = state.activeId !== null && !choosingDoor && (can.myTurn || can.isQuizmaster);
  const passLabel =
    state.phase === "GALLERY"
      ? t("akGame.skip")
      : can.isQuizmaster && !can.myTurn
        ? t("akGame.endTurnOf", { name: active?.name ?? "" })
        : t("akGame.passTurn");

  return (
    <>
      <Header state={state} deadlineLeft={deadlineLeft} />

      <div
        className={`grid gap-2 ${
          scoreboard.length === 1 ? "grid-cols-1 w-full max-w-[12rem] self-center" : scoreboard.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"
        }`}
      >
        {scoreboard.map((c) => {
          const isActive = c.id === state.activeId;
          const isMine = c.id === state.me.contestantId;
          const seconds = displaySeconds(c.id, c.seconds);
          return (
            <div
              key={c.id}
              className={`rounded-2xl px-3 py-2.5 flex flex-col items-center transition ${
                isActive
                  ? "bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg animate-invite-glow"
                  : `bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 shadow-sm ${
                      state.teamMode ? `border-2 ${TEAM_BORDERS[c.color % TEAM_BORDERS.length]}` : ""
                    }`
              }`}
            >
              <span className="text-xs font-bold truncate max-w-full flex items-center gap-1">
                {state.teamMode && <span className={`h-2 w-2 shrink-0 rounded-full ${TEAM_DOTS[c.color % TEAM_DOTS.length]}`} aria-hidden />}
                <span className="truncate">{c.name}</span>
                {isMine && !state.teamMode && <span className="shrink-0">{t("lobby.you")}</span>}
              </span>
              <span className={`text-3xl font-extrabold tabular-nums ${isActive && state.clockRunning ? "text-gold-400" : ""}`}>
                {Math.ceil(seconds)}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? "text-brand-100" : "text-slate-400"}`}>
                {isActive
                  ? state.clockRunning
                    ? t("akGame.clockRunning")
                    : t("akGame.onTurn")
                  : isMine && state.teamMode
                    ? t("akGame.yourTeam")
                    : t("akGame.seconds")}
              </span>
              {state.teamMode && (
                <span className={`text-[10px] truncate max-w-full ${isActive ? "text-brand-100" : "text-slate-400"}`}>
                  ★ {c.members.find((m) => m.userId === c.leaderId)?.name}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {state.personal && state.personal.mine !== null && (
        <p className="text-center text-xs font-bold text-slate-500 dark:text-slate-400">
          {t("akGame.yourPoints")} <span className="text-brand-700 dark:text-brand-300">{state.personal.mine}</span>
        </p>
      )}

      {state.intermission ? (
        <Intermission state={state} />
      ) : (
        <>
          <TurnBanner state={state} can={can} activeName={active?.name ?? null} leaderName={leaderName(state)} />
          {state.phase === "R369" && state.r369 && <Round369 state={state} can={can} />}
          {state.phase === "OPEN_DEUR" && state.openDeur && <RoundOpenDeur state={state} can={can} />}
          {state.phase === "PUZZLE" && state.puzzle && <RoundPuzzle state={state} can={can} />}
          {state.phase === "GALLERY" && state.gallery && <RoundGallery state={state} can={can} />}
          {state.phase === "MEMORY" && state.memory && <RoundMemory state={state} can={can} deadlineLeft={deadlineLeft} />}
          {state.phase === "FINALE" && state.finale && <RoundFinale state={state} can={can} />}
          {showPass && (
            <button className="btn-secondary self-center !px-8" onClick={() => socket.emit("ak:pass")}>
              {passLabel}
            </button>
          )}
        </>
      )}

      <Feedback state={state} />

      {state.me.isHost && (
        <button
          className="text-xs text-slate-400 hover:text-red-500 hover:underline self-center"
          onClick={async () =>
            (await confirm(
              state.solo?.mode === "DAILY"
                ? t("akGame.confirmStopDaily")
                : state.solo
                  ? t("akGame.confirmStopPractice")
                  : t("akGame.confirmStop")
            )) && socket.emit("ak:stop")
          }
        >
          {t("akGame.stop")}
        </button>
      )}
    </>
  );
}

function leaderName(state: AkStateView): string | null {
  const active = state.contestants.find((c) => c.id === state.activeId);
  return active?.members.find((m) => m.userId === active.leaderId)?.name ?? null;
}

function Header({ state, deadlineLeft }: { state: AkStateView; deadlineLeft: number | null }) {
  const t = useT();
  let detail = "";
  if (state.r369) detail = t("akGame.questionOf", { n: state.r369.number, total: state.r369.total });
  else if (state.openDeur) detail = t("akGame.subjectOf", { n: state.openDeur.number, total: state.openDeur.total });
  else if (state.puzzle) detail = t("akGame.puzzleOf", { n: state.puzzle.number, total: state.puzzle.total });
  else if (state.gallery) detail = t("akGame.galleryOf", { n: state.gallery.number, total: state.gallery.total });
  else if (state.memory) detail = t("akGame.fragmentOf", { n: state.memory.number, total: state.memory.total });
  else if (state.finale) detail = t("akGame.subjectOf", { n: state.finale.number, total: state.finale.total });
  // Tijdens het lezen bij Collectief Geheugen staat de teller al bij de tekst zelf.
  // Tijdens het lezen (Collectief Geheugen) of luisteren (luistervraag) staat
  // er geen bedenktijd: de teller daar is alleen een vangnet.
  const showDeadline =
    deadlineLeft !== null && !(state.phase === "MEMORY" && state.memory?.reading) && !state.r369?.listening;
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {t("pages.alleskenner")}
          {state.phase !== "FINALE" && ` · ${t("akGame.roundOf", { n: state.round.number, total: state.round.total })}`}
        </p>
        <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">
          {t(ROUND_TITLE_KEY[state.phase])} <span className="text-sm font-bold text-slate-400 dark:text-slate-500">{detail}</span>
        </h1>
      </div>
      {showDeadline && (
        <span
          className={`rounded-full px-3 py-1 text-sm font-extrabold tabular-nums ${
            (deadlineLeft ?? 0) <= 5
              ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          }`}
          title={t("akGame.thinkingTime")}
        >
          ⏳ {deadlineLeft}
        </span>
      )}
    </div>
  );
}

function Intermission({ state }: { state: AkStateView }) {
  const t = useT();
  const intermission = state.intermission!;
  const ranked = [...state.contestants].sort((a, b) => b.seconds - a.seconds);
  return (
    <div className="card !bg-gradient-to-br from-brand-700 to-brand-900 !border-0 text-white text-center flex flex-col gap-3 py-10 animate-pop">
      <h2 className="text-3xl font-extrabold">{intermission.title}</h2>
      {intermission.standings && (
        <ol className="flex flex-col gap-1 self-center min-w-[12rem]">
          {ranked.map((c, i) => (
            <li key={c.id} className="flex items-center justify-between gap-4 font-bold">
              <span>
                {i + 1}. {c.name}
              </span>
              <span className="tabular-nums text-gold-400">{Math.round(c.seconds)}</span>
            </li>
          ))}
        </ol>
      )}
      {intermission.title !== t("serverTexts.akStandings") && <p className="text-brand-100">{intermission.subtitle}</p>}
    </div>
  );
}

function TurnBanner({
  state,
  can,
  activeName,
  leaderName,
}: {
  state: AkStateView;
  can: Abilities;
  activeName: string | null;
  leaderName: string | null;
}) {
  const t = useT();
  if (!state.activeId) return null;
  let text: string;
  if (can.myTurn) {
    text = state.teamMode ? t("akGame.turnMyTeamMe") : t("akGame.turnMe");
    if (!can.tapMode) text += t("akGame.sayItAloud");
  } else if (can.inActiveTeam) {
    text = t("akGame.turnMyTeamLeader", { name: leaderName ?? "" });
  } else if (can.isQuizmaster) {
    text = t("akGame.turnQuizmaster", { name: activeName ?? "" });
  } else {
    text = t("akGame.turnOther", { name: activeName ?? "" });
    if (can.canSilent) text += t("akGame.chooseSilently");
  }
  return (
    <p
      className={`text-center font-extrabold ${
        can.myTurn || can.inActiveTeam ? "text-green-600 dark:text-green-400 text-lg" : "text-slate-500 dark:text-slate-400"
      }`}
    >
      {text}
    </p>
  );
}

// --- Gedeelde onderdelen -------------------------------------------------------

function QuizmasterBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gold-400 bg-gold-50 dark:bg-slate-900/50 p-3 flex flex-col gap-2">
      <p className="text-sm font-bold text-gold-700 dark:text-gold-400">{title}</p>
      {children}
    </div>
  );
}

function OptionButtons({
  options,
  enabled,
  myPick,
  answer,
  wrong = [],
  onPick,
}: {
  options: string[];
  enabled: boolean;
  myPick: string | null;
  answer: string | null;
  wrong?: string[];
  onPick: (option: string) => void;
}) {
  const t = useT();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const isAnswer = answer !== null && option === answer;
        const picked = myPick === option;
        const isWrong = !isAnswer && wrong.includes(option);
        return (
          <button
            key={option}
            disabled={!enabled || isWrong}
            onClick={() => onPick(option)}
            className={`rounded-2xl border-2 px-4 py-3 text-left font-bold transition ${
              isAnswer
                ? "border-green-500 bg-green-50 dark:bg-green-900/40 text-green-800 dark:text-green-200"
                : isWrong
                  ? "border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 line-through"
                  : picked
                  ? "border-gold-500 bg-gold-50 dark:bg-slate-700 dark:text-slate-100"
                  : "border-slate-200 dark:border-slate-600 dark:text-slate-100 enabled:hover:border-brand-400 enabled:active:scale-[0.98]"
            } disabled:cursor-default`}
          >
            {option}
            {picked && <span className="ml-2 text-xs font-extrabold text-gold-700 dark:text-gold-400">{t("akGame.yourPick")}</span>}
          </button>
        );
      })}
    </div>
  );
}

function GridCells({ cells, can, hint }: { cells: AkGridCell[]; can: Abilities; hint: string }) {
  const socket = getSocket();
  const t = useT();
  return (
    <>
      {(can.canAct || can.canSilent) && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {can.canAct
            ? hint
            : t("akGame.silentHint")}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {cells.map((cell) => {
          const enabled = cell.state === "open" && (can.canAct || can.canSilent);
          return (
            <button
              key={cell.text}
              disabled={!enabled}
              onClick={() => socket.emit("ak:tap_grid", { text: cell.text })}
              className={`rounded-xl border-2 px-3 py-2.5 text-left text-sm font-bold transition ${
                cell.state === "found"
                  ? "border-green-500 bg-green-50 dark:bg-green-900/40 text-green-800 dark:text-green-200"
                  : cell.state === "wrong"
                    ? "border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 line-through"
                    : cell.mine
                      ? "border-gold-500 bg-gold-50 dark:bg-slate-700 dark:text-slate-100"
                      : "border-slate-200 dark:border-slate-600 dark:text-slate-100 enabled:hover:border-brand-400 enabled:active:scale-[0.98]"
              } disabled:cursor-default`}
            >
              {cell.text}
            </button>
          );
        })}
      </div>
    </>
  );
}

function AnswerProgress({ found, total }: { found: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`h-3 flex-1 rounded-full ${i < found ? "bg-green-500" : "bg-slate-200 dark:bg-slate-700"}`} />
      ))}
      <span className="text-sm font-extrabold tabular-nums dark:text-slate-100">
        {found}/{total}
      </span>
    </div>
  );
}

function FoundList({ found }: { found: string[] }) {
  if (found.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {found.map((text) => (
        <li key={text} className="text-sm font-bold text-green-700 dark:text-green-400">
          ✓ {text}
        </li>
      ))}
    </ul>
  );
}

function RevealedList({ all, found }: { all: string[]; found: string[] }) {
  const t = useT();
  return (
    <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">{t("akGame.allAnswers")}</p>
      <ul className="flex flex-col gap-1">
        {all.map((text) => (
          <li
            key={text}
            className={`text-sm font-bold ${found.includes(text) ? "text-green-700 dark:text-green-400" : "text-slate-600 dark:text-slate-300"}`}
          >
            {found.includes(text) ? "✓" : "•"} {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuizmasterAnswers({ state }: { state: AkStateView }) {
  const socket = getSocket();
  const t = useT();
  const answers = state.quizmaster?.answers;
  if (!answers) return null;
  return (
    <QuizmasterBox title={t("akGame.qmTapAnswer")}>
      {answers.map((answer, index) => (
        <button
          key={answer.text}
          disabled={answer.found || !state.activeId}
          onClick={() => socket.emit("ak:qm_answer", { index })}
          className="rounded-xl bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600 px-3 py-2 text-left disabled:opacity-60"
        >
          <span className="font-extrabold dark:text-slate-100">
            {answer.found ? "✓ " : ""}
            {answer.text}
          </span>
          {answer.accept.length > 0 && (
            <span className="block text-xs text-slate-500 dark:text-slate-400">{t("akGame.alsoGood", { list: answer.accept.join(", ") })}</span>
          )}
        </button>
      ))}
    </QuizmasterBox>
  );
}

// --- Rondes --------------------------------------------------------------------

function Round369({ state, can }: { state: AkStateView; can: Abilities }) {
  const socket = getSocket();
  const t = useT();
  const q = state.r369!;
  // De luistervraag wordt maar op één apparaat voorgelezen (quizmaster, of
  // zonder quizmaster degene die namens de beurt antwoordt): anders praat
  // iedere telefoon in de kamer door elkaar heen.
  const speaker = can.tapMode ? can.myTurn : can.isQuizmaster;
  const spokenFor = useRef<string | null>(null);
  const number = q.number;
  const listenDone = () => socket.emit("ak:listen_done", { number });
  useEffect(() => {
    if (!q.listenText || !speaker || !q.listening) return;
    const key = `${q.number}`;
    if (spokenFor.current === key) return;
    spokenFor.current = key;
    speak(q.listenText, state.me.language, () => socket.emit("ak:listen_done", { number: q.number }));
  }, [q.listenText, q.number, q.listening, speaker, socket, state.me.language]);
  const activeName = state.contestants.find((c) => c.id === state.activeId)?.name;

  return (
    <div className="card flex flex-col gap-4">
      {q.isPointQuestion && (
        <span className="self-start rounded-full bg-gold-50 dark:bg-slate-700 px-3 py-1 text-xs font-extrabold text-gold-700 dark:text-gold-400">
          {t("akGame.pointQuestion")}
        </span>
      )}
      {q.listenText && (
        <div className="flex items-center gap-3 rounded-2xl bg-brand-50 dark:bg-slate-700 px-4 py-3">
          <span className="text-2xl" aria-hidden>
            🔊
          </span>
          <p className="flex-1 text-sm font-semibold text-brand-800 dark:text-brand-200">
            {t("akGame.listenQuestion")}{" "}
            {q.listening
              ? speaker
                ? t("akGame.listenSpeaker")
                : t("akGame.listenOthers")
              : t("akGame.listenDone")}
          </p>
          {(speaker || !q.listening) && (
            <button
              className="btn-secondary !px-3 !py-1.5 !text-xs shrink-0"
              onClick={() => speak(q.listenText!, state.me.language, q.listening && speaker ? listenDone : undefined)}
            >
              {q.listening ? t("akGame.readAloud") : t("akGame.again")}
            </button>
          )}
        </div>
      )}
      <h2 className="text-xl font-extrabold dark:text-slate-100">{q.prompt}</h2>

      {q.wrongOptions.length > 0 && !q.reveal && (
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
          {t("akGame.notYet")}{" "}
          {can.myTurn
            ? t("akGame.yourTry")
            : activeName
              ? t("akGame.theirTry", { name: activeName })
              : t("akGame.nextTry")}
        </p>
      )}

      {q.options && (
        <OptionButtons
          options={q.options}
          enabled={(can.canAct || can.canSilent) && q.reveal === null}
          myPick={q.myPick}
          answer={q.reveal?.answer ?? null}
          wrong={q.wrongOptions}
          onPick={(option) => socket.emit("ak:tap_369", { option })}
        />
      )}

      {q.reveal && (
        <p className={`text-center font-extrabold ${q.reveal.correct ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {q.reveal.correct ? t("akGame.revealCorrect") : t("akGame.revealWrong")} — {t("akGame.answerIs", { answer: q.reveal.answer })}
        </p>
      )}

      {can.isQuizmaster && state.quizmaster?.answer369 && !q.reveal && (
        <QuizmasterBox title={t("akGame.answer", { answer: state.quizmaster.answer369 })}>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary !bg-green-600" onClick={() => socket.emit("ak:qm_369", { correct: true })}>
              {t("akGame.markCorrect")}
            </button>
            <button className="btn-primary !bg-red-500" onClick={() => socket.emit("ak:qm_369", { correct: false })}>
              {t("akGame.markWrong")}
            </button>
          </div>
        </QuizmasterBox>
      )}
    </div>
  );
}

function RoundOpenDeur({ state, can }: { state: AkStateView; can: Abilities }) {
  const socket = getSocket();
  const t = useT();
  const round = state.openDeur!;
  const chooser = state.contestants.find((c) => c.id === state.activeId)?.name;

  if (round.choosing) {
    const mayChoose = can.myTurn || can.isQuizmaster;
    return (
      <div className="card flex flex-col gap-4">
        <h2 className="text-xl font-extrabold dark:text-slate-100">
          {can.myTurn ? t("akGame.chooseSubject") : t("akGame.choosesSubject", { name: chooser ?? "" })}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {round.doors.map((door) => (
            <button
              key={door.index}
              disabled={!mayChoose || door.taken}
              onClick={() => socket.emit("ak:choose_door", { index: door.index })}
              className={`rounded-2xl px-4 py-6 text-center font-extrabold transition ${
                door.taken
                  ? "bg-slate-100 dark:bg-slate-800 text-slate-400 line-through"
                  : "bg-gradient-to-b from-gold-400 to-gold-600 text-brand-900 shadow-md enabled:hover:scale-[1.02] enabled:active:scale-[0.98]"
              } disabled:cursor-default`}
            >
              <span className="block text-2xl mb-1" aria-hidden>
                🚪
              </span>
              {door.subject}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!round.subject) return null;
  return (
    <div className="card flex flex-col gap-4">
      <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("akGame.whatDoYouKnow", { subject: round.subject })}</h2>
      <AnswerProgress found={round.found.length} total={round.answerCount} />
      {!round.revealed && <FoundList found={round.found} />}
      {round.revealed && <RevealedList all={round.revealed} found={round.found} />}
      {round.grid && (
        <GridCells
          cells={round.grid}
          can={round.tapOnly ? { ...can, canAct: can.myTurn } : can}
          hint={t("akGame.openDoorHint")}
        />
      )}
      {can.isQuizmaster && !round.revealed && <QuizmasterAnswers state={state} />}
    </div>
  );
}

function RoundPuzzle({ state, can }: { state: AkStateView; can: Abilities }) {
  const socket = getSocket();
  const t = useT();
  const puzzle = state.puzzle!;
  const [answer, setAnswer] = useState("");
  const silentLeft = puzzle.myGuesses ? 3 - puzzle.myGuesses.length : 0;
  const canType = can.canAct || (can.canSilent && silentLeft > 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!answer.trim()) return;
    socket.emit("ak:type_puzzle", { text: answer.trim() });
    setAnswer("");
  }

  return (
    <div className="card flex flex-col gap-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("akGame.puzzleIntro")}
      </p>
      <div className={`grid gap-2 ${puzzle.clues.some((c) => c.text.length > 32) ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-3"}`}>
        {puzzle.clues.map((clue) => (
          <div
            key={clue.text}
            className={`rounded-xl px-2 py-3 min-h-[4.5rem] flex items-center justify-center text-center text-xs sm:text-sm font-bold transition ${
              clue.group !== null ? GROUP_STYLES[clue.group] : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100"
            }`}
          >
            {clue.text}
          </div>
        ))}
      </div>

      {puzzle.found.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {puzzle.found.map((f) => (
            <span key={f.group} className={`rounded-full px-3 py-1 text-sm font-extrabold ${GROUP_STYLES[f.group]}`}>
              {f.answer}
            </span>
          ))}
        </div>
      )}

      {canType && !puzzle.revealed && (
        <form onSubmit={submit} className="flex gap-2">
          <input
            className="input flex-1"
            placeholder={can.canAct ? t("akGame.typeConnecting") : t("akGame.silentGuess", { n: silentLeft })}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            autoFocus={can.canAct}
            autoComplete="off"
            autoCapitalize="off"
          />
          <button className="btn-primary" type="submit">
            {can.canAct ? t("lesson.check") : t("akGame.guess")}
          </button>
        </form>
      )}
      {puzzle.myGuesses && puzzle.myGuesses.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {rich(t("akGame.yourSilentGuesses"), { guesses: <span className="font-bold">{puzzle.myGuesses.join(", ")}</span> })}
        </p>
      )}

      {can.isQuizmaster && state.quizmaster?.puzzleGroups && !puzzle.revealed && (
        <QuizmasterBox title={t("akGame.qmTapGroup")}>
          {state.quizmaster.puzzleGroups.map((group, index) => (
            <button
              key={group.answer}
              disabled={group.found || !state.activeId}
              onClick={() => socket.emit("ak:qm_puzzle", { group: index })}
              className={`rounded-xl px-3 py-2 text-left disabled:opacity-60 ${GROUP_STYLES[index]}`}
            >
              <span className="font-extrabold">
                {group.found ? "✓ " : ""}
                {group.answer}
              </span>
              {group.accept.length > 0 && <span className="text-xs"> {t("akGame.alsoGoodParen", { list: group.accept.join(", ") })}</span>}
              <span className="block text-xs opacity-80">{group.clues.join(" · ")}</span>
            </button>
          ))}
        </QuizmasterBox>
      )}
    </div>
  );
}

function RoundGallery({ state, can }: { state: AkStateView; can: Abilities }) {
  const socket = getSocket();
  const t = useT();
  const gallery = state.gallery!;
  const question = gallery.variant === "QUOTES" ? t("akGame.galleryQuotes") : t("akGame.galleryImages");

  if (gallery.revealed) {
    return (
      <div className="card flex flex-col gap-3">
        <h2 className="text-lg font-extrabold dark:text-slate-100">{t("akGame.allAnswers")}</h2>
        <div className={`grid gap-2 ${gallery.variant === "IMAGES" ? "grid-cols-2 sm:grid-cols-4" : ""}`}>
          {gallery.revealed.map((entry, i) => (
            <div
              key={i}
              className={`rounded-xl border-2 p-2 text-sm ${entry.found ? "border-green-500" : "border-slate-200 dark:border-slate-600"}`}
            >
              {entry.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={entry.image} alt="" className="w-full aspect-[4/3] object-cover rounded-lg mb-1" />
              )}
              {entry.text && <p className="text-xs italic text-slate-500 dark:text-slate-400 line-clamp-2">“{entry.text}”</p>}
              <p className={`font-extrabold ${entry.found ? "text-green-700 dark:text-green-400" : "dark:text-slate-100"}`}>
                {entry.found ? "✓ " : ""}
                {entry.answer}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex gap-1.5">
        {gallery.results.map((r, i) => (
          <span
            key={i}
            className={`h-2.5 flex-1 rounded-full ${
              r.found ? "bg-green-500" : i === gallery.itemIndex ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        ))}
      </div>
      <h2 className="text-lg font-extrabold dark:text-slate-100">{question}</h2>
      {gallery.item?.text && (
        <blockquote className="rounded-2xl bg-brand-50 dark:bg-slate-700 px-4 py-4 text-base sm:text-lg font-semibold italic text-brand-900 dark:text-brand-100">
          “{gallery.item.text}”
        </blockquote>
      )}
      {gallery.item?.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={gallery.item.image} alt={t("akGame.illustration")} className="w-full max-h-[50vh] object-contain rounded-2xl bg-white" />
      )}
      {gallery.options && (
        <OptionButtons
          options={gallery.options}
          enabled={can.canAct || can.canSilent}
          myPick={gallery.myPick}
          answer={null}
          onPick={(option) => socket.emit("ak:tap_gallery", { option })}
        />
      )}
      {can.isQuizmaster && state.quizmaster?.galleryAnswer && (
        <QuizmasterBox title={t("akGame.answer", { answer: state.quizmaster.galleryAnswer })}>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary !bg-green-600" onClick={() => socket.emit("ak:qm_gallery", { correct: true })}>
              {t("akGame.markCorrect")}
            </button>
            <button className="btn-primary !bg-red-500" onClick={() => socket.emit("ak:qm_gallery", { correct: false })}>
              {t("akGame.markWrongNext")}
            </button>
          </div>
        </QuizmasterBox>
      )}
    </div>
  );
}

function RoundMemory({ state, can, deadlineLeft }: { state: AkStateView; can: Abilities; deadlineLeft: number | null }) {
  const t = useT();
  const memory = state.memory!;
  const owner = state.contestants.find((c) => c.id === state.activeId);

  if (memory.reading) {
    return (
      <div className="card flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold dark:text-slate-100">
            {memory.title} <span className="text-sm font-bold text-slate-400">{memory.passage}</span>
          </h2>
          {deadlineLeft !== null && (
            <span className="shrink-0 rounded-full bg-brand-600 text-white px-3 py-1 text-sm font-extrabold tabular-nums">
              📖 {deadlineLeft}
            </span>
          )}
        </div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("akGame.readCarefully")}</p>
        <div className="flex flex-col gap-2 text-[15px] leading-relaxed dark:text-slate-100">
          {memory.verses?.map((v) =>
            // Versnummer 0 = een hoofdstukkop: de delen (gescheiden door " — ") onder elkaar.
            v.number === 0 ? (
              <ul key="kop" className="flex flex-col gap-1.5 list-disc pl-5">
                {v.text.split(/\s+—\s+/).map((part) => (
                  <li key={part}>{part}</li>
                ))}
              </ul>
            ) : (
              <p key={v.number}>
                <sup className="font-bold text-brand-600 dark:text-brand-300 mr-1">{v.number}</sup>
                {v.text}
              </p>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-4">
      <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
        {t("akGame.whatDoYouRemember", { title: memory.title })} <span className="text-sm font-bold text-slate-400">{memory.passage}</span>
      </h2>
      {!memory.revealed && memory.found.length < memory.answerCount && (
        <span className="self-start rounded-full bg-gold-50 dark:bg-slate-700 px-3 py-1 text-xs font-extrabold text-gold-700 dark:text-gold-400">
          {owner
            ? t("akGame.nextValueFor", { n: memory.nextValue, name: owner.name })
            : t("akGame.nextValue", { n: memory.nextValue })}
        </span>
      )}
      <AnswerProgress found={memory.found.length} total={memory.answerCount} />
      {memory.found.length > 0 && !memory.revealed && (
        <ul className="flex flex-col gap-1">
          {memory.found.map((f) => (
            <li key={f.text} className="text-sm font-bold text-green-700 dark:text-green-400">
              ✓ {f.text} <span className="text-xs text-slate-400">+{f.value}</span>
            </li>
          ))}
        </ul>
      )}
      {memory.revealed && <RevealedList all={memory.revealed} found={memory.found.map((f) => f.text)} />}
      {memory.grid && (
        <GridCells
          cells={memory.grid}
          can={can}
          hint={t("akGame.memoryHint")}
        />
      )}
      {can.isQuizmaster && !memory.revealed && <QuizmasterAnswers state={state} />}
    </div>
  );
}

function RoundFinale({ state, can }: { state: AkStateView; can: Abilities }) {
  const t = useT();
  const finale = state.finale!;
  return (
    <div className="card flex flex-col gap-4">
      <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("akGame.whatDoYouKnow", { subject: finale.subject })}</h2>
      <AnswerProgress found={finale.found.length} total={finale.answerCount} />
      {!finale.revealed && <FoundList found={finale.found} />}
      {finale.revealed && <RevealedList all={finale.revealed} found={finale.found} />}
      {finale.grid && (
        <GridCells
          cells={finale.grid}
          can={finale.tapOnly ? { ...can, canAct: can.myTurn } : can}
          hint={t("akGame.finaleHint", { subject: finale.subject })}
        />
      )}
      {can.isQuizmaster && !finale.revealed && <QuizmasterAnswers state={state} />}
    </div>
  );
}

function Feedback({ state }: { state: AkStateView }) {
  const [visible, setVisible] = useState<AkStateView["feedback"]>(null);
  // Alleen nieuwe meldingen tonen (niet de laatste van vóór het openen van
  // dit scherm); vergeleken op de servertijd van de melding zelf, zodat een
  // afwijkende klok van dit toestel niet uitmaakt.
  // De verbergtimer staat in een ref en niet in de cleanup van het effect:
  // elke statusupdate (elke seconde) levert een nieuw feedback-object op, en
  // die cleanup zou de timer dan telkens wissen, waardoor de melding bleef staan.
  const lastShownAt = useRef<number | null>(state.feedback?.at ?? null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state.feedback || state.feedback.at === lastShownAt.current) return;
    lastShownAt.current = state.feedback.at;
    setVisible(state.feedback);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(null), 2500);
  }, [state.feedback]);
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);
  if (!visible) return null;
  const who = state.contestants.find((c) => c.id === visible.contestantId)?.name;
  const mine = visible.contestantId !== null && visible.contestantId === state.me.contestantId;
  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 top-[calc(var(--header-offset,var(--header-default))+0.75rem)] z-40 w-max max-w-[90vw] text-center rounded-2xl px-5 py-2.5 font-extrabold shadow-lg animate-pop pointer-events-none ${
        visible.kind === "good" ? "bg-green-600 text-white" : visible.kind === "bad" ? "bg-red-500 text-white" : "bg-slate-800 text-white"
      }`}
    >
      {!mine && who ? `${who}: ` : ""}
      {visible.text}
    </div>
  );
}
