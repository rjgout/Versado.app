import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getKompasPageData } from "@/lib/kompas/pageData";
import { KOMPAS_ROOT, getTopic, isTopicVisible, kompasHref, topicTeaser, topicTitle, visibleChildren } from "@/lib/kompas/registry";
import { resolveExplanation } from "@/lib/kompas/resolve";
import { findRow } from "@/lib/kompas/state";
import { getTour } from "@/lib/kompas/tours";
import { TopicIcon } from "@/components/kompas/KompasIcon";
import TopicCard from "@/components/kompas/TopicCard";
import TourButton from "@/components/kompas/TourButton";
import MarkViewed from "@/components/kompas/MarkViewed";
import { primaryButton, surfaceCard } from "@/components/versado/styles";
import { gameTitle } from "@/lib/gameCatalog";

// Uitleg bij één onderdeel, in de vaste structuur: Wat is het? · Wat kun je
// ermee? · Hoe werkt het? · Probeer het zelf · Meer weten. Alleen wat er is
// wordt getoond. De tekst volgt de fallbackvolgorde van resolveExplanation
// (activiteit + schriftbron, activiteit, onderdeel, Versado).
export default async function KompasTopicPage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (topicId === KOMPAS_ROOT) redirect("/kompas");
  const topic = getTopic(topicId);
  if (!topic) notFound();

  const { t, context, active, rows, character } = await getKompasPageData(user);
  if (!isTopicVisible(topic, context)) notFound();

  const explanation = resolveExplanation(t, topic.id, { work: context.work, character });
  const { entry } = explanation;
  const title = topicTitle(topic, t, character);
  const children = visibleChildren(topic.id, context);
  const tour = getTour(topic.tour);
  const alreadyViewed = (() => {
    const row = findRow(rows, { topicId: topic.id, scope: explanation.scope, kind: "GUIDE" });
    return row !== undefined && row.version >= topic.version && row.status === "VIEWED";
  })();
  const tourDone = tour ? rows.some((row) => row.topicId === tour.topicId && row.kind === "TOUR" && row.status === "COMPLETED") : false;
  const sectionTitle = "text-lg font-extrabold tracking-tight text-vs-fg";
  const body = "text-base leading-relaxed text-vs-fg-2 sm:text-lg";
  const isGameParent = topic.id === "play";

  return (
    <article className="vs-motion mx-auto flex max-w-2xl flex-col gap-7">
      {!alreadyViewed && <MarkViewed topicId={topic.id} scope={explanation.scope} />}

      <header className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-vs-accent-soft text-vs-accent">
          <TopicIcon icon={topic.icon} className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-vs-fg sm:text-3xl">{title}</h1>
          {explanation.scope && (
            <p className="mt-1 inline-flex rounded-full bg-vs-accent-soft px-2.5 py-0.5 text-xs font-bold text-vs-accent">{t("kompas.topic.forSource", { name: active.name })}</p>
          )}
        </div>
      </header>

      {entry.what && (
        <section aria-labelledby="kompas-what" className="flex flex-col gap-1.5">
          <h2 id="kompas-what" className={sectionTitle}>{t("kompas.topic.what")}</h2>
          <p className={body}>{entry.what}</p>
        </section>
      )}

      {entry.benefit && (
        <section aria-labelledby="kompas-benefit" className="flex flex-col gap-1.5">
          <h2 id="kompas-benefit" className={sectionTitle}>{t("kompas.topic.benefit")}</h2>
          <p className={body}>{entry.benefit}</p>
        </section>
      )}

      {entry.steps.length > 0 && (
        <section aria-labelledby="kompas-steps" className="flex flex-col gap-2">
          <h2 id="kompas-steps" className={sectionTitle}>{t("kompas.topic.steps")}</h2>
          <ol className="flex flex-col gap-2.5">
            {entry.steps.map((step, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-vs-accent text-sm font-extrabold tabular-nums text-vs-on-accent" aria-hidden>
                  {index + 1}
                </span>
                <span className={`${body} min-w-0 pt-0.5`}>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(topic.href || tour) && topic.id !== KOMPAS_ROOT && (
        <section aria-labelledby="kompas-try" className={`${surfaceCard} flex flex-col gap-3 p-4 sm:p-5`}>
          <h2 id="kompas-try" className={sectionTitle}>{t("kompas.topic.try")}</h2>
          <div className="flex flex-wrap items-center gap-3">
            {topic.href && (
              <Link href={topic.href} className={`${primaryButton} !h-11 !px-5`}>
                {t("kompas.topic.open", { name: title })}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
            {tour && <TourButton tourId={tour.id} topicId={tour.topicId} done={tourDone} variant={topic.href ? "secondary" : "primary"} />}
          </div>
        </section>
      )}

      {(entry.more || entry.faq.length > 0) && (
        <section aria-labelledby="kompas-more" className="flex flex-col gap-2">
          <h2 id="kompas-more" className={sectionTitle}>{t("kompas.topic.more")}</h2>
          {entry.more && <p className={body}>{entry.more}</p>}
          {entry.faq.length > 0 && (
            <div className="flex flex-col gap-2">
              {entry.faq.map((item, index) => (
                <details key={index} className={`${surfaceCard} group p-4`}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-base font-bold text-vs-fg marker:hidden [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">{item.q}</span>
                    <span aria-hidden className="shrink-0 text-vs-fg-3 transition group-open:rotate-90">›</span>
                  </summary>
                  <p className={`${body} mt-1`}>{item.a}</p>
                </details>
              ))}
            </div>
          )}
        </section>
      )}

      {isGameParent && (
        <section aria-labelledby="kompas-games" className="flex flex-col gap-3">
          <h2 id="kompas-games" className={sectionTitle}>{t("kompas.topic.games")}</h2>
          {children.length === 0 ? (
            <div className={`${surfaceCard} flex flex-col gap-1 p-4`}>
              <p className="text-base font-bold text-vs-fg">{t("gamesHub.noGames", { name: active.name })}</p>
              <p className="text-base text-vs-fg-2">{t("gamesHub.switchContent")}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {children.map((child) => (
                <li key={child.id}>
                  <TopicCard
                    href={kompasHref(child.id)}
                    icon={child.icon}
                    title={child.game ? gameTitle(t, child.game, character) : topicTitle(child, t, character)}
                    teaser={topicTeaser(child, t)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!isGameParent && children.length > 0 && (
        <section aria-labelledby="kompas-related" className="flex flex-col gap-3">
          <h2 id="kompas-related" className={sectionTitle}>{t("kompas.topic.related")}</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {children.map((child) => (
              <li key={child.id}>
                <TopicCard href={kompasHref(child.id)} icon={child.icon} title={topicTitle(child, t, character)} teaser={topicTeaser(child, t)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
