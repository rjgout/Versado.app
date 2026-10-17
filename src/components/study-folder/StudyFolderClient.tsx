"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Highlighter, LoaderCircle, Pencil, Search, StickyNote, X, type LucideIcon } from "lucide-react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import PageIntro from "@/components/versado/PageIntro";
import AnnotationActions from "@/components/annotations/AnnotationActions";
import MarkSwatch from "@/components/annotations/MarkSwatch";
import { primaryButton, secondaryButton, surfaceCard, focusRing } from "@/components/versado/styles";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson, ApiRequestError } from "@/lib/data/fetchJson";
import { getLanguage } from "@/lib/languages";
import type { AnnotationKind } from "@/lib/annotations/contract";
import { ANNOTATION_COLORS, type AnnotationColor, type AnnotationView } from "@/lib/annotations/clientContract";
import type { StudyFolderItem, StudyFolderPage, StudyFolderSources } from "@/lib/annotations/studyFolder";

const KINDS: AnnotationKind[] = ["bookmark", "highlight", "note"];
const KIND_ICON: Record<AnnotationKind, LucideIcon> = { bookmark: Bookmark, highlight: Highlighter, note: StickyNote };
const COLOR_KEY = {
  yellow: "annotations.yellow", green: "annotations.green", blue: "annotations.blue", pink: "annotations.pink", purple: "annotations.purple",
} as const;
const DEBOUNCE_MS = 350;

type Filters = { q: string; type: AnnotationKind | ""; source: string; color: AnnotationColor | "" };
// Tijdelijk geheugen (alleen deze tab): na terug uit een leespassage staan de al geladen pagina's er direct weer.
const loadedPages = new Map<string, { first: string | null; pages: StudyFolderPage[] }>();

function apiQuery(filters: Filters, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  // Een kleur hoort alleen bij markeringen: het type volgt de kleur, zodat URL, query-sleutel en cursor dezelfde filters beschrijven.
  const type = filters.color ? "highlight" : filters.type;
  if (type) params.set("type", type);
  if (filters.source) params.set("source", filters.source);
  if (filters.color) params.set("color", filters.color);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params.toString();
}

export default function StudyFolderClient() {
  const t = useT();
  const language = useUiLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const urlQ = search.get("q") ?? "";
  const rawType = search.get("type");
  const rawColor = search.get("color");
  // Een onbekende kleur of een kleur bij bladwijzers/notities in de URL telt niet mee; de server wijst zo'n combinatie af.
  const color: Filters["color"] = ANNOTATION_COLORS.includes(rawColor as AnnotationColor) && (!rawType || rawType === "highlight") ? (rawColor as AnnotationColor) : "";
  const type: Filters["type"] = color ? "highlight" : KINDS.includes(rawType as AnnotationKind) ? (rawType as AnnotationKind) : "";
  const source = search.get("source") ?? "";
  const itemParam = search.get("item") ?? "";
  const filters: Filters = { q: urlQ, type, source, color };
  const filterKey = apiQuery(filters);
  const [text, setText] = useState(urlQ);
  const pushed = useRef(urlQ);
  const [editing, setEditing] = useState<{ item: StudyFolderItem; element: HTMLElement } | null>(null);

  function navigate(next: Partial<Filters>, keepItem = false) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams(apiQuery(merged));
    if (keepItem && itemParam) params.set("item", itemParam);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  // Zoeken wacht rustig tot de gebruiker even stopt met typen; één request per zoekterm.
  useEffect(() => {
    if (text.trim() === urlQ) return;
    const timer = setTimeout(() => { pushed.current = text.trim(); navigate({ q: text.trim() }, true); }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // navigate leest alleen huidige URL-waarden; opnieuw plannen bij elke wijziging is gewenst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, urlQ]);
  useEffect(() => {
    if (urlQ !== pushed.current) { pushed.current = urlQ; setText(urlQ); }
  }, [urlQ]);

  const first = useLiveQuery<StudyFolderPage>(["studyFolder", "list", filterKey], () => fetchJson(`/api/study-folder?${filterKey}`), { scopes: ["annotations"] });
  const sources = useLiveQuery<StudyFolderSources>(["studyFolder", "sources"], () => fetchJson("/api/study-folder?view=sources"), { scopes: ["annotations"] });
  const focus = useLiveQuery<{ item: StudyFolderItem }>(["studyFolder", "item", itemParam], () => fetchJson(`/api/study-folder?item=${encodeURIComponent(itemParam)}`), { scopes: ["annotations"], enabled: Boolean(itemParam) });

  // Extra pagina's horen bij precies deze eerste pagina: verandert die (mutatie, verwijderen), dan vervalt het extra geheugen.
  const [extra, setExtra] = useState<{ key: string; first: string | null; pages: StudyFolderPage[] } | null>(null);
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const firstCursor = first.data?.nextCursor ?? null;
  const firstSignature = first.data ? JSON.stringify(first.data.items.map((i) => [i.kind, i.id, i.mutationVersion])) : null;
  const signature = `${filterKey}|${firstSignature}`;
  const [seen, setSeen] = useState<string | null>(null);
  // Een aanvullende pagina geldt alleen voor de lijst waarvoor hij is opgevraagd: een bevestigde mutatie of een andere
  // zoekopdracht maakt een nog onderweg zijnde response ongeldig (generatie + laatste handtekening, nooit een oude closure).
  const generation = useRef(0);
  const latestSignature = useRef(signature);
  useEffect(() => { latestSignature.current = signature; });
  if (first.data && seen !== signature) {
    setSeen(signature);
    const remembered = loadedPages.get(filterKey);
    setExtra(remembered && remembered.first === signature ? { key: filterKey, first: signature, pages: remembered.pages } : null);
    setMore("idle");
  }
  const pages = extra && extra.key === filterKey && extra.first === signature ? extra.pages : [];
  const items = [...(first.data?.items ?? []), ...pages.flatMap((page) => page.items)];
  const nextCursor = pages.length ? pages.at(-1)!.nextCursor : firstCursor;

  async function loadMore() {
    if (!nextCursor || more === "loading") return;
    const requested = signature, requestedGeneration = generation.current;
    const stale = () => generation.current !== requestedGeneration || latestSignature.current !== requested;
    setMore("loading");
    try {
      const page = await fetchJson<StudyFolderPage>(`/api/study-folder?${apiQuery(filters, { cursor: nextCursor })}`);
      // Een late response van een eerdere zoekopdracht of een inmiddels gewijzigde lijst wordt genegeerd.
      if (stale()) return;
      setExtra((old) => {
        const current = old && old.key === filterKey && old.first === signature ? old.pages : [];
        const next = [...current, page];
        loadedPages.set(filterKey, { first: signature, pages: next });
        return { key: filterKey, first: signature, pages: next };
      });
      setMore("idle");
    } catch { if (!stale()) setMore("error"); }
  }

  const returnTo = `${pathname}${search.toString() ? `?${search.toString()}` : ""}`;
  const dateFormat = (iso: string) => new Date(iso).toLocaleDateString(getLanguage(language).intlLocale, { dateStyle: "medium" });
  const filtered = Boolean(urlQ || type || source || color);
  const focusGone = Boolean(itemParam) && focus.error instanceof ApiRequestError && focus.error.status === 404;
  const sourceList = sources.data?.sources ?? [];

  // De bevestigde mutatie komt uit de 4A-writer (annotationsChanged ververst de eerste pagina al centraal). Latere pagina's kunnen
  // een gewijzigd of verwijderd item nog bevatten: die en de tijdelijke paginacache vervallen, de huidige filters blijven staan.
  function onChanged(row: AnnotationView) {
    void row;
    generation.current += 1;
    loadedPages.clear();
    setExtra(null);
    setMore("idle");
    void first.refetch();
  }

  return (
    <div data-study-folder className="mx-auto flex w-full max-w-5xl flex-col gap-5 pb-6">
      <PageIntro title={t("studyFolder.title")} text={t("studyFolder.intro")} />

      <form role="search" className="flex min-w-0 flex-col gap-3" onSubmit={(event) => { event.preventDefault(); navigate({ q: text.trim() }, true); }}>
        <label className="flex min-w-0 flex-col gap-1 text-sm font-bold text-vs-fg">
          {t("studyFolder.searchLabel")}
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-vs-fg-3" aria-hidden />
            <input
              type="search" value={text} maxLength={100} enterKeyHint="search" autoComplete="off"
              placeholder={t("studyFolder.searchPlaceholder")}
              onChange={(event) => setText(event.target.value)}
              className={`min-h-11 w-full min-w-0 rounded-xl border border-vs-line bg-vs-surface py-2 pl-10 pr-3 font-normal text-vs-fg ${focusRing}`}
            />
          </span>
        </label>
        <div role="group" aria-label={t("studyFolder.typeLabel")} className="flex flex-wrap gap-2">
          {(["", ...KINDS] as const).map((value) => (
            <button
              key={value || "all"} type="button" aria-pressed={type === value} data-folder-type={value || "all"}
              onClick={() => navigate({ type: value, color: value === "highlight" ? color : "" }, true)}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 py-2 text-sm font-bold ${type === value ? "border-vs-accent bg-vs-accent-soft text-vs-accent" : "border-vs-line text-vs-fg-2 hover:border-vs-accent"} ${focusRing}`}
            >
              {t(value ? `studyFolder.type.${value}` : "studyFolder.type.all")}
            </button>
          ))}
        </div>
        {(type === "" || type === "highlight") && (
          <div role="group" aria-label={t("studyFolder.colorLabel")} data-folder-colors className="flex flex-wrap gap-2">
            <button
              type="button" aria-pressed={color === ""} data-folder-color="all"
              onClick={() => navigate({ color: "" }, true)}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 py-2 text-sm font-bold ${color === "" ? "border-vs-accent bg-vs-accent-soft text-vs-accent" : "border-vs-line text-vs-fg-2 hover:border-vs-accent"} ${focusRing}`}
            >
              {t("studyFolder.colorAll")}
            </button>
            {ANNOTATION_COLORS.map((value) => (
              <button
                key={value} type="button" aria-pressed={color === value} data-folder-color={value}
                onClick={() => navigate({ type: "highlight", color: value }, true)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-2 text-sm font-bold ${color === value ? "border-vs-accent bg-vs-accent-soft text-vs-accent" : "border-vs-line text-vs-fg-2 hover:border-vs-accent"} ${focusRing}`}
              >
                <MarkSwatch color={value} checked={color === value} />
                {t(COLOR_KEY[value])}
              </button>
            ))}
          </div>
        )}
        <label className="flex min-w-0 flex-col gap-1 text-sm font-bold text-vs-fg sm:max-w-sm">
          {t("studyFolder.sourceLabel")}
          <select
            value={sourceList.some((entry) => entry.id === source) ? source : ""} data-folder-source
            onChange={(event) => navigate({ source: event.target.value }, true)}
            className={`min-h-11 w-full min-w-0 rounded-xl border border-vs-line bg-vs-surface px-3 py-2 font-normal text-vs-fg ${focusRing}`}
          >
            <option value="">{t("studyFolder.sourceAll")}</option>
            {sourceList.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {getLanguage(entry.language).nativeName}</option>)}
          </select>
        </label>
      </form>

      {itemParam && (
        <section aria-labelledby="folder-focus-title" data-folder-focus className="flex flex-col gap-2">
          <h2 id="folder-focus-title" className="text-sm font-extrabold text-vs-fg-2">{t("studyFolder.focusTitle")}</h2>
          {!focusGone && focus.data?.item && <FolderCard item={focus.data.item} t={t} date={dateFormat} returnTo={returnTo} emphasized onEdit={(element) => setEditing({ item: focus.data!.item, element })} />}
          {focusGone && <p role="status" className="rounded-2xl border border-vs-line bg-vs-elevated p-3 text-sm text-vs-fg">{t("studyFolder.itemGone")}</p>}
          {Boolean(focus.error) && !focusGone && <p role="alert" className="rounded-2xl border border-vs-line bg-vs-elevated p-3 text-sm text-vs-fg">{t("studyFolder.loadFailed")}</p>}
        </section>
      )}

      <section aria-label={t("studyFolder.listLabel")} className="flex flex-col gap-3">
        {first.isLoading && <p role="status" className="flex items-center gap-2 text-sm font-semibold text-vs-fg-2"><LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />{t("studyFolder.loading")}</p>}
        {Boolean(first.error) && !first.data && (
          <div role="alert" className="rounded-2xl border border-vs-line bg-vs-elevated p-3 text-sm text-vs-fg">
            <p>{t("studyFolder.loadFailed")}</p>
            <button type="button" className={`${secondaryButton} mt-2 min-h-11`} onClick={() => void first.refetch()}>{t("studyFolder.retry")}</button>
          </div>
        )}
        {first.data && items.length === 0 && (
          <div data-folder-empty className="rounded-2xl border border-dashed border-vs-line p-5 text-sm text-vs-fg-2">
            <p>{t(filtered ? "studyFolder.noResults" : "studyFolder.empty")}</p>
            {filtered && <button type="button" className={`${secondaryButton} mt-3 min-h-11`} onClick={() => { setText(""); pushed.current = ""; navigate({ q: "", type: "", source: "", color: "" }); }}><X className="h-4 w-4" aria-hidden />{t("studyFolder.clearFilters")}</button>}
          </div>
        )}
        {items.length > 0 && <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} data-folder-item={`${item.kind}:${item.id}`}>
              <FolderCard item={item} t={t} date={dateFormat} returnTo={returnTo} onEdit={(element) => setEditing({ item, element })} />
            </li>
          ))}
        </ul>}
        {nextCursor && (
          <div className="flex flex-col items-start gap-2">
            <button type="button" data-folder-more className={`${secondaryButton} min-h-11`} disabled={more === "loading"} onClick={() => void loadMore()}>
              {more === "loading" ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}{t("studyFolder.loadMore")}
            </button>
            {more === "error" && <p role="alert" className="text-sm text-vs-danger">{t("studyFolder.loadFailed")}</p>}
          </div>
        )}
      </section>

      {editing && <AnnotationActions key={`${editing.item.kind}:${editing.item.id}`} target={editing.item.target} returnFocus={editing.element} onClose={() => setEditing(null)} onChanged={onChanged} />}
    </div>
  );
}

function FolderCard({ item, t, date, returnTo, emphasized = false, onEdit }: {
  item: StudyFolderItem;
  t: ReturnType<typeof useT>;
  date: (iso: string) => string;
  returnTo: string;
  emphasized?: boolean;
  onEdit: (element: HTMLElement) => void;
}) {
  const Icon = KIND_ICON[item.kind];
  const source = item.source;
  const available = source.status !== "unavailable";
  const href = source.status === "unavailable" ? null : `${source.href}${source.href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`;
  const title = available ? source.label : t("studyFolder.sourceUnavailable");
  const kindName = t(`studyFolder.kind.${item.kind}`);
  return (
    <article className={`${surfaceCard} flex min-w-0 flex-col gap-2 p-4 ${emphasized ? "ring-2 ring-vs-accent" : ""}`}>
      <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-extrabold text-vs-accent">
          <Icon className="h-4 w-4 shrink-0" aria-hidden />{kindName}
        </span>
        {item.color && (
          <span className="inline-flex items-center gap-1.5 text-vs-fg-2">
            {item.color in COLOR_KEY && <MarkSwatch color={item.color as AnnotationColor} />}
            {item.color in COLOR_KEY ? t(COLOR_KEY[item.color as keyof typeof COLOR_KEY]) : item.color}
          </span>
        )}
        <time dateTime={item.createdAt} className="ml-auto text-xs text-vs-fg-3">{date(item.createdAt)}</time>
      </header>
      <h3 className="min-w-0 text-base font-extrabold leading-snug text-vs-fg [overflow-wrap:anywhere]">{title}</h3>
      {available && <p className="text-xs text-vs-fg-3 [overflow-wrap:anywhere]">{source.collectionName}</p>}
      {item.snippet && <p className="line-clamp-4 text-sm leading-relaxed text-vs-fg-2 [overflow-wrap:anywhere]">{item.snippet}</p>}
      {item.quote && (
        <blockquote className="border-l-2 border-vs-line pl-3 text-sm leading-relaxed text-vs-fg-2 [overflow-wrap:anywhere]">
          <span className="block text-xs font-bold text-vs-fg-3">{t("studyFolder.originalPassage")}</span>
          <span className="whitespace-pre-line">{item.quote}</span>
        </blockquote>
      )}
      {item.text && <p className="whitespace-pre-wrap rounded-xl bg-vs-subtle p-3 text-sm leading-relaxed text-vs-fg [overflow-wrap:anywhere]">{item.text}</p>}
      {item.recovery && (
        <p data-folder-recovery={item.recovery} className="text-sm font-bold text-vs-fg">
          {t(item.recovery === "found" ? "studyFolder.recoveryFound" : item.recovery === "review" ? "studyFolder.recoveryReview" : "studyFolder.recoveryMissing")}
        </p>
      )}
      {source.status === "revision-changed" && (
        <p role="note" className="text-sm text-vs-fg-2">
          {t(item.recovery === "review" ? "studyFolder.recoveryReviewHelp" : item.recovery === "missing" ? "studyFolder.recoveryMissingHelp" : "studyFolder.revisionChanged")}
        </p>
      )}
      {source.status === "unavailable" && <p className="text-sm text-vs-fg-2">{t("studyFolder.sourceUnavailableHelp")}</p>}
      <footer className="mt-1 flex flex-wrap items-center gap-2">
        {href && <Link href={href} data-folder-open className={primaryButton}>{t(item.recovery === "review" ? "studyFolder.recoveryCompare" : source.status === "revision-changed" ? "studyFolder.openLesson" : "studyFolder.open")}</Link>}
        <button type="button" data-folder-edit className={secondaryButton} aria-haspopup="dialog" aria-label={t("studyFolder.editAria", { label: title })} onClick={(event) => onEdit(event.currentTarget)}>
          <Pencil className="h-4 w-4" aria-hidden />{t("studyFolder.edit")}
        </button>
      </footer>
    </article>
  );
}
