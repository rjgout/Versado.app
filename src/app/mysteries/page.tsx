import Link from "next/link";
import { ArrowRight, Brain, CheckCircle2, LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";
import { canUseMystery, getMysteryProgress } from "@/lib/mysteries/progress";
import { getCurrentUser } from "@/lib/session";
import { MYSTERY_GAME } from "@/lib/mysteries/game";
import { getT } from "@/lib/i18n";
import { MYSTERY_002A } from "@/lib/mysteries/mystery002a";
import { MYSTERY_001A } from "@/lib/mysteries/mystery001a";
import MediaArtwork from "@/components/versado/MediaArtwork";
import { surfaceCard } from "@/components/versado/styles";

export default async function MysteryGamePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMystery(user.id, user.isAdmin))) redirect("/live");
  const [mystery001Progress, mystery002Progress, t] = await Promise.all([
    getMysteryProgress(user.id, MYSTERY_001A),
    getMysteryProgress(user.id, MYSTERY_002A),
    Promise.resolve(getT(user.uiLanguage)),
  ]);
  const progress = [mystery001Progress, mystery002Progress];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <section className={`${surfaceCard} overflow-hidden`}>
        <div className="grid md:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
          <MediaArtwork kind="game" artworkKey={MYSTERY_GAME.coverArtworkKey} ratio="16/9" sizes="(min-width: 768px) 45vw, 100vw" priority className="border-b border-vs-line md:border-b-0 md:border-r" />
          <div className="flex flex-col justify-center gap-4 p-5 sm:p-7">
            <div>
              <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-vs-accent"><Brain className="h-4 w-4" aria-hidden />{t("mysteryGame.eyebrow")}</p>
              <h1 className="mt-2 text-3xl font-black text-vs-fg">{t(MYSTERY_GAME.titleKey)}</h1>
              <p className="mt-2 text-base font-extrabold text-vs-fg-2">{t(MYSTERY_GAME.subtitleKey)}</p>
            </div>
            <p className="text-vs-fg-2">{t(MYSTERY_GAME.introKey)}</p>
          </div>
        </div>
      </section>

      <section className={`${surfaceCard} p-5 sm:p-7`} aria-labelledby="available-mysteries-title">
        <p id="available-mysteries-title" className="text-xs font-extrabold uppercase tracking-wider text-vs-accent">{t("mysteryGame.available")}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {MYSTERY_GAME.mysteries.map((mystery, index) => {
            const current = progress[index];
            const available = index === 0 || progress[index - 1].mysteryCompleted;
            const card = (
              <div className={`${surfaceCard} h-full border p-4 ${available ? "!border-vs-line" : "!border-vs-line opacity-65"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-wider text-vs-accent">{t("mysteryGame.mysteryNumber", { number: mystery.number })}</p>
                    <h2 className="mt-1 text-xl font-black text-vs-fg">{t(mystery.titleKey)}</h2>
                  </div>
                  {current.mysteryCompleted ? <CheckCircle2 className="h-6 w-6 shrink-0 text-vs-success" aria-label={t("mystery001a.completed")} /> : !available ? <LockKeyhole className="h-6 w-6 shrink-0 text-vs-fg-3" aria-label={t("mysteryGame.locked")} /> : null}
                </div>
                <p className="mt-3 text-sm text-vs-fg-2">{t(index === 0 ? "mystery001a.intro" : "mystery002a.intro")}</p>
                <p className="mt-3 text-xs font-extrabold uppercase tracking-wide text-vs-accent">{available ? t("mysteryGame.levelsAvailable") : t("mysteryGame.locked")}</p>
                {available && <span className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-vs-accent">{t("mystery001a.open")}<ArrowRight className="h-4 w-4" aria-hidden /></span>}
              </div>
            );
            return available ? <Link key={mystery.id} href={mystery.href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-vs-accent">{card}</Link> : <div key={mystery.id} aria-disabled="true">{card}</div>;
          })}
        </div>
      </section>
    </div>
  );
}
