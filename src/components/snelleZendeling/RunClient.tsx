"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ImmersiveLayout from "@/components/versado/ImmersiveLayout";
import { useT } from "@/components/I18nProvider";
import type { PersonalMascotCharacter } from "@/lib/mascots";
import { quickMissionaryTitle } from "@/lib/gameCatalog";
import { quickMissionaryMascotSprite } from "@/lib/snelleZendeling/assets";
import {
  BOOST_VELOCITY, FIRST_OBSTACLE_X, GAP_HEIGHT, HORIZONTAL_SPEED, MASCOT_X,
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
interface RunView { runId: string; status: "IN_PROGRESS" | "DEAD_AWAITING_REVIVE" | "REVIVE_READY" | "FINISHED"; score: number; reviveUsed: boolean; reviveAvailable: boolean; reviveQuestion: { exerciseId: string; context: { kind: "chapter"; label: string } | null; prompt: string; options: { id: string; label: string }[] } | null; dailyBest: number; allTimeBest: number }

function image(src: string) { const img = new Image(); img.src = `${ASSET_BASE}/${src}`; return img; }

export default function QuickMissionaryRunClient({ runId, character }: { runId: string; character: PersonalMascotCharacter }) {
  const t = useT();
  const router = useRouter();
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
  const abandonSentRef = useRef(false);
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});
  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  const [view, setView] = useState<RunView | null>(null);
  const [initialAllTimeBest, setInitialAllTimeBest] = useState<number | null>(null);
  const [error, setError] = useState(false);

  const setCurrentPhase = useCallback((next: Phase) => { phaseRef.current = next; setPhase(next); }, []);

  useEffect(() => {
    fetch(`/api/snelle-zendeling/runs/${runId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: RunView) => {
        setView(data);
        setInitialAllTimeBest((current) => current ?? data.allTimeBest);
        scoreRef.current = data.score;
        setScore(data.score);
        if (data.status === "DEAD_AWAITING_REVIVE") setCurrentPhase("dead");
        if (data.status === "REVIVE_READY") setCurrentPhase("revive-ready");
        if (data.status === "FINISHED") setCurrentPhase("finished");
      })
      .catch(() => setError(true));
  }, [runId, setCurrentPhase]);

  // Browser- en native systeem-back lopen allebei via de geschiedenis. Een
  // keepalive-finish sluit de serverrun idempotent af zonder de navigatie te
  // vertragen; de server valideert score en eigenaarschap zoals altijd.
  useEffect(() => {
    const abandon = () => {
      if (phaseRef.current === "finished" || abandonSentRef.current) return;
      abandonSentRef.current = true;
      void fetch(`/api/snelle-zendeling/runs/${runId}/finish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ score: scoreRef.current }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", abandon);
    window.addEventListener("popstate", abandon);
    return () => {
      window.removeEventListener("pagehide", abandon);
      window.removeEventListener("popstate", abandon);
      // Next kan zijn popstate-listener eerder uitvoeren en deze component al
      // ontkoppelen. Wacht één taak: bij Reacts ontwikkel-remount staat exact
      // dezelfde runstage dan alweer in de DOM; bij echte navigatie niet.
      window.setTimeout(() => {
        if (!document.querySelector(`[data-quick-missionary-run="${runId}"]`)) abandon();
      }, 0);
    };
  }, [runId]);

  useEffect(() => {
    const names = [...LAYER_CONFIG.map(([name]) => name), "foreground-ground.png", "obstacle-wall.png", "obstacle-rock.png", quickMissionaryMascotSprite(character, "glide"), quickMissionaryMascotSprite(character, "boost")];
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
    const mascotName = quickMissionaryMascotSprite(character, timestamp < boostUntilRef.current ? "boost" : "glide");
    const mascot = imagesRef.current[mascotName];
    if (mascot?.complete && mascot.naturalWidth) ctx.drawImage(mascot, MASCOT_X, yRef.current, MASCOT_RENDER_SIZE, MASCOT_RENDER_SIZE);
  }, [character]);

  const finishFromDeath = useCallback(async () => {
    const response = await fetch(`/api/snelle-zendeling/runs/${runId}/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ score: scoreRef.current }) });
    if (!response.ok) setError(true);
    const viewResponse = await fetch(`/api/snelle-zendeling/runs/${runId}`, { cache: "no-store" });
    if (viewResponse.ok) setView(await viewResponse.json());
    abandonSentRef.current = true;
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
      const next = stepPhysics(yRef.current, velocityRef.current, dt);
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
    if (phaseRef.current === "ready") {
      resetLocalRun();
      setCurrentPhase("running");
      boostUntilRef.current = performance.now() + 180;
      velocityRef.current = BOOST_VELOCITY;
      return;
    }
    if (phaseRef.current === "running") {
      boostUntilRef.current = performance.now() + 180;
      velocityRef.current = BOOST_VELOCITY;
      return;
    }
    if (phaseRef.current === "revive-ready") {
      const response = await fetch(`/api/snelle-zendeling/runs/${runId}/resume`, { method: "POST" });
      if (response.ok) { safeUntilRef.current = performance.now() + 3000; setCurrentPhase("running"); boostUntilRef.current = performance.now() + 180; velocityRef.current = BOOST_VELOCITY; }
    }
  }, [resetLocalRun, runId, setCurrentPhase]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.code === "Space" || event.code === "ArrowUp") { event.preventDefault(); void action(); } };
    window.addEventListener("keydown", key, { passive: false });
    return () => window.removeEventListener("keydown", key);
  }, [action]);

  async function requestRevive() { const response = await fetch(`/api/snelle-zendeling/runs/${runId}/revive`, { method: "POST" }); if (response.ok) { setView(await response.json()); setCurrentPhase("revive-question"); } else setError(true); }
  async function answer(optionId: string) { if (!view?.reviveQuestion) return; const response = await fetch(`/api/snelle-zendeling/runs/${runId}/revive/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ exerciseId: view.reviveQuestion.exerciseId, optionId }) }); if (!response.ok) { setError(true); return; } const result = await response.json() as { correct: boolean; view: RunView }; setView(result.view); if (result.correct) { repositionAfterRevive(); setCurrentPhase("revive-ready"); } else { abandonSentRef.current = true; setCurrentPhase("finished"); } }
  async function playAgain() { const response = await fetch("/api/snelle-zendeling/runs", { method: "POST" }); const data = await response.json().catch(() => ({})); if (response.ok && data.runId) router.push(`/snelle-zendeling/run/${data.runId}`); }

  const title = quickMissionaryTitle(t, character);
  const finalScore = view?.score ?? score;
  const newRecord = phase === "finished" && initialAllTimeBest !== null && finalScore > initialAllTimeBest;
  return (
    <ImmersiveLayout className="items-center justify-center bg-slate-950 sm:p-4">
      <div
        className="relative h-[100dvh] w-full overflow-hidden bg-sky-100 dark:bg-sky-950 sm:h-[min(48rem,calc(100dvh-2rem))] sm:w-auto sm:max-w-[calc(100vw-2rem)] sm:aspect-[9/16] sm:rounded-[2rem] sm:border-4 sm:border-vs-line-strong sm:shadow-xl"
        data-quick-missionary-stage
        data-quick-missionary-run={runId}
        data-client-ready={view ? "true" : "false"}
      >
        <canvas ref={canvasRef} width={WORLD_WIDTH} height={WORLD_HEIGHT} data-mascot={character} aria-label={t("quickMissionary.gameArea", { title })} className="block h-full w-full touch-none" onPointerDown={(event) => { event.preventDefault(); void action(); }} />
        <span className="pointer-events-none absolute right-[calc(var(--vs-safe-area-right)+1rem)] top-[calc(var(--vs-safe-area-top)+0.75rem)] z-30 min-w-10 rounded-full bg-slate-950/45 px-3 py-1.5 text-center text-xl font-black tabular-nums text-white shadow-sm backdrop-blur-sm" aria-live="polite" data-game-score>{score}</span>
        {phase === "ready" && <ActionOverlay label={t("quickMissionary.tapToFly")} onAction={() => void action()}><p className="text-xl font-black">{t("quickMissionary.tapToFly")}</p><p className="text-sm sm:hidden">{t("quickMissionary.readyHint")}</p><p className="hidden text-sm sm:block">{t("quickMissionary.readyHintDesktop")}</p></ActionOverlay>}
        {phase === "dead" && <Overlay><p className="text-2xl font-black">{t("quickMissionary.heal")}</p><p>{t("quickMissionary.scoreLabel", { n: score })}</p><p className="max-w-sm text-sm">{t("quickMissionary.healIntro")}</p><div className="flex flex-wrap justify-center gap-2"><button type="button" className="btn-primary" onClick={() => void requestRevive()} disabled={view?.reviveUsed}>{t("quickMissionary.heal")}</button><button type="button" className="btn-secondary" onClick={() => void finishFromDeath()}>{t("quickMissionary.endRun")}</button></div></Overlay>}
        {phase === "revive-question" && view?.reviveQuestion && <Overlay><p className="text-2xl font-black">{t("quickMissionary.heal")}</p>{view.reviveQuestion.context && <p className="rounded-full bg-white/15 px-3 py-1 text-sm font-extrabold">{view.reviveQuestion.context.label}</p>}<p className="max-w-sm text-sm font-semibold">{t("quickMissionary.reviveQuestion")}</p><p className="max-w-sm text-base font-bold leading-snug">{view.reviveQuestion.prompt}</p><div className="grid w-full max-w-sm gap-3">{view.reviveQuestion.options.map((option) => <button key={option.id} type="button" className="btn-secondary min-h-12 w-full !h-auto !justify-start !whitespace-normal !px-4 !py-3 !text-left !text-sm !leading-snug !normal-case" onClick={() => void answer(option.id)}>{option.label}</button>)}</div></Overlay>}
        {phase === "revive-ready" && <ActionOverlay label={t("quickMissionary.tapToContinue")} onAction={() => void action()}><p className="text-xl font-black text-emerald-300">{t("quickMissionary.reviveCorrect")}</p><p>{t("quickMissionary.tapToContinue")}</p></ActionOverlay>}
        {phase === "finished" && <Overlay><p className="text-sm font-extrabold uppercase tracking-wide text-white/75">{title}</p><p className="text-3xl font-black">{t("quickMissionary.gameOver")}</p>{newRecord && <p className="rounded-full bg-amber-300 px-3 py-1 text-sm font-black text-amber-950">{t("quickMissionary.newRecord")}</p>}<p className="text-xl font-black">{t("quickMissionary.scoreLabel", { n: finalScore })}</p><div className="text-sm"><p>{t("quickMissionary.dailyBest", { n: view?.dailyBest ?? 0 })}</p><p>{t("quickMissionary.allTimeBest", { n: view?.allTimeBest ?? 0 })}</p></div><div className="grid w-full max-w-xs gap-3"><button type="button" className="btn-primary w-full" onClick={() => void playAgain()}>{t("quickMissionary.playAgain")}</button><Link className="btn-secondary w-full" href="/snelle-zendeling#quick-missionary-leaderboard">{t("quickMissionary.viewRanking")}</Link><Link className="btn-secondary w-full" href="/live">{t("quickMissionary.backToGames")}</Link></div></Overlay>}
        {error && <p className="absolute inset-x-4 bottom-[calc(var(--vs-safe-area-bottom)+1rem)] z-40 rounded-xl bg-red-950/90 p-3 text-center text-sm font-semibold text-white">{t("quickMissionary.connectionError")}</p>}
      </div>
    </ImmersiveLayout>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 z-20 overflow-y-auto overscroll-contain bg-slate-950/70 text-white backdrop-blur-[2px]" data-game-overlay><div className="flex min-h-full flex-col items-center justify-center gap-3 px-5 pb-[calc(var(--vs-safe-area-bottom)+1.25rem)] pt-[calc(var(--vs-safe-area-top)+4.25rem)] text-center">{children}</div></div>;
}

function ActionOverlay({ children, label, onAction }: { children: ReactNode; label: string; onAction: () => void }) {
  return <button type="button" aria-label={label} className="absolute inset-0 z-20 flex w-full flex-col items-center justify-center gap-3 bg-slate-950/50 px-5 pb-[calc(var(--vs-safe-area-bottom)+1rem)] pt-[calc(var(--vs-safe-area-top)+3.5rem)] text-center text-white backdrop-blur-[2px] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-[-6px] focus-visible:outline-white" onClick={onAction}>{children}</button>;
}
