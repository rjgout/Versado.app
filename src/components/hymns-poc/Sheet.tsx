"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { iconButton } from "@/components/versado/styles";
import { COPY } from "./copy";

// Een paneel dat over de lofzangweergave opent: op mobiel een bottom sheet, vanaf sm een compacte dialoog.
// Zelfde patroon als de hintbevestiging van Woord van de dag (native <dialog>, bodyportal): de browser maakt de
// rest van de pagina inert, houdt de focus in het paneel, sluit op Escape (en op Android op het
// terug-gebaar) en geeft de focus terug. De inhoud scrolt zelf; het paneel respecteert de safe areas.
// Het paneel is puur interface: het raakt de engine, de microfoon en de positie niet.

interface Props {
  title: string;
  onClose(): void;
  children: ReactNode;
  /** Hogere sheet voor veel inhoud (technische gegevens). */
  tall?: boolean;
}

export default function Sheet({ title, onClose, children, tall = false }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-labelledby={titleId}
      data-hymns-sheet
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // een tik op de achtergrond (het dialoogelement zelf) sluit het paneel
        if (event.target === dialog.current) onClose();
      }}
      className={`vs-motion fixed inset-x-0 bottom-0 top-auto z-50 m-auto mb-0 flex ${
        tall ? "h-[calc(100dvh-1rem-var(--vs-safe-area-top))]" : ""
      } max-h-[calc(100dvh-1rem-var(--vs-safe-area-top))] w-[calc(100%-var(--vs-safe-area-left)-var(--vs-safe-area-right))] max-w-[34rem] flex-col overflow-hidden rounded-t-3xl border-0 bg-vs-elevated p-0 text-vs-fg shadow-xl backdrop:bg-vs-overlay/40 sm:bottom-auto sm:top-1/2 sm:h-auto sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-3xl`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-vs-line px-4 py-2">
        <h2 id={titleId} className="vs-wrap min-w-0 text-lg font-bold text-vs-fg">
          {title}
        </h2>
        <button type="button" autoFocus className={iconButton} aria-label={COPY.close} onClick={onClose}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+var(--vs-safe-area-bottom))] pt-4 sm:pb-4">{children}</div>
    </dialog>,
    document.body
  );
}
