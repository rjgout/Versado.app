"use client";
import {AppLink as Link} from "@/components/navigation/AppNavigation";
import {ArrowRight} from "lucide-react";
import {useT} from "@/components/I18nProvider";
import {KOMPAS_ROOT,kompasHref,type KompasIconId} from "@/lib/kompas/registry";
import type {KompasEntry} from "@/lib/kompas/resolve";
import {TopicIcon} from "./KompasIcon";
import TopicCard from "./TopicCard";
import TourButton from "./TourButton";
import MarkViewed from "./MarkViewed";
import {primaryButton,surfaceCard} from "@/components/versado/styles";
/** De volledige bestaande uitlegpresentatie, met dezelfde serverselectie. */
export default function KompasTopicView({topic,title,scope,activeName,entry,children,alreadyViewed,tour,tourDone}:{
 topic:{id:string;icon:KompasIconId;href?:string};title:string;scope:string;activeName:string;entry:KompasEntry;
 children:{id:string;icon:KompasIconId;title:string;teaser:string|null}[];alreadyViewed:boolean;tour:{id:string;topicId:string}|null;tourDone:boolean;
}){
 const t=useT(),sectionTitle="text-lg font-extrabold tracking-tight text-vs-fg",body="text-base leading-relaxed text-vs-fg-2 sm:text-lg",isGameParent=topic.id==="play";
  return (
    <article className="vs-motion mx-auto flex max-w-2xl flex-col gap-7">
      {!alreadyViewed && <MarkViewed topicId={topic.id} scope={scope} />}

      <header className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-vs-accent-soft text-vs-accent">
          <TopicIcon icon={topic.icon} className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-vs-fg sm:text-3xl">{title}</h1>
          {scope && (
            <p className="mt-1 inline-flex rounded-full bg-vs-accent-soft px-2.5 py-0.5 text-xs font-bold text-vs-accent">{t("kompas.topic.forSource", { name: activeName })}</p>
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
              <Link href={topic.href} className={`${primaryButton} !min-h-11 !px-5`}>
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
              <p className="text-base font-bold text-vs-fg">{t("gamesHub.noGames", { name: activeName })}</p>
              <p className="text-base text-vs-fg-2">{t("gamesHub.switchContent")}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {children.map((child) => (
                <li key={child.id}>
                  <TopicCard
                    href={kompasHref(child.id)}
                    icon={child.icon}
                    title={child.title}
                    teaser={child.teaser}
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
                <TopicCard href={kompasHref(child.id)} icon={child.icon} title={child.title} teaser={child.teaser} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
