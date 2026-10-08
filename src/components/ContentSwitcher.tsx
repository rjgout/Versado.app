"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { getLanguage } from "@/lib/languages";
import { useT } from "@/components/I18nProvider";
import ContentIcon from "@/components/versado/ContentIcon";
import { contentAbbreviation } from "@/lib/contentMetadata";
import type { SwitchResult, UnavailableNotice } from "@/lib/contentSwitch";

interface Collection {
  id: string;
  slug: string;
  name: string;
  icon: string;
  order: number;
  visibleToUsers: boolean;
  work: string | null;
  editionKey: string;
  language: string;
}

type LabelMode = "full" | "short" | "icon";

// Eén regel per werk (Boek van Mormon, Leer en Verbonden, ...), niet per
// uitgave: anders staat elk werk er in elke taal apart in. De taal kies je
// eronder, met knoppen voor de talen waarin het actieve werk bestaat.
export default function ContentSwitcher({
  enabled,
  active,
  works,
  activeEditions,
  showLanguage,
}: {
  enabled: boolean;
  active: Collection;
  works: { work: string; edition: Collection }[];
  activeEditions: Collection[];
  /** Er is meer dan één contenttaal te kiezen: toon dan overal de taal. */
  showLanguage: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // De wissel die niet kan, met de uitleg in de taal van de nieuwe content.
  const [pending, setPending] = useState<{ body: { contentCollectionId: string } | { contentLanguage: string }; notice: UnavailableNotice } | null>(null);
  const noticeRef = useRef<HTMLDialogElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // Waar het menu staat: gemeten ten opzichte van de kiezer, zie placeMenu().
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const chevronRef = useRef<SVGSVGElement>(null);
  const fullLabelRef = useRef<HTMLSpanElement>(null);
  const shortLabelRef = useRef<HTMLSpanElement>(null);
  const [labelMode, setLabelMode] = useState<LabelMode>("full");
  // Breedte die de knop met de volledige naam nodig heeft; vanaf desktop de
  // basisbreedte van de kiezer (zie hieronder).
  const [fullTriggerWidth, setFullTriggerWidth] = useState<number | null>(null);

  // Het menu hangt niet in de header maar in een portal op <body> met position: fixed.
  // Binnen de vaste bovenbalk werd het afgekapt door de rand van die balk
  // (overflow-x: clip) en deelde het diens stackinglaag, waardoor elk latere element
  // met z-index in de pagina eroverheen kon schilderen. Zie docs/LAYOUT.md ("Lagen").
  const placeMenu = useCallback(() => {
    const anchor = ref.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    // De onderbalk (alleen onder lg) blijft vrij: het menu eindigt erboven.
    const nav = document.querySelector<HTMLElement>("[data-main-nav]");
    const navTop = nav && nav.getBoundingClientRect().height > 0 ? nav.getBoundingClientRect().top : viewportHeight;
    const width = Math.min(512, viewportWidth - 16);
    const left = Math.min(Math.max(rect.left, 8), viewportWidth - width - 8);
    setMenuBox({ top: rect.bottom, left, width, maxHeight: Math.max(Math.min(viewportHeight, navTop) - rect.bottom - 8, 128) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
    // De kiezer kan bewegen (adresbalk, draaien, een bovenbalk die bij grote tekst meescrolt).
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, { passive: true });
    window.visualViewport?.addEventListener("resize", placeMenu);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu);
      window.visualViewport?.removeEventListener("resize", placeMenu);
    };
  }, [open, placeMenu]);

  // Toetsenbord: Escape sluit en geeft de focus terug; pijlen lopen door de opties.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const options = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=option]:not(:disabled)") ?? []);
      if (options.length === 0) return;
      event.preventDefault();
      const current = options.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next].focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Bij openen staat de focus op de huidige keuze.
  useEffect(() => {
    if (!open || !menuBox) return;
    const selected = menuRef.current?.querySelector<HTMLElement>("[role=option][aria-selected=true]") ?? menuRef.current?.querySelector<HTMLElement>("[role=option]");
    if (selected && !menuRef.current?.contains(document.activeElement)) selected.focus({ preventScroll: true });
  }, [open, menuBox]);

  const shortName = contentAbbreviation(active, active.language);

  useLayoutEffect(() => {
    const root = ref.current;
    const button = buttonRef.current;
    if (!root || !button) return;

    const updateLabelMode = () => {
      const iconWidth = iconRef.current?.getBoundingClientRect().width ?? 20;
      const chevronWidth = chevronRef.current?.getBoundingClientRect().width ?? 16;
      // De button gebruikt px-2 en gap-1.5: trek de vaste ruimte af en laat
      // daarna de gemeten tekstbreedtes beslissen welke representatie past.
      // De wrapper krijgt de resterende headerbreedte; de knop zelf blijft
      // bewust content-sized zodat de vrije ruimte geen klikvlak wordt.
      const available = root.clientWidth - iconWidth - chevronWidth - 28;
      // getBoundingClientRect op block-spans: scrollWidth is voor inline-
      // elementen altijd 0, en dan "paste" de volledige naam altijd.
      const fullWidth = Math.ceil(fullLabelRef.current?.getBoundingClientRect().width ?? Infinity);
      const shortWidth = Math.ceil(shortLabelRef.current?.getBoundingClientRect().width ?? Infinity);
      const next: LabelMode = fullWidth <= available ? "full" : shortName && shortWidth <= available ? "short" : "icon";
      setLabelMode((current) => current === next ? current : next);
      const needed = fullWidth + iconWidth + chevronWidth + 28;
      if (Number.isFinite(needed)) setFullTriggerWidth((current) => current === needed ? current : needed);
    };

    updateLabelMode();
    // Ook de verborgen meetlabels volgen: die worden breder zodra het
    // webfont geladen is, terwijl de beschikbare ruimte gelijk blijft.
    const observer = new ResizeObserver(updateLabelMode);
    observer.observe(root);
    if (fullLabelRef.current) observer.observe(fullLabelRef.current);
    if (shortLabelRef.current) observer.observe(shortLabelRef.current);
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) updateLabelMode();
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [active.id, active.name, active.language, shortName]);

  useEffect(() => {
    const element = noticeRef.current;
    if (pending && element && !element.open) element.showModal();
    if (!pending && element?.open) element.close();
  }, [pending]);

  if (!enabled) return null;

  async function selectCollection(collection: Collection) {
    if (collection.id === active.id) {
      setOpen(false);
      return;
    }
    await save({ contentCollectionId: collection.id });
  }

  // Een taalknop wisselt de contenttaal zelf (ook voor de andere werken), niet
  // alleen deze ene uitgave.
  async function selectLanguage(edition: Collection) {
    if (edition.id === active.id) return;
    // Bij meerdere vertalingen in dezelfde taal moet een taalknop ook de
    // gekozen uitgavefamilie kunnen vastleggen; met één collectie per taal
    // blijft de bestaande contentLanguage-flow ongewijzigd.
    if (edition.language === active.language && edition.editionKey !== active.editionKey) {
      await save({ contentCollectionId: edition.id });
    } else {
      await save({ contentLanguage: edition.language });
    }
  }

  // De wissel gaat met de huidige pagina mee: de server zoekt het equivalent in
  // de nieuwe content/taal. Geen volledige reload: de layout krijgt de nieuwe
  // keuze via router.refresh() en bouwt de pagina eronder opnieuw op.
  async function save(body: { contentCollectionId: string } | { contentLanguage: string }, force = false) {
    setBusy(true);
    try {
      const response = await fetch("/api/content-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          location: { pathname, search: searchParams.toString() ? `?${searchParams.toString()}` : "" },
          ...(force ? { force: true } : {}),
        }),
      });
      if (!response.ok) return;
      const result = (await response.json()) as SwitchResult;
      setOpen(false);
      if (!result.applied) {
        setPending({ body, notice: result.notice });
        return;
      }
      setPending(null);
      if (result.outcome.kind === "redirect") router.replace(result.outcome.href);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const activeWork = active.work ?? active.id;
  const ordered = [
    ...works.filter((option) => option.work === activeWork),
    ...works.filter((option) => option.work !== activeWork),
  ];
  const languageCounts = new Map<string, number>();
  for (const edition of activeEditions) languageCounts.set(edition.language, (languageCounts.get(edition.language) ?? 0) + 1);
  return (
    // Het menu blijft links staan op ieder scherm; de items rechts worden
    // nooit weggedrukt. Telefoon en tablet: alle ruimte tot de items rechts. Desktop: de
    // breedte van de volledige naam als basis, zodat de navigatie in het
    // midden de kiezer niet half opeet; is er te weinig, dan krimpt de kiezer
    // (de navigatie houdt haar eigen minimale breedte) en volgt de afkorting.
    <div
      ref={ref}
      data-kompas-target="content-switcher"
      className="relative -ml-2 self-stretch flex min-w-[4.5rem] max-w-full flex-1 lg:max-w-[18rem] lg:flex-[0_1_var(--vs-switcher-full,18rem)]"
      style={fullTriggerWidth ? ({ "--vs-switcher-full": `${fullTriggerWidth}px` } as CSSProperties) : undefined}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
        title={active.name}
        aria-label={t("contentSwitcher.activeAria", {
          name: active.name + (showLanguage ? ` (${getLanguage(active.language).nativeName})` : ""),
        })}
        className="h-full w-fit max-w-full min-w-0 inline-flex items-center justify-start gap-1.5 px-2 text-sm font-bold text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-300"
      >
        <span ref={iconRef} className="shrink-0"><ContentIcon collection={active} className="h-5 w-5" /></span>
        <span className="pointer-events-none absolute -left-[9999px] whitespace-nowrap" aria-hidden>
          <span ref={fullLabelRef} className="block w-max">{active.name}</span>
          {shortName && <span ref={shortLabelRef} className="block w-max">{shortName}</span>}
        </span>
        {labelMode !== "icon" && <span className="block shrink-0 whitespace-nowrap">{labelMode === "short" && shortName ? shortName : active.name}</span>}
        <ChevronDown ref={chevronRef} className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open &&
        menuBox &&
        createPortal(
          <>
            {/* Onzichtbare laag: een tik buiten het menu sluit alleen het menu en raakt niets eronder. */}
            <button type="button" tabIndex={-1} aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              id={menuId}
              data-content-menu
              style={{ top: menuBox.top, left: `max(var(--vs-safe-area-left), ${menuBox.left}px)`, width: menuBox.width, maxHeight: menuBox.maxHeight }}
              className="fixed z-40 max-w-[calc(100vw-var(--vs-safe-area-left)-var(--vs-safe-area-right)-1rem)] overflow-y-auto overscroll-contain rounded-b-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="mx-auto max-w-2xl px-4 py-2" role="listbox" aria-label={t("contentSwitcher.available")}>
                {ordered.map(({ work, edition: collection }, index) => {
                  const selected = work === activeWork;
                  return (
                    <button
                      key={work}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={busy}
                      onClick={() => selectCollection(collection)}
                      className={[
                        "w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition",
                        selected
                          ? "bg-brand-50 text-brand-800 dark:!bg-brand-900 dark:!text-brand-100"
                          : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800",
                        index === 0 ? "font-extrabold" : "font-semibold",
                      ].join(" ")}
                    >
                      <span className="w-7 shrink-0 text-center" aria-hidden>{selected ? "✓" : ""}</span>
                      <ContentIcon collection={collection} className="h-5 w-5 shrink-0" />
                      <span className="min-w-0 truncate">{collection.name}</span>
                      {showLanguage && (
                        <span className="shrink-0 text-[10px] font-extrabold text-slate-400 dark:text-slate-500">
                          {getLanguage(collection.language).badge}
                        </span>
                      )}
                      {/* Alleen beheerders krijgen verborgen content in dit menu. */}
                      {!collection.visibleToUsers && (
                        <span className="ml-auto shrink-0 text-[10px] font-bold uppercase text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400 rounded-full px-2 py-0.5">
                          {t("contentSwitcher.hidden")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {activeEditions.length > 1 && (
                <div className="mx-auto max-w-2xl px-4 pb-3 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 pt-2 pb-1.5">
                    {t("contentSwitcher.textLanguage")}
                  </p>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("contentSwitcher.textLanguage")}>
                    {activeEditions.map((edition) => {
                      const language = getLanguage(edition.language);
                      const selected = edition.id === active.id;
                      const duplicateLanguage = (languageCounts.get(edition.language) ?? 0) > 1;
                      return (
                        <button
                          key={edition.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={language.nativeName}
                          disabled={busy}
                          onClick={() => selectLanguage(edition)}
                          title={edition.visibleToUsers ? undefined : t("contentSwitcher.hiddenTitle")}
                          className={[
                            "rounded-full px-3 py-1.5 text-sm font-bold border-2 transition",
                            selected
                              ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900 dark:text-brand-100"
                              : "border-slate-200 text-slate-600 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300",
                            edition.visibleToUsers ? "" : "border-dashed",
                          ].join(" ")}
                        >
                          {/* Smal scherm: alleen de code; breder: alleen de naam. Allebei
                              tegelijk zonder ruimte ertussen gaf "NLNederlands". */}
                          <span className="sm:hidden">{language.badge}</span>
                          <span className="hidden sm:inline">{duplicateLanguage ? edition.name : language.nativeName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>,
          document.body,
        )}

      <dialog
        ref={noticeRef}
        lang={pending?.notice.language}
        aria-labelledby="content-unavailable-title"
        onCancel={() => setPending(null)}
        onClose={() => setPending(null)}
        className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-vs-line bg-vs-surface p-5 text-vs-fg shadow-xl backdrop:bg-black/50 sm:p-6"
      >
        {pending && (
          <>
            <h2 id="content-unavailable-title" className="text-xl font-extrabold">{pending.notice.title}</h2>
            <p className="mb-5 mt-2 text-sm leading-relaxed text-vs-fg-2">{pending.notice.body}</p>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <button type="button" className="btn-secondary w-full" autoFocus onClick={() => setPending(null)}>{pending.notice.stay}</button>
              <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => save(pending.body, true)}>{pending.notice.proceed}</button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
