import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  XP_PER_CORRECT_STANDARD,
  XP_PERFECT_BONUS_STANDARD,
  XP_PER_CORRECT_LIGHT,
  CHALLENGE_WIN_XP,
  SCRABBLE_WIN_XP,
  SCRABBLE_PARTICIPATION_XP,
  REPEAT_DISCOUNT,
} from "@/lib/xpRules";
import { xpForWin, MAX_GUESSES } from "@/lib/wordGame";
import { getT } from "@/lib/i18n";
import { Baby, BookOpen, Compass, Grid3x3, Mic, PenLine, Search, Swords, Type, type LucideIcon } from "lucide-react";
import PageIntro from "@/components/versado/PageIntro";
import { surfaceCard } from "@/components/versado/styles";
import type { TFunction } from "@/lib/i18n/core";

// Leest rechtstreeks de waarden uit src/lib/xpRules.ts (en wordGame.ts voor
// het woordspel) — dus deze pagina kan nooit uit sync raken met wat er
// daadwerkelijk wordt uitgekeerd, zoals bij losstaand gekopieerde tekst wel
// had gekund.
function activities(t: TFunction): { icon: LucideIcon; title: string; description: string }[] {
  const standard = t("xpGuide.standardText", { n: XP_PER_CORRECT_STANDARD, bonus: XP_PERFECT_BONUS_STANDARD });
  return [
    { icon: BookOpen, title: t("xpGuide.chapter"), description: t("xpGuide.chapterText", { n: XP_PER_CORRECT_STANDARD, bonus: XP_PERFECT_BONUS_STANDARD }) },
    { icon: Compass, title: t("xpGuide.intro"), description: standard },
    { icon: Baby, title: t("xpGuide.kids"), description: standard },
    { icon: Mic, title: t("xpGuide.podcast"), description: standard },
    { icon: PenLine, title: t("xpGuide.quick"), description: t("xpGuide.quickText", { n: XP_PER_CORRECT_LIGHT }) },
    { icon: Search, title: t("pages.chapterGuess"), description: t("xpGuide.chapterGuessText", { n: XP_PER_CORRECT_LIGHT }) },
    {
      icon: Type,
      title: t("pages.wordOfTheDay"),
      description: t("xpGuide.wordOfDayText", { min: xpForWin(MAX_GUESSES), max: xpForWin(1) }),
    },
    { icon: Swords, title: t("xpGuide.challenge"), description: t("xpGuide.challengeText", { n: CHALLENGE_WIN_XP }) },
    {
      icon: Grid3x3,
      title: t("pages.wordGame"),
      description: t("xpGuide.wordGameText", { win: SCRABBLE_WIN_XP, rest: SCRABBLE_PARTICIPATION_XP }),
    },
  ];
}

export default async function XpGuidePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = getT(user.uiLanguage);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageIntro title={t("xpGuide.title")} text={t("xpGuide.subtitle")} />

      <ul className={`${surfaceCard} divide-y divide-vs-line overflow-hidden`}>
        {activities(t).map(({ icon: Icon, title, description }) => (
          <li key={title} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-vs-xp-soft text-vs-xp" aria-hidden>
              <Icon className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p className="font-extrabold leading-snug text-vs-fg">{title}</p>
              <p className="text-sm leading-snug text-vs-fg-3">{description}</p>
            </div>
          </li>
        ))}
      </ul>

      <aside className="rounded-2xl border border-vs-line bg-vs-xp-soft p-4 sm:p-5">
        <p className="font-extrabold text-vs-fg">{t("xpGuide.repeatTitle")}</p>
        <p className="mt-1 text-sm leading-relaxed text-vs-fg-2">{t("xpGuide.repeatText", { pct: Math.round(REPEAT_DISCOUNT * 100) })}</p>
      </aside>
    </div>
  );
}
