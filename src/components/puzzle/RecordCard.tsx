"use client";

import Link from "next/link";
import NextImage from "next/image";
import { useT } from "@/components/I18nProvider";
import { formatPuzzleTime } from "@/lib/puzzle/recordFormat";
import type { OwnRecordView } from "@/lib/puzzle/records";

const levelKeys = { DISCOVERER: "jigsaw.discoverer", ADVENTURER: "jigsaw.adventurer", EXPERT: "jigsaw.expert", MASTER: "jigsaw.master" } as const;

/** Eén persoonlijk record als kaart; de tekst draagt de betekenis (niet alleen kleur). Bruikbaar op 320 px zonder horizontaal scrollen. */
export default function RecordCard({ record, locale }: { record: OwnRecordView; locale?: string }) {
  const t = useT();
  const hints = record.hintsUsed === 0 ? t("puzzleRecords.hintNone") : record.hintsUsed === 1 ? t("puzzleRecords.hintOne") : t("puzzleRecords.hintMany", { n: record.hintsUsed });
  const date = new Date(record.completedAt).toLocaleDateString(locale);
  const href = `/jigsaw/records/${encodeURIComponent(record.variantId)}?mode=${record.mode}&cat=${record.hintCategory}`;
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-vs-line bg-vs-surface p-3">
      <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-vs-subtle"><NextImage src={record.image} alt="" fill unoptimized sizes="96px" className="object-cover" /></div>
      <div className="min-w-0 flex-1 basis-40">
        <p className="break-words font-bold text-vs-fg">{t("puzzleRecords.image", { n: record.imageNumber })} · {t("puzzleRecords.pieces", { n: record.pieceCount })} · {t(levelKeys[record.difficulty as keyof typeof levelKeys] ?? "jigsaw.adventurer")}</p>
        <p className="text-sm text-vs-fg-2">{t(`puzzleRecords.mode${record.mode}`)} · {t(`puzzleRecords.cat${record.hintCategory}`)}</p>
        <p className="text-sm text-vs-fg-2">{hints}{record.extraHintsUsed > 0 ? ` (${t("puzzleRecords.hintStock", { n: record.extraHintsUsed })})` : ""} · {t("puzzleRecords.completedOn", { date })}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className="text-xs font-semibold uppercase text-vs-fg-2">{t("puzzleRecords.bestTime")}</p>
        <p className="font-mono text-2xl font-extrabold tabular-nums text-vs-fg">{formatPuzzleTime(record.elapsedMs)}</p>
        <Link href={href} className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-semibold text-vs-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent">{t("puzzleRecords.compare")}</Link>
      </div>
    </li>
  );
}
