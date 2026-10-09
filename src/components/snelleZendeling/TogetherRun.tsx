"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Socket } from "socket.io-client";
import ImmersiveLayout from "@/components/versado/ImmersiveLayout";
import UserAvatar from "@/components/UserAvatar";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import type { PersonalMascotCharacter } from "@/lib/mascots";
import { PLAY_ROUTE } from "@/lib/navigation";
import { invalidateData } from "@/lib/data/client";
import { announceXpChanged } from "@/lib/xpBroadcast";
import { DeathPanel, ReviveFailurePanel, ReviveQuestionPanel, type DeathOptionView, type ReviveQuestionView, type ReviveReadingView } from "@/components/snelleZendeling/RevivePanels";
import { drawScene, loadSceneImages, type SceneImages, type SceneMascot } from "@/components/snelleZendeling/scene";
import { applyGhostSnapshot, applyGhostState, newGhost, remainingOthers, stepGhost, viewModeFor, type GhostPose } from "@/lib/snelleZendeling/ghostState";
import { estimateClockOffset, type ClockSample } from "@/lib/snelleZendeling/clock";
import { survivalOrder } from "@/lib/snelleZendeling/matchRules";
import type { MatchView } from "@/lib/snelleZendeling/match";
import { createSharedWorld, distanceAt, passedPairsAtDistance } from "@/lib/snelleZendeling/sharedWorld";
import { BOOST_VELOCITY, MASCOT_RENDER_SIZE, MASCOT_X, PLAY_BOTTOM, PLAY_TOP, WORLD_HEIGHT, WORLD_WIDTH, collidesWithObstacle, isOutOfPlayZone, passedPair, stepPhysics } from "@/lib/snelleZendeling/gameplay";

// De gezamenlijke run zelf (Samen spelen). De wereld, de tijdlijn en wie nog meedoet
// komen van de server (match.ts); de eigen physics draaien lokaal, net als solo.
// Alle spelers zien exact dezelfde obstakels op dezelfde tijdlijn (seed + servertijd).
// De anderen zijn doorzichtige ghosts: ze botsen niet en geven geen score.
// De uitslag (dood, Genees, opgeven, einde, laatste twee) bepaalt alleen de server.

type LocalPhase = "countdown" | "running" | "dead" | "revive-question" | "revive-ready";

interface RunView {
  runId: string;
  status: "IN_PROGRESS" | "DEAD_AWAITING_REVIVE" | "REVIVE_READY" | "FINISHED";
  score: number;
  reviveUsed: boolean;
  reviveAvailable: boolean;
  deathOption: DeathOptionView;
  geneesBalance: number;
  geneesPriceXp: number;
  xpTotal: number;
  canAffordGenees: boolean;
  inGamePurchaseUsed: boolean;
  reviveQuestion: ReviveQuestionView | null;
  reviveReading: ReviveReadingView | null;
}

const CLOCK_SAMPLES = 5;
const CLOCK_RESYNC_MS = 30_000;
const POS_INTERVAL_MS = 100;
const BEAT_INTERVAL_MS = 2_000;
/** Een frame dat zo lang wegblijft (verborgen tabblad, bevroren toestel) is geen besturing meer: dat is een botsing. */
const STALL_SECONDS = 1;
const SAFE_SECONDS_AFTER_REVIVE = 3;
const SUBSTEP_SECONDS = 1 / 60;
/** Dekking van een ghost naast je eigen mascotte, en als je zelf alleen kijkt (dan zijn zij de hoofdzaak). */
const GHOST_OPACITY = 0.4;
const SPECTATOR_GHOST_OPACITY = 0.85;

export default function TogetherRun({ match, myUserId, character, socket }: { match: MatchView; myUserId: string; character: PersonalMascotCharacter; socket: Socket }) {
  const t = useT();
  const confirm = useConfirm();
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<SceneImages>({});
  const matchRef = useRef(match);
  const phaseRef = useRef<LocalPhase>("countdown");
  const outRef = useRef(false);
  const yRef = useRef(270);
  const velocityRef = useRef(0);
  const scoreRef = useRef(0);
  const scoredRef = useRef(new Set<number>());
  const boostUntilRef = useRef(0);
  const lastTimelineRef = useRef<number | null>(null);
  const safeUntilRef = useRef(0);
  const clockOffsetRef = useRef<number | null>(null);
  const clockSyncedAtRef = useRef(0);
  const clockSyncingRef = useRef(false);
  const lastPosRef = useRef(0);
  const lastBeatRef = useRef(0);
  const ghostsRef = useRef(new Map<string, GhostPose>());
  const lifeRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const shownGhostsRef = useRef(-1);
  const startsAtRef = useRef(Date.parse(match.startsAt));
  const purchaseConfirmationRef = useRef(false);
  const world = useMemo(() => createSharedWorld(match.seed), [match.seed]);

  const me = match.participants.find((p) => p.userId === myUserId) ?? null;
  const runId = me?.runId ?? null;
  const mode = viewModeFor(me?.state, match.status);
  const ended = mode === "result";
  const out = mode !== "play" || !me;

  const [phase, setPhase] = useState<LocalPhase>("countdown");
  const [score, setScore] = useState(me?.score ?? 0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState(false);
  const [geneesBusy, setGeneesBusy] = useState(false);
  const [geneesError, setGeneesError] = useState<string | null>(null);

  const setLocalPhase = useCallback((next: LocalPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // De stand van de server leeft in refs voor de spellus.
  useEffect(() => {
    matchRef.current = match;
    startsAtRef.current = Date.parse(match.startsAt);
    // Tot er een echte klokmeting is: de servertijd uit dit bericht (fout = één enkele latency).
    if (clockOffsetRef.current === null) clockOffsetRef.current = Date.parse(match.serverNow) - Date.now();
    outRef.current = out;
  }, [match, out]);

  // Nieuwe/andere gids-sprites voor iedereen die meedoet.
  // De sprites worden alleen opnieuw bepaald als de verzameling gidsen echt verandert; elke
  // statuswijziging van een speler geeft een nieuwe participantenlijst en mag de wereld
  // nooit laten flitsen doordat afbeeldingen opnieuw geladen worden.
  const charactersKey = useMemo(() => [...new Set<PersonalMascotCharacter>([character, ...match.participants.map((p) => p.character)])].sort().join(","), [character, match.participants]);
  useEffect(() => {
    imagesRef.current = loadSceneImages(charactersKey.split(",") as PersonalMascotCharacter[]);
  }, [charactersKey]);

  // --- Klok -------------------------------------------------------------------------
  const syncClock = useCallback(() => {
    if (clockSyncingRef.current) return;
    clockSyncingRef.current = true;
    const samples: ClockSample[] = [];
    const measure = (remaining: number) => {
      const sentAt = Date.now();
      socket.timeout(3_000).emit("qm:clock", (err: Error | null, res?: { now: number }) => {
        if (!err && res) samples.push({ sentAt, receivedAt: Date.now(), serverNow: res.now });
        if (remaining > 1) return measure(remaining - 1);
        const offset = estimateClockOffset(samples);
        if (offset !== null) clockOffsetRef.current = offset;
        clockSyncedAtRef.current = performance.now();
        clockSyncingRef.current = false;
      });
    };
    measure(CLOCK_SAMPLES);
  }, [socket]);

  useEffect(() => {
    syncClock();
    socket.on("connect", syncClock);
    return () => {
      socket.off("connect", syncClock);
    };
  }, [socket, syncClock]);

  // --- Ghosts -------------------------------------------------------------------------
  useEffect(() => {
    const onGhosts = ({ g }: { g: [string, number, number, number, number][] }) => {
      const now = performance.now();
      for (const [userId, y, , boost, life] of g) {
        if (userId === myUserId) continue;
        const known = ghostsRef.current.get(userId);
        // Zonder bekende deelnemer (nog) geen ghost; de toestand beslist of een momentopname telt.
        if (known) ghostsRef.current.set(userId, applyGhostSnapshot(known, { y, boost: boost === 1, life }, now));
      }
    };
    socket.on("qm:ghosts", onGhosts);
    return () => {
      socket.off("qm:ghosts", onGhosts);
    };
  }, [socket, myUserId]);

  /** Instappen in de gezamenlijke wereld op tijdstip `t` (na de start, na Genees of na herverbinden). */
  const enterRunning = useCallback(
    (timeline: number, currentScore: number) => {
      yRef.current = (PLAY_TOP + PLAY_BOTTOM) / 2 - MASCOT_RENDER_SIZE / 2;
      velocityRef.current = 0;
      lastTimelineRef.current = timeline;
      // Een nieuw life-nummer laat de anderen deze mascotte als verse start tonen (geen doorschuiven vanaf een oude positie).
      lifeRef.current += 1;
      // Wat de wereld al gepasseerd is levert nooit punten op: de score telt alleen wat je zelf vliegt.
      const passed = passedPairsAtDistance(distanceAt(timeline));
      for (let id = 1; id <= passed; id++) scoredRef.current.add(id);
      scoreRef.current = currentScore;
      safeUntilRef.current = timeline + SAFE_SECONDS_AFTER_REVIVE;
      boostUntilRef.current = performance.now() + 180;
      velocityRef.current = BOOST_VELOCITY;
      setLocalPhase("running");
    },
    [setLocalPhase]
  );

  // --- Eigen run: begintoestand (ook na herladen of herverbinden) ------------------------
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    fetch(`/api/snelle-zendeling/runs/${runId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: RunView) => {
        if (cancelled) return;
        setView(data);
        scoreRef.current = data.score;
        setScore(data.score);
        if (data.status === "DEAD_AWAITING_REVIVE") setLocalPhase(data.reviveQuestion ? "revive-question" : "dead");
        else if (data.status === "REVIVE_READY") setLocalPhase("revive-ready");
        else if (data.status === "IN_PROGRESS") {
          // Herladen of herverbinden midden in de run: de wereld loopt door op de tijdlijn, de eigen positie niet.
          const t0 = (Date.now() + (clockOffsetRef.current ?? 0) - startsAtRef.current) / 1000;
          if (t0 > 0) enterRunning(t0, data.score);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // --- Dood, Genees, opgeven (allemaal via de server) -----------------------------------
  const refreshView = useCallback(async () => {
    if (!runId) return;
    const response = await fetch(`/api/snelle-zendeling/runs/${runId}`, { cache: "no-store" });
    if (response.ok) setView(await response.json());
  }, [runId]);

  const finishFromDeath = useCallback(async () => {
    if (!runId) return;
    const response = await fetch(`/api/snelle-zendeling/runs/${runId}/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ score: scoreRef.current }) });
    if (!response.ok) setError(true);
    await refreshView();
    socket.emit("qm:sync");
  }, [runId, refreshView, socket]);

  const die = useCallback(async () => {
    if (phaseRef.current !== "running" || !runId) return;
    setView(null);
    setLocalPhase("dead");
    const response = await fetch(`/api/snelle-zendeling/runs/${runId}/death`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ score: scoreRef.current }) });
    if (!response.ok) {
      setError(true);
      return;
    }
    await refreshView();
  }, [runId, refreshView, setLocalPhase]);

  // Geen Genees mogelijk: de dood is meteen definitief.
  useEffect(() => {
    // finishFromDeath wacht eerst op de server; er wordt hier niet synchroon gerenderd.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (phase === "dead" && view && !view.reviveAvailable && !out) void finishFromDeath();
  }, [phase, view, out, finishFromDeath]);

  const resume = useCallback(async () => {
    if (!runId || phaseRef.current !== "revive-ready") return;
    const response = await fetch(`/api/snelle-zendeling/runs/${runId}/resume`, { method: "POST" });
    if (!response.ok) return;
    const timeline = (Date.now() + (clockOffsetRef.current ?? 0) - startsAtRef.current) / 1000;
    enterRunning(timeline, scoreRef.current);
  }, [runId, enterRunning]);

  const action = useCallback(() => {
    if (phaseRef.current === "running" && !outRef.current) {
      boostUntilRef.current = performance.now() + 180;
      velocityRef.current = BOOST_VELOCITY;
    } else if (phaseRef.current === "revive-ready") void resume();
  }, [resume]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", key, { passive: false });
    return () => window.removeEventListener("keydown", key);
  }, [action]);

  async function requestRevive() {
    if (!runId) return;
    setGeneesBusy(true);
    setGeneesError(null);
    try {
      const response = await fetch(`/api/snelle-zendeling/runs/${runId}/revive`, { method: "POST" });
      if (response.ok) {
        setView(await response.json());
        setLocalPhase("revive-question");
        invalidateData("gamesChanged");
      } else if (response.status === 409) void finishFromDeath();
      else setError(true);
    } finally {
      setGeneesBusy(false);
    }
  }

  async function buyGeneesAndRevive() {
    if (!runId || geneesBusy) return;
    setGeneesBusy(true);
    setGeneesError(null);
    try {
      const response = await fetch(`/api/snelle-zendeling/runs/${runId}/genees`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setGeneesError(typeof body.error === "string" ? body.error : t("quickMissionary.healBuyFailed"));
        await refreshView();
        return;
      }
      announceXpChanged();
      setView(body);
    } finally {
      setGeneesBusy(false);
    }
    await requestRevive();
  }

  async function confirmGeneesPurchase() {
    if (!view || geneesBusy || purchaseConfirmationRef.current) return;
    purchaseConfirmationRef.current = true;
    try {
      const accepted = await confirm(t("quickMissionary.healBuyConfirm", { xp: view.geneesPriceXp }), {
        title: t("quickMissionary.healBuyConfirmTitle"),
        confirmLabel: t("quickMissionary.healBuyConfirmAction", { xp: view.geneesPriceXp }),
      });
      if (accepted) await buyGeneesAndRevive();
    } finally {
      purchaseConfirmationRef.current = false;
    }
  }

  async function answer(optionId: string) {
    if (!runId || !view?.reviveQuestion) return;
    const response = await fetch(`/api/snelle-zendeling/runs/${runId}/revive/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ exerciseId: view.reviveQuestion.exerciseId, optionId }) });
    if (!response.ok) {
      // Bv. de run is intussen afgesloten: de stand van de server beslist.
      await refreshView();
      socket.emit("qm:sync");
      return;
    }
    const result = (await response.json()) as { correct: boolean; view: RunView };
    setView(result.view);
    if (result.correct) setLocalPhase("revive-ready");
  }

  // --- De spellus ----------------------------------------------------------------------------
  const loopRef = useRef<(timestamp: number) => void>(() => {});
  const loop = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const nowServer = Date.now() + (clockOffsetRef.current ?? 0);
      const timeline = (nowServer - startsAtRef.current) / 1000;
      const current = matchRef.current;
      const phaseNow = phaseRef.current;

      if (timestamp - clockSyncedAtRef.current > CLOCK_RESYNC_MS) syncClock();

      if (!outRef.current && phaseNow === "countdown") {
        if (timeline >= 0) enterRunning(0, scoreRef.current);
        else setCountdown(Math.ceil(-timeline));
      }

      if (!outRef.current && phaseRef.current === "running" && lastTimelineRef.current !== null) {
        const previous = lastTimelineRef.current;
        if (timeline - previous > STALL_SECONDS) {
          // De speler was niet aan het sturen: dat telt als een botsing.
          lastTimelineRef.current = timeline;
          void die();
        } else if (timeline > previous) {
          const steps = Math.max(1, Math.ceil((timeline - previous) / SUBSTEP_SECONDS));
          const dt = (timeline - previous) / steps;
          let crashed = false;
          for (let i = 1; i <= steps && !crashed; i++) {
            const at = previous + dt * i;
            const next = stepPhysics(yRef.current, velocityRef.current, dt);
            yRef.current = next.y;
            velocityRef.current = next.velocity;
            const pairs = world.visiblePairs(distanceAt(at));
            for (const pair of pairs) {
              if (passedPair(MASCOT_X, pair, scoredRef.current.has(pair.id))) {
                scoredRef.current.add(pair.id);
                scoreRef.current += 1;
                setScore(scoreRef.current);
              }
              if (at >= safeUntilRef.current && (collidesWithObstacle({ x: MASCOT_X, y: yRef.current }, pair) || isOutOfPlayZone({ x: MASCOT_X, y: yRef.current }))) {
                crashed = true;
                break;
              }
            }
          }
          lastTimelineRef.current = timeline;
          if (crashed) void die();
        }
      }

      // Positie en teken van leven naar de server (alleen visueel resp. voor wegvallen).
      if (!outRef.current && current.status === "RUNNING") {
        if (phaseRef.current === "running" && timestamp - lastPosRef.current >= POS_INTERVAL_MS) {
          lastPosRef.current = timestamp;
          socket.volatile.emit("qm:pos", { y: yRef.current, score: scoreRef.current, boost: timestamp < boostUntilRef.current, life: lifeRef.current });
        } else if (phaseRef.current !== "running" && timestamp - lastBeatRef.current >= BEAT_INTERVAL_MS) {
          lastBeatRef.current = timestamp;
          socket.emit("qm:beat");
        }
      }

      if (ctx) {
        const distance = distanceAt(Math.max(0, timeline));
        const ghosts: SceneMascot[] = [];
        const dt = lastFrameRef.current === null ? 0 : (timestamp - lastFrameRef.current) / 1000;
        const spectating = outRef.current && current.status === "RUNNING";
        for (const p of current.participants) {
          if (p.userId === myUserId) continue;
          // Eén ghost per deelnemer voor de hele wedstrijd; de toestand bepaalt alleen de weergave.
          let ghost = ghostsRef.current.get(p.userId) ?? newGhost(p.state);
          ghost = stepGhost(applyGhostState(ghost, p.state), dt, timestamp);
          ghostsRef.current.set(p.userId, ghost);
          if (ghost.alpha > 0.01) ghosts.push({ character: p.character, y: ghost.y, boost: ghost.boost, alpha: ghost.alpha * (spectating ? SPECTATOR_GHOST_OPACITY : GHOST_OPACITY) });
        }
        if (stageRef.current && shownGhostsRef.current !== ghosts.length) {
          shownGhostsRef.current = ghosts.length;
          stageRef.current.dataset.togetherGhosts = String(ghosts.length);
        }
        const showMe = !outRef.current && phaseRef.current === "running";
        drawScene(ctx, imagesRef.current, {
          offset: distance,
          pairs: world.visiblePairs(distance),
          ghosts,
          me: showMe ? { character, y: yRef.current, boost: timestamp < boostUntilRef.current } : null,
        });
      }
      lastFrameRef.current = timestamp;
      requestAnimationFrame(loopRef.current);
    },
    [character, die, enterRunning, myUserId, socket, syncClock, world]
  );
  useEffect(() => {
    loopRef.current = loop;
    const frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [loop]);

  // De stap "Opnieuw samen vliegen": een nieuwe lobby.
  async function playAgain() {
    const response = await fetch("/api/snelle-zendeling/together", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (response.ok && typeof data.code === "string") router.replace(`/live/${data.code}`);
  }

  // Stabiele volgorde en geen sortering op score: wisselen tussen vliegen en Genees verspringt niets.
  const flyingOthers = remainingOthers(match.participants, myUserId);
  const flying = match.participants.filter((p) => p.state === "ACTIVE" || p.state === "REVIVE_PENDING").length;
  const spectating = mode === "spectate";
  const displayScore = out && me ? me.score : score;

  return (
    <ImmersiveLayout className="items-center justify-center bg-slate-950 sm:p-4">
      <div
        className="relative h-[100dvh] w-full overflow-hidden bg-sky-100 dark:bg-sky-950 sm:h-[min(48rem,calc(100dvh-2rem))] sm:w-auto sm:max-w-[calc(100vw-2rem)] sm:aspect-[9/16] sm:rounded-[2rem] sm:border-4 sm:border-vs-line-strong sm:shadow-xl"
        ref={stageRef}
        data-together-stage
        data-together-phase={ended ? "ended" : spectating ? "spectator" : phase}
        data-together-match={match.matchId}
        data-client-ready={view || out ? "true" : "false"}
      >
        <canvas ref={canvasRef} width={WORLD_WIDTH} height={WORLD_HEIGHT} data-mascot={character} className="block h-full w-full touch-none" onPointerDown={(event) => { event.preventDefault(); action(); }} />
        <span className="pointer-events-none absolute right-[calc(var(--vs-safe-area-right)+1rem)] top-[calc(var(--vs-safe-area-top)+0.75rem)] z-30 min-w-10 rounded-full bg-slate-950/45 px-3 py-1.5 text-center text-xl font-black tabular-nums text-white shadow-sm backdrop-blur-sm" aria-live="polite" data-game-score>{displayScore}</span>
        <div className="pointer-events-none absolute left-[calc(var(--vs-safe-area-left)+0.75rem)] top-[calc(var(--vs-safe-area-top)+0.75rem)] z-30 flex max-w-[55%] flex-col gap-1" data-together-hud>
          {!ended && <span className="w-fit rounded-full bg-slate-950/45 px-2.5 py-1 text-xs font-extrabold text-white backdrop-blur-sm" data-together-flying>{t("quickMissionary.together.flyingCount", { n: flying })}</span>}
          {flyingOthers.slice(0, 4).map((p) => (
            <span key={p.userId} data-together-chip={p.userId} className={`flex w-fit items-center gap-1.5 rounded-full bg-slate-950/35 py-0.5 pl-0.5 pr-2 text-[0.7rem] font-bold text-white/90 backdrop-blur-sm transition-opacity duration-300 ${p.state === "ACTIVE" ? "" : "opacity-50"}`}>
              <UserAvatar id={p.userId} handle={p.handle} size="xs" />
              <span className="max-w-[6rem] truncate">{p.handle}</span>
              <span className="tabular-nums">{p.score}</span>
            </span>
          ))}
          {flyingOthers.length > 4 && <span className="w-fit rounded-full bg-slate-950/35 px-2 py-0.5 text-[0.7rem] font-bold text-white/80">{t("quickMissionary.together.more", { n: flyingOthers.length - 4 })}</span>}
        </div>

        {!out && phase === "countdown" && (
          <Overlay passive>
            <p className="text-lg font-black">{t("quickMissionary.together.getReady")}</p>
            <p className="text-6xl font-black tabular-nums" role="status" aria-live="assertive" data-together-countdown>{countdown !== null && countdown > 0 ? countdown : ""}</p>
          </Overlay>
        )}
        {!out && phase === "dead" && view?.reviveAvailable && (
          <Overlay><DeathPanel score={score} choice={view} busy={geneesBusy} error={geneesError} onUse={() => void requestRevive()} onBuy={() => void confirmGeneesPurchase()} onEnd={() => void finishFromDeath()} /></Overlay>
        )}
        {!out && phase === "revive-question" && view?.reviveQuestion && <Overlay><ReviveQuestionPanel question={view.reviveQuestion} onAnswer={(optionId) => void answer(optionId)} /></Overlay>}
        {!out && phase === "revive-ready" && (
          <button type="button" aria-label={t("quickMissionary.tapToContinue")} className="absolute inset-0 z-20 flex w-full flex-col items-center justify-center gap-3 bg-slate-950/50 px-5 text-center text-white backdrop-blur-[2px]" onClick={() => void resume()}>
            <p className="text-xl font-black text-emerald-300">{t("quickMissionary.reviveCorrect")}</p>
            <p>{t("quickMissionary.tapToContinue")}</p>
          </button>
        )}
        {spectating && (
          <div className="absolute inset-x-3 bottom-[calc(var(--vs-safe-area-bottom)+0.75rem)] z-30 flex flex-col gap-2 rounded-2xl bg-slate-950/70 p-3 text-white backdrop-blur-sm" data-together-spectator>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-black leading-tight" data-together-out>{t("quickMissionary.together.outTitle")}</p>
                <p className="text-xs leading-snug text-white/85">{t("quickMissionary.together.outHint")}</p>
                <p className="text-xs font-bold text-white/85" aria-live="polite">{t("quickMissionary.together.finalScore", { n: displayScore })} · {t("quickMissionary.together.flyingCount", { n: flying })}</p>
              </div>
              <Link replace className="btn-secondary shrink-0 !px-3 !py-1.5 !text-sm" href={PLAY_ROUTE}>{t("quickMissionary.together.stopWatching")}</Link>
            </div>
            {view?.reviveReading && <ReviveFailurePanel reading={view.reviveReading} />}
          </div>
        )}
        {ended && (
          <Overlay>
            {view?.reviveReading && <ReviveFailurePanel reading={view.reviveReading} />}
            <Results match={match} myUserId={myUserId} onPlayAgain={() => void playAgain()} />
          </Overlay>
        )}
        {error && <p className="absolute inset-x-4 bottom-[calc(var(--vs-safe-area-bottom)+1rem)] z-40 rounded-xl bg-red-950/90 p-3 text-center text-sm font-semibold text-white">{t("quickMissionary.connectionError")}</p>}
      </div>
    </ImmersiveLayout>
  );
}


function Overlay({ children, passive = false }: { children: ReactNode; passive?: boolean }) {
  return (
    <div className={`absolute inset-0 z-20 overflow-y-auto overscroll-contain text-white backdrop-blur-[2px] ${passive ? "pointer-events-none bg-slate-950/30" : "bg-slate-950/70"}`} data-game-overlay>
      <div className="flex min-h-full flex-col items-center justify-center gap-3 px-5 pb-[calc(var(--vs-safe-area-bottom)+1.25rem)] pt-[calc(var(--vs-safe-area-top)+4.25rem)] text-center">{children}</div>
    </div>
  );
}

/**
 * Uitslag: wie het langst meedeed staat vooraan; de laatste twee zijn gemarkeerd.
 * De Duo-score en -ranking staan in duoRanking.ts en bij de ranking van het spel.
 */
function Results({ match, myUserId, onPlayAgain }: { match: MatchView; myUserId: string; onPlayAgain: () => void }) {
  const t = useT();
  const ranked = survivalOrder(match.participants);
  const duoIds = new Set(match.duo ? [match.duo.userAId, match.duo.userBId] : []);
  const winner = match.endReason === "LAST_STANDING" ? ranked.find((p) => p.eliminatedSeq === null) : null;
  const mine = match.participants.find((p) => p.userId === myUserId);
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3" data-together-results>
      <p className="text-sm font-extrabold uppercase tracking-wide text-white/75">{t("quickMissionary.together.resultsTitle")}</p>
      <p className="text-xl font-black">{winner ? t("quickMissionary.together.winner", { name: winner.handle }) : t("quickMissionary.together.nobodyFlying")}</p>
      {mine && <p className="text-lg font-black" data-together-my-score>{t("quickMissionary.together.yourResult", { n: mine.score })}</p>}
      <ol className="w-full max-h-64 overflow-y-auto rounded-2xl bg-white/10 p-2 text-left text-sm">
        {ranked.map((p, index) => (
          <li key={p.userId} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${p.userId === myUserId ? "bg-white/15 font-black" : ""}`} data-together-rank={index + 1}>
            <span className="w-6 text-center tabular-nums">{index + 1}</span>
            <UserAvatar id={p.userId} handle={p.handle} size="xs" />
            <span className="min-w-0 flex-1 truncate">{p.handle}</span>
            {duoIds.has(p.userId) && <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[0.65rem] font-black text-amber-950" data-together-duo>{t("quickMissionary.together.duoTitle")}</span>}
            <span className="tabular-nums">{p.score}</span>
          </li>
        ))}
      </ol>
      <div className="grid w-full gap-3">
        <button type="button" className="btn-primary w-full" onClick={onPlayAgain}>{t("quickMissionary.together.playAgain")}</button>
        <Link replace className="btn-secondary w-full" href={PLAY_ROUTE}>{t("quickMissionary.backToGames")}</Link>
      </div>
    </div>
  );
}
