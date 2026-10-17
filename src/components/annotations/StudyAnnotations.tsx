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
  selectorRanges,
} from "@/lib/annotations/domSelector";
import type { AnnotationTarget } from "@/lib/annotations/contract";
import type {
  AnnotationList,
  AnnotationView,
} from "@/lib/annotations/clientContract";
import type { ReaderDocument } from "@/lib/studyContent/readingPositionContract";
import AnnotationActions, { StudyAnnotationContext } from "./AnnotationActions";
import { secondaryButton } from "@/components/versado/styles";

export default function StudyAnnotations({
  document: body,
  editionId,
  revisionId,
  sessionKey,
  children,
  disabled,
}: {
  document: ReaderDocument;
  editionId: string;
  revisionId: string;
  sessionKey: string;
  disabled: boolean;
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
    [invalid, setInvalid] = useState(false);
  const list = useLiveQuery<AnnotationList>(
    ["annotations", "lesson", sessionKey, editionId, revisionId],
    () =>
      fetchJson(
        `/api/annotations?view=reader&lessonEditionId=${encodeURIComponent(editionId)}&revisionId=${encodeURIComponent(revisionId)}`,
      ),
    { scopes: ["annotations"] },
  );
  const rows = useMemo(() => list.data?.annotations ?? [], [list.data]);
  if (disabled && selected) setSelected(null);
  function open(blockId: string, element: HTMLElement) {
    if (disabled) return;
    try {
      const section = element.closest<HTMLElement>("[data-study-section]")!;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount !== 1) throw Error("SELECTION");
      const selector =
        selection && !selection.isCollapsed && selection.rangeCount === 1
          ? selectionToSelector(
              root.current!,
              body,
              revisionId,
              selection.getRangeAt(0),
            )
          : blockSelector(
              body,
              revisionId,
              section.dataset.studySection!,
              blockId,
            );
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
      setSelected({
        target: {
          type: "lesson",
          lessonEditionId: editionId,
          revisionId,
          selector,
        },
        element: selectionButton.current!,
      });
      setInvalid(false);
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
    for (const color of ["yellow", "green", "blue", "pink", "purple"]) {
      const ranges = rows
        .filter(
          (row) =>
            row.kind === "highlight" &&
            row.color === color &&
            row.target.type === "lesson",
        )
        .flatMap((row) => {
          try {
            return selectorRanges(
              root.current!,
              (row.target as Extract<AnnotationTarget, { type: "lesson" }>)
                .selector,
            );
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
  }, [rows, highlightId]);
  function changed(row: AnnotationView) {
    list.setData((old) =>
      old
        ? {
            ...old,
            annotations: [
              ...old.annotations.filter((r) => r.id !== row.id),
              ...(!row.deleted ? [row] : []),
            ],
          }
        : old,
    );
  }
  const marked = rows.flatMap((row) =>
    row.target.type === "lesson"
      ? row.target.selector.ranges.map((range) => range.blockId)
      : [],
  );
  return (
    <div ref={root} data-study-annotations>
      <style>
        {["yellow", "green", "blue", "pink", "purple"]
          .map(
            (color, index) =>
              `::highlight(annotation-${highlightId}-${color}) {background-color:${["#facc1540", "#4ade8040", "#60a5fa40", "#f472b640", "#c084fc40"][index]};color:inherit;}`,
          )
          .join("\n")}
      </style>
      <button
        ref={selectionButton}
        type="button"
        className={`${secondaryButton} mb-4`}
        disabled={disabled}
        onPointerDown={(e) => e.preventDefault()}
        onClick={select}
      >
        {t("annotations.selection")}
      </button>
      {invalid && (
        <p role="alert" className="mb-3 text-vs-fg-2">
          {t("annotations.invalid")}
        </p>
      )}
      {!!list.error && <p role="alert">{t("annotations.failed")}</p>}
      {list.data && !list.data.complete && (
        <p role="status">{t("annotations.incomplete")}</p>
      )}
      <StudyAnnotationContext.Provider value={{ open, marked }}>
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
