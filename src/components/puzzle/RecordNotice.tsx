"use client";

import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { formatPuzzleTime } from "@/lib/puzzle/recordFormat";

/**
 * Rustige melding bij een door de server bevestigde nieuwe persoonlijke beste tijd. Tekst, geen overlay of animatie en
 * dus geen botsing met de voltooiingskaart of reeksviering; een snellere of gelijke tijd die niets verbetert toont niets.
 */
export default function RecordNotice({ hintCategory, elapsedMs, first, variantId, mode }: { hintCategory: "NO_HINTS" | "WITH_HINTS"; elapsedMs: number; first?: boolean; variantId: string; mode: "SOLO" | "MATCH" }) {
  const t = useT();
  const category = t(`puzzleRecords.cat${hintCategory}`);
  const time = formatPuzzleTime(elapsedMs);
  return (
    <section role="status" className="w-full max-w-[440px] rounded-2xl border border-vs-xp/40 bg-vs-xp/10 p-3 text-left" data-record-notice>
      <p className="font-extrabold text-vs-fg">{t("puzzleRecords.newRecord")}</p>
      <p className="text-sm text-vs-fg-2">{t(first ? "puzzleRecords.firstRecordText" : "puzzleRecords.newRecordText", { category, time })}</p>
      <Link href={`/jigsaw/records/${encodeURIComponent(variantId)}?mode=${mode}&cat=${hintCategory}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-bold text-vs-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent">{t("puzzleRecords.seeFriends")}</Link>
    </section>
  );
}
