"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { ContentStatusInline } from "@/components/learning/ContentStatus";
import MyStepNav from "@/components/reading/MyStepNav";
import { ActiveChapterCard, CARD, ChapterLinkCard, ChapterThumb, Connector, DoneMark, Heading, LockedChapterCard, THUMB_PAD, hasArtwork, type VisualState } from "@/components/reading/pathParts";
import { focusRing, primaryButton } from "@/components/versado/styles";
import { bookArtworkKeys, chapterArtworkKeys } from "@/lib/artwork";
import { chapterCardState, chapterLocks, groupByBook, type BookGroup, type ChapterItem } from "@/lib/readingCourses";

// Het leespad voor Hoofdstuk voor hoofdstuk (vaste volgorde, één hoofdstuk = één leesactiviteit) en Vrije keuze (alle
// hoofdstukken vrij). Zelfde kaarten, miniaturen en verbindingen als het leerpad van Stap voor stap, gegroepeerd onder
// inklapbare boeken. Alleen presentatie: afronding, vergrendeling en volgorde komen van de server; de les opent via de
// bestaande hoofdstukles (/lesson/<id>?cursus=<cursus>). Ingeklapte boeken renderen niets, dus ook geen beelden.

interface Props {
  courseId: string;
  chapters: ChapterItem[];
  /** Hoofdstuk voor hoofdstuk: vergrendelt een hoofdstuk zolang het vorige niet af is. Vrije keuze: nooit een slot. */
  sequential: boolean;
  /** Het hoofdstuk dat nu aan de beurt is (alleen vaste volgorde), anders null. */
  todayId: string | null;
  todayMinutes: number;
  todayXp: number;
  /** Het boek dat standaard openstaat; null = alles ingeklapt. */
  defaultOpenBook: string | null;
  /** "hoofdstukken", of "afdelingen" bij Leer en Verbonden (zie src/lib/chapterTerm.ts). */
  unitPlural: string;
}

export default function ChapterPath({ courseId, chapters, sequential, todayId, todayMinutes, todayXp, defaultOpenBook, unitPlural }: Props) {
  const t = useT();
  const groups = useMemo(() => groupByBook(chapters), [chapters]);
  const locks = useMemo(() => chapterLocks(chapters, sequential), [chapters, sequential]);
  const todayBook = useMemo(() => (todayId ? groups.find((g) => g.chapters.some((c) => c.id === todayId))?.key ?? null : null), [groups, todayId]);
  const singleBook = groups.length <= 1;

  // Wat openstaat is van de gebruiker: de beginstand volgt de voortgang, daarna alleen handmatige keuzes. Een nieuw
  // aan-de-beurt-boek (Hoofdstuk voor hoofdstuk, na het afronden van het laatste hoofdstuk van een boek) gaat erbij open
  // zonder iets anders te sluiten; een refresh klapt nooit een ander boek open of dicht.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(defaultOpenBook ? [defaultOpenBook] : []));
  const [seenTodayBook, setSeenTodayBook] = useState(todayBook);
  if (seenTodayBook !== todayBook) {
    setSeenTodayBook(todayBook);
    if (todayBook && !open.has(todayBook)) setOpen(new Set([...open, todayBook]));
  }
  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const list = (group: BookGroup<ChapterItem>) => (
    <ol className={`m-0 flex list-none flex-col items-stretch p-0 ${sequential ? "" : "gap-2"}`}>
      {group.chapters.map((chapter, index) => {
        const next = group.chapters[index + 1];
        const state = stateOf(chapter);
        return (
          <ChapterEntry
            key={chapter.id}
            chapter={chapter}
            courseId={courseId}
            state={state}
            nextState={sequential && next ? stateOf(next) : null}
            todayMinutes={todayMinutes}
            todayXp={todayXp}
          />
        );
      })}
    </ol>
  );
  function stateOf(chapter: ChapterItem): VisualState {
    return chapterCardState(chapter, { locked: locks.get(chapter.id) ?? false, current: chapter.id === todayId });
  }

  return (
    <div>
      {singleBook ? (
        <div data-reading-path data-chapter-path>
          {groups[0] && list(groups[0])}
        </div>
      ) : (
        <ol aria-label={t("courseView.path.books")} data-reading-path data-chapter-path className="m-0 flex list-none flex-col gap-3 p-0">
          {groups.map((group) => (
            <BookSection key={group.key} group={group} unitPlural={unitPlural} isOpen={open.has(group.key)} onToggle={() => toggle(group.key)} containsToday={group.key === todayBook}>
              {list(group)}
            </BookSection>
          ))}
        </ol>
      )}
      <MyStepNav currentKey={todayId} revealKey={todayBook && open.has(todayBook) ? "open" : "closed"} kind="chapter" />
    </div>
  );
}

function BookSection({ group, unitPlural, isOpen, onToggle, containsToday, children }: { group: BookGroup<ChapterItem>; unitPlural: string; isOpen: boolean; onToggle: () => void; containsToday: boolean; children: React.ReactNode }) {
  const t = useT();
  const done = group.chapters.filter((c) => c.completed).length;
  const keys = bookArtworkKeys(group.bookKey);
  const thumb = hasArtwork(keys);
  const panelId = `book-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <li data-book={group.key} data-book-open={isOpen ? "" : undefined} className="min-w-0">
      <div className={`${CARD} ${containsToday ? "border-vs-accent/50" : "border-vs-line"}`}>
        <div className="relative">
          {thumb && <ChapterThumb artworkKeys={keys} fadeTo="to-vs-surface" />}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-controls={panelId}
            className={`relative flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${thumb ? THUMB_PAD : ""} ${focusRing}`}
          >
            <Heading label={group.name} subtitle={t("courseView.path.chaptersDone", { done, total: group.chapters.length, unit: unitPlural })} />
            {done === group.chapters.length && <DoneMark />}
            <ChevronDown size={16} aria-hidden className={`vs-motion shrink-0 text-vs-fg-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
        {isOpen && (
          <div id={panelId} className="border-t border-vs-line p-[clamp(0.5rem,3vw,0.75rem)]">
            {children}
          </div>
        )}
      </div>
    </li>
  );
}

function ChapterEntry({ chapter, courseId, state, nextState, todayMinutes, todayXp }: { chapter: ChapterItem; courseId: string; state: VisualState; nextState: VisualState | null; todayMinutes: number; todayXp: number }) {
  const t = useT();
  const label = `${chapter.bookName} ${chapter.number}`;
  const artworkKeys = chapterArtworkKeys(chapter.bookKey, chapter.number);
  const href = `/lesson/${chapter.id}?cursus=${courseId}`;
  const verses = t("courseView.verseCount", { n: chapter.verseCount });
  const subtitle = (
    <>
      {verses}
      {chapter.exerciseScore !== null ? t("courseView.bestScore", { n: chapter.exerciseScore }) : ""}
      {state !== "done" && state !== "locked" && <ContentStatusInline read={chapter.read} exercisesAnswered={chapter.exercisesAnswered} exercisesTotal={chapter.exercisesTotal} />}
    </>
  );

  return (
    <>
      <li data-path-chapter={chapter.id} data-chapter-state={state} data-path-current={state === "current" ? "" : undefined} className="min-w-0">
        {state === "current" ? (
          <ActiveChapterCard label={label} subtitle={[verses, todayMinutes > 0 ? t("progress.minutes", { n: todayMinutes }) : null].filter(Boolean).join(" · ")} artworkKeys={artworkKeys}>
            <div className="flex flex-col gap-2">
              <ContentStatusInline read={chapter.read} exercisesAnswered={chapter.exercisesAnswered} exercisesTotal={chapter.exercisesTotal} />
              {/* De ene duidelijke actie: lezen of hervatten. Na het lezen volgen de bestaande hoofdstukoefeningen. */}
              <Link href={href} data-current-step className={`${primaryButton} !min-h-11 w-full justify-center ${focusRing}`}>
                {chapter.read !== "UNREAD" || chapter.exercisesAnswered > 0 ? t("courseView.path.continueChapter") : t("courseView.path.readChapter")}
              </Link>
              <p className="text-xs text-vs-fg-3">{t("courseView.estimate", { minutes: todayMinutes, xp: todayXp })}</p>
            </div>
          </ActiveChapterCard>
        ) : state === "locked" ? (
          <LockedChapterCard label={label} subtitle={verses} artworkKeys={artworkKeys} />
        ) : (
          <ChapterLinkCard href={href} label={label} subtitle={subtitle} artworkKeys={artworkKeys} state={state === "done" ? "done" : state === "started" ? "started" : "open"} />
        )}
      </li>
      {nextState && <Connector from={state} to={nextState} />}
    </>
  );
}
