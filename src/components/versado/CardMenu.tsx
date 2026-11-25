"use client";
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useT } from "@/components/I18nProvider";
export interface CardMenuAction {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}
export function CardMenu({ title, actions }: { title: string; actions: CardMenuAction[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastOnOpen = useRef(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const menuId = useId();

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function focusItem(button: HTMLButtonElement | undefined) {
    if (!button) return;
    button.focus({ preventScroll: true });
    const menu = menuRef.current;
    if (!menu) return;
    const itemRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    // Scroll alleen binnen het menu, nooit de pagina achter de kaarten.
    menu.scrollTop += itemRect.top < menuRect.top
      ? itemRect.top - menuRect.top
      : Math.max(0, itemRect.bottom - menuRect.bottom);
  }

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && menuRef.current?.contains(active)) focusItem(active);
  }, [position]);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    function place() {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor || !menu) return;
      const header = document.querySelector("[data-sticky-header]")?.getBoundingClientRect();
      const nav = document.querySelector("[data-main-nav]")?.getBoundingClientRect();
      const top = Math.max(8, header?.bottom ?? 0) + 8;
      const bottom = Math.min(window.innerHeight - 8, nav && nav.height > 0 ? nav.top - 8 : window.innerHeight - 8);
      const maxHeight = Math.max(44, bottom - top);
      const height = Math.min(menu.scrollHeight, maxHeight);
      const width = menu.getBoundingClientRect().width;
      setPosition({
        left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)) - anchor.left,
        top: Math.max(top, Math.min(anchor.bottom + 8, bottom - height)) - anchor.top,
        maxHeight,
      });
    }
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
    place();
    const buttons = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    focusItem(lastOnOpen.current ? buttons[buttons.length - 1] : buttons[0]);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [open]);

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      // Eerst terug naar het anker, daarna volgt de gewone tabvolgorde.
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    focusItem(buttons[next]);
  }

  return (
    <div ref={rootRef} className="absolute right-2 top-2 z-20">
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("cards.menu", { title })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          lastOnOpen.current = false;
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            lastOnOpen.current = event.key === "ArrowUp";
            setOpen(true);
          }
        }}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          style={position}
          onBlur={(event) => {
            // iPhone Safari geeft een knop bij een tik geen focus: het menu-item dat wij zelf focusten verliest dan
            // focus met relatedTarget null, nog vóór de click. Sluiten op dat moment haalt het menu weg voordat de
            // gekozen actie loopt. Alleen focus die aantoonbaar naar een element buiten het menu gaat (toetsenbord,
            // schermlezer) sluit hier; tikken buiten het menu sluit via pointerdown.
            const next = event.relatedTarget as Node | null;
            if (next && !rootRef.current?.contains(next)) setOpen(false);
          }}
          aria-label={t("cards.menu", { title })}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-14 w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-vs-line bg-vs-elevated p-1 shadow-lg"
        >
          {actions.map(({ label, icon: Icon, onSelect, disabled }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                close();
                onSelect();
              }}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-bold text-vs-fg transition hover:bg-vs-subtle focus-visible:bg-vs-subtle focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              {Icon && <Icon className="h-4 w-4 shrink-0 text-vs-fg-2" aria-hidden />}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
