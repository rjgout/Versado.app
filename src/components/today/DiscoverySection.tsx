import Link from "next/link";
import { getT } from "@/lib/i18n";
import MediaArtwork from "@/components/versado/MediaArtwork";
import SectionHeader from "@/components/today/SectionHeader";
import { interactiveCard } from "@/components/versado/styles";
import type { DiscoverItem } from "@/lib/today";
import type { MessageKey } from "@/lib/i18n/core";
import PersonalMascot from "@/components/versado/PersonalMascot";

// Iets nieuws om te ontdekken. Nu eenvoudig (nog niet toegevoegde cursussen
// en spellen in je eigen volgorde, zie getTodayData); de kaart ondersteunt
// verschillende soorten content, zodat een echt aanbevelingssysteem of een
// andere volgorde (bv. voor kinderen) later alleen de lijst verandert.
export default function DiscoverySection({ items, language, showMascot = true }: { items: DiscoverItem[]; language: string; showMascot?: boolean }) {
  const t = getT(language);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="today-discover" className="vs-rise">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <SectionHeader id="today-discover" title={t("today.discoverTitle")} />
        </div>
        {showMascot && (
          <div className="-mb-1 aspect-square w-[clamp(88px,24vw,6.5rem)] shrink-0 sm:w-28 lg:w-32">
            <PersonalMascot state="discovery" size={128} fill />
          </div>
        )}
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {items.map((item, i) => (
          // Op een telefoon vier kaarten (twee rijen); meer maakt de pagina lang.
          <li key={item.key} className={i >= 4 ? "max-sm:hidden" : undefined}>
            <Link href={item.href} className={`${interactiveCard} flex h-full flex-col overflow-hidden`}>
              <MediaArtwork
                kind={item.kind === "game" ? "game" : "course"}
                artworkKey={item.artwork}
                ratio="4/3"
                sizes="(min-width: 1024px) 220px, (min-width: 640px) 33vw, 50vw"
              />
              <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-vs-fg-3">
                  {item.kind === "game" ? t("today.kind.game") : t("today.kind.course")}
                </p>
                <h3 className="line-clamp-2 text-sm font-extrabold leading-snug text-vs-fg sm:text-[15px]">{item.title}</h3>
                <p className="line-clamp-2 text-xs text-vs-fg-3 sm:text-sm">
                  {item.gameTextKey ? t(`gamesHub.${item.gameTextKey}.description` as MessageKey) : item.description ?? item.meta}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
