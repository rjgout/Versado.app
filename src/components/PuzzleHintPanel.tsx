"use client";

import { useEffect, useRef } from "react";
import { Image, MapPin, Link, ListFilter, X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { puzzleHintBudget } from "@/lib/puzzle/hints";
import { type PuzzleDifficulty, type PuzzleFilter, type PuzzleHintType, type PuzzleSnapshot } from "@/lib/puzzle/types";

export default function PuzzleHintPanel({ snapshot, difficulty, rulesVersion, selected, busy, active, onUse, onClose }: {
  snapshot: PuzzleSnapshot; difficulty: PuzzleDifficulty; rulesVersion: number; selected: number | null; busy: boolean; active: boolean;
  onUse: (type: PuzzleHintType, filter?: Exclude<PuzzleFilter, null>) => void; onClose: () => void;
}) {
  const t = useT(); const panel = useRef<HTMLDivElement>(null);
  const budget = puzzleHintBudget(snapshot, difficulty, rulesVersion);
  useEffect(() => { panel.current?.focus(); }, []);
  const tools = [
    { type: "PREVIEW", title: "jigsaw.hintPreview", description: "jigsaw.hintPreviewDescription", Icon: Image },
    { type: "LOCATION", title: "jigsaw.hintLocation", description: "jigsaw.hintLocationDescription", Icon: MapPin },
    { type: "CONNECTION", title: "jigsaw.hintConnection", description: "jigsaw.hintConnectionDescription", Icon: Link },
  ] as const;
  return <div ref={panel} tabIndex={-1} role="dialog" aria-label={t("jigsaw.hintPanel")} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} className="absolute bottom-full right-0 z-10 mb-3 w-80 max-w-[calc(100vw-1.5rem-var(--vs-safe-area-left)-var(--vs-safe-area-right))] max-h-[calc(100dvh-var(--header-height,var(--header-default))-60px-2.25rem-var(--vs-safe-area-bottom))] overflow-y-auto rounded-2xl border border-vs-line bg-vs-surface p-[12px] shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-vs-xp">
    <div className="flex items-center justify-between gap-2"><h2 className="font-bold">{t("jigsaw.hintPanel")}</h2><button type="button" aria-label={t("jigsaw.closeHints")} className="btn-secondary min-h-[44px] min-w-[44px] shrink-0 !p-[8px]" onClick={onClose}><X size={22} /></button></div>
    <p className="mt-2 text-sm font-semibold text-vs-fg-2">{budget.remaining === null ? t("jigsaw.hintsUnlimited") : t("jigsaw.hintsRemaining", { n: budget.remaining })}</p>
    {budget.remaining === 0 && <p className="mt-2 text-sm text-vs-fg-2">{t("jigsaw.extraHintNotice")}</p>}
    {active && <p role="status" className="mt-2 text-sm text-vs-fg-2">{t("jigsaw.hintActive")}</p>}
    {selected === null && <p className="mt-2 text-sm text-vs-fg-2">{t("jigsaw.hintSelectFirst")}</p>}
    <div className="mt-3 grid gap-2">{tools.map(({ type, title, description, Icon }) => <button key={type} type="button" aria-label={t(title)} className="btn-secondary min-h-11 w-full items-start gap-3 !p-3 text-left" disabled={busy || active || (type !== "PREVIEW" && selected === null)} onClick={() => onUse(type)}><Icon size={24} className="shrink-0" /><span className="min-w-0"><span className="block font-semibold">{t(title)}</span><span className="mt-1 block text-sm font-normal normal-case tracking-normal text-vs-fg-2">{t(description)}</span></span></button>)}</div>
    <fieldset className="mt-3"><legend className="flex items-center gap-3 font-semibold"><ListFilter size={24} className="shrink-0" />{t("jigsaw.hintFilter")}</legend><p className="mt-1 text-sm text-vs-fg-2">{t("jigsaw.hintFilterDescription")}</p><div className="mt-2 flex flex-wrap gap-2">{([ ["CORNERS", "jigsaw.hintCorners"], ["EDGES", "jigsaw.hintEdges"], ["MIDDLES", "jigsaw.hintMiddles"] ] as const).map(([filter, key]) => <button type="button" key={filter} className="btn-secondary min-h-11" disabled={busy || active || (filter === "MIDDLES" && snapshot.groups.reduce((n, group) => n + group.pieceIds.length, 0) === 6)} onClick={() => onUse("FILTER", filter)}>{t(key)}</button>)}</div></fieldset>
    {rulesVersion === 1 && <p className="mt-3 text-sm text-vs-fg-2">{t("jigsaw.legacyRules")}</p>}
  </div>;
}
