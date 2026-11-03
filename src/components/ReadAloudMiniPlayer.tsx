"use client";

import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import { useReadAloudPlayer } from "@/lib/readAloudPlayerContext";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export default function ReadAloudMiniPlayer() {
  const t = useT();
  const { source, isPlaying, isPreparing, currentIndex, speed, togglePlay, previousVerse, nextVerse, stop, setSpeed } = useReadAloudPlayer();
  if (!source) return null;

  const currentVerse = source.verses[currentIndex];
  const progress = ((currentIndex + (isPlaying ? 1 : 0)) / source.verses.length) * 100;

  return (
    <div data-read-aloud-controls className="bg-brand-50 dark:bg-slate-800 border-b border-brand-100 dark:border-slate-700">
      <div className="mx-auto max-w-5xl px-4 py-2 flex flex-wrap items-center gap-2">
        <button onClick={previousVerse} disabled={isPreparing||currentIndex === 0} className="shrink-0 w-8 h-8 rounded-full text-slate-500 dark:text-slate-300 disabled:opacity-30" aria-label={t("player.prevVerse")}>
          ⏪️
        </button>
        <button onClick={togglePlay} disabled={isPreparing} aria-busy={isPreparing} className="shrink-0 w-9 h-9 rounded-full bg-brand-500 text-white flex items-center justify-center text-lg" aria-label={isPlaying ? t("player.pause") : t("player.play")}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button onClick={nextVerse} disabled={isPreparing||currentIndex >= source.verses.length - 1} className="shrink-0 w-8 h-8 rounded-full text-slate-500 dark:text-slate-300 disabled:opacity-30" aria-label={t("player.nextVerse")}>
          ⏩️
        </button>
        <div className="min-w-0 flex-1 basis-24">
          <p className="text-xs font-bold text-brand-700 dark:text-brand-300 truncate">
            {t("player.verse", { title: source.title, n: currentVerse?.number ?? "" })}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums shrink-0">{currentIndex + 1}/{source.verses.length}</span>
            <div className="w-full h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" aria-hidden>
              <div className="h-full bg-brand-500 transition-all duration-300" style={{ width: progress + "%" }} />
            </div>
            <AppSelect disabled={isPreparing} value={String(speed)} onChange={(value) => setSpeed(Number(value))} className="shrink-0 bg-transparent text-xs font-bold text-slate-500 dark:text-slate-300 border-0 outline-none" ariaLabel={t("player.speed")} options={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))} />
          </div>
        </div>
        <button onClick={stop} className="shrink-0 w-7 h-7 rounded-full text-slate-400 dark:text-slate-500" aria-label={t("player.stopAria")} title={t("player.stop")}>
          ✕
        </button>
      </div>
    </div>
  );
}
