import Link from "next/link";
import { redirect } from "next/navigation";
import { Brain, CheckCircle2 } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canUseMystery001a, getMystery001aProgress, getMysteryProgress } from "@/lib/mysteries/progress";
import { MYSTERY_001B } from "@/lib/mysteries/mystery001b";
import { getT } from "@/lib/i18n";
import MediaArtwork from "@/components/versado/MediaArtwork";
import { surfaceCard } from "@/components/versado/styles";

export default async function Mystery001aPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMystery001a(user.id, user.isAdmin))) redirect("/live");
  const [progress, investigatorProgress, t] = await Promise.all([getMystery001aProgress(user.id), getMysteryProgress(user.id, MYSTERY_001B), Promise.resolve(getT(user.uiLanguage))]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <section className={`${surfaceCard} overflow-hidden`}>
        <div className="grid md:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
          <MediaArtwork
            kind="game"
            artworkKey="game:mystery"
            ratio="1/1"
            sizes="(min-width: 768px) 45vw, 100vw"
            priority
            className="border-b border-vs-line md:border-b-0 md:border-r"
          />
          <div className="flex flex-col justify-center gap-4 p-5 sm:p-7">
            <div>
              <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-vs-accent">
                <Brain className="h-4 w-4" aria-hidden />
                {t("mystery001a.eyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-black text-vs-fg">{t("mystery001a.title")}</h1>
            </div>
            <p className="text-vs-fg-2">{t("mystery001a.intro")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Link href="/mysteries/001a/play" className={`${surfaceCard} border p-4 transition hover:border-vs-accent ${progress.completed ? "!border-vs-success" : "!border-vs-line"}`}>
                <span className="flex items-center justify-between gap-2 text-sm font-extrabold text-vs-fg"><span>{t("mystery001a.difficulty")}</span>{progress.completed ? <CheckCircle2 className="h-5 w-5 text-vs-success" aria-label={t("mystery001a.completed")} /> : <span aria-label={t("mystery001a.notCompleted")}>○</span>}</span>
                <span className="mt-2 block text-sm font-bold text-vs-accent">{progress.completed ? t("mystery001a.replay") : t("mystery001a.start")}</span>
              </Link>
              <Link href="/mysteries/001b/play" className={`${surfaceCard} border p-4 transition hover:border-vs-accent ${investigatorProgress.completed ? "!border-vs-success" : "!border-vs-line"}`}>
                <span className="flex items-center justify-between gap-2 text-sm font-extrabold text-vs-fg"><span>{t("mystery001b.difficulty")}</span>{investigatorProgress.completed ? <CheckCircle2 className="h-5 w-5 text-vs-success" aria-label={t("mystery001a.completed")} /> : <span aria-label={t("mystery001a.notCompleted")}>○</span>}</span>
                <span className="mt-2 block text-sm font-bold text-vs-accent">{investigatorProgress.completed ? t("mystery001a.replay") : t("mystery001a.start")}</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
