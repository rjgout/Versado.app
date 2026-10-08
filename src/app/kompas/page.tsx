import { redirect } from "next/navigation";
import { Compass } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getKompasPageData } from "@/lib/kompas/pageData";
import { KOMPAS_TOPICS, kompasHref, topicTeaser, topicTitle, isTopicVisible } from "@/lib/kompas/registry";
import { resolveWorkIntro } from "@/lib/kompas/resolve";
import { findRow } from "@/lib/kompas/state";
import PersonalMascot from "@/components/versado/PersonalMascot";
import TopicCard from "@/components/kompas/TopicCard";
import TourButton from "@/components/kompas/TourButton";
import { KompasIcon } from "@/components/kompas/KompasIcon";
import { guideMascotState } from "@/lib/kompas/mascot";
import { surfaceCard } from "@/components/versado/styles";
import Link from "next/link";
import MarkViewed from "@/components/kompas/MarkViewed";
import OffersOptIn from "@/components/kompas/OffersOptIn";

// Ontdek Versado: de permanente plek voor uitleg (Versado Kompas, docs/KOMPAS.md).
// Eerst de twee hoofdactiviteiten, Leren en Spelen, daaronder de
// ondersteunende onderwerpen. Server-gerenderd: de uitleg volgt zo vanzelf de
// actieve content en taal, en een wissel van de contentkiezer ververst hem.
export default async function KompasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { t, context, active, rows, character } = await getKompasPageData(user);

  const top = KOMPAS_TOPICS.filter((topic) => topic.group && isTopicVisible(topic, context));
  const main = top.filter((topic) => topic.group === "main");
  const support = top.filter((topic) => topic.group === "support");
  const workIntro = resolveWorkIntro(t, context.work);
  const viewed = (id: string) => Boolean(findRow(rows, { topicId: id, scope: "", kind: "GUIDE" }));
  const tourDone = rows.some((row) => row.topicId === "start" && row.kind === "TOUR" && row.status === "COMPLETED");

  // Alleen bij de eerste keer openen: bestaande accounts hebben uitnodigingen uit en krijgen hier één rustige vraag.
  const firstVisit = !viewed("versado");
  const noGames = context.visibleGameIds.length === 0;

  const card = (id: string, prominent = false) => {
    const topic = KOMPAS_TOPICS.find((entry) => entry.id === id)!;
    return (
      <TopicCard
        key={topic.id}
        href={kompasHref(topic.id)}
        icon={topic.icon}
        title={topicTitle(topic, t, character)}
        teaser={topic.id === "play" && noGames ? t("gamesHub.noGames", { name: active.name }) : topicTeaser(topic, t)}
        viewedLabel={viewed(topic.id) ? t("kompas.topic.viewed") : undefined}
        prominent={prominent}
      />
    );
  };

  return (
    <div className="vs-motion mx-auto flex max-w-5xl flex-col gap-8 sm:gap-10">
      {firstVisit && <MarkViewed topicId="versado" scope="" />}
      <section aria-labelledby="kompas-intro" className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h1 id="kompas-intro" className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-vs-fg sm:text-3xl">
            <KompasIcon className="h-7 w-7 shrink-0 text-vs-accent" />
            {t("kompas.title")}
          </h1>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-vs-fg-2 sm:text-lg">{t("kompas.hub.intro")}</p>
        </div>
        <div className="aspect-square w-[clamp(88px,24vw,8rem)] shrink-0 vs-decor">
          <PersonalMascot state={guideMascotState(character)} size={128} fill />
        </div>
      </section>

      <section aria-labelledby="kompas-main" className="flex flex-col gap-3">
        <h2 id="kompas-main" className="text-lg font-extrabold tracking-tight text-vs-fg sm:text-xl">{t("kompas.hub.mainTitle")}</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {main.map((topic) => (
            <li key={topic.id}>{card(topic.id, true)}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="kompas-source" className={`${surfaceCard} flex flex-col gap-2 p-4 sm:p-5`}>
        <h2 id="kompas-source" className="flex items-center gap-2 text-base font-extrabold text-vs-fg">
          <Compass className="h-5 w-5 shrink-0 text-vs-accent" aria-hidden />
          {t("kompas.hub.sourceNow", { name: active.name })}
        </h2>
        {workIntro.intro ? (
          <>
            <p className="text-base leading-relaxed text-vs-fg-2">{workIntro.intro}</p>
            {workIntro.contents && <p className="text-base leading-relaxed text-vs-fg-2">{workIntro.contents}</p>}
          </>
        ) : (
          <p className="text-base leading-relaxed text-vs-fg-2">{t("kompas.hub.sourceGeneric")}</p>
        )}
        <p className="text-sm text-vs-fg-3">{t("kompas.hub.sourceHint")}</p>
        {context.switcherEnabled && (
          <Link href={kompasHref("switcher")} className="inline-flex min-h-11 items-center self-start text-base font-bold text-vs-accent underline-offset-2 hover:underline">
            {t("kompas.hub.sourceSwitch")}
          </Link>
        )}
      </section>

      <section aria-labelledby="kompas-support" className="flex flex-col gap-3">
        <h2 id="kompas-support" className="text-lg font-extrabold tracking-tight text-vs-fg sm:text-xl">{t("kompas.hub.supportTitle")}</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {support.map((topic) => (
            <li key={topic.id}>{card(topic.id)}</li>
          ))}
        </ul>
      </section>

      {firstVisit && !user.kompasOffersEnabled && <OffersOptIn />}

      <section aria-labelledby="kompas-tour" className={`${surfaceCard} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5`}>
        <div className="min-w-0">
          <h2 id="kompas-tour" className="text-base font-extrabold text-vs-fg">{t("kompas.hub.tourTitle")}</h2>
          <p className="text-base text-vs-fg-2">{t("kompas.hub.tourText")}</p>
        </div>
        <div className="shrink-0">
          <TourButton tourId="start" topicId="start" done={tourDone} />
        </div>
      </section>
    </div>
  );
}
