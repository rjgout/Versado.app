"use client";

import { useEffect, useRef } from "react";

/**
 * `position: sticky` heeft op iOS Safari een bekende weergavefout: zodra
 * Safari's eigen adresbalk bij het naar beneden scrollen inklapt, verdwijnt
 * de sticky header mee en komt hij pas terug zodra je weer omhoog scrolt en
 * de adresbalk (en daarmee het echte viewport) weer verschijnt — een fout in
 * Safari's eigen sticky-herberekening bij die overgang, niet iets wat met
 * CSS op de sticky-eigenschap zelf te fixen is. `position: fixed` heeft die
 * fout niet, maar valt daardoor wel uit de normale documentflow — de hoogte
 * (die meebeweegt met de mini-player, zie PodcastMiniPlayer.tsx) wordt hier
 * gemeten en als CSS-variabele doorgegeven, zodat <main> in layout.tsx altijd
 * evenveel ruimte vrijhoudt als de header daadwerkelijk inneemt.
 */
export default function StickyHeader({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const setHeight = () => document.documentElement.style.setProperty("--header-height", `${el.offsetHeight}px`);
    setHeight();
    const observer = new ResizeObserver(setHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-sticky-header className="fixed top-0 inset-x-0 z-20">
      {children}
    </div>
  );
}
