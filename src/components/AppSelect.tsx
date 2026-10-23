"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface AppSelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface Props {
  value: string;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

/** App-eigen keuzelijst, zodat selecties niet afhankelijk zijn van browser/OS-opmaak. */
export default function AppSelect({ value, options, onChange, disabled = false, className = "input", ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex];

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node) && !listRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  // De lijst staat buiten de kaart en de shell. Meet alleen de vrije ruimte
  // tussen de zichtbare boven- en onderbalk; klap zo nodig omhoog open.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
      const visibleBounds = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => element.getBoundingClientRect());
      const top = Math.max(viewportTop, ...visibleBounds("[data-sticky-header]").map((bounds) => bounds.bottom)) + 8;
      const bottom = Math.min(viewportBottom, ...visibleBounds("[data-main-nav]").map((bounds) => bounds.top)) - 8;
      const below = Math.max(0, bottom - rect.bottom - 4);
      const above = Math.max(0, rect.top - top - 4);
      const preferred = parseFloat(getComputedStyle(document.documentElement).fontSize) * 16;
      const upwards = below < preferred && above > below;
      const width = Math.min(rect.width, Math.max(0, viewportRight - viewportLeft - 16));
      setPlacement({
        left: Math.max(viewportLeft + 8, Math.min(rect.left, viewportRight - width - 8)),
        width,
        ...(upwards ? { bottom: window.innerHeight - Math.min(rect.top - 4, bottom) } : { top: Math.max(rect.bottom + 4, top) }),
        maxHeight: Math.min(preferred, upwards ? above : below),
      });
    }
    place();
    const observer = new ResizeObserver(place);
    if (buttonRef.current) observer.observe(buttonRef.current);
    document.querySelectorAll("[data-sticky-header], [data-main-nav]").forEach((element) => observer.observe(element));
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, placement?.maxHeight]);

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }

  function move(direction: 1 | -1) {
    if (!options.length) return;
    let index = open ? activeIndex : selectedIndex;
    do {
      index = (index + direction + options.length) % options.length;
    } while (options[index]?.disabled && index !== activeIndex);
    setActiveIndex(index);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(activeIndex);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        className={`${className} flex items-center justify-between gap-2 text-left`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        onClick={() => { setActiveIndex(selectedIndex); setOpen((isOpen) => !isOpen); }}
        onKeyDown={onKeyDown}
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <span className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>▾</span>
      </button>
      {open && placement && !disabled && createPortal(
        <>
          <div className="fixed inset-0 z-40" aria-hidden onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false); }} />
          {/* Ook buiten het DOM-label voorkomt preventDefault dat kiezen de trigger opnieuw activeert. */}
          <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel}
            onClick={(event) => event.preventDefault()}
            className="fixed z-40 overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-800"
            style={placement}>
            {options.map((option, index) => (
              <button
                key={option.value}
                id={`${listId}-${index}`}
                data-option-index={index}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={`block w-full break-words rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                  index === activeIndex ? "bg-brand-50 text-brand-700 dark:bg-slate-700 dark:text-brand-300" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                } disabled:cursor-not-allowed disabled:opacity-40`}
                onPointerMove={(event) => { if (event.pointerType === "mouse") setActiveIndex(index); }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>, document.body
      )}
    </div>
  );
}
