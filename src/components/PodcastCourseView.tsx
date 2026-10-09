"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePodcastPlayer } from "@/lib/podcastPlayerContext";
import { useT } from "@/components/I18nProvider";
import { isNativeApp, openExternalUrl } from "@/lib/platform";
import AppSelect from "@/components/AppSelect";
import type { PodcastChapter } from "@/lib/podcastChapters";
import { jsonMutation } from "@/lib/data/mutation";

interface EpisodeView {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  listenUrl: string | null;
  audioUrl: string | null;
  contentCompleted: boolean;
  contentBestScore: number | null;
  hasContentExercises: boolean;
  bomCompleted: boolean;
  bomBestScore: number | null;
  hasBomExercises: boolean;
  resumeSeconds: number;
  chapters: PodcastChapter[];
}

interface Props {
  /** Ingang naar Samen studeren, naast de titel (zie StudyTogetherButton). */
  studyAction?: React.ReactNode;
  courseName: string;
  podcastName: string;
  podcastId: string | null;
  askForNotifications: boolean;
  episodes: EpisodeView[];
}

type StatusFilter = "ALL" | "DONE" | "PARTIAL" | "TODO";

const FILTERS = [
  { value: "ALL", label: "courseViews.podcast.filterAll" },
  { value: "DONE", label: "courseViews.podcast.filterDone" },
  { value: "PARTIAL", label: "courseViews.podcast.filterPartial" },
  { value: "TODO", label: "courseViews.podcast.filterTodo" },
] as const satisfies readonly { value: StatusFilter; label: string }[];

const PAGE_SIZE = 10;

function episodeStatus(episode: EpisodeView): StatusFilter {
  const availableCount = (episode.hasContentExercises ? 1 : 0) + (episode.hasBomExercises ? 1 : 0);
  if (availableCount === 0) return "TODO";
  const completedCount = (episode.hasContentExercises && episode.contentCompleted ? 1 : 0) + (episode.hasBomExercises && episode.bomCompleted ? 1 : 0);
  if (completedCount === availableCount) return "DONE";
  if (completedCount > 0) return "PARTIAL";
  return "TODO";
}

export default function PodcastCourseView({ courseName, podcastName, podcastId, askForNotifications, episodes, studyAction }: Props) {
  const t = useT();
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [page, setPage] = useState(1);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(askForNotifications);
  const [savingNotification, setSavingNotification] = useState(false);

  async function chooseNotifications(enabled: boolean) {
    if (!podcastId || savingNotification) return;
    setSavingNotification(true);
    try {
      await jsonMutation(`/api/podcast-notifications/${encodeURIComponent(podcastId)}`, { method: "PATCH", json: { enabled } }, { invalidates: "settingsChanged" });
      setShowNotificationPrompt(false);
    } finally {
      setSavingNotification(false);
    }
  }

  const filtered = useMemo(() => {
    if (filter === "ALL") return episodes;
    return episodes.filter((e) => episodeStatus(e) === filter);
  }, [episodes, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageEpisodes = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function selectFilter(value: StatusFilter) {
    setFilter(value);
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{courseName}</h1>
          {studyAction}
        </div>
        <div className="card bg-gradient-to-br from-brand-500 to-brand-600 text-white flex flex-col gap-2">
          <p className="text-brand-100 font-bold uppercase text-xs tracking-wide">{t("courseViews.about")}</p>
          <p>
            {t("courseViews.podcast.aboutBefore")}
            <span className="font-extrabold">{podcastName}</span>
            {t("courseViews.podcast.aboutAfter")}
          </p>
        </div>
        {showNotificationPrompt && (
          <section className="card flex flex-col gap-3" aria-labelledby="podcast-notification-title">
            <div>
              <h2 id="podcast-notification-title" className="font-extrabold text-vs-fg">{t("courseViews.podcast.notificationsTitle")}</h2>
              <p className="mt-1 text-sm text-vs-fg-2">{t("courseViews.podcast.notificationsText", { podcast: podcastName })}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={savingNotification} onClick={() => void chooseNotifications(true)}>{t("courseViews.podcast.notificationsEnable")}</button>
              <button className="btn-secondary" disabled={savingNotification} onClick={() => void chooseNotifications(false)}>{t("courseViews.podcast.notificationsLater")}</button>
            </div>
          </section>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => selectFilter(f.value)}
                className={`rounded-full px-4 py-1.5 text-sm font-bold border-2 transition ${
                  filter === f.value
                    ? "bg-brand-500 text-white border-brand-500"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-brand-300"
                }`}
              >
                {t(f.label)}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {filtered.length === 1
              ? t("courseViews.podcast.countOne", { n: filtered.length })
              : t("courseViews.podcast.countMany", { n: filtered.length })}
          </p>
        </div>

        <PageControls currentPage={currentPage} totalPages={totalPages} onChange={setPage} />

        {episodes.length === 0 && (
          <p className="text-slate-400 dark:text-slate-500">{t("courseViews.podcast.none")}</p>
        )}
        {episodes.length > 0 && filtered.length === 0 && (
          <p className="text-slate-400 dark:text-slate-500">{t("courseViews.podcast.noneInFilter")}</p>
        )}

        <div className="contents">
        {pageEpisodes.map((episode) => (
          <div key={episode.id} className="card flex flex-col gap-3 max-w-xl">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-extrabold text-lg dark:text-slate-100">
                🎙️ {t("courseViews.podcast.episode", { n: episode.number })} — {episode.title}
              </h2>
              {episode.listenUrl && (
                <a
                  href={episode.listenUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-bold text-brand-600 dark:text-brand-300 underline underline-offset-2"
                  onClick={(event) => {
                    if (isNativeApp()) {
                      event.preventDefault();
                      void openExternalUrl(episode.listenUrl!);
                    }
                  }}
                >
                  {t("courseViews.podcast.viewOnSite")}
                </a>
              )}
            </div>
            {episode.audioUrl && <EpisodePlayButton episode={episode} podcastName={podcastName} />}
            {episode.summary && <EpisodeSummary text={episode.summary} />}
            <div className="flex gap-3 flex-wrap">
              <ModeButton
                href={`/podcast/${episode.id}/CONTENT`}
                label={t("lessonFlows.roundContent")}
                available={episode.hasContentExercises}
                completed={episode.contentCompleted}
                bestScore={episode.contentBestScore}
              />
              <ModeButton
                href={`/podcast/${episode.id}/BOM_CONNECTION`}
                label={t("lessonFlows.roundBom")}
                available={episode.hasBomExercises}
                completed={episode.bomCompleted}
                bestScore={episode.bomBestScore}
              />
            </div>
          </div>
        ))}
        </div>

        <PageControls currentPage={currentPage} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}

function PageControls({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const t = useT();
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-3 flex-wrap">
      <button className="btn-secondary !px-3 !py-1.5" disabled={currentPage <= 1} onClick={() => onChange(currentPage - 1)}>
        {t("courseViews.podcast.previous")}
      </button>
      <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        {t("courseViews.podcast.page")}
        <AppSelect
          className="input !w-auto !py-1.5 text-center"
          value={String(currentPage)}
          onChange={(value) => onChange(Number(value))}
          ariaLabel={t("courseViews.podcast.page")}
          options={Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => ({ value: String(p), label: p }))}
        />
        {t("courseViews.podcast.pageOf", { total: totalPages })}
      </label>
      <button className="btn-secondary !px-3 !py-1.5" disabled={currentPage >= totalPages} onClick={() => onChange(currentPage + 1)}>
        {t("courseViews.podcast.next")}
      </button>
    </div>
  );
}

function EpisodePlayButton({ episode, podcastName }: { episode: EpisodeView; podcastName: string }) {
  const player = usePodcastPlayer();
  const t = useT();
  if (!episode.audioUrl) return null;

  const isThisEpisode = player.episode?.id === episode.id;
  const isPlaying = isThisEpisode && player.isPlaying;
  // "Hervatten" hoort niet alleen bij de op dit moment geladen aflevering,
  // maar bij elke aflevering met een eerder opgeslagen afspeelpositie — ook
  // als de mini-player inmiddels gesloten is (zie PodcastMiniPlayer's
  // sluitknop, die de positie bewust bewaart).
  const hasResumePoint = isThisEpisode ? player.currentTime > 0 : episode.resumeSeconds > 0;

  function handleClick() {
    if (isThisEpisode) {
      player.togglePlay();
    } else {
      player.playEpisode({
        id: episode.id,
        number: episode.number,
        title: episode.title,
        audioUrl: episode.audioUrl!,
        podcastName,
        chapters: episode.chapters,
        startAt: episode.resumeSeconds,
      });
    }
  }

  return (
    <button onClick={handleClick} className="btn-secondary !px-4 !py-2 self-start flex items-center gap-2">
      <span aria-hidden>{isPlaying ? "⏸" : "▶"}</span>
      {isPlaying ? t("courseViews.podcast.pause") : hasResumePoint ? t("courseViews.podcast.resume") : t("courseViews.podcast.play")}
    </button>
  );
}

const SUMMARY_TRUNCATE_LENGTH = 220;

function EpisodeSummary({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();

  if (text.length <= SUMMARY_TRUNCATE_LENGTH) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>;
  }

  // Knip af op een woordgrens, niet halverwege een woord.
  const truncated = text.slice(0, SUMMARY_TRUNCATE_LENGTH).replace(/\s+\S*$/, "");

  return (
    <p className="text-sm text-slate-500 dark:text-slate-400">
      {expanded ? text : `${truncated}…`}{" "}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-brand-600 dark:text-brand-300 font-bold hover:underline"
      >
        {expanded ? t("courseViews.podcast.readLess") : t("courseViews.podcast.readMore")}
      </button>
    </p>
  );
}

function ModeButton({
  href,
  label,
  available,
  completed,
  bestScore,
}: {
  href: string;
  label: string;
  available: boolean;
  completed: boolean;
  bestScore: number | null;
}) {
  const t = useT();
  if (!available) {
    return (
      <span className="btn flex-1 min-w-[220px] border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 cursor-default">
        {t("courseViews.podcast.comingSoon", { label })}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`btn flex-1 min-w-[220px] border-2 ${
        completed
          ? "bg-brand-500 text-white border-brand-500"
          : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600"
      }`}
    >
      {completed ? "✓ " : ""}
      {label}
      {bestScore !== null ? ` · ${bestScore}%` : ""}
    </Link>
  );
}
