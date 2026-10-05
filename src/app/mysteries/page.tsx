import Link from "next/link";
import { ArrowRight, Brain } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseMystery001a } from "@/lib/mysteries/progress";
import { MYSTERY_GAME } from "@/lib/mysteries/game";
import { getT } from "@/lib/i18n";
import MediaArtwork from "@/components/versado/MediaArtwork";
import { primaryButton, surfaceCard } from "@/components/versado/styles";

/** De spelpagina: hier staat de spelidentiteit, niet de titel van puzzel 001. */
export default async function MysteryGamePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMystery001a(user.id, user.isAdmin))) redirect("/live");
  const t = await getT(user.uiLanguage);
  const puzzle = MYSTERY_GAME.puzzles[0];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <section className={`${surfaceCard} overflow-hidden`}>
        <div className="grid md:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
          <MediaArtwork
            kind="game"
            artworkKey={MYSTERY_GAME.coverArtworkKey}
            ratio="1/1"
            sizes="(min-width: 768px) 45vw, 100vw"
            priority
            className="border-b border-vs-line md:border-b-0 md:border-r"
          />
          <div className="flex flex-col justify-center gap-4 p-5 sm:p-7">
            <div>
              <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-vs-accent">
                <Brain className="h-4 w-4" aria-hidden />
                {t("mysteryGame.eyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-black text-vs-fg">{t(MYSTERY_GAME.titleKey)}</h1>
              <p className="mt-2 text-base font-extrabold text-vs-fg-2">{t(MYSTERY_GAME.subtitleKey)}</p>
            </div>
            <p className="text-vs-fg-2">{t(MYSTERY_GAME.introKey)}</p>
          </div>
        </div>
      </section>

      <section className={`${surfaceCard} p-5 sm:p-7`} aria-labelledby="available-mystery-title">
        <p className="text-xs font-extrabold uppercase tracking-wider text-vs-accent">{t("mysteryGame.available")}</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="available-mystery-title" className="text-2xl font-black text-vs-fg">Mysterie {puzzle.mysteryNumber}</h2>
            <p className="mt-1 text-lg font-bold text-vs-fg-2">{t("mystery001a.title")}</p>
            <span className="mt-2 inline-flex rounded-full bg-vs-accent-soft px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-vs-accent">
              {t("mysteryGame.levelsAvailable")}
            </span>
          </div>
          <Link href="/mysteries/001a" className={`${primaryButton} min-h-12 self-start px-6 sm:self-center`}>
            {t("mystery001a.open")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}
