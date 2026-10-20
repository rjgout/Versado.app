"use client";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useT } from "@/components/I18nProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import {
  blockSelector,
  selectionToSelector,
  selectionTouchesBlock,
  selectorRanges,
} from "@/lib/annotations/domSelector";
import type { AnnotationTarget } from "@/lib/annotations/contract";
import { ANNOTATION_COLORS } from "@/lib/annotations/clientContract";
import type {
  AnnotationList,
  AnnotationView,
} from "@/lib/annotations/clientContract";
import type { ReaderDocument } from "@/lib/studyContent/readingPositionContract";
import AnnotationActions, { StudyAnnotationContext } from "./AnnotationActions";
import AnnotationRecovery from "./AnnotationRecovery";
import type { AnnotationFocus } from "@/lib/annotations/studyFocus";
import type { AnnotationKind, PassageSelector } from "@/lib/annotations/contract";
import { secondaryButton } from "@/components/versado/styles";

export default function StudyAnnotations({
  document: body,
  editionId,
  revisionId,
  sessionKey,
  children,
  disabled,
  recovery = null,
  compact = false,
}: {
  document: ReaderDocument;
  editionId: string;
  revisionId: string;
  sessionKey: string;
  disabled: boolean;
  /** Fase 4D: een voorstel of verloren passage van de geopende annotatie; anders null. */
  recovery?: AnnotationFocus | null;
  /** Persoonlijke studie 2.0: de selectie-actie is een rustige, kleine knop in plaats van een dominante knop. */
  compact?: boolean;
  children: ReactNode;
}) {
  const t = useT(),
    root = useRef<HTMLDivElement>(null),
    selectionButton = useRef<HTMLButtonElement>(null),
    highlightId = useId().replace(/[^a-z0-9]/gi, "");
  const [selected, setSelected] = useState<{
      target: AnnotationTarget;
      element: HTMLElement;
    } | null>(null),
    [invalid, setInvalid] = useState(false),
    [pickMode, setPickMode] = useState(false),
    [picked, setPicked] = useState<PassageSelector | null>(null);
  const list = useLiveQuery<AnnotationList>(
    ["annotations", "lesson", sessionKey, editionId, revisionId],
    () =>
      fetchJson(
        `/api/annotations?view=reader&lessonEditionId=${encodeURIComponent(editionId)}&revisionId=${encodeURIComponent(revisionId)}`,
      ),
    { scopes: ["annotations"] },
  );
  const rows = useMemo(() => list.data?.annotations ?? [], [list.data]);
  // Het oorspronkelijke target blijft de identiteit; de zichtbare plaats is alleen een bewezen exacte plaats (fase 4D).
  // Zonder serverplaatsing (bv. direct na een bewerking) geldt de oorspronkelijke selector alleen als hij bij de werkelijk
  // getoonde revisie hoort; anders liever tijdelijk geen markering dan een markering op de verkeerde tekst.
  const effective = (row: AnnotationView): PassageSelector | null =>
    row.placement ? (row.placement.status === "EXACT" ? (row.placement.selector ?? null) : null)
      : row.target.type === "lesson" && row.target.selector.originalRevisionId === revisionId ? row.target.selector : null;
  if (disabled && selected) setSelected(null);
  function open(blockId: string, element: HTMLElement) {
    if (disabled || pickMode) return;
    try {
      const section = element.closest<HTMLElement>("[data-study-section]")!;
      // Een native selectie telt alleen mee als zij dit blok raakt of omvat. Een selectie elders blijft liggen en wordt
      // genegeerd (blokdoel); een relevante maar ongeldige of ambigue selectie wordt geweigerd, nooit omgezet in een ander doel.
      const selection = window.getSelection();
      const relevant = !!selection && selectionTouchesBlock(selection, section, blockId);
      if (relevant && selection!.rangeCount !== 1) throw Error("SELECTION");
      const selector = relevant
        ? selectionToSelector(root.current!, body, revisionId, selection!.getRangeAt(0))
        : blockSelector(body, revisionId, section.dataset.studySection!, blockId);
      setSelected({
        target: {
          type: "lesson",
          lessonEditionId: editionId,
          revisionId,
          selector,
        },
        element,
      });
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }
  function select() {
    if (disabled) return;
    try {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount !== 1) throw Error("SELECTION");
      const selector = selectionToSelector(
        root.current!,
        body,
        revisionId,
        selection.getRangeAt(0),
      );
      setInvalid(false);
      // Herstelactie: de gekozen passage wordt eerst getoond en pas na bevestiging aan de bestaande annotatie gekoppeld.
      if (pickMode) { setPicked(selector); return; }
      setSelected({
        target: {
          type: "lesson",
          lessonEditionId: editionId,
          revisionId,
          selector,
        },
        element: selectionButton.current!,
      });
    } catch {
      setInvalid(true);
    }
  }
  useEffect(() => {
    // CSS Highlight API: geen tekstwrappers, geen kapotte referentielinks of dubbele mark-tags.
    const css = CSS as typeof CSS & { highlights?: Map<string, unknown> };
    const HighlightClass = (
      window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
    ).Highlight;
    if (!css.highlights || !HighlightClass || !root.current) return;
    const keys: string[] = [];
    for (const color of ANNOTATION_COLORS) {
      const ranges = rows
        .filter(
          (row) =>
            row.kind === "highlight" &&
            row.color === color &&
            row.target.type === "lesson",
        )
        .flatMap((row) => {
          try {
            const selector = effective(row);
            return selector ? selectorRanges(root.current!, selector) : [];
          } catch {
            return [];
          }
        });
      const key = `annotation-${highlightId}-${color}`;
      keys.push(key);
      css.highlights.set(key, new HighlightClass(...ranges));
    }
    return () => {
      keys.forEach((key) => css.highlights?.delete(key));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, highlightId]);
  function changed(row: AnnotationView) {
    list.setData((old) => {
      if (!old) return old;
      // Dezelfde annotatie-identiteit behoudt haar door de server bewezen plaats (alleen kleur/tekst veranderden); de
      // centrale annotationsChanged-invalidatie haalt daarna de definitieve plaatsing op.
      const previous = old.annotations.find((r) => r.id === row.id);
      const next = !row.placement && previous?.placement && previous.targetKey === row.targetKey ? { ...row, placement: previous.placement } : row;
      return { ...old, annotations: [...old.annotations.filter((r) => r.id !== row.id), ...(!row.deleted ? [next] : [])] };
    });
  }
  const marked = rows.flatMap((row) => effective(row)?.ranges.map((range) => range.blockId) ?? []);
  const kinds: Record<string, AnnotationKind[]> = {};
  for (const row of rows)
    for (const range of effective(row)?.ranges ?? [])
      if (!(kinds[range.blockId] ??= []).includes(row.kind)) kinds[range.blockId].push(row.kind);
  return (
    <div ref={root} data-study-annotations>
      <style>
        {ANNOTATION_COLORS.map(
          (color) =>
            // Kleuren per thema uit globals.css. Alleen eigenschappen die ::highlight ondersteunt: achtergrond plus een
            // gekleurde onderstreping als tweede aanwijzing; de tekstkleur blijft die van de pagina.
            `::highlight(annotation-${highlightId}-${color}) {background-color:rgb(var(--vs-mark-${color}) / var(--vs-mark-alpha));color:inherit;text-decoration:underline;text-decoration-color:rgb(var(--vs-mark-${color}));text-decoration-thickness:2px;text-underline-offset:0.2em;}`,
        ).join("\n")}
      </style>
      {/* Persoonlijke studie: geen permanente knop; de alinea aantikken (of een selectie in die alinea) opent de acties.
          Alleen bij het kiezen van een nieuwe passage voor een verloren annotatie is de knop nodig. */}
      {(!compact || pickMode) && (
        <button
          ref={selectionButton}
          data-annotation-selection
          type="button"
          className={`${secondaryButton} ${compact ? "mb-3 !min-h-9 !px-3" : "mb-4"}`}
          disabled={disabled}
          onPointerDown={(e) => e.preventDefault()}
          onClick={select}
        >
          {t("annotations.selection")}
        </button>
      )}
      {recovery && (recovery.status === "proposal" || recovery.status === "orphaned") && (
        <AnnotationRecovery
          recovery={recovery}
          revisionId={revisionId}
          pickMode={pickMode}
          picked={picked}
          onPick={() => { setPickMode(true); setPicked(null); }}
          onCancelPick={() => { setPickMode(false); setPicked(null); }}
        />
      )}
      {invalid && (
        <p role="alert" className="mb-3 text-vs-fg-2">
          {t("annotations.invalid")}
        </p>
      )}
      {!!list.error && <p role="alert">{t("annotations.failed")}</p>}
      {list.data && !list.data.complete && (
        <p role="status">{t("annotations.incomplete")}</p>
      )}
      <StudyAnnotationContext.Provider value={{ open, marked, kinds }}>
        {children}
      </StudyAnnotationContext.Provider>
      {/* Bestaande exacte passages blijven individueel bereikbaar, ook bij overlap. */}
      {!!rows.length && (
        <details className="mt-4 rounded-xl border border-vs-line p-3">
          <summary>{t("annotations.existing")}</summary>
          <ul className="mt-3 space-y-2">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  disabled={disabled}
                  className={`${secondaryButton} !justify-start whitespace-normal break-words text-left`}
                  onClick={(e) =>
                    setSelected({
                      target: row.target,
                      element: e.currentTarget,
                    })
                  }
                >
                  {t(`annotations.${row.kind}`)} —{" "}
                  {row.target.type === "lesson"
                    ? row.target.selector.exact.slice(0, 120)
                    : ""}
                  {row.placement && row.placement.status !== "EXACT" && (
                    <span className="ml-2 text-xs text-vs-fg-3">
                      ({t(row.placement.status === "NEEDS_REVIEW" ? "studyFolder.recoveryReview" : "studyFolder.recoveryMissing")})
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {selected && !disabled && (
        <AnnotationActions
          target={selected.target}
          returnFocus={selected.element}
          onClose={() => setSelected(null)}
          onChanged={changed}
        />
      )}
    </div>
  );
}
