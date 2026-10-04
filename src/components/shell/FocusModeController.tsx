"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";
import { isFocusRoute } from "@/lib/focusMode";

/**
 * Zet de centrale shellvariant op de body. De vaste shell blijft daardoor op
 * normale pagina's exact hetzelfde, terwijl actieve flows hun eigen canvas
 * krijgen zonder dat iedere pagina header/bottomnav-props hoeft door te geven.
 */
export default function FocusModeController() {
  const pathname = usePathname();
  const focus = isFocusRoute(pathname);

  useLayoutEffect(() => {
    document.body.dataset.shellMode = focus ? "focus" : "normal";
    return () => {
      delete document.body.dataset.shellMode;
    };
  }, [focus]);

  return null;
}
