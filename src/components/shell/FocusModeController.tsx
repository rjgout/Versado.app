"use client";

import { useAppNavigation } from "@/components/navigation/AppNavigation";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { resolveShellMode, shellModeForRoute } from "@/lib/focusMode";
import { immersiveShellRequested, subscribeShellModeOverride, useEffectiveShellMode } from "@/lib/shellModeOverride";

/**
 * Zet de centrale shellvariant op de body. De vaste shell blijft daardoor op
 * normale pagina's exact hetzelfde, terwijl actieve flows hun eigen canvas
 * krijgen zonder dat iedere pagina header/bottomnav-props hoeft door te geven.
 */
export default function FocusModeController({ children }: { children: ReactNode }) {
  const pathname = useAppNavigation().pathname;
  const routeMode = shellModeForRoute(pathname);
  // De route bepaalt de modus; een actief speelbord binnen een Focus-route mag hem tot Immersive verheffen (shellModeOverride.ts).
  const mode = useEffectiveShellMode(routeMode);
  const element = useRef<HTMLDivElement>(null);
  const routeModeRef = useRef(routeMode);
  useLayoutEffect(() => { routeModeRef.current = routeMode; });
  // Een aanvraag komt uit het layout-effect van het bord. React rendert de wissel pas ná de passieve effecten van dat bord (waar de
  // werktafel haar eerste afmeting en camera bepaalt). Daarom zet dit de modus ook meteen op het element, in dezelfde commit; de
  // gewone render hierna zet exact dezelfde waarde en is daarmee alleen nog de bron van waarheid voor latere renders.
  useLayoutEffect(() => {
    const apply = () => { if (element.current) element.current.dataset.shellMode = resolveShellMode(routeModeRef.current, immersiveShellRequested()); };
    apply(); // een bord dat in dezelfde commit al om Immersive vroeg (eerste laad van een bordroute)
    return subscribeShellModeOverride(apply);
  }, []);

  return (
    <div ref={element} data-shell-mode={mode} className="contents">
      {children}
    </div>
  );
}
