import Link from "next/link";
import { redirect } from "next/navigation";
import { Brain, CheckCircle2 } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canUseMystery001a, getMystery001aProgress } from "@/lib/mysteries/progress";
import { getT } from "@/lib/i18n";
import MediaArtwork from "@/components/versado/MediaArtwork";
import { primaryButton, surfaceCard } from "@/components/versado/styles";

export default async function Mystery001aPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMystery001a(user.id, user.isAdmin))) redirect("/live");
  const [progress, t] = await Promise.all([getMystery001aProgress(user.id), Promise.resolve(getT(user.uiLanguage))]);

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
              <span className="mt-3 inline-flex rounded-full bg-vs-accent-soft px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-vs-accent">
                {t("mystery001a.difficulty")}
              </span>
            </div>
            <p className="text-vs-fg-2">{t("mystery001a.intro")}</p>
            {progress.completed && (
              <p className="flex items-center gap-2 text-sm font-bold text-vs-success">
                <CheckCircle2 className="h-5 w-5" aria-hidden />
                {t("mystery001a.completed")}
              </p>
            )}
            <Link href="/mysteries/001a/play" className={`${primaryButton} min-h-12 self-start px-6`}>
              {progress.completed ? t("mystery001a.replay") : t("mystery001a.start")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
