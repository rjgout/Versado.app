import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { TopicIcon } from "@/components/kompas/KompasIcon";
import { interactiveCard } from "@/components/versado/styles";
import type { KompasIconId } from "@/lib/kompas/registry";

/**
 * Een onderdeel in Ontdek Versado. "prominent" is voor de twee hoofdactiviteiten
 * (Leren en Spelen); de rest is een rustiger kaart. Tekst breekt altijd af in
 * plaats van af te kappen, zodat langere vertalingen en een groter lettertype passen.
 */
export default function TopicCard({
  href,
  icon,
  title,
  teaser,
  viewedLabel,
  prominent = false,
}: {
  href: string;
  icon: KompasIconId;
  title: string;
  teaser: string | null;
  /** Wordt getoond als de gebruiker dit onderdeel al bekeek. */
  viewedLabel?: string;
  prominent?: boolean;
}) {
  return (
    <Link href={href} className={`${interactiveCard} flex h-full min-w-0 items-start gap-3 p-4 ${prominent ? "sm:flex-col sm:gap-4 sm:p-5" : ""}`}>
      <span
        className={`flex shrink-0 items-center justify-center rounded-2xl bg-vs-accent-soft text-vs-accent ${prominent ? "h-12 w-12 sm:h-14 sm:w-14" : "h-11 w-11"}`}
      >
        <TopicIcon icon={icon} className={prominent ? "h-6 w-6 sm:h-7 sm:w-7" : "h-5 w-5"} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`font-extrabold text-vs-fg ${prominent ? "text-xl" : "text-lg"}`}>{title}</span>
          {viewedLabel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-vs-success-soft px-2 py-0.5 text-xs font-bold text-vs-success">
              <Check className="h-3 w-3" aria-hidden />
              {viewedLabel}
            </span>
          )}
        </span>
        {teaser && <span className="text-base leading-snug text-vs-fg-2">{teaser}</span>}
      </span>
      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-vs-fg-3 sm:mt-0 sm:self-center" aria-hidden />
    </Link>
  );
}
