"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSocket } from "@/lib/socketClient";
import { useLobbyExit } from "@/lib/useLobbyExit";
import LobbyClosedNotice from "@/components/LobbyClosedNotice";
import UserAvatar from "@/components/UserAvatar";
import LobbyInviteCard from "@/components/LobbyInviteCard";
import IntroAudioButton from "@/components/IntroAudioButton";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { translateServerText } from "@/lib/i18n/serverTexts";
import RankMedal from "@/components/versado/RankMedal";

type Phase = "connecting" | "lobby" | "playing" | "finished" | "error";
type Region = "JERUZALEM" | "WILDERNIS" | "ZEE" | "BELOOFDE_LAND" | "ZARAHEMLA";
type TileKind = "START" | "KNOWLEDGE" | "FILL_IN" | "WHERE_IN_BOOK" | "EVENT" | "FINISH";

interface BoardTileView {
  index: number;
  region: Region;
  kind: TileKind;
}

interface FamilyPlayerView {
  userId: string;
  displayName: string;
  score: number;
  isGuest: boolean;
  position: number;
}

interface Friend {
  id: string;
  handle: string;
}

type CardView =
  | { tileKind: "KNOWLEDGE" | "FILL_IN"; exerciseId: string; type: "FILL_BLANK" | "WORD_BANK" | "TRUE_FALSE"; verseRef: string; prompt: string; wordBank?: string[]; options?: string[] }
  | { tileKind: "WHERE_IN_BOOK"; introText: string; introAudio?: { url: string; start: number; end: number } | null; options: { chapterId: string; label: string }[] }
  | { tileKind: "EVENT"; slug: string; title: string; choices: string[] };

const REGION_KEY = {
  JERUZALEM: "jerusalem",
  WILDERNIS: "wilderness",
  ZEE: "sea",
  BELOOFDE_LAND: "promisedLand",
  ZARAHEMLA: "zarahemla",
} as const satisfies Record<Region, string>;
const REGION_IMAGE: Record<Region, string> = {
  JERUZALEM: "/gezinsavond/regions/jeruzalem.webp",
  WILDERNIS: "/gezinsavond/regions/wildernis.webp",
  ZEE: "/gezinsavond/regions/zee.webp",
  BELOOFDE_LAND: "/gezinsavond/regions/beloofde-land.webp",
  ZARAHEMLA: "/gezinsavond/regions/zarahemla.webp",
};
const TILE_ICON: Record<TileKind, string> = {
  START: "🏺",
  KNOWLEDGE: "📖",
  FILL_IN: "🔤",
  WHERE_IN_BOOK: "📍",
  EVENT: "⚔️",
  FINISH: "🏁",
};
const TILE_BORDER: Record<TileKind, string> = {
  START: "border-slate-800 dark:border-slate-200",
  KNOWLEDGE: "border-brand-500",
  FILL_IN: "border-ice-500",
  WHERE_IN_BOOK: "border-gold-500",
  EVENT: "border-rose-500",
  FINISH: "border-gold-600",
};

const TUTORIAL_DONE_KEY = "familyGameTutorialDone";
const TILE_SPACING = 108;
const TILE_MARGIN = 60;
const WAVE_AMPLITUDE = 90;
const WAVE_BASE_Y = 240;
const WORLD_HEIGHT = 480;

function tileX(index: number): number {
  return TILE_MARGIN + index * TILE_SPACING;
}
function tileY(index: number): number {
  return WAVE_BASE_Y + WAVE_AMPLITUDE * Math.sin(index * 0.7);
}

export default function FamilyGameRoom({ code, myUserId }: { code: string; myUserId: string }) {
  const t = useT();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<Phase>("connecting");
  const [hostId, setHostId] = useState<string | null>(null);
  const [players, setPlayers] = useState<FamilyPlayerView[]>([]);
  const [diceMode, setDiceMode] = useState<"DIGITAL" | "PHYSICAL" | null>(null);
  const [board, setBoard] = useState<BoardTileView[]>([]);
  const [finishIndex, setFinishIndex] = useState(29);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [guestName, setGuestName] = useState("");
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [physicalChoice, setPhysicalChoice] = useState<number | null>(null);
  const [card, setCard] = useState<CardView | null>(null);
  const [given, setGiven] = useState<string[]>([]);
  const [reveal, setReveal] = useState<{
    correct: boolean;
    explanation: { verseRef: string; verseText: string | null } | { correctLabel: string } | null;
  } | null>(null);
  const [eventResult, setEventResult] = useState<{ delta: number; label: string } | null>(null);
  const [seenKinds, setSeenKinds] = useState<Set<TileKind>>(new Set());
  const [tutorialDone, setTutorialDone] = useState(true); // pas na mount echt bepaald, zie effect hieronder
  const [confirming, setConfirming] = useState(false);

  const socket = getSocket();
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });

  useEffect(() => {
    try {
      setTutorialDone(localStorage.getItem(TUTORIAL_DONE_KEY) === "true");
    } catch {
      // privénavigatie e.d. — dan gewoon geen tutorial-tips onthouden, nooit de app breken
    }
  }, []);

  useEffect(() => {
    socket.emit("join_game", { code });

    function onLobby(data: { hostId: string; status: string; diceMode: "DIGITAL" | "PHYSICAL" | null; players: FamilyPlayerView[] }) {
      setHostId(data.hostId);
      setPlayers(data.players);
      setDiceMode(data.diceMode);
      if (data.status === "LOBBY") setPhase((p) => (p === "connecting" ? "lobby" : p));
    }
    function onStarted(data: { board: BoardTileView[]; finishIndex: number; diceMode: "DIGITAL" | "PHYSICAL"; scoreboard: FamilyPlayerView[] }) {
      setBoard(data.board);
      setFinishIndex(data.finishIndex);
      setDiceMode(data.diceMode);
      setPlayers(data.scoreboard);
      setPhase("playing");
    }
    function onTurn(data: { currentPlayerId: string | null; scoreboard: FamilyPlayerView[] }) {
      setCurrentPlayerId(data.currentPlayerId);
      setPlayers(data.scoreboard);
      setCard(null);
      setReveal(null);
      setEventResult(null);
      setGiven([]);
      setLastRoll(null);
      setPhysicalChoice(null);
    }
    function onDiceResult(data: { playerId: string; roll: number }) {
      setLastRoll(data.roll);
    }
    function onLanded(data: { playerId: string; to: number; tile: BoardTileView; card: CardView | null; isFinish: boolean }) {
      setPlayers((prev) => prev.map((p) => (p.userId === data.playerId ? { ...p, position: data.to } : p)));
      setCard(data.card);
      setSeenKinds((prev) => new Set(prev).add(data.tile.kind));
    }
    function onReveal(data: { correct: boolean; explanation: { verseRef: string; verseText: string | null } | { correctLabel: string } | null; scoreboard: FamilyPlayerView[] }) {
      setReveal({ correct: data.correct, explanation: data.explanation });
      setPlayers(data.scoreboard);
    }
    function onEventResult(data: { delta: number; label: string; scoreboard: FamilyPlayerView[] }) {
      setEventResult({ delta: data.delta, label: data.label });
      setPlayers(data.scoreboard);
    }
    function onFinished(data: { scoreboard: FamilyPlayerView[] }) {
      setPlayers(data.scoreboard);
      setPhase("finished");
      try {
        localStorage.setItem(TUTORIAL_DONE_KEY, "true");
      } catch {
        // zie hierboven
      }
    }
    function onError(data: { message: string }) {
      setErrorMessage(data.message);
      setPhase("error");
    }

    socket.on("lobby_update", onLobby);
    socket.on("family_game_started", onStarted);
    socket.on("family_turn", onTurn);
    socket.on("family_dice_result", onDiceResult);
    socket.on("family_landed", onLanded);
    socket.on("family_reveal", onReveal);
    socket.on("family_event_result", onEventResult);
    socket.on("game_finished", onFinished);
    socket.on("error_message", onError);

    return () => {
      socket.off("lobby_update", onLobby);
      socket.off("family_game_started", onStarted);
      socket.off("family_turn", onTurn);
      socket.off("family_dice_result", onDiceResult);
      socket.off("family_landed", onLanded);
      socket.off("family_reveal", onReveal);
      socket.off("family_event_result", onEventResult);
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

  // --- Pan/zoom (muis-wiel, slepen, pinch — zie de eerder gedeelde
  // bordverkenning) — puur visueel, geen spellogica. ---
  useEffect(() => {
    if (phase !== "playing") return;
    const stage = stageRef.current;
    const world = worldRef.current;
    if (!stage || !world) return;

    const worldW = TILE_MARGIN * 2 + Math.max(0, board.length - 1) * TILE_SPACING;
    const minScale = 0.35;
    const maxScale = 2;

    function clamp(v: number, lo: number, hi: number) {
      return Math.max(lo, Math.min(hi, v));
    }
    function apply() {
      const v = viewRef.current;
      world!.style.transform = `translate(${v.tx}px,${v.ty}px) scale(${v.scale})`;
    }
    function fit() {
      const r = stage!.getBoundingClientRect();
      const scale = clamp(r.height / WORLD_HEIGHT, minScale, maxScale);
      viewRef.current = { scale, tx: 16, ty: 8 };
      apply();
    }
    function zoomAt(clientX: number, clientY: number, factor: number) {
      const r = stage!.getBoundingClientRect();
      const v = viewRef.current;
      const px = clientX - r.left, py = clientY - r.top;
      const wx = (px - v.tx) / v.scale, wy = (py - v.ty) / v.scale;
      v.scale = clamp(v.scale * factor, minScale, maxScale);
      v.tx = px - wx * v.scale;
      v.ty = py - wy * v.scale;
      apply();
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    const pointers = new Map<number, { x: number; y: number }>();
    let lastDist = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      stage!.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        if (lastDist) zoomAt(midX, midY, dist / lastDist);
        lastDist = dist;
      } else if (dragging) {
        const v = viewRef.current;
        v.tx += e.clientX - lastX;
        v.ty += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        apply();
      }
    };
    const endPointer = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) lastDist = 0;
      if (pointers.size === 0) dragging = false;
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);
    fit();

    return () => {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", endPointer);
      stage.removeEventListener("pointercancel", endPointer);
    };
  }, [phase, board.length]);

  function zoomButton(factor: number) {
    const stage = stageRef.current;
    const world = worldRef.current;
    if (!stage || !world) return;
    const r = stage.getBoundingClientRect();
    const v = viewRef.current;
    const px = r.width / 2, py = r.height / 2;
    const wx = (px - v.tx) / v.scale, wy = (py - v.ty) / v.scale;
    v.scale = Math.max(0.35, Math.min(2, v.scale * factor));
    v.tx = px - wx * v.scale;
    v.ty = py - wy * v.scale;
    world.style.transform = `translate(${v.tx}px,${v.ty}px) scale(${v.scale})`;
  }

  function addGuest() {
    const name = guestName.trim();
    if (!name) return;
    socket.emit("add_guest", { name });
    setGuestName("");
  }

  function inviteFriend(friendId: string) {
    socket.emit("invite_friend", { toUserId: friendId, code });
    setInvited((prev) => new Set(prev).add(friendId));
  }

  function startGame() {
    socket.emit("start_game");
  }

  async function cancelGame() {
    if (!(await confirm(t("activeGames.confirmEnd")))) return;
    socket.emit("cancel_game", { code });
  }

  async function abortInProgress() {
    if (!(await confirm(t("familyGame.confirmAbort")))) return;
    socket.emit("forfeit");
  }

  function rollDice() {
    setRolling(true);
    socket.emit("roll_dice");
    setTimeout(() => setRolling(false), 500);
  }

  function enterPhysicalRoll(value: number) {
    setPhysicalChoice(value);
    socket.emit("enter_physical_roll", { value });
  }

  function submitAnswer() {
    if (!card || card.tileKind === "EVENT") return;
    socket.emit("submit_family_answer", { given });
  }

  function chooseEvent(index: number) {
    socket.emit("choose_event", { choiceIndex: index });
  }

  const currentPlayer = players.find((p) => p.userId === currentPlayerId) ?? null;
  // Zelfde regel als canActFor op de server (zie gameServer.ts): een gast
  // wordt altijd bediend vanaf het apparaat van de host, een echt account
  // alleen vanaf zijn eigen apparaat. Dit is puur voor de UI (welke knoppen
  // tonen) — de server keurt een verkeerd ingestuurde actie hoe dan ook af.
  const myTurn = currentPlayer !== null && (currentPlayer.isGuest ? myUserId === hostId : myUserId === currentPlayerId);
  const isMyOwnTurn = currentPlayerId === myUserId && !currentPlayer?.isGuest;
  const showTip = !tutorialDone;

  const { closedByHost, leave: leaveLobby } = useLobbyExit(code, { isHost: hostId !== null && myUserId === hostId });

  if (closedByHost) return <LobbyClosedNotice />;

  if (phase === "error") {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
        <p className="text-red-600 dark:text-red-400 font-bold">{translateServerText(errorMessage ?? "", t)}</p>
        <Link href="/gezinsavond" className="btn-secondary self-center">
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
        <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300 text-center">🎉 {t("pages.familyNight")}</h1>

        <div className="card">
          <h2 className="font-extrabold mb-3">{t("lobby.players", { n: players.length })}</h2>
          <ul className="flex flex-col gap-2">
            {players.map((p) => (
              <li key={p.userId} className="flex items-center gap-2">
                {/* Een gast heeft geen account (en dus geen eigen avatar-emoji). */}
                <UserAvatar id={p.userId} handle={p.displayName} avatarEmoji={p.isGuest ? null : undefined} size="xs" />
                <span className="font-bold">{p.displayName}</span>
                {p.userId === hostId && <span title={t("lobby.host")}>👑</span>}
                {p.userId === myUserId && <span className="text-brand-500 dark:text-brand-300 text-sm">{t("lobby.you")}</span>}
                {p.isGuest && <span className="text-slate-400 dark:text-slate-500 text-xs">{t("familyGame.guest")}</span>}
                {p.isGuest && myUserId === hostId && (
                  <button
                    className="ml-auto text-red-500 dark:text-red-400 text-xs font-semibold hover:underline"
                    onClick={() => socket.emit("remove_guest", { guestId: p.userId })}
                  >
                    {t("familyGame.remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {myUserId === hostId && (
          <div className="card flex flex-col gap-3">
            <h2 className="font-extrabold dark:text-slate-100">{t("familyGame.addGuest")}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("familyGame.addGuestHint")}
            </p>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder={t("familyGame.name")}
                maxLength={24}
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addGuest()}
              />
              <button className="btn-secondary" onClick={addGuest} disabled={!guestName.trim()}>
                {t("courses.add")}
              </button>
            </div>
          </div>
        )}

        {myUserId === hostId && (
          <LobbyInviteCard
            title={t("familyGame.inviteFriend")}
            friends={friends}
            invitedIds={invited}
            joinedIds={players.map((p) => p.userId)}
            onInvite={inviteFriend}
          />
        )}

        {myUserId === hostId ? (
          <div className="flex flex-col items-center gap-2">
            <button className="btn-primary self-center" onClick={startGame} disabled={players.length < 2}>
              {t("lobby.start")}
            </button>
            {players.length < 2 && (
              <p className="text-xs text-slate-400 dark:text-slate-500">{t("familyGame.needMorePlayers")}</p>
            )}
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

  if (phase === "playing") {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">🎉 {t("pages.familyNight")}</h1>
          <button className="text-xs text-slate-400 dark:text-slate-500 hover:underline" onClick={abortInProgress}>
            {t("familyGame.abort")}
          </button>
        </div>

        <div
          className={`flex items-center gap-2 rounded-full px-4 py-2 font-extrabold text-sm w-fit ${
            isMyOwnTurn ? "bg-brand-50 dark:bg-slate-700 text-brand-700 dark:text-brand-300" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${isMyOwnTurn ? "bg-brand-500 animate-pulse" : "bg-slate-400"}`} />
          {t("familyGame.turnOf", { name: currentPlayer?.displayName ?? "?" })}
          {isMyOwnTurn && t("familyGame.turnYou")}
        </div>

        <div ref={stageRef} className="relative h-[340px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 touch-none">
          <div
            ref={worldRef}
            className="absolute top-0 left-0"
            style={{ width: TILE_MARGIN * 2 + Math.max(0, board.length - 1) * TILE_SPACING, height: WORLD_HEIGHT, transformOrigin: "0 0" }}
          >
            {(["JERUZALEM", "WILDERNIS", "ZEE", "BELOOFDE_LAND", "ZARAHEMLA"] as Region[]).map((region) => {
              const tiles = board.filter((t) => t.region === region);
              if (tiles.length === 0) return null;
              const left = tileX(tiles[0].index) - TILE_SPACING / 2;
              const width = tileX(tiles[tiles.length - 1].index) - tileX(tiles[0].index) + TILE_SPACING;
              return (
                <div
                  key={region}
                  className="absolute top-0 h-full bg-cover bg-center flex items-start pt-3"
                  style={{ left, width, backgroundImage: `url(${REGION_IMAGE[region]})` }}
                >
                  <span className="px-3 py-1 rounded-full font-extrabold text-sm bg-slate-900/55 text-white backdrop-blur-sm">
                    {t(`familyGame.regions.${REGION_KEY[region]}`)}
                  </span>
                </div>
              );
            })}

            <svg className="absolute top-0 left-0 overflow-visible" width={1} height={1}>
              {/* Dubbele lijn (donkere onderlaag + lichte bovenlaag) zodat het pad
                  afsteekt tegen de illustraties op de achtergrond, ongeacht kleur. */}
              <polyline
                points={board.map((t) => `${tileX(t.index)},${tileY(t.index)}`).join(" ")}
                fill="none"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={8}
                strokeLinecap="round"
              />
              <polyline
                points={board.map((t) => `${tileX(t.index)},${tileY(t.index)}`).join(" ")}
                fill="none"
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={4}
                strokeLinecap="round"
              />
            </svg>

            {board.map((tile) => (
              <div
                key={tile.index}
                className={`absolute w-10 h-10 rounded-full bg-white dark:bg-slate-800 border-[3px] ${TILE_BORDER[tile.kind]} flex items-center justify-center text-base shadow`}
                style={{ left: tileX(tile.index), top: tileY(tile.index), transform: "translate(-50%,-50%)" }}
              >
                {TILE_ICON[tile.kind]}
              </div>
            ))}

            {players.map((p, i) => (
              <div
                key={p.userId}
                className="absolute w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 shadow flex items-center justify-center text-[10px] font-extrabold text-white transition-all duration-500"
                style={{
                  left: tileX(p.position) + (i % 2 === 0 ? -8 : 8),
                  top: tileY(p.position) - 26 - Math.floor(i / 2) * 16,
                  backgroundColor: p.userId === currentPlayerId ? "#0f4a85" : "#64748b",
                }}
                title={p.displayName}
              >
                {p.displayName.slice(0, 1).toUpperCase()}
              </div>
            ))}
          </div>

          <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
            <button className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold shadow" onClick={() => zoomButton(1.25)}>
              +
            </button>
            <button className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold shadow" onClick={() => zoomButton(1 / 1.25)}>
              −
            </button>
          </div>
        </div>

        {!card && !reveal && !eventResult && myTurn && (
          <div className="card flex flex-col items-center gap-3">
            {diceMode === "DIGITAL" ? (
              <>
                <button className="btn-primary" disabled={rolling} onClick={rollDice}>
                  {t("familyGame.roll")}
                </button>
                {lastRoll !== null && <p className="font-extrabold text-lg">{t("familyGame.youRolled", { n: lastRoll })}</p>}
                {showTip && <p className="text-xs text-slate-400 dark:text-slate-500">{t("familyGame.tipDigital")}</p>}
              </>
            ) : (
              <>
                <p className="font-bold">{t("familyGame.howMany")}</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      className={`w-11 h-11 rounded-xl border-2 font-extrabold ${
                        physicalChoice === n ? "border-brand-500 bg-brand-50 dark:bg-slate-700" : "border-slate-200 dark:border-slate-600"
                      }`}
                      onClick={() => enterPhysicalRoll(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {showTip && <p className="text-xs text-slate-400 dark:text-slate-500">{t("familyGame.tipPhysical")}</p>}
              </>
            )}
          </div>
        )}

        {!myTurn && !card && !reveal && !eventResult && (
          <p className="text-center text-slate-400 dark:text-slate-500">{t("familyGame.waitingRoll", { name: currentPlayer?.displayName ?? "" })}</p>
        )}

        {/* Alleen de speler (of, voor een gast, de host) die aan de beurt is
            krijgt hier interactieve knoppen — anders zou elk ander apparaat
            in de room hetzelfde antwoordscherm tonen zonder dat een klik daar
            iets doet (de server keurt zo'n actie toch af, zie canActFor). */}
        {card && !myTurn && !reveal && !eventResult && (
          <p className="text-center text-slate-400 dark:text-slate-500">
            {t("familyGame.answering", { name: currentPlayer?.displayName ?? "" })}
          </p>
        )}

        {card && myTurn && card.tileKind !== "EVENT" && !reveal && (
          <div className="card flex flex-col gap-4">
            {showTip && (
              <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
                {card.tileKind === "KNOWLEDGE" ? t("familyGame.tipKnowledge") : t("familyGame.tipFillIn")}
              </p>
            )}
            {card.tileKind === "WHERE_IN_BOOK" ? (
              <>
                <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("familyGame.whereInBook")}</p>
                <p className="text-lg italic leading-relaxed">&ldquo;{card.introText}&rdquo;</p>
                <IntroAudioButton audio={card.introAudio} />
                <div className="grid grid-cols-2 gap-3">
                  {card.options.map((opt) => (
                    <button
                      key={opt.chapterId}
                      onClick={() => setGiven([opt.chapterId])}
                      className={`btn text-left border-2 ${
                        given[0] === opt.chapterId
                          ? "bg-brand-500 text-white border-brand-500"
                          : "bg-white dark:bg-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-600"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            ) : card.type === "WORD_BANK" ? (
              <WordBankCard card={card} given={given} setGiven={setGiven} />
            ) : (
              <>
                <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{card.verseRef}</p>
                <p className="text-lg leading-relaxed">{card.prompt}</p>
                {card.type === "TRUE_FALSE" ? (
                  <div className="flex gap-3">
                    <button
                      onClick={() => setGiven(["true"])}
                      className={`btn flex-1 border-2 ${given[0] === "true" ? "bg-brand-500 text-white border-brand-500" : "border-slate-200 dark:border-slate-600 dark:text-slate-100"}`}
                    >
                      {t("lesson.true")}
                    </button>
                    <button
                      onClick={() => setGiven(["false"])}
                      className={`btn flex-1 border-2 ${given[0] === "false" ? "bg-brand-500 text-white border-brand-500" : "border-slate-200 dark:border-slate-600 dark:text-slate-100"}`}
                    >
                      {t("lesson.false")}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {(card.options ?? []).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setGiven([opt])}
                        className={`btn text-left border-2 ${
                          given[0] === opt ? "bg-brand-500 text-white border-brand-500" : "bg-white dark:bg-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-600"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <button className="btn-primary self-end" disabled={given.length === 0} onClick={submitAnswer}>
              {t("lobby.send")}
            </button>
          </div>
        )}

        {card && myTurn && card.tileKind === "EVENT" && !eventResult && (
          <div className="card flex flex-col gap-4">
            {showTip && <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("familyGame.tipEvent")}</p>}
            <p className="text-lg font-bold">{translateServerText(card.title, t)}</p>
            <div className="flex flex-col gap-2">
              {card.choices.map((choice, i) => (
                <button key={choice} className="btn-secondary" onClick={() => chooseEvent(i)}>
                  {translateServerText(choice, t)}
                </button>
              ))}
            </div>
          </div>
        )}

        {reveal && (
          <div className={`card flex flex-col gap-2 ${reveal.correct ? "border-2 border-brand-500" : "border-2 border-red-300"}`}>
            <p className={`font-extrabold ${reveal.correct ? "text-brand-600 dark:text-brand-300" : "text-red-500"}`}>
              {reveal.correct ? t("familyGame.correct") : t("familyGame.wrong")}
            </p>
            {reveal.explanation && "correctLabel" in reveal.explanation && (
              <p className="text-sm text-slate-600 dark:text-slate-300">{t("familyGame.correctAnswer", { answer: reveal.explanation.correctLabel })}</p>
            )}
            {reveal.explanation && "verseRef" in reveal.explanation && (
              <div className="text-sm text-slate-600 dark:text-slate-300">
                <p className="font-bold">📖 {reveal.explanation.verseRef}</p>
                {reveal.explanation.verseText && <p className="italic mt-1">&ldquo;{reveal.explanation.verseText}&rdquo;</p>}
              </div>
            )}
          </div>
        )}

        {eventResult && (
          <div className="card flex flex-col gap-1">
            <p className="font-extrabold">{translateServerText(eventResult.label, t)}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {eventResult.delta > 0
                ? t("familyGame.points", { n: `+${eventResult.delta}` })
                : eventResult.delta < 0
                  ? t("familyGame.points", { n: eventResult.delta })
                  : t("familyGame.noEffect")}
            </p>
          </div>
        )}

        <FamilyScoreboard players={players} myUserId={myUserId} />
      </div>
    );
  }

  if (phase === "finished") {
    return (
      <div className="max-w-xl mx-auto flex flex-col gap-6 items-center">
        <h1 className="text-3xl font-extrabold text-brand-800 dark:text-brand-300">{t("familyGame.over")}</h1>
        <FamilyScoreboard players={players} myUserId={myUserId} showMedals />
        <Link href="/gezinsavond" className="btn-primary">
          {t("familyGame.again")}
        </Link>
      </div>
    );
  }

  return null;
}

function WordBankCard({
  card,
  given,
  setGiven,
}: {
  card: { prompt: string; wordBank?: string[] };
  given: string[];
  setGiven: (g: string[]) => void;
}) {
  const [placed, setPlaced] = useState<{ word: string; poolIndex: number }[]>([]);
  const t = useT();
  const pool = card.wordBank ?? [];
  const available = pool.map((word, poolIndex) => ({ word, poolIndex })).filter(({ poolIndex }) => !placed.some((p) => p.poolIndex === poolIndex));

  function place(word: string, poolIndex: number) {
    const next = [...placed, { word, poolIndex }];
    setPlaced(next);
    setGiven(next.map((p) => p.word));
  }
  function unplace(i: number) {
    const next = placed.filter((_, idx) => idx !== i);
    setPlaced(next);
    setGiven(next.map((p) => p.word));
  }

  return (
    <>
      <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("familyGame.fillIn")}</p>
      <p className="text-lg leading-relaxed">{card.prompt}</p>
      <div className="flex flex-wrap gap-2 min-h-[3rem] p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-700">
        {placed.map((p, i) => (
          <button key={i} onClick={() => unplace(i)} className="rounded-xl bg-brand-500 text-white px-3 py-1.5 font-bold">
            {p.word}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {available.map(({ word, poolIndex }) => (
          <button
            key={poolIndex}
            onClick={() => place(word, poolIndex)}
            className="rounded-xl bg-white dark:bg-slate-800 dark:text-slate-100 border-2 border-slate-200 dark:border-slate-600 px-3 py-1.5 font-bold"
          >
            {word}
          </button>
        ))}
      </div>
    </>
  );
}

function FamilyScoreboard({ players, myUserId, showMedals }: { players: FamilyPlayerView[]; myUserId: string; showMedals?: boolean }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const t = useT();
  return (
    <div className="card flex flex-col divide-y divide-slate-100 dark:divide-slate-700 w-full">
      {sorted.map((p, i) => (
        <div key={p.userId} className={`flex items-center justify-between py-2 ${p.userId === myUserId ? "font-extrabold" : ""}`}>
          <span className="flex items-center gap-2">
            {showMedals && i < 3 ? (
              <RankMedal
                rank={(i + 1) as 1 | 2 | 3}
                label={i === 0 ? t("profile.medalGold") : i === 1 ? t("profile.medalSilver") : t("profile.medalBronze")}
              />
            ) : <span>{i + 1}.</span>}
            <UserAvatar id={p.userId} handle={p.displayName} avatarEmoji={p.isGuest ? null : undefined} size="xs" />
            {p.displayName} {p.userId === myUserId && t("lobby.you")}
          </span>
          <span className="text-gold-600 font-bold">{p.score}</span>
        </div>
      ))}
    </div>
  );
}
