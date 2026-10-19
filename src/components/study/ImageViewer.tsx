"use client";
import { useEffect, useId, useRef } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { iconButton } from "@/components/versado/styles";

/**
 * Eenvoudige vergrotingsweergave voor een studieafbeelding. Versado had er nog geen: dit is een native modaal
 * dialoogvenster (Escape, focusval en achtergrond inert zijn dus van de browser) dat de pagina niet laat scrollen
 * of navigeren, zodat de leespositie niet verandert.
 */
export default function ImageViewer({
  src,
  alt,
  width,
  height,
  caption,
  returnFocus,
  onClose,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
  returnFocus: HTMLElement | null;
  onClose(): void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
      returnFocus?.focus({ preventScroll: true });
    };
  }, [returnFocus]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      className="m-auto max-h-[100svh] w-full max-w-4xl overflow-auto border-0 bg-transparent p-3 text-vs-fg backdrop:bg-black/70"
    >
      <div className="flex min-w-0 flex-col items-center gap-3 rounded-2xl bg-vs-elevated p-3">
        <div className="flex w-full items-start justify-between gap-3">
          <p id={title} className="min-w-0 break-words text-sm font-semibold text-vs-fg-2">
            {caption ?? alt}
          </p>
          <button type="button" className={iconButton} aria-label={t("cfmStudy.imageClose")} onClick={onClose} autoFocus>
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>
        <Image
          unoptimized
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="h-auto max-h-[80svh] w-auto max-w-full object-contain"
        />
      </div>
    </dialog>
  );
}
