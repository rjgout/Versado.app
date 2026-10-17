"use client";

import { usePathname } from "next/navigation";
import { useSetBackTarget } from "@/lib/backTarget";

/** Geeft een reader die vanuit een activiteit is geopend een vaste terugweg. */
export default function ReaderBackTarget({ href, parent, soft = false }: { href: string; parent: string; soft?: boolean }) {
  useSetBackTarget(usePathname(), href, parent, undefined, true, soft);
  return null;
}
