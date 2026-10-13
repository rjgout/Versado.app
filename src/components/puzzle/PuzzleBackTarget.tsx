"use client";

import { usePathname } from "next/navigation";
import { useSetBackTarget } from "@/lib/backTarget";
import { JIGSAW_ROUTE } from "@/lib/puzzle/navigation";

/**
 * Eén eigenaar voor het terugdoel van een puzzelscherm. Het scherm rendert dit alleen terwijl het zelf de
 * terugknop beheert; een kind dat een eigen stapnavigatie heeft (de gedeelde werktafel) vervangt het, zodat
 * er nooit twee overrides om dezelfde balk strijden. Het pad is het werkelijke pad van de pagina.
 */
export default function PuzzleBackTarget({ onBack }: { onBack: () => void }) {
  useSetBackTarget(usePathname(), JIGSAW_ROUTE, "", onBack);
  return null;
}
