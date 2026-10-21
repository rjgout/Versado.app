"use client";

import { usePathname } from "next/navigation";
import { useSetBackTarget } from "@/lib/backTarget";
import { useStudyBack } from "@/lib/studyOrigin";

/**
 * Geeft een reader die vanuit een activiteit is geopend een terugweg. `studyOrigin` (studielessen) gebruikt de vastgelegde,
 * geverifieerde herkomst (src/lib/studyOrigin.ts) en `href` alleen als veilige terugval.
 */
export default function ReaderBackTarget({ href, parent, soft = false, studyOrigin = false }: { href: string; parent: string; soft?: boolean; studyOrigin?: boolean }) {
  const pathname = usePathname();
  const goBack = useStudyBack(pathname, href, studyOrigin);
  useSetBackTarget(pathname, href, parent, studyOrigin ? goBack : undefined, true, soft);
  return null;
}
