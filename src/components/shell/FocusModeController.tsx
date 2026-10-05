"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { shellModeForRoute } from "@/lib/focusMode";

/**
 * Zet de centrale shellvariant op de body. De vaste shell blijft daardoor op
 * normale pagina's exact hetzelfde, terwijl actieve flows hun eigen canvas
 * krijgen zonder dat iedere pagina header/bottomnav-props hoeft door te geven.
 */
export default function FocusModeController({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mode = shellModeForRoute(pathname);

  return (
    <div data-shell-mode={mode} className="contents">
      {children}
    </div>
  );
}
