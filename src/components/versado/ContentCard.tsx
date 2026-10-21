"use client";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, EyeOff, Info, MoreHorizontal, Plus, X, type LucideIcon } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import MediaArtwork from "@/components/versado/MediaArtwork";
import { interactiveCard } from "@/components/versado/styles";
import type { ArtworkAsset, ArtworkKeys, ArtworkKind } from "@/lib/artwork";

// Eén kaarttaal voor cursussen (Leren) en spellen (Spelen); zie
// docs/KAARTEN.md. Elke interactie heeft een eigen zone, zodat ze elkaar
// nooit raken:
//   afbeelding of titel → openen     ⓘ → uitleg (alleen als er unieke uitleg is)
//   ⋯ op de afbeelding → beheren (verbergen, verplaatsen)
// De kaart als geheel is dus géén link: dan zou elke tik op het
// menu ook navigeren.

export interface CardMenuAction {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}

const CHIP_TONES = {
  neutral: "bg-vs-subtle text-vs-fg-2",
  accent: "bg-vs-accent-soft text-vs-accent",
  success: "bg-vs-success-soft text-vs-success",
  danger: "bg-vs-danger-soft text-vs-danger",
} as const;

/** Statuslabel op een kaart (Speel nu, Voltooid, Uitgeschakeld voor gebruikers). */
export function StatusChip({ tone = "neutral", children }: { tone?: keyof typeof CHIP_TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${CHIP_TONES[tone]}`}>{children}</span>;
}

/** Voortgangsbalk met "4 / 239 hoofdstukken voltooid" eronder. */
export function CardProgress({ done, total, text }: { done: number; total: number; text: string }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-vs-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={text}>
        <div className="h-full rounded-full bg-vs-xp-fill transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-vs-fg-3">{text}</p>
    </div>
  );
}

/**
 * Beheermenu (⋯) rechtsboven op de afbeelding. Een menu in plaats van een
 * losse ✕: verbergen gebeurt nooit per ongeluk, en verplaatsen kan hier ook
 * via hetzelfde menu als verbergen.
 */
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
            if (!rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
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

/**
 * Standaardacties in het beheermenu van een kaart in een sorteerbare lijst:
 * eerder, later en verbergen uit het overzicht (verwijdert nooit gegevens).
 */
export function cardActions({
  t,
  index,
  count,
  onMove,
  onHide,
  busy = false,
}: {
  t: ReturnType<typeof useT>;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onHide: () => void;
  busy?: boolean;
}): CardMenuAction[] {
  return [
    { label: t("cards.moveUp"), icon: ArrowUp, disabled: busy || index <= 0, onSelect: () => onMove(index, index - 1) },
    { label: t("cards.moveDown"), icon: ArrowDown, disabled: busy || index >= count - 1, onSelect: () => onMove(index, index + 1) },
    { label: t("cards.hide"), icon: EyeOff, disabled: busy, onSelect: onHide },
  ];
}

export function ContentCard({
  title,
  href,
  artwork,
  label,
  chips,
  description,
  info,
  actions,
  wide = false,
  priority = false,
  children,
}: {
  title: string;
  href: string;
  /** `asset`: een rechtstreeks meegegeven beeld (bv. het officiële lesbeeld van een studiecursus); gaat voor het register. */
  artwork: { kind: ArtworkKind; keys: ArtworkKeys; sizes: string; asset?: ArtworkAsset | null };
  /** Kleine kop boven de titel, bv. het soort cursus. */
  label?: ReactNode;
  /** Statuslabels (StatusChip). */
  chips?: ReactNode;
  description?: ReactNode;
  /** Alleen bij unieke uitleg die niet al op de kaart staat (speluitleg). */
  info?: { label: string; onClick: () => void };
  actions?: CardMenuAction[];
  /** Breed op desktop (afbeelding links): de huidige cursus. */
  wide?: boolean;
  /** Eerste kaart bovenaan de pagina: beeld direct laden (zie MediaArtwork). */
  priority?: boolean;
  /** Onder de omschrijving: voortgang, een hervatknop. */
  children?: ReactNode;
}) {
  return (
    <article
      className={`relative flex h-full flex-col rounded-2xl border border-vs-line bg-vs-surface shadow-sm transition-shadow has-[.card-title-link:focus-visible]:ring-2 has-[.card-title-link:focus-visible]:ring-vs-accent ${
        wide ? "lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]" : ""
      }`}
    >
      {/* Het menu staat naast (niet in) de afgeronde uitsnede van de
          afbeelding: anders zou die het uitklapmenu afknippen. */}
      <div className="relative">
        <div className={`h-full overflow-hidden rounded-t-[calc(1rem-1px)] ${wide ? "lg:rounded-l-[calc(1rem-1px)] lg:rounded-tr-none" : ""}`}>
          {/* Zelfde bestemming als de titel; voor het toetsenbord en de
              schermlezer is de titel de link, zodat er geen dubbele tabstop is. */}
          <Link href={href} tabIndex={-1} aria-hidden className="group/image block h-full">
            <MediaArtwork
              kind={artwork.kind}
              artworkKey={artwork.keys}
              asset={artwork.asset}
              ratio="21/9"
              sizes={artwork.sizes}
              priority={priority}
              className={`transition-transform duration-300 group-hover/image:scale-[1.03] motion-reduce:transition-none sm:!aspect-[16/9] ${wide ? "lg:!aspect-auto lg:h-full lg:min-h-60" : ""}`}
            />
          </Link>
        </div>
        {actions && actions.length > 0 && <CardMenu title={title} actions={actions} />}
      </div>
      <div className="flex min-w-0 flex-1 gap-1 p-3 sm:p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {(label || chips) && (
            <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
              {label && <span className="text-[11px] font-extrabold uppercase tracking-wide text-vs-fg-3">{label}</span>}
              {chips}
            </div>
          )}
          <div className="flex items-start gap-1">
            <h3 className="min-w-0 flex-1 text-base font-extrabold leading-snug text-vs-fg sm:text-lg">
              <Link href={href} className="card-title-link rounded hover:text-vs-accent focus-visible:outline-none">
                {title}
              </Link>
            </h3>
            {info && (
              <button
                type="button"
                onClick={info.onClick}
                aria-label={info.label}
                title={info.label}
                className="-my-2 -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-vs-fg-3 transition hover:bg-vs-subtle hover:text-vs-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent"
              >
                <Info className="h-[18px] w-[18px]" aria-hidden />
              </button>
            )}
          </div>
          {description && <p className="line-clamp-2 text-sm text-vs-fg-2">{description}</p>}
          {children && <div className="mt-auto flex flex-col gap-3 pt-2">{children}</div>}
        </div>
      </div>
    </article>
  );
}

export interface PickerItem {
  id: string;
  title: string;
  label?: string;
  description?: string | null;
  artwork: { kind: ArtworkKind; keys: ArtworkKeys };
}

/**
 * "+ Cursus toevoegen" / "+ Spel toevoegen": toont alleen wat nu niet in het
 * overzicht staat. Toevoegen zet het item achteraan; daarna kun je het
 * via het kaartmenu verplaatsen.
 */
export function CardPicker({
  addLabel,
  addHint,
  emptyText,
  items,
  busyId,
  disabled = false,
  onOpen,
  onAdd,
}: {
  addLabel: string;
  /** Eén regel uitleg onder het label van de toevoegkaart. */
  addHint?: string;
  emptyText: string;
  /** null = nog aan het laden. */
  items: PickerItem[] | null;
  busyId?: string | null;
  disabled?: boolean;
  onOpen?: () => void;
  onAdd: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const headingId = useId();

  if (!open) {
    return (
      // Dezelfde kaart als een cursus of spel (afgeronde rand, vlak, schaduw), geen losse
      // gestippelde knop: de gestippelde rand is voorbehouden aan de plek waar je iets neerzet.
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          onOpen?.();
        }}
        className={`group flex min-h-16 w-full items-center gap-3 p-3 text-left sm:p-4 ${interactiveCard} hover:!border-vs-accent`}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-vs-accent-soft text-vs-accent" aria-hidden>
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </span>
        <span className="min-w-0">
          <span className="block font-extrabold text-vs-fg">{addLabel}</span>
          {addHint && <span className="block text-xs text-vs-fg-2">{addHint}</span>}
        </span>
      </button>
    );
  }

  return (
    <section aria-labelledby={headingId} className="vs-rise rounded-2xl border border-vs-line bg-vs-surface p-3 shadow-sm sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-xs font-extrabold uppercase tracking-wider text-vs-fg-2">
          {addLabel}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("common.close")}
          className="-mr-1 flex h-10 w-10 items-center justify-center rounded-full text-vs-fg-3 transition hover:bg-vs-subtle hover:text-vs-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {!items ? (
        <p className="py-3 text-sm text-vs-fg-3">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="py-3 text-sm text-vs-fg-2">{emptyText}</p>
      ) : (
        <ul className="mt-1 divide-y divide-vs-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <div className="w-20 shrink-0 overflow-hidden rounded-lg sm:w-24">
                <MediaArtwork kind={item.artwork.kind} artworkKey={item.artwork.keys} ratio="16/9" sizes="96px" />
              </div>
              <div className="min-w-0 flex-1">
                {item.label && <p className="text-[11px] font-extrabold uppercase tracking-wide text-vs-fg-3">{item.label}</p>}
                <p className="truncate font-bold text-vs-fg">{item.title}</p>
                {item.description && <p className="line-clamp-1 text-xs text-vs-fg-2">{item.description}</p>}
              </div>
              <button
                type="button"
                disabled={disabled || busyId === item.id}
                onClick={() => onAdd(item.id)}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-vs-line-strong px-3 text-sm font-bold text-vs-fg transition hover:bg-vs-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden />
                {busyId === item.id ? t("courses.busy") : t("courses.add")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
