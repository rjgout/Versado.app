"use client";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { Brain, CheckCircle2 } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import MediaArtwork from "@/components/versado/MediaArtwork";
import { surfaceCard } from "@/components/versado/styles";
import type { getMysteryProgress } from "@/lib/mysteries/progress";
import type { MysteryDetailConfig } from "./MysteryDetailPage";
const difficultyColors = ["text-vs-success", "text-vs-accent", "text-vs-xp"] as const;

export default function MysteryDetailView({config,progress}:{config:MysteryDetailConfig;progress:Awaited<ReturnType<typeof getMysteryProgress>>[]}) {
  const t = useT();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <section className={`${surfaceCard} overflow-hidden`}>
        <div className="grid md:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
          <MediaArtwork kind="game" artworkKey="game:mystery" ratio="16/9" sizes="(min-width: 768px) 45vw, 100vw" priority className="border-b border-vs-line md:border-b-0 md:border-r" />
          <div className="flex flex-col justify-center gap-4 p-5 sm:p-7">
            <div>
              <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-vs-accent"><Brain className="h-4 w-4" aria-hidden />{t(config.eyebrowKey)}</p>
              <h1 className="mt-2 text-3xl font-black text-vs-fg">{t(config.titleKey)}</h1>
            </div>
            <p className="text-vs-fg-2">{t(config.introKey)}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {config.definitions.map((definition, index) => {
                const current = progress[index];
                return (
                  <Link key={definition.id} href={config.paths[index]} className={`${surfaceCard} border p-4 transition hover:border-vs-accent ${current.completed ? "!border-vs-success" : "!border-vs-line"}`}>
                    <span className="flex items-center justify-between gap-2 text-sm font-extrabold text-vs-fg">
                      <span className={difficultyColors[index]}>{t(definition.difficultyLabelKey)}</span>
                      {current.completed ? <CheckCircle2 className="h-5 w-5 text-vs-success" aria-label={t("mystery001a.completed")} /> : <span aria-label={t("mystery001a.notCompleted")}>○</span>}
                    </span>
                    <span className="mt-2 block text-xs font-semibold text-vs-fg-2">{t(definition.difficultyDescriptionKey)}</span>
                    <span className="mt-2 block text-sm font-bold text-vs-accent">{current.completed ? t("mystery001a.replay") : t("mystery001a.start")}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
