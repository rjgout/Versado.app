import { Check } from "lucide-react";
import SystemIcon from "@/components/versado/SystemIcon";
import { getT } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import PersonalMascot from "@/components/versado/PersonalMascot";
import type { TodayData } from "@/lib/today";

// Kop van Vandaag: datum, persoonlijke begroeting en in één zin waar je
// reeks staat. De persoonlijke gids vormt rechts een herkenbare metgezel
// zonder dat lange namen of de statusregel daarvoor hoeven te worden afgekapt.
export default function Greeting({ data, language, showMascot = true }: { data: TodayData; language: string; showMascot?: boolean }) {
  const t = getT(language);
  const locale = getLanguage(language).intlLocale;
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: data.timeZone }).format(new Date());
  const { current, studiedToday } = data.streak;
  const status = data.streak.interrupted ? t("streakReturn.saved", { n: current }) : studiedToday
    ? t("today.streakDone")
    : current === 1
      ? t("today.streakKeepOne")
      : current > 1
        ? t("today.streakKeep", { n: current })
        : t("today.streakStart");

  return (
    <header className="vs-rise grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 min-[390px]:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold first-letter:uppercase text-vs-fg-3">{date}</p>
        <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight text-vs-fg sm:text-3xl">
          {t(`today.greeting.${data.partOfDay}`, { name: data.firstName })}
        </h1>
        <p className={`mt-2 inline-flex items-center gap-2 text-sm font-semibold ${studiedToday ? "text-vs-success" : current > 0 ? "text-vs-streak" : "text-vs-fg-2"}`}>
          {studiedToday ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : <SystemIcon kind="streak" className="h-4 w-4" fill="none" aria-hidden />}
          {status}
        </p>
      </div>
      {showMascot && (
        // Het vaste canvas houdt de compositie stabiel; de gids zelf blijft volledig in beeld.
        <div className="aspect-square w-[clamp(5.5rem,26vw,7rem)] shrink-0 sm:w-32 lg:w-36">
          <PersonalMascot state="greeting" size={144} fill />
        </div>
      )}
    </header>
  );
}
