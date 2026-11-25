"use client";

import { useLayoutEffect, useRef } from "react";
import type { LeagueTier } from "@/generated/prisma/client";
import { TIER_ORDER } from "@/lib/leagueTiers";
import DivisionEmblem from "@/components/versado/DivisionEmblem";
import { useT } from "@/components/I18nProvider";

type TierState = "current" | "reached" | "previously" | "locked";

// De "schaduw" is bewust een CSS-filter op het embleem zelf, niet een eigen
// kleur of ander beeld.
// brightness-0 maakt er een silhouet van; bij "eerder behaald" blijft er
// bewust wat kleur over.
const STATE_FILTER: Record<TierState, string> = {
  current: "",
  reached: "",
  previously: "brightness-[.55] saturate-[.55] opacity-80",
  locked: "brightness-0 opacity-30",
};

function TierIcon({ tier, state, className = "" }: { tier: LeagueTier; state: TierState; className?: string }) {
  return (
    <DivisionEmblem tier={tier} className={`block select-none ${STATE_FILTER[state]} ${className}`} />
  );
}

function stateFor(index: number, current: number, highest: number): TierState {
  if (index === current) return "current";
  if (index < current) return "reached";
  return index <= highest ? "previously" : "locked";
}

/**
 * Alle divisies naast elkaar, horizontaal te scrollen, met je huidige
 * divisie bij het laden in het midden. Links (lager) in kleur, rechts (nog
 * te behalen) als schaduw; een hogere divisie waar je al eens in zat en uit
 * degradeerde, is een schaduw met wat kleur.
 */
export default function DivisionScroller({ current, highest }: { current: LeagueTier; highest: LeagueTier }) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const currentItem = useRef<HTMLDivElement>(null);
  const currentIndex = TIER_ORDER.indexOf(current);
  const highestIndex = Math.max(currentIndex, TIER_ORDER.indexOf(highest));

  // Alleen horizontaal centreren: scrollIntoView zou ook de pagina zelf
  // verticaal verschuiven. De scrollcontainer is `relative`, zodat
  // offsetLeft vanaf de container telt en niet vanaf de pagina.
  useLayoutEffect(() => {
    const box = scroller.current;
    const item = currentItem.current;
    if (!box || !item) return;
    box.scrollLeft = item.offsetLeft + item.offsetWidth / 2 - box.clientWidth / 2;
  }, [current]);

  return (
    <div
      ref={scroller}
      className="relative w-full min-w-0 max-w-full overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)]"
    >
      {/* Opvulling van een halve containerbreedte (procenten van padding
          rekenen tegen de scrollcontainer), zodat ook de eerste en laatste
          divisie in het midden kunnen staan. */}
      <div className="flex items-end w-max px-[calc(50%-3rem)]">
        {TIER_ORDER.map((tier, index) => {
          const state = stateFor(index, currentIndex, highestIndex);
          const isCurrent = state === "current";
          return (
            <div
              key={tier}
              ref={isCurrent ? currentItem : undefined}
              className="snap-center shrink-0 w-24 flex flex-col items-center gap-1.5"
              aria-current={isCurrent ? "true" : undefined}
            >
              <TierIcon tier={tier} state={state} className={isCurrent ? "h-16 w-16 drop-shadow-lg" : "h-10 w-10"} />
              <span
                className={`text-center leading-tight ${
                  isCurrent
                    ? "text-lg font-extrabold text-white"
                    : state === "locked"
                      ? "text-xs font-bold text-white/40"
                      : state === "previously"
                        ? "text-xs font-bold text-white/60"
                        : "text-xs font-bold text-brand-100"
                }`}
              >
                {t(`tiers.${tier}`)}
              </span>
              <span className="h-4 text-[10px] font-bold uppercase tracking-wider text-gold-400">
                {isCurrent ? t("profile.thisWeek") : state === "previously" ? t("leaderboard.earlier") : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
