"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import FocusLayout from "@/components/versado/FocusLayout";
import { useCompanion } from "@/components/versado/PersonalMascot";
import QuickMissionaryLeaderboard from "./Leaderboard";
import { useT } from "@/components/I18nProvider";
import {
  FIRST_OBSTACLE_X, GAP_HEIGHT, HORIZONTAL_SPEED, MASCOT_X,
  OBSTACLE_WIDTH, PAIR_SPACING, PLAY_BOTTOM, PLAY_TOP, WORLD_HEIGHT, WORLD_WIDTH,
  collidesWithObstacle, createObstaclePair, isOutOfPlayZone, passedPair, stepPhysics,
  type ObstaclePair,
} from "@/lib/snelleZendeling/gameplay";

const ASSET_BASE = "/games/snelle-zendeling";
const MASCOT_RENDER_SIZE = 74;
const LAYER_CONFIG = [
  ["background-sky.png", 0], ["background-hills.png", 0.12], ["background-city.png", 0.2], ["background-landscape.png", 0.35],
] as const;

type Phase = "ready" | "running" | "dead" | "revive-question" | "revive-ready" | "finished";
interface RunView { runId: string; status: "IN_PROGRESS" | "DEAD_AWAITING_REVIVE" | "REVIVE_READY" | "FINISHED"; score: number; reviveUsed: boolean; reviveAvailable: boolean; reviveQuestion: { exerciseId: string; prompt: string; options: { id: string; label: string }[] } | null; dailyBest: number; allTimeBest: number }

function image(src: string) { const img = new Image(); img.src = `${ASSET_BASE}/${src}`; return img; }

export default function QuickMissionaryRunClient({ runId }: { runId: string }) {
  const t = useT();
  const router = useRouter();
  const { character } = useCompanion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>("ready");
  const yRef = useRef(270);
  const velocityRef = useRef(0);
  const worldOffsetRef = useRef(0);
  const obstaclesRef = useRef<ObstaclePair[]>([]);
  const scoreRef = useRef(0);
  const scoredRef = useRef(new Set<number>());
  const boostUntilRef = useRef(0);
  const safeUntilRef = useRef(0);
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});
  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState(false);

  const setCurrentPhase = useCallback((next: Phase) => { phaseRef.current = next; setPhase(next); }, []);

  useEffect(() => {
    fetch(`/api/snelle-zendeling/runs/${runId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: RunView) => {
        setView(data);
        scoreRef.current = data.score;
        setScore(data.score);
        if (data.status === "DEAD_AWAITING_REVIVE") setCurrentPhase("dead");
        if (data.status === "REVIVE_READY") setCurrentPhase("revive-ready");
        if (data.status === "FINISHED") setCurrentPhase("finished");
      })
      .catch(() => setError(true));
  }, [runId, setCurrentPhase]);

  useEffect(() => {
    const names = [...LAYER_CONFIG.map(([name]) => name), "foreground-ground.png", "obstacle-wall.png", "obstacle-rock.png", `${character}-snelle-zendeling-glide.png`, `${character}-snelle-zendeling-boost.png`];
    const loaded: Record<string, HTMLImageElement> = {};
    names.forEach((name) => { loaded[name] = image(name); });
    imagesRef.current = loaded;
  }, [character]);

  const draw = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    const drawRepeating = (name: string, factor: number, maxHeight?: number) => {
      const img = imagesRef.current[name];
      if (!img?.complete || !img.naturalWidth) return;
      const targetHeight = maxHeight ? WORLD_HEIGHT * maxHeight : WORLD_HEIGHT;
      const scale = maxHeight ? Math.max(WORLD_WIDTH / img.naturalWidth, targetHeight / img.naturalHeight) : Math.max(WORLD_WIDTH / img.naturalWidth, WORLD_HEIGHT / img.naturalHeight);
      const width = img.naturalWidth * scale;
      const height = img.naturalHeight * scale;
      const offset = -((worldOffsetRef.current * factor) % width);
      const y = WORLD_HEIGHT - height;
      for (let x = offset - width; x < WORLD_WIDTH + width; x += width - 1) ctx.drawImage(img, x, y, width, height);
    };
    for (const [name, factor] of LAYER_CONFIG) drawRepeating(name, factor);
    drawRepeating("foreground-ground.png", 0.75, 0.08);
    for (const pair of obstaclesRef.current) {
      const rock = imagesRef.current["obstacle-rock.png"];
      const wall = imagesRef.current["obstacle-wall.png"];
      if (rock?.complete && rock.naturalWidth) { const h = OBSTACLE_WIDTH * rock.naturalHeight / rock.naturalWidth; ctx.drawImage(rock, pair.x, pair.gapY - h, OBSTACLE_WIDTH, h); }
      if (wall?.complete && wall.naturalWidth) { const h = OBSTACLE_WIDTH * wall.naturalHeight / wall.naturalWidth; ctx.drawImage(wall, pair.x, pair.gapY + GAP_HEIGHT, OBSTACLE_WIDTH, h); }
    }
    const mascotName = `${character}-snelle-zendeling-${timestamp < boostUntilRef.current ? "boost" : "glide"}.png`;
    const mascot = imagesRef.current[mascotName];
    if (mascot?.complete && mascot.naturalWidth) ctx.drawImage(mascot, MASCOT_X, yRef.current, MASCOT_RENDER_SIZE, MASCOT_RENDER_SIZE);
  }, [character]);

  const finishFromDeath = useCallback(async () => {
    const response = await fetch(`/api/snelle-zendeling/runs/${runId}/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ score: scoreRef.current }) });
    if (!response.ok) setError(true);
    const viewResponse = await fetch(`/api/snelle-zendeling/runs/${runId}`, { cache: "no-store" });
    if (viewResponse.ok) setView(await viewResponse.json());
    setCurrentPhase("finished");
  }, [runId, setCurrentPhase]);

  const die = useCallback(async () => {
    if (phaseRef.current !== "running") return;
    setCurrentPhase("dead");
    const response = await fetch(`/api/snelle-zendeling/runs/${runId}/death`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ score: scoreRef.current }) });
    if (!response.ok) { setError(true); return; }
    const viewResponse = await fetch(`/api/snelle-zendeling/runs/${runId}`, { cache: "no-store" });
    if (viewResponse.ok) setView(await viewResponse.json());
  }, [runId, setCurrentPhase]);

  const loopRef = useRef<(timestamp: number) => void>(() => {});
  const loop = useCallback((timestamp: number) => {
    const previous = lastFrameRef.current ?? timestamp;
    const dt = Math.min(0.05, Math.max(0, (timestamp - previous) / 1000));
    lastFrameRef.current = timestamp;
    if (phaseRef.current === "running") {
      const boosted = timestamp < boostUntilRef.current;
      const next = stepPhysics(yRef.current, velocityRef.current, dt, boosted);
      yRef.current = next.y;
      velocityRef.current = next.velocity;
      worldOffsetRef.current += HORIZONTAL_SPEED * dt;
      obstaclesRef.current = obstaclesRef.current.map((pair) => ({ ...pair, x: pair.x - HORIZONTAL_SPEED * dt }));
      const last = obstaclesRef.current.at(-1);
      if (last && last.x < WORLD_WIDTH - PAIR_SPACING) obstaclesRef.current.push(createObstaclePair(last.id + 1, last.x + PAIR_SPACING, Math.random, last.gapY));
      for (const pair of obstaclesRef.current) {
        if (passedPair(MASCOT_X, pair, scoredRef.current.has(pair.id))) { scoredRef.current.add(pair.id); scoreRef.current += 1; setScore(scoreRef.current); }
        if (timestamp >= safeUntilRef.current && (collidesWithObstacle({ x: MASCOT_X, y: yRef.current }, pair) || isOutOfPlayZone({ x: MASCOT_X, y: yRef.current }))) { void die(); break; }
      }
      obstaclesRef.current = obstaclesRef.current.filter((pair) => pair.x > -OBSTACLE_WIDTH - 2);
    }
    draw(timestamp);
    frameRef.current = requestAnimationFrame(loopRef.current);
  }, [die, draw]);

  useEffect(() => { loopRef.current = loop; frameRef.current = requestAnimationFrame(loop); return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); }; }, [loop]);

  const resetLocalRun = useCallback(() => {
    yRef.current = 270; velocityRef.current = 0; worldOffsetRef.current = 0; scoreRef.current = 0; setScore(0); scoredRef.current = new Set();
    const first = createObstaclePair(1, FIRST_OBSTACLE_X, Math.random);
    const second = createObstaclePair(2, FIRST_OBSTACLE_X + PAIR_SPACING, Math.random, first.gapY);
    obstaclesRef.current = [first, second, createObstaclePair(3, FIRST_OBSTACLE_X + PAIR_SPACING * 2, Math.random, second.gapY)];
  }, []);

  const repositionAfterRevive = useCallback(() => {
    yRef.current = (PLAY_TOP + PLAY_BOTTOM) / 2 - MASCOT_RENDER_SIZE / 2;
    velocityRef.current = 0;
    const first = createObstaclePair(1001, MASCOT_X + 170, () => 0.5);
    const second = createObstaclePair(1002, MASCOT_X + 170 + PAIR_SPACING, () => 0.5, first.gapY);
    obstaclesRef.current = [first, second, createObstaclePair(1003, MASCOT_X + 170 + PAIR_SPACING * 2, () => 0.5, second.gapY)];
  }, []);

  const action = useCallback(async () => {
    if (phaseRef.current === "ready") { resetLocalRun(); setCurrentPhase("running"); boostUntilRef.current = performance.now() + 180; velocityRef.current = -285; return; }
    if (phaseRef.current === "revive-ready") {
      const response = await fetch(`/api/snelle-zendeling/runs/${runId}/resume`, { method: "POST" });
      if (response.ok) { safeUntilRef.current = performance.now() + 3000; setCurrentPhase("running"); boostUntilRef.current = performance.now() + 180; velocityRef.current = -285; }
    }
  }, [resetLocalRun, runId, setCurrentPhase]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.code === "Space" || event.code === "ArrowUp") { event.preventDefault(); void action(); } };
    window.addEventListener("keydown", key, { passive: false });
    return () => window.removeEventListener("keydown", key);
  }, [action]);

  async function requestRevive() { const response = await fetch(`/api/snelle-zendeling/runs/${runId}/revive`, { method: "POST" }); if (response.ok) { setView(await response.json()); setCurrentPhase("revive-question"); } else setError(true); }
  async function answer(optionId: string) { if (!view?.reviveQuestion) return; const response = await fetch(`/api/snelle-zendeling/runs/${runId}/revive/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ exerciseId: view.reviveQuestion.exerciseId, optionId }) }); if (!response.ok) { setError(true); return; } const result = await response.json() as { correct: boolean; view: RunView }; setView(result.view); if (result.correct) { repositionAfterRevive(); setCurrentPhase("revive-ready"); } else setCurrentPhase("finished"); }
  async function playAgain() { const response = await fetch("/api/snelle-zendeling/runs", { method: "POST" }); const data = await response.json().catch(() => ({})); if (response.ok && data.runId) router.push(`/snelle-zendeling/run/${data.runId}`); }

  const title = t("pages.quickMissionary");
  return (
    <FocusLayout className="max-w-3xl items-center gap-3 py-2 sm:gap-4 sm:py-4">
      <div className="flex w-full items-center justify-between gap-3 px-1"><h1 className="truncate text-lg font-black text-vs-fg">{title}</h1><span className="rounded-full bg-vs-accent-soft px-4 py-1.5 text-xl font-black tabular-nums text-vs-accent" aria-live="polite">{score}</span></div>
      <div className="relative w-full max-w-[min(90vw,28rem)] overflow-hidden rounded-[2rem] border-4 border-vs-line-strong bg-sky-100 shadow-xl dark:bg-sky-950" style={{ aspectRatio: `${WORLD_WIDTH}/${WORLD_HEIGHT}` }}>
        <canvas ref={canvasRef} width={WORLD_WIDTH} height={WORLD_HEIGHT} aria-label={t("quickMissionary.gameArea")} className="block h-full w-full touch-none" onPointerDown={(event) => { event.preventDefault(); void action(); }} />
        {phase === "ready" && <Overlay><p className="text-lg font-black">{t("quickMissionary.tapToFly")}</p><p className="text-sm">{t("quickMissionary.readyHint")}</p></Overlay>}
        {phase === "dead" && <Overlay><p className="text-2xl font-black">{t("quickMissionary.secondChance")}</p><p>{t("quickMissionary.scoreLabel", { n: score })}</p><div className="flex flex-wrap justify-center gap-2"><button type="button" className="btn-primary" onClick={() => void requestRevive()} disabled={view?.reviveUsed}>{t("quickMissionary.revive")}</button><button type="button" className="btn-secondary" onClick={() => void finishFromDeath()}>{t("quickMissionary.endRun")}</button></div></Overlay>}
        {phase === "revive-question" && view?.reviveQuestion && <Overlay><p className="text-lg font-black">{t("quickMissionary.reviveQuestion")}</p><p className="text-sm">{view.reviveQuestion.prompt}</p><div className="grid w-full gap-2">{view.reviveQuestion.options.map((option) => <button key={option.id} type="button" className="btn-secondary !justify-start !text-left" onClick={() => void answer(option.id)}>{option.label}</button>)}</div></Overlay>}
        {phase === "revive-ready" && <Overlay><p className="text-lg font-black text-vs-success">{t("quickMissionary.reviveCorrect")}</p><p>{t("quickMissionary.tapToContinue")}</p></Overlay>}
        {phase === "finished" && <Overlay><p className="text-2xl font-black">{t("quickMissionary.gameOver")}</p><p>{t("quickMissionary.scoreLabel", { n: view?.score ?? score })}</p><p className="text-sm">{t("quickMissionary.dailyBest", { n: view?.dailyBest ?? 0 })} · {t("quickMissionary.allTimeBest", { n: view?.allTimeBest ?? 0 })}</p><div className="flex flex-wrap justify-center gap-2"><button type="button" className="btn-primary" onClick={() => void playAgain()}>{t("quickMissionary.playAgain")}</button><Link className="btn-secondary" href="/snelle-zendeling">{t("quickMissionary.viewRanking")}</Link></div></Overlay>}
      </div>
      {error && <p className="text-sm font-semibold text-red-600 dark:text-red-400">{t("quickMissionary.connectionError")}</p>}
      <p className="text-center text-xs text-vs-fg-3">{phase === "running" ? t("quickMissionary.runningHint") : t("quickMissionary.noXp")}</p>
      {phase === "finished" && <QuickMissionaryLeaderboard compact />}
    </FocusLayout>
  );
}

function Overlay({ children }: { children: ReactNode }) { return <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/50 p-5 text-center text-white backdrop-blur-[2px]">{children}</div>; }
