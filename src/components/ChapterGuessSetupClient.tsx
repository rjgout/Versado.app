"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";

type Level = "BEGINNER" | "ADVANCED" | "EXPERT";

const LEVELS = [
  { value: "BEGINNER", key: "beginner" },
  { value: "ADVANCED", key: "advanced" },
  { value: "EXPERT", key: "expert" },
] as const satisfies readonly { value: Level; key: string }[];

const QUESTION_COUNTS = [5, 10, 15] as const;

export default function ChapterGuessSetupClient({ availableQuestionCounts = [5, 10, 15] }: { availableQuestionCounts?: number[] }) {
  const t = useT();
  const router = useRouter();
  const [level, setLevel] = useState<Level>("BEGINNER");
  const [questionCount, setQuestionCount] = useState<(typeof QUESTION_COUNTS)[number]>(5);
  const [starting, setStarting] = useState<"solo" | "live" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function playSolo() {
    setError(null);
    setStarting("solo");
    const res = await fetch("/api/chapter-guess/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, questionCount }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? t("gamesHub.createFailed"));
      setStarting(null);
      return;
    }
    router.push(`/chapter-guess/solo/${data.gameId}`);
  }

  async function playWithFriends() {
    setError(null);
    setStarting("live");
    const res = await fetch("/api/live/create-chapter-guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, questionCount }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? t("gamesHub.createFailed"));
      setStarting(null);
      return;
    }
    router.push(`/live/${data.code}`);
  }

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">🔎 {t("pages.chapterGuess")}</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          {t("chapterGuess.intro")}
        </p>
      </div>

      <div className="card flex flex-col gap-3">
        <h2 className="font-extrabold dark:text-slate-100">{t("chapterGuess.level")}</h2>
        <div className="flex flex-col gap-2">
          {LEVELS.map((l) => (
            <button
              key={l.value}
              onClick={() => setLevel(l.value)}
              className={`text-left rounded-xl border-2 px-4 py-3 transition-colors ${
                level === l.value
                  ? "border-brand-500 bg-brand-50 dark:bg-slate-700"
                  : "border-slate-200 dark:border-slate-600 hover:border-brand-300"
              }`}
            >
              <p className="font-extrabold dark:text-slate-100">{t(`chapterGuessLevels.${l.key}`)}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t(`chapterGuess.levelDescriptions.${l.key}`)}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="card flex flex-col gap-3">
        <h2 className="font-extrabold dark:text-slate-100">{t("chapterGuess.questionCount")}</h2>
        <div className="flex gap-3">
          {QUESTION_COUNTS.map((n) => (
            <button
              key={n}
              disabled={!availableQuestionCounts.includes(n)}
              onClick={() => setQuestionCount(n)}
              className={`flex-1 rounded-xl border-2 py-3 font-extrabold transition-colors ${
                questionCount === n
                  ? "border-brand-500 bg-brand-50 dark:bg-slate-700 text-brand-700 dark:text-brand-300"
                  : "border-slate-200 dark:border-slate-600 hover:border-brand-300 dark:text-slate-100"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button className="btn-primary flex-1" disabled={starting !== null} onClick={playSolo}>
          {starting === "solo" ? t("courses.busy") : t("pages.playAlone")}
        </button>
        <button className="btn-secondary flex-1" disabled={starting !== null} onClick={playWithFriends}>
          {starting === "live" ? t("courses.busy") : t("chapterGuess.withFriends")}
        </button>
      </div>
      {error && <p className="text-red-600 dark:text-red-400 text-sm font-semibold">{error}</p>}
    </div>
  );
}
