"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Image, MapPin, Link, ListFilter, X, ChevronRight, ArrowLeft, ShoppingBag } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { puzzleHintBudget } from "@/lib/puzzle/hints";
import { type PuzzleDifficulty, type PuzzleFilter, type PuzzleHintType, type PuzzleSnapshot } from "@/lib/puzzle/types";

type Choice = { type: PuzzleHintType; filter?: Exclude<PuzzleFilter, null> };
const rowStyle = "flex min-h-14 w-full items-center gap-3 rounded-2xl p-3 text-left text-vs-fg transition hover:bg-vs-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent disabled:opacity-50 disabled:pointer-events-none";

export default function PuzzleHintPanel({ snapshot, difficulty, rulesVersion, selected, canConnect, hintBalance, inventoryBusy, inventoryError, busy, active, error, onRefresh, onUse, onShop, onClose, returnFocus }: {
  snapshot: PuzzleSnapshot; difficulty: PuzzleDifficulty; rulesVersion: number; selected: number | null; canConnect: boolean;
  hintBalance: number | null; inventoryBusy: boolean; inventoryError: boolean; busy: boolean; active: boolean; error: string;
  onRefresh: () => void; onUse: (type: PuzzleHintType, filter?: Exclude<PuzzleFilter, null>, confirmPersonal?: boolean) => void;
  onShop: () => void; onClose: () => void; returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT(); const dialog = useRef<HTMLDialogElement>(null);
  const [sorting, setSorting] = useState(false); const [confirmation, setConfirmation] = useState<Choice | null>(null);
  const budget = puzzleHintBudget(snapshot, difficulty, rulesVersion);
  const empty = budget.remaining === 0 && hintBalance === 0;
  const disabled = busy || active || empty || (budget.remaining === 0 && (inventoryBusy || inventoryError || hintBalance === null));
  useEffect(() => {
    const node = dialog.current; if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreFocus = returnFocus.current ?? previous;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    node.showModal();
    return () => { node.close(); document.body.style.overflow = overflow; restoreFocus?.focus(); };
  }, [returnFocus]);
  useEffect(() => {
    const node = dialog.current;
    // Een vervangen keuze verdwijnt uit de DOM; houd focus in de nieuwe stap.
    if (node?.open && !node.contains(document.activeElement)) node.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [sorting, confirmation]);
  function choose(choice: Choice) {
    if (disabled) return;
    if (budget.remaining === 0) setConfirmation(choice);
    else onUse(choice.type, choice.filter);
  }
  const tools = [
    { type: "PREVIEW", title: "jigsaw.hintPreview", description: "jigsaw.hintPreviewDescription", Icon: Image, reason: null },
    { type: "LOCATION", title: "jigsaw.hintLocation", description: "jigsaw.hintLocationDescription", Icon: MapPin, reason: selected === null ? "jigsaw.hintSelectFirst" : null },
    { type: "CONNECTION", title: "jigsaw.hintConnection", description: "jigsaw.hintConnectionDescription", Icon: Link, reason: selected === null ? "jigsaw.hintSelectFirst" : !canConnect ? "jigsaw.hintNoConnection" : null },
    { type: "FILTER", title: "jigsaw.hintFilter", description: "jigsaw.hintFilterDescription", Icon: ListFilter, reason: null },
  ] as const;
  return createPortal(<dialog ref={dialog} aria-modal="true" aria-labelledby="puzzle-hints-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const first = buttons[0]; const last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onClick={(event) => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }} className="fixed inset-x-0 bottom-0 top-auto z-50 m-auto mb-0 flex max-h-[calc(100dvh-1rem-var(--vs-safe-area-top))] w-[calc(100%-var(--vs-safe-area-left)-var(--vs-safe-area-right))] max-w-[440px] flex-col overflow-hidden rounded-t-3xl border-0 bg-vs-elevated p-0 text-vs-fg shadow-xl backdrop:bg-slate-950/45 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-vs-line px-4 py-3">
      <h2 id="puzzle-hints-title" className="text-lg font-extrabold">{t("jigsaw.hintPanel")}</h2>
      <button type="button" autoFocus aria-label={t("jigsaw.closeHints")} className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-vs-fg-2 hover:bg-vs-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent" onClick={onClose}><X size={22} aria-hidden /></button>
    </header>
    <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+var(--vs-safe-area-bottom))] pt-3 sm:pb-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-2xl bg-vs-subtle p-3 text-sm font-semibold" aria-live="polite">
        <p data-hint-included>{budget.remaining === null ? t("jigsaw.hintsUnlimited") : t("jigsaw.hintsRemaining", { n: budget.remaining })}</p>
        <p data-hint-stock>{hintBalance === null ? t("common.loading") : t("jigsaw.hintStock", { n: hintBalance })}</p>
      </div>
      {inventoryError && <div className="mt-3"><p role="alert" className="text-sm text-vs-fg-2">{t("jigsaw.hintInventoryFailed")}</p><button type="button" className="btn-secondary mt-2 min-h-12 w-full" onClick={onRefresh}>{t("jigsaw.hintRefresh")}</button></div>}
      {error && <p role="alert" className="mt-3 text-sm text-vs-fg-2">{error}</p>}
      {active && <p role="status" className="mt-3 text-sm text-vs-fg-2">{t("jigsaw.hintActive")}</p>}
      {empty ? <div className="mt-4 space-y-3"><p role="status">{t("jigsaw.hintEmpty")}</p><button type="button" className="btn-primary min-h-12 w-full gap-2" disabled={busy} onClick={onShop}><ShoppingBag size={22} aria-hidden />{t("jigsaw.hintShop")}</button></div>
        : confirmation ? <div className="mt-4 space-y-3" data-hint-confirmation><p className="font-semibold">{t("jigsaw.hintPersonalCost")}</p><p className="text-sm text-vs-fg-2">{t(tools.find((tool) => tool.type === confirmation.type)!.title)}</p><button type="button" className="btn-primary min-h-12 w-full" disabled={disabled} onClick={() => onUse(confirmation.type, confirmation.filter, true)}>{busy ? t("common.loading") : t("jigsaw.hintConfirmUse")}</button><button type="button" className="btn-secondary min-h-12 w-full" disabled={busy} onClick={() => setConfirmation(null)}>{t("common.cancel")}</button></div>
        : <>
          {budget.remaining === 0 && <p className="mt-3 text-sm text-vs-fg-2">{t("jigsaw.extraHintNotice")}</p>}
          {sorting ? <div className="mt-3"><button type="button" className={rowStyle} onClick={() => setSorting(false)}><ArrowLeft size={22} aria-hidden /><span className="font-semibold">{t("jigsaw.hintBack")}</span></button><h3 className="mt-2 font-bold">{t("jigsaw.hintFilter")}</h3><div className="mt-2 divide-y divide-vs-line">{([ ["CORNERS", "jigsaw.hintCorners"], ["EDGES", "jigsaw.hintEdges"], ["MIDDLES", "jigsaw.hintMiddles"] ] as const).map(([filter, key]) => { const absent = filter === "MIDDLES" && snapshot.groups.reduce((n, group) => n + group.pieceIds.length, 0) === 6; return <button type="button" key={filter} aria-label={t(key)} className={rowStyle} disabled={disabled || absent} onClick={() => choose({ type: "FILTER", filter })}><ListFilter size={22} className="shrink-0" aria-hidden /><span className="min-w-0"><span className="block font-semibold">{t(key)}</span>{absent && <span className="mt-1 block text-sm text-vs-fg-2">{t("jigsaw.hintNoPieces")}</span>}</span></button>; })}</div></div>
            : <div className="mt-3 divide-y divide-vs-line">{tools.map(({ type, title, description, Icon, reason }) => <button key={type} type="button" aria-label={t(title)} className={rowStyle} disabled={disabled || !!reason} onClick={() => type === "FILTER" ? setSorting(true) : choose({ type })}><Icon size={24} className="shrink-0 text-vs-accent" aria-hidden /><span className="min-w-0 flex-1"><span className="block font-semibold">{t(title)}</span><span className="mt-1 block text-sm text-vs-fg-2">{t(description)}</span>{reason && <span className="mt-1 block text-sm font-semibold text-vs-fg-2">{t(reason)}</span>}</span><ChevronRight size={18} className="shrink-0 text-vs-fg-2" aria-hidden /></button>)}</div>}
        </>}
      {rulesVersion === 1 && <p className="mt-3 text-sm text-vs-fg-2">{t("jigsaw.legacyRules")}</p>}
    </div>
  </dialog>, document.body);
}
