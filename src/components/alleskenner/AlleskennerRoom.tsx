"use client";
import {applicationFetch} from "@/lib/data/applicationRuntime";


import { useEffect, useMemo, useState } from "react";
import {AppLink as Link} from "@/components/navigation/AppNavigation";
import {useGameRouter as useRouter} from "@/components/games/GameNavigation";
import { getSocket } from "@/lib/socketClient";
import { useLobbyExit } from "@/lib/useLobbyExit";
import LobbyClosedNotice from "@/components/LobbyClosedNotice";
import type { AkStateView } from "@/lib/alleskenner/types";
import { AK_MAX_TEAMS, AK_MIN_PLAYERS, AK_MIN_TEAM_PLAYERS } from "@/lib/alleskenner/types";
import AlleskennerGame, { TEAM_DOTS } from "@/components/alleskenner/AlleskennerGame";
import UserAvatar from "@/components/UserAvatar";
import LobbyInviteCard from "@/components/LobbyInviteCard";
import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import { useConfirm } from "@/components/ConfirmProvider";
import { rich } from "@/lib/i18n/rich";
import { translateServerText } from "@/lib/i18n/serverTexts";
import type { TFunction } from "@/lib/i18n/core";

// De server maakt titels, feedback en teamnamen in het Nederlands (voor alle
// spelers dezelfde status); elke speler ziet ze hier in de eigen taal.
function localizeState(state: AkStateView, t: TFunction): AkStateView {
  const tr = (text: string) => translateServerText(text, t);
  return {
    ...state,
    lobbyTeams: state.lobbyTeams?.map((team) => ({ ...team, name: tr(team.name) })) ?? null,
    // Bij teams is de naam van een deelnemer een teamnaam; spelersnamen blijven zoals ze zijn.
    contestants: state.teamMode ? state.contestants.map((c) => ({ ...c, name: tr(c.name) })) : state.contestants,
    intermission: state.intermission && {
      ...state.intermission,
      title: tr(state.intermission.title),
      subtitle: tr(state.intermission.subtitle),
    },
    feedback: state.feedback && { ...state.feedback, text: tr(state.feedback.text) },
  };
}

interface Friend {
  id: string;
  handle: string;
}

/**
 * Speelruimte van De Slimste Heilige. Alle spelstatus komt van de server
 * (src/server/alleskenner.ts) via "ak:state"; elke deelnemer krijgt een eigen
 * weergave, dus dit component beslist niets zelf over goed/fout of seconden.
 */
export default function AlleskennerRoom({ code, soloRunId }: { code: string; soloRunId?: string }) {
  const t = useT();
  const confirm = useConfirm();
  const [rawState, setState] = useState<AkStateView | null>(null);
  const state = useMemo(() => rawState && localizeState(rawState, t), [rawState, t]);
  const [receivedAt, setReceivedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const join = () => (soloRunId ? socket.emit("ak:solo_join", { runId: soloRunId }) : socket.emit("ak:join", { code }));
    function onState(next: AkStateView) {
      if (next.code !== code) return;
      setState(next);
      setReceivedAt(Date.now());
      setError(null);
    }
    function onError({ message }: { message: string }) {
      setError(message);
    }
    socket.on("ak:state", onState);
    socket.on("ak:error", onError);
    // Na een herverbinding (bv. telefoon even in slaap) opnieuw aanmelden.
    socket.on("connect", join);
    if (socket.connected) join();
    return () => {
      socket.off("ak:state", onState);
      socket.off("ak:error", onError);
      socket.off("connect", join);
    };
  }, [code, soloRunId]);

  // Sluiten door de host en zelf vertrekken: zie useLobbyExit.
  const { closedByHost, leave } = useLobbyExit(code, { isHost: state?.me.isHost ?? false, alleskenner: true });
  if (closedByHost) return <LobbyClosedNotice />;

  if (!state) {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-3">
        {error ? (
          <>
            <p className="font-semibold text-red-600 dark:text-red-400">{translateServerText(error, t)}</p>
            <Link href={soloRunId ? "/alleskenner/alleen" : "/live"} className="btn-secondary self-center">
              {soloRunId ? t("akRoom.backToSolo") : t("akRoom.backToPlay")}
            </Link>
          </>
        ) : (
          <p className="text-slate-400 dark:text-slate-500">{t("akRoom.connecting")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      {error && <p className="card !py-3 text-sm font-semibold text-red-600 dark:text-red-400">{translateServerText(error, t)}</p>}
      {state.phase === "LOBBY" && <Lobby state={state} onLeave={leave} />}
      {state.phase !== "LOBBY" && state.phase !== "FINISHED" && (
        <AlleskennerGame state={state} receivedAt={receivedAt} />
      )}
      {state.phase === "FINISHED" && <Finished state={state} />}
    </div>
  );
}

const ROLE_KEY = { player: "player", spectator: "spectator", quizmaster: "quizmaster" } as const;

function Lobby({ state, onLeave }: { state: AkStateView; onLeave: () => void }) {
  const socket = getSocket();
  const t = useT();
  const isHost = state.me.isHost;
  const [friends, setFriends] = useState<Friend[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const playerCount = state.participants.filter((p) => p.role === "player").length;
  const teams = state.lobbyTeams;
  const season = state.season;
  const minPlayers = season ? season.lineup.length : teams ? AK_MIN_TEAM_PLAYERS : AK_MIN_PLAYERS;

  useEffect(() => {
    if (!isHost) return;
    applicationFetch("/api/friends")
      .then((r) => r.json())
      .then((d) => setFriends((d.friends ?? []).map((entry: { user: Friend }) => entry.user)))
      .catch(() => {});
  }, [isHost]);


  function invite(friendId: string) {
    socket.emit("invite_friend", { toUserId: friendId, code: state.code });
    setInvited((prev) => new Set(prev).add(friendId));
  }

  async function cancel() {
    if (!(await confirm(t("activeGames.confirmEnd")))) return;
    socket.emit("cancel_game", { code: state.code });
  }

  return (
    <>
      <div className="card !bg-gradient-to-br from-brand-600 to-brand-800 text-white !border-0 flex flex-col gap-1">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-100">
          {season
            ? t(season.isLast ? "akRoom.lastSeasonFinaleEvening" : season.isFinale ? "akRoom.seasonFinaleEvening" : "akRoom.seasonEvening")
            : t("akRoom.lobby")}
        </p>
        <h1 className="text-2xl font-extrabold">{t("pages.alleskenner")}</h1>
        <p className="text-sm text-brand-100">
          {isHost
            ? t("akRoom.hostIntro")
            : t("akRoom.joinedAs", { role: t(`akRoom.roles.${ROLE_KEY[state.me.role]}`).toLowerCase() })}
        </p>
        {season && (
          <p className="text-sm text-white mt-1">
            {rich(t("akRoom.tonightPlaying"), { names: <strong>{season.lineup.map((p) => p.name).join(", ")}</strong> })}
          </p>
        )}
        <p className="text-xs font-bold text-gold-400 mt-1">
          {state.length === "FULL" ? t("akRoom.fullGame") : t("akRoom.shortGame")}
          {teams ? ` · ${t("akRoom.teamsN", { n: teams.length })}` : ""}
        </p>
      </div>

      <div className="card flex flex-col gap-3">
        <h2 className="font-extrabold dark:text-slate-100">{t("akRoom.participants")}</h2>
        <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
          {state.participants.map((p) => {
            const team = teams && p.teamIndex !== null ? teams[p.teamIndex] : null;
            const isLeader = team?.leaderId === p.userId;
            return (
              <li key={p.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                {/* Groene rand = online; wie (nog) niet verbonden is, staat vager. */}
                <UserAvatar
                  id={p.userId}
                  handle={p.name}
                  size="xs"
                  className={p.online ? "ring-2 ring-green-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-800" : "opacity-50"}
                />
                <span className="flex-1 min-w-[8rem] truncate font-semibold dark:text-slate-100">
                  {p.name}
                  {p.userId === state.hostId && <span className="ml-1.5 text-xs text-slate-400">{t("akRoom.hostTag")}</span>}
                  {isLeader && <span className="ml-1.5 text-xs font-bold text-gold-600 dark:text-gold-400">{t("akRoom.leaderTag")}</span>}
                </span>
                {teams && p.teamIndex !== null && !isHost && (
                  <span className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                    <span className={`h-2 w-2 rounded-full ${TEAM_DOTS[p.teamIndex % TEAM_DOTS.length]}`} aria-hidden />
                    {teams[p.teamIndex].name}
                  </span>
                )}
                {isHost && teams && p.teamIndex !== null && (
                  <>
                    <AppSelect
                      className="input !w-auto !py-1 !text-sm"
                      value={String(p.teamIndex)}
                      onChange={(value) => socket.emit("ak:set_team", { userId: p.userId, team: Number(value) })}
                      ariaLabel={p.name}
                      options={teams.map((team, i) => ({ value: String(i), label: team.name }))}
                    />
                    <button
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                        isLeader
                          ? "bg-gold-50 text-gold-700 dark:bg-slate-700 dark:text-gold-400"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 hover:text-gold-600"
                      }`}
                      disabled={isLeader}
                      onClick={() => socket.emit("ak:set_leader", { userId: p.userId })}
                      title={t("akRoom.makeLeader")}
                    >
                      ★
                    </button>
                  </>
                )}
                {isHost && p.role !== "quizmaster" && !season ? (
                  <AppSelect
                    className="input !w-auto !py-1 !text-sm"
                    value={p.role}
                    onChange={(value) => socket.emit("ak:set_role", { userId: p.userId, role: value })}
                    ariaLabel={p.name}
                    options={[{ value: "player", label: t("akRoom.roles.player") }, { value: "spectator", label: t("akRoom.roles.spectator") }]}
                  />
                ) : (
                  <span className="text-sm text-slate-500 dark:text-slate-400">{t(`akRoom.roles.${ROLE_KEY[p.role]}`)}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {isHost && (
        <div className="card flex flex-col gap-3">
          <h2 className="font-extrabold dark:text-slate-100">{t("akRoom.length")}</h2>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "SHORT", title: t("akRoom.short"), text: t("akRoom.shortText") },
                { value: "FULL", title: t("akRoom.full"), text: t("akRoom.fullText") },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                onClick={() => socket.emit("ak:set_length", { length: option.value })}
                className={`rounded-2xl border-2 px-3 py-2.5 text-left transition ${
                  state.length === option.value
                    ? "border-brand-500 bg-brand-50 dark:bg-slate-700"
                    : "border-slate-200 dark:border-slate-600 hover:border-brand-300"
                }`}
              >
                <span className="block font-extrabold dark:text-slate-100">{option.title}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{option.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isHost && (
        <div className="card flex flex-col gap-3">
          <h2 className="font-extrabold dark:text-slate-100">{t("akRoom.roles.quizmaster")}</h2>
          <AppSelect
            className="input"
            value={state.quizmasterId ?? ""}
            onChange={(value) => socket.emit("ak:set_quizmaster", { userId: value || null })}
            ariaLabel={t("akRoom.roles.quizmaster")}
            options={[{ value: "", label: t("akRoom.noQuizmaster") }, ...state.participants.filter((p) => !season?.lineup.some((l) => l.userId === p.userId)).map((p) => ({ value: p.userId, label: t("akRoom.isQuizmaster", { name: p.name }) }))]}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("akRoom.quizmasterHint")}
          </p>
        </div>
      )}

      {isHost && !season && (playerCount >= AK_MIN_TEAM_PLAYERS || teams) && (
        <div className="card flex flex-col gap-3">
          <h2 className="font-extrabold dark:text-slate-100">{t("akRoom.teams")}</h2>
          <AppSelect
            className="input"
            value={String(teams?.length ?? 0)}
            onChange={(value) => socket.emit("ak:set_teams", { count: Number(value) })}
            ariaLabel={t("akRoom.teams")}
            options={[{ value: "0", label: t("akRoom.everyoneForThemselves") }, ...Array.from({ length: AK_MAX_TEAMS - 1 }, (_, i) => i + 2).map((count) => ({ value: String(count), label: t("akRoom.teamsN", { n: count }) }))]}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("akRoom.teamsHint")}
          </p>
        </div>
      )}

      {isHost && !season && (
        <LobbyInviteCard
          friends={friends}
          invitedIds={invited}
          joinedIds={state.participants.map((p) => p.userId)}
          onInvite={invite}
        />
      )}

      {isHost && (
        <div className="flex flex-col items-center gap-2">
          <button className="btn-primary" disabled={playerCount < minPlayers} onClick={() => socket.emit("ak:start")}>
            {playerCount === 1 ? t("akRoom.startOne", { n: playerCount }) : t("akRoom.startMany", { n: playerCount })}
          </button>
          {playerCount < minPlayers && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("akRoom.minPlayers", { n: minPlayers })}</p>
          )}
          <button className="text-sm text-red-500 hover:underline" onClick={cancel}>
            {t("lobby.end")}
          </button>
        </div>
      )}

      {!isHost && (
        <button className="self-center text-sm font-semibold text-slate-500 dark:text-slate-400 hover:underline" onClick={onLeave}>
          {t("lobby.leave")}
        </button>
      )}
    </>
  );
}

function Finished({ state }: { state: AkStateView }) {
  if (state.season && state.winnerId) return <SeasonFinished state={state} />;
  if (state.solo) return <SoloFinished state={state} solo={state.solo} />;
  return <GameFinished state={state} />;
}

function GameFinished({ state }: { state: AkStateView }) {
  const t = useT();
  const winner = state.contestants.find((c) => c.id === state.winnerId);
  const standings = [...state.contestants].sort((a, b) => b.seconds - a.seconds);
  const best = state.personal?.ranking?.[0] ?? null;
  const mine = winner && winner.id === state.me.contestantId;
  return (
    <>
      <div className="card !bg-gradient-to-br from-gold-500 to-gold-700 !border-0 text-brand-900 text-center flex flex-col items-center gap-2 animate-pop">
        <p className="text-5xl" aria-hidden>
          🏆
        </p>
        {winner ? (
          <h1 className="text-2xl font-extrabold">
            {state.teamMode
              ? t(mine ? "akRoom.teamWinnerMine" : "akRoom.teamWinner", { name: winner.name })
              : mine
                ? t("akRoom.youWin")
                : t("akRoom.winner", { name: winner.name })}
          </h1>
        ) : (
          <h1 className="text-2xl font-extrabold">{t("akRoom.stopped")}</h1>
        )}
        {best && best.points > 0 && (
          <p className="font-bold">
            {t("akRoom.bestPlayer", { name: best.userId === state.me.userId ? t("akRoom.youLower") : best.name, n: best.points })}
          </p>
        )}
      </div>
      <div className="card flex flex-col gap-2">
        <h2 className="font-extrabold dark:text-slate-100">{t("akRoom.finalStandings")}</h2>
        <ol className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
          {standings.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <span className="w-6 text-center font-extrabold text-slate-400">{i + 1}</span>
              {/* Bij teams is een deelnemer een team, geen gebruiker. */}
              {!state.teamMode && <UserAvatar id={c.id} handle={c.name} size="xs" />}
              <span className="flex-1 font-semibold dark:text-slate-100">
                {c.name}
                {state.teamMode && (
                  <span className="block text-xs font-normal text-slate-400">{c.members.map((m) => m.name).join(", ")}</span>
                )}
              </span>
              <span className="font-extrabold tabular-nums dark:text-slate-100">{Math.round(c.seconds)} s</span>
            </li>
          ))}
        </ol>
      </div>
      {state.personal?.ranking && (
        <div className="card flex flex-col gap-2">
          <h2 className="font-extrabold dark:text-slate-100">{t("akRoom.personalPoints")}</h2>
          <ol className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
            {state.personal.ranking.map((p, i) => (
              <li key={p.userId} className="flex items-center gap-3 py-1.5">
                <span className="w-6 text-center font-extrabold text-slate-400">{i + 1}</span>
                <UserAvatar id={p.userId} handle={p.name} size="xs" />
                <span className="flex-1 font-semibold dark:text-slate-100">{p.name}</span>
                <span className="font-extrabold tabular-nums dark:text-slate-100">{p.points}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <Link href="/live" className="btn-secondary self-center">
        {t("akRoom.backToPlay")}
      </Link>
    </>
  );
}

function SeasonFinished({ state }: { state: AkStateView }) {
  const season = state.season!;
  const t = useT();
  const name = (id: string | null) => state.contestants.find((c) => c.id === id)?.name ?? "";
  const loser = state.finalists?.find((id) => id !== state.winnerId) ?? null;
  const standings = [...state.contestants].sort((a, b) => b.seconds - a.seconds);
  return (
    <>
      <div className="card !bg-gradient-to-br from-gold-500 to-gold-700 !border-0 text-brand-900 text-center flex flex-col items-center gap-2 animate-pop">
        <p className="text-5xl" aria-hidden>
          {season.isLast ? "👑" : "🏆"}
        </p>
        {season.isLast ? (
          <h1 className="text-2xl font-extrabold">
            {state.winnerId === state.me.userId
              ? t("akRoom.youSeasonChampion")
              : t("akRoom.seasonChampion", { name: name(state.winnerId) })}
          </h1>
        ) : (
          <>
            {season.safeId && (
              <h1 className="text-2xl font-extrabold">
                {season.safeId === state.me.userId
                  ? t("akRoom.youEveningChampion")
                  : t("akRoom.eveningChampion", { name: name(season.safeId) })}
              </h1>
            )}
            <p className="font-bold">
              {state.winnerId === state.me.userId
                ? t("akRoom.youWinFinal")
                : t("akRoom.winsFinal", { name: name(state.winnerId) })}{" "}
              {loser === state.me.userId ? t("akRoom.youAreOut") : t("akRoom.isOut", { name: name(loser) })}
            </p>
          </>
        )}
      </div>
      <div className="card flex flex-col gap-2">
        <h2 className="font-extrabold dark:text-slate-100">{t("akRoom.tonightStandings")}</h2>
        <ol className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
          {standings.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <span className="w-6 text-center font-extrabold text-slate-400">{i + 1}</span>
              <UserAvatar id={c.id} handle={c.name} size="xs" />
              <span className="flex-1 font-semibold dark:text-slate-100">{c.name}</span>
              <span className="font-extrabold tabular-nums dark:text-slate-100">{Math.round(c.seconds)} s</span>
            </li>
          ))}
        </ol>
      </div>
      <Link href={`/alleskenner/seizoen/${season.seasonId}`} className="btn-primary self-center">
        {t("akRoom.toSeason")}
      </Link>
    </>
  );
}

function SoloFinished({ state, solo }: { state: AkStateView; solo: NonNullable<AkStateView["solo"]> }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seconds = Math.round(state.contestants[0]?.seconds ?? 0);
  const stopped = state.winnerId === null;

  async function practice() {
    setBusy(true);
    setError(null);
    const res = await applicationFetch("/api/alleskenner/solo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "PRACTICE" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.error ?? t("gamesHub.createFailed"));
      return;
    }
    router.push(`/alleskenner/alleen/${data.runId}`);
  }

  return (
    <>
      <div className="card !bg-gradient-to-br from-gold-500 to-gold-700 !border-0 text-brand-900 text-center flex flex-col items-center gap-2 animate-pop">
        <p className="text-xs font-bold uppercase tracking-wider">
          {solo.mode === "DAILY" ? t("alleskenner.dailyTitle") : t("alleskenner.practiceTitle")}
        </p>
        {stopped ? (
          <>
            <h1 className="text-2xl font-extrabold">{t("akRoom.youStopped")}</h1>
            <p className="font-semibold">
              {solo.mode === "DAILY" ? t("akRoom.dailyNotCounted") : t("akRoom.practiceNotCounted")}
            </p>
          </>
        ) : (
          <>
            <p className="text-6xl font-extrabold tabular-nums">{seconds}</p>
            <p className="font-bold">{t("akRoom.secondsLeft")}</p>
            <p className="text-sm font-semibold">
              {solo.xpEarned === null
                ? t("akRoom.saving")
                : `+${solo.xpEarned} XP${solo.rank !== null ? ` · ${t("akRoom.placeToday", { n: solo.rank })}` : ""}`}
            </p>
          </>
        )}
      </div>
      {error && <p className="card !py-3 text-sm font-semibold text-red-600 dark:text-red-400">{translateServerText(error, t)}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/alleskenner/alleen" className="btn-primary">
          {solo.mode === "DAILY" ? t("akRoom.toLeaderboard") : t("wordOfTheDay.back")}
        </Link>
        <button className="btn-secondary" onClick={practice} disabled={busy}>
          {busy ? t("courses.busy") : solo.mode === "DAILY" ? t("alleskenner.practiceTitle") : t("akRoom.anotherRound")}
        </button>
      </div>
    </>
  );
}
