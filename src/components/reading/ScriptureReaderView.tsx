"use client";
import { useEffect, useState, type ReactNode, type PointerEvent } from "react";
import { useT } from "@/components/I18nProvider";
export interface ScriptureVerse {
  id: string;
  number: number;
  text: string;
  highlighted?: boolean;
}
/** De bestaande tekstpresentatie van ReaderView, gedeeld met de lokale bundel.
 * Audio, annotaties en mutaties blijven adapters van de aanroepende webflow. */
export default function ScriptureReaderView<V extends ScriptureVerse>({
  bookName,
  chapterNumber,
  verses,
  focus = false,
  focusVerse,
  readingVerse,
  followReadingVerse=true,
  activeVerseId,
  language,
  colorForVerse,
  renderVerseNumber,
  onPointerDown,
  onVerseClick,
  beforeVerses,
  afterVerses,
  restoreVerse,
}: {
  bookName: string;
  chapterNumber: number;
  verses: V[];
  focus?: boolean;
  focusVerse?: number;
  readingVerse?: number | null;
  followReadingVerse?: boolean;
  activeVerseId?: string;
  language?: string;
  colorForVerse?: (id: string) => string | undefined;
  renderVerseNumber?: (verse: V) => ReactNode;
  onPointerDown?: (event: PointerEvent) => void;
  onVerseClick?: (event: React.MouseEvent<HTMLElement>, id: string) => void;
  beforeVerses?: ReactNode;
  afterVerses?: ReactNode;
  restoreVerse?: (number: number) => void;
}) {
  const t = useT();
  const [scale, setScale] = useState(1),
    [flashVerse, setFlashVerse] = useState<number | null>(focusVerse ?? null);
  useEffect(() => {
    try {
      const value = Number(localStorage.getItem("bom-reader-font-scale"));
      if (Number.isFinite(value) && value >= 0.85 && value <= 1.5)
        setScale(value);
    } catch {}
  }, []);
  useEffect(() => {
    if (!focusVerse) return;
    if (restoreVerse) restoreVerse(focusVerse);
    else
      document
        .getElementById(`vers-${focusVerse}`)
        ?.scrollIntoView({ block: "center" });
    const timer = setTimeout(() => setFlashVerse(null), 4000);
    return () => clearTimeout(timer);
  }, [focusVerse, restoreVerse]);
  useEffect(() => {
    if (readingVerse && followReadingVerse)
      document
        .getElementById(`vers-${readingVerse}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [readingVerse,followReadingVerse]);
  function changeScale(delta: number) {
    const next = Math.min(
      1.5,
      Math.max(0.85, Math.round((scale + delta) * 100) / 100),
    );
    setScale(next);
    try {
      localStorage.setItem("bom-reader-font-scale", String(next));
    } catch {}
  }
  return (
    <div
      data-scripture-reader
      lang={language}
      className="flex min-w-0 flex-col gap-5"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h1
          tabIndex={-1}
          className="min-w-0 break-words text-2xl font-extrabold text-brand-800 dark:text-brand-300"
        >
          {bookName} {chapterNumber}
        </h1>
        <div className="flex shrink-0 items-center gap-1 text-sm">
          <button
            type="button"
            aria-label={t("lesson.smallerText")}
            className="min-h-11 min-w-11 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
            onClick={() => changeScale(-0.1)}
          >
            A-
          </button>
          <button
            type="button"
            aria-label={t("lesson.largerText")}
            className="min-h-11 min-w-11 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
            onClick={() => changeScale(0.1)}
          >
            A+
          </button>
        </div>
      </div>
      {beforeVerses}
      <div
        className={`${focus ? "" : "card "}flex flex-col gap-1`}
        style={{ "--reader-font-scale": scale } as React.CSSProperties}
      >
        {verses.map((v) => {
          const mark = colorForVerse?.(v.id),
            selected = activeVerseId === v.id;
          const ring =
            flashVerse === v.number
              ? "ring-2 ring-brand-400 dark:ring-brand-500"
              : selected
                ? "ring-2 ring-brand-300 dark:ring-brand-600"
                : readingVerse === v.number
                  ? "ring-2 ring-brand-300/70 dark:ring-brand-600/70"
                  : "";
          const surface = mark
            ? ""
            : flashVerse === v.number
              ? "bg-brand-100/70 dark:bg-brand-900/30"
              : selected
                ? "bg-brand-50 dark:bg-brand-900/20"
                : v.highlighted
                  ? "bg-gold-400/20 dark:bg-gold-400/10"
                  : readingVerse === v.number
                    ? "bg-brand-100/70 dark:bg-brand-900/30"
                    : "";
          return (
            <div
              key={v.id}
              id={`vers-${v.number}`}
              data-annotation-color={mark}
              onPointerDown={onPointerDown}
              onClick={
                onVerseClick ? (event) => onVerseClick(event, v.id) : undefined
              }
              className={`reader-text rounded-xl -mx-2 px-2 py-1 transition-colors duration-700 ${onVerseClick ? "cursor-pointer" : ""} ${ring} ${surface}`}
            >
              <p className="whitespace-pre-line break-words">
                {renderVerseNumber ? (
                  renderVerseNumber(v)
                ) : (
                  <span className="text-brand-400 dark:text-brand-500 font-bold mr-2 select-none">
                    {v.number}
                  </span>
                )}
                {v.text}
              </p>
            </div>
          );
        })}
      </div>
      {afterVerses}
    </div>
  );
}
