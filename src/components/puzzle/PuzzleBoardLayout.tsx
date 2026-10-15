"use client";

import type { ReactNode } from "react";
import ImmersiveLayout from "@/components/versado/ImmersiveLayout";
import { useImmersiveShell } from "@/lib/shellModeOverride";

/**
 * Het canvas van het actieve legpuzzelbord (Solo, Samen en Tegen elkaar): de bestaande Immersive-shell. Alleen
 * zolang het bord gemonteerd is vraagt dit om Immersive; de catalogus, lobby, voltooiingskaart, vraag en uitslag
 * blijven in Focus. Terug staat in het zwevende bordmenu; de terugbalk van Focus is er in dit scherm niet.
 */
export default function PuzzleBoardLayout({ children }: { children: ReactNode }) {
  useImmersiveShell();
  return <ImmersiveLayout className="puzzle-workspace flex-col gap-0">{children}</ImmersiveLayout>;
}
