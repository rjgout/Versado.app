"use client";

import { usePathname } from "next/navigation";
import { useSetBackTarget } from "@/lib/backTarget";

/** Geeft een reader die vanuit een activiteit is geopend een vaste terugweg. */
export default function ReaderBackTarget({ href, parent }: { href: string; parent: string }) {
  useSetBackTarget(usePathname(), href, parent);
  return null;
}
