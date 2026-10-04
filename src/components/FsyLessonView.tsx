"use client";

import { useT } from "@/components/I18nProvider";
import FsyContentBlocks from "@/components/FsyContentBlocks";
import FocusLayout from "@/components/versado/FocusLayout";
import type { FsyContentBlock } from "@/lib/fsyContent";

interface Props {
  title: string;
  month: number;
  year: number;
  category: string;
  blocks: FsyContentBlock[];
  sourceUrl: string;
}

export const FSY_CATEGORY_KEYS = {
  INTRO: "courseViews.fsy.intro",
  FAST_SUNDAY: "courseViews.fsy.fastSunday",
  SECOND_SUNDAY: "courseViews.fsy.secondSunday",
  THIRD_SUNDAY: "courseViews.fsy.thirdSunday",
  LAST_SUNDAY_YOUNG_WOMEN: "courseViews.fsy.lastSundayYoungWomen",
  LAST_SUNDAY_AARONIC_PRIESTHOOD: "courseViews.fsy.lastSundayAaronic",
  ACTIVITY: "courseViews.fsy.activity",
  OTHER: "courseViews.fsy.other",
} as const;

export default function FsyLessonView({ title, month, year, category, blocks, sourceUrl }: Props) {
  const t = useT();
  const categoryKey = FSY_CATEGORY_KEYS[category as keyof typeof FSY_CATEGORY_KEYS];
  return (
    <FocusLayout className="max-w-3xl gap-6">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {categoryKey ? t(categoryKey) : t("courseViews.fsy.lesson")} · {month}/{year}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-brand-800 dark:text-brand-300 mt-1">{title}</h1>
      </div>

      <article>
        <FsyContentBlocks blocks={blocks} />
      </article>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        {t("courseViews.fsy.source")}{" "}
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="underline">
          {t("courseViews.fsy.officialSite")}
        </a>
      </p>
    </FocusLayout>
  );
}
