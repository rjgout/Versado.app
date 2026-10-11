"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BookOpen, Lightbulb, Search, X, ShoppingBag } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { useHintInventory } from "@/lib/data/hints";
import { ApiRequestError } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import { useServerCountdown } from "@/lib/useServerCountdown";
import type { WordGameView } from "@/lib/wordGame";
import type { WordGameHintsView } from "@/lib/wordGameHintRules";
import type { WordGameHintRequest } from "@/lib/wordGameHints";

interface Props {
  gameId: string; hints: WordGameHintsView; finished: boolean; serverNow: number; receivedAt: number;
  onUpdate: (game: WordGameView) => void; onRefresh: () => Promise<void>; onFill: (word: string) => void;
}

export default function WordGameHintPanel({ gameId, hints, finished, serverNow, receivedAt, onUpdate, onRefresh, onFill }: Props) {
  const t = useT();
  const inventory = useHintInventory();
  const balance = inventory.data?.hintBalance;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmation, setConfirmation] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const buying = useRef(false);
  const pending = useRef<WordGameHintRequest | null>(null);
  const storageKey = `word-game-hint:${gameId}`;
  const remaining = useServerCountdown(hints.nextHintAt, serverNow, receivedAt);
  const cooldownText = t("wordOfTheDay.hintCooldown", { minutes: Math.floor(remaining / 60), seconds: remaining % 60 });
  const words = hints.candidates.filter((word) => word.includes(search.toLowerCase().trim()));

  function storedRequest(): WordGameHintRequest | null {
    if (pending.current?.expectedLevel === hints.level) return pending.current;
    if (pending.current) clearRequest();
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as WordGameHintRequest | null;
      if (value?.gameId === gameId && typeof value.actionId === "string" && value.expectedLevel === hints.level) return value;
    } catch { /* Opslag is optioneel; server-idempotentie blijft leidend. */ }
    return null;
  }
  function clearRequest() {
    pending.current = null;
    try { sessionStorage.removeItem(storageKey); } catch { /* Geen lokale opslag beschikbaar. */ }
  }
  function ask() {
    if (buying.current) return;
    setMessage("");
    if (remaining > 0 && !storedRequest()) { setMessage(cooldownText); return; }
    if (balance === undefined || inventory.error) { setMessage(t("wordOfTheDay.hintStockFailed")); return; }
    if (balance === 0 && !storedRequest()) { setMessage(t("wordOfTheDay.hintEmpty")); return; }
    setConfirmation(hints.level);
  }
  async function buy() {
    if (buying.current || confirmation !== hints.level) return;
    buying.current = true; setBusy(true); setMessage("");
    const request = storedRequest() ?? { gameId, actionId: crypto.randomUUID(), expectedLevel: hints.level };
    pending.current = request;
    try { sessionStorage.setItem(storageKey, JSON.stringify(request)); } catch { /* Geheugen bewaart dezelfde retry. */ }
    try {
      await jsonMutation<{ game: WordGameView; hintBalance: number }>("/api/word-game/hint", { json: request }, {
        invalidates: "hintsChanged",
        onSuccess: (reply) => {
          inventory.setData({ hintBalance: reply.hintBalance });
          onUpdate(reply.game); clearRequest(); setConfirmation(null); setSearch(""); setOpen(true);
        },
      });
    } catch (error) {
      setMessage(error instanceof ApiRequestError && !error.message.startsWith("HTTP ") ? error.message : t("wordOfTheDay.hintFailure"));
      if (error instanceof ApiRequestError && error.status < 500) {
        clearRequest();
        await Promise.allSettled([onRefresh(), inventory.refetch()]);
      }
    } finally { buying.current = false; setBusy(false); }
  }
  const canBuy = !finished && hints.nextCount !== null;
  return <section className="card flex min-w-0 flex-col gap-3 !p-[12px] text-vs-fg sm:!p-4" aria-labelledby="word-hints-title" data-word-hints>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h2 id="word-hints-title" className="flex flex-wrap items-center gap-2 text-sm font-extrabold [overflow-wrap:normal]"><BookOpen size={22} className="shrink-0 text-vs-accent" aria-hidden />{t("wordOfTheDay.hintTitle")}</h2>
        <p className="mt-1 text-sm text-vs-fg-2">{hints.level > 0 ? t("wordOfTheDay.hintCount", { n: hints.candidates.length }) : t("wordOfTheDay.hintLocked")}</p></div>
      <p className="text-sm font-semibold" data-word-hint-stock>{balance === undefined ? t("common.loading") : t("wordOfTheDay.hintStock", { n: balance })}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      {hints.level > 0 && <button type="button" className="btn-secondary min-h-12 min-w-[min(100%,9rem)] flex-1 !px-2" aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? "wordOfTheDay.hintClose" : "wordOfTheDay.hintOpen")}</button>}
      {canBuy && <button ref={trigger} type="button" className="btn-primary min-h-12 min-w-[min(100%,9rem)] flex-1 gap-2 !px-1 [overflow-wrap:normal]" disabled={busy} onClick={ask}><Lightbulb size={22} className="hidden shrink-0 sm:block" aria-hidden />{t("wordOfTheDay.hintUse")}</button>}
    </div>
    {canBuy && remaining > 0 && <p className="text-sm text-vs-fg-2" data-word-hint-countdown>{cooldownText}</p>}
    {!finished && hints.nextCount === null && <p className="text-sm text-vs-fg-2">{t("wordOfTheDay.hintMax")}</p>}
    {message && <p role="status" className="text-sm font-semibold text-vs-fg-2">{message}</p>}
    {balance === 0 && canBuy && <div className="space-y-2"><p className="text-sm text-vs-fg-2">{t("wordOfTheDay.hintEmpty")}</p><Link href="/shop" className="btn-secondary min-h-12 w-full gap-2"><ShoppingBag size={22} aria-hidden />{t("wordOfTheDay.hintShop")}</Link></div>}
    {!!inventory.error && <button type="button" className="btn-secondary min-h-12 w-full" onClick={() => void inventory.refetch()}>{t("wordOfTheDay.hintRefresh")}</button>}
    {open && hints.level > 0 && <div className="space-y-3" data-word-dictionary>
      <label className="flex items-center gap-2"><Search size={20} className="shrink-0 text-vs-fg-2" aria-hidden /><input type="search" className="input min-w-0" aria-label={t("wordOfTheDay.hintSearch")} placeholder={t("wordOfTheDay.hintSearch")} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="max-h-[min(45svh,24rem)] overflow-y-auto overscroll-contain rounded-xl border border-vs-line p-2" tabIndex={0} aria-label={t("wordOfTheDay.hintCount", { n: words.length })}>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-1">{words.map((word) => <li key={word}>{finished ? <span className="block p-2 text-center font-semibold uppercase">{word}</span> : <button type="button" className="min-h-11 w-full rounded-lg p-2 text-center font-semibold uppercase hover:bg-vs-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent" aria-label={t("wordOfTheDay.hintSelect", { word })} onClick={() => { onFill(word); setMessage(t("wordOfTheDay.hintSelected", { word })); }}>{word}</button>}</li>)}</ul>
        {words.length === 0 && <p className="p-2 text-sm text-vs-fg-2">{t("wordOfTheDay.hintNoResults")}</p>}
      </div>
    </div>}
    {confirmation !== null && confirmation === hints.level && canBuy && <HintConfirmation level={hints.level} count={hints.nextCount!} balance={balance ?? 0} busy={busy} error={message} returnFocus={trigger} onConfirm={() => void buy()} onClose={() => { if (!buying.current) { setConfirmation(null); setMessage(""); } }} />}
  </section>;
}

function HintConfirmation({ level, count, balance, busy, error, returnFocus, onConfirm, onClose }: {
  level: number; count: number; balance: number; busy: boolean; error: string; returnFocus: RefObject<HTMLButtonElement | null>; onConfirm: () => void; onClose: () => void;
}) {
  const t = useT(); const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current; if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restore = returnFocus.current ?? previous;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    // Sluit een eventueel schermtoetsenbord vóór de sheet verschijnt.
    if (previous instanceof HTMLInputElement) previous.blur();
    node.showModal();
    return () => { node.close(); document.body.style.overflow = overflow; restore?.focus(); };
  }, [returnFocus]);
  return createPortal(<dialog ref={dialog} aria-modal="true" aria-labelledby="word-hint-confirm-title" aria-describedby="word-hint-confirm-description" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="vs-motion fixed inset-x-0 bottom-0 top-auto z-50 m-auto mb-0 flex max-h-[calc(100dvh-1rem-var(--vs-safe-area-top))] w-[calc(100%-var(--vs-safe-area-left)-var(--vs-safe-area-right))] max-w-[440px] flex-col overflow-hidden rounded-t-3xl border-0 bg-vs-elevated p-0 text-vs-fg shadow-xl [overflow-wrap:normal] backdrop:bg-vs-overlay/40 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
    <header className="flow-root shrink-0 border-b border-vs-line px-4 py-3"><button type="button" autoFocus aria-label={t("wordOfTheDay.hintClose")} disabled={busy} className="float-right ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-vs-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent" onClick={onClose}><X size={22} aria-hidden /></button><h2 id="word-hint-confirm-title" className="text-base font-extrabold">{t("wordOfTheDay.hintConfirmTitle")}</h2></header>
    <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+var(--vs-safe-area-bottom))] pt-4 sm:pb-4">
      <p id="word-hint-confirm-description" className="text-sm text-vs-fg-2">{t(level === 0 ? "wordOfTheDay.hintUnlockDescription" : "wordOfTheDay.hintNarrowDescription")}</p>
      <div className="space-y-2 rounded-2xl bg-vs-subtle p-3 text-sm font-semibold"><p>{t("wordOfTheDay.hintCost")}</p><p>{t("wordOfTheDay.hintStockAfter", { before: balance, after: Math.max(0, balance - 1) })}</p><p>{t("wordOfTheDay.hintNextList", { n: count })}</p><p>{t("wordOfTheDay.hintNextAvailable")}</p></div>
      {error && <p role="alert" className="text-sm text-vs-fg-2">{error}</p>}
      <button type="button" className="btn-primary min-h-12 w-full !px-2" disabled={busy} onClick={onConfirm}>{busy ? t("common.loading") : t("wordOfTheDay.hintConfirm")}</button>
      <button type="button" className="btn-secondary min-h-12 w-full !px-2" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
    </div>
  </dialog>, document.body);
}
