"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isFocusRoute } from "@/lib/focusMode";

/**
 * Zet de centrale shellvariant op de body. De vaste shell blijft daardoor op
 * normale pagina's exact hetzelfde, terwijl actieve flows hun eigen canvas
 * krijgen zonder dat iedere pagina header/bottomnav-props hoeft door te geven.
 */
export default function FocusModeController({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const focus = isFocusRoute(pathname);

  return (
    <div data-shell-mode={focus ? "focus" : "normal"} className="contents">
      {children}
    </div>
  );
}
