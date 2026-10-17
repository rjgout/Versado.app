"use client";
import { createContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bookmark,
  Highlighter,
  StickyNote,
  X,
  MoreHorizontal,
  Play,
} from "lucide-react";
import { useT } from "@/components/I18nProvider";
import {
  iconButton,
  primaryButton,
  secondaryButton,
} from "@/components/versado/styles";
import { fetchJson, ApiRequestError } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import {
  clientTargetKey,
  type AnnotationView,
  type AnnotationList,
} from "@/lib/annotations/clientContract";
import type {
  AnnotationAction,
  AnnotationKind,
  AnnotationTarget,
} from "@/lib/annotations/contract";

export const StudyAnnotationContext = createContext<{
  open(blockId: string, element: HTMLElement): void;
  marked: string[];
} | null>(null);
export function AnnotationTrigger({
  onClick,
  marked = false,
  label,
}: {
  onClick(element: HTMLElement): void;
  marked?: boolean;
  label?: string;
}) {
  const t = useT();
  // De ingang zelf ondersteunt longpress, zonder native tekstselectie/scrollhandlers op de tekst.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    fired = useRef(false);
  function clear() {
    if (timer.current) clearTimeout(timer.current);
  }
  useEffect(() => () => clear(), []);
  return (
    <button
      type="button"
      data-annotation-trigger
      aria-label={
        label ?? t(marked ? "annotations.existing" : "annotations.open")
      }
      aria-haspopup="dialog"
      className={`${iconButton} !h-auto min-h-11 !w-11 ${marked ? "!text-vs-accent" : "opacity-60 hover:opacity-100"}`}
      onPointerDown={(e) => {
        if (!window.getSelection()?.isCollapsed) e.preventDefault();
        fired.current = false;
        if (e.pointerType === "touch") {
          const element = e.currentTarget;
          clear();
          timer.current = setTimeout(() => {
            fired.current = true;
            onClick(element);
          }, 550);
        }
      }}
      onPointerMove={clear}
      onPointerCancel={clear}
      onPointerUp={clear}
      onClick={(e) => {
        clear();
        if (fired.current) {
          fired.current = false;
          return;
        }
        onClick(e.currentTarget);
      }}
    >
      <MoreHorizontal aria-hidden className="h-5 w-5" />
    </button>
  );
}
export default function AnnotationActions({
  target,
  returnFocus,
  onClose,
  onChanged,
  audio,
}: {
  target: AnnotationTarget;
  returnFocus: HTMLElement | null;
  onClose(): void;
  onChanged(row: AnnotationView): void;
  /** Alleen voor bronnen met een voorleesfunctie (schriftverzen); start bewust vanaf dit target. */
  audio?: { label: string; ready: boolean; onStart(): boolean };
}) {
  const t = useT(),
    dialog = useRef<HTMLDialogElement>(null),
    title = useId(),
    alive = useRef(true),
    lock = useRef(false);
  const [rows, setRows] = useState<AnnotationView[] | null>(null),
    [text, setText] = useState(""),
    [savedText, setSavedText] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<"failed" | "conflict" | null>(null),
    [saved, setSaved] = useState<AnnotationKind | null>(null),
    [discard, setDiscard] = useState(false);
  const pending = useRef<{
    action: AnnotationAction;
    method: "PUT" | "DELETE";
  } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  async function load(signal?: AbortSignal) {
    const key = await clientTargetKey(target);
    const result = await fetchJson<AnnotationList>(
      `/api/annotations?view=reader&targetKey=${encodeURIComponent(key)}`,
      { signal },
    );
    if (!alive.current || signal?.aborted) return;
    setRows(result.annotations);
    const note =
      result.annotations.find((r) => r.kind === "note" && !r.deleted)?.text ??
      "";
    setText(note);
    setSavedText(note);
    setError(null);
    setDiscard(false);
    pending.current = null;
    setUncertain(false);
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("failed");
    });
    return () => {
      alive.current = false;
      controller.abort();
    };
    // De parent remount bij een ander target of een andere revisie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const node = dialog.current!;
    const overflow = document.body.style.overflow,
      gutter = document.documentElement.style.scrollbarGutter;
    document.documentElement.style.scrollbarGutter = "stable";
    document.body.style.overflow = "hidden";
    node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = overflow;
      document.documentElement.style.scrollbarGutter = gutter;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [returnFocus]);
  useEffect(() => {
    const node=dialog.current;
    // Een verwijderknop kan na bevestiging verdwijnen: focus blijft in de dialoog.
    if(!busy && node?.open && !node.contains(document.activeElement)) {
      node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  },[rows,busy]);
  async function reload() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await load();
    } catch {
      if (alive.current) setError("failed");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function close() {
    if (busy || lock.current) return;
    if (text !== savedText || uncertain) {
      setDiscard(true);
      return;
    }
    onClose();
  }
  async function send(
    kind: AnnotationKind,
    remove = false,
    color?: AnnotationAction["color"],
  ) {
    if (lock.current || !rows || error === "conflict") return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setSaved(null);
    if (!pending.current) {
      const row = rows.find((r) => r.kind === kind);
      pending.current = {
        method: remove ? "DELETE" : "PUT",
        action: {
          kind,
          target,
          expectedVersion: row?.mutationVersion ?? 0,
          actionId: crypto.randomUUID(),
          ...(!remove && kind === "note" ? { text: text.trim() } : {}),
          ...(!remove && kind === "highlight"
            ? { color: color ?? "yellow" }
            : {}),
        },
      };
    }
    try {
      const next = await jsonMutation<{ annotation: AnnotationView }>(
        "/api/annotations",
        { method: pending.current.method, json: pending.current.action },
        { invalidates: "annotationsChanged" },
      );
      if (!alive.current) return;
      setRows((old) => [
        ...(old ?? []).filter((r) => r.kind !== next.annotation.kind),
        next.annotation,
      ]);
      if (next.annotation.kind === "note") {
        const note = next.annotation.deleted
          ? ""
          : (next.annotation.text ?? "");
        setText(note);
        setSavedText(note);
      }
      onChanged(next.annotation);
      pending.current = null;
      setUncertain(false);
      setDiscard(false);
      setSaved(next.annotation.kind);
    } catch (e) {
      if (!alive.current) return;
      const definitive =
        e instanceof ApiRequestError && e.status >= 400 && e.status < 500;
      if (definitive) pending.current = null;
      setUncertain(!definitive);
      setError(
        e instanceof ApiRequestError && e.status === 409
          ? "conflict"
          : "failed",
      );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const active = (kind: AnnotationKind) =>
    rows?.find((r) => r.kind === kind && !r.deleted);
  const disabled = busy || !rows || uncertain || error === "conflict";
  return createPortal(
    <dialog
      ref={dialog}
      data-annotation-dialog
      aria-labelledby={title}
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const elements = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button, textarea, input, select, a[href], [tabindex="0"]',
          ),
        ).filter(
          (element) =>
            !element.matches(":disabled") &&
            element.getClientRects().length > 0,
        );
        const first = elements[0],
          last = elements.at(-1),
          active = document.activeElement;
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (active === first || !event.currentTarget.contains(active))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (active === last || !event.currentTarget.contains(active))
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="vs-motion fixed inset-x-0 bottom-0 top-auto z-50 m-auto mb-0 max-h-[calc(100dvh-1rem-var(--vs-safe-area-top))] w-[calc(100%-var(--vs-safe-area-left)-var(--vs-safe-area-right))] max-w-[34rem] overflow-y-auto overscroll-contain rounded-t-3xl border border-vs-line bg-vs-elevated p-4 pb-[calc(1rem+var(--vs-safe-area-bottom))] text-vs-fg shadow-xl backdrop:bg-vs-overlay/40 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-3xl"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 id={title} className="min-w-0 break-words text-lg font-bold">
          {t("annotations.title")}
        </h2>
        <button
          autoFocus
          type="button"
          className={iconButton}
          aria-label={t("annotations.close")}
          onClick={close}
          disabled={busy}
        >
          <X aria-hidden className="h-5 w-5" />
        </button>
      </header>
      {target.type === "lesson" && (
        <p className="my-3 max-h-24 overflow-auto whitespace-pre-wrap break-words text-sm text-vs-fg-2">
          {target.selector.exact}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-3">
        {audio && (
          <>
            <button
              type="button"
              data-annotation-read-aloud
              disabled={!audio.ready}
              className={`${primaryButton} min-h-11`}
              onClick={() => {
                if (audio.onStart()) close();
              }}
            >
              <Play className="h-5 w-5 shrink-0" aria-hidden />
              {audio.label}
            </button>
            {!audio.ready && (
              <p role="status" className="text-sm text-vs-fg-2">
                {t("annotations.audioPreparing")}
              </p>
            )}
          </>
        )}
        <button
          type="button"
          disabled={disabled}
          aria-pressed={!!active("bookmark")}
          className={`${secondaryButton} flex-col !px-3 sm:flex-row`}
          onClick={() => void send("bookmark", !!active("bookmark"))}
        >
          <Bookmark className="h-5 w-5 shrink-0" aria-hidden />
          {t(
            active("bookmark")
              ? "annotations.bookmarkRemove"
              : "annotations.bookmarkAdd",
          )}
        </button>
        <fieldset disabled={disabled} className="min-w-0">
          <legend className="mb-2 flex items-center gap-2 font-semibold">
            <Highlighter className="h-5 w-5" aria-hidden />
            {t("annotations.highlight")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {(["yellow", "green", "blue", "pink", "purple"] as const).map(
              (color) => (
                <button
                  key={color}
                  type="button"
                  aria-pressed={active("highlight")?.color === color}
                  className={`${secondaryButton} min-h-11 ${active("highlight")?.color === color ? "ring-2 ring-vs-accent" : ""}`}
                  onClick={() => void send("highlight", false, color)}
                >
                  {t(`annotations.${color}`)}
                </button>
              ),
            )}
          </div>
          {active("highlight") && (
            <button
              type="button"
              className={`${secondaryButton} mt-2`}
              onClick={() => void send("highlight", true)}
            >
              {t("annotations.highlightRemove")}
            </button>
          )}
        </fieldset>
        <label className="flex flex-col gap-2 font-semibold">
          <span className="flex items-center gap-2">
            <StickyNote className="h-5 w-5" aria-hidden />
            {t("annotations.note")}
          </span>
          <textarea
            data-annotation-note
            maxLength={2000}
            rows={4}
            className="min-h-28 w-full min-w-0 rounded-xl border border-vs-line bg-vs-surface p-3 font-normal text-vs-fg focus-visible:outline-vs-accent"
            disabled={!rows || busy || uncertain}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(null);
            }}
          />
        </label>
        <p className="text-sm text-vs-fg-2">{text.length}/2000</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled || !text.trim()}
            className={primaryButton}
            onClick={() => void send("note")}
          >
            {t("annotations.save")}
          </button>
          {active("note") && (
            <button
              type="button"
              disabled={disabled}
              className={secondaryButton}
              onClick={() => void send("note", true)}
            >
              {t("annotations.noteRemove")}
            </button>
          )}
        </div>
        <p role="status" aria-live="polite">
          {busy
            ? t("annotations.saving")
            : saved
              ? `${t(`annotations.${saved}`)}: ${t("annotations.saved")}`
              : ""}
        </p>
        {error && (
          <div role="alert" className="space-y-2">
            <p>
              {t(
                error === "conflict"
                  ? "annotations.conflict"
                  : "annotations.failed",
              )}
            </p>
            {!rows || error === "conflict" ? (
              <button
                type="button"
                className={secondaryButton}
                disabled={busy}
                onClick={() => void reload()}
              >
                {t("annotations.reload")}
              </button>
            ) : uncertain ? (
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  const action = pending.current;
                  if (action) void send(action.action.kind);
                }}
              >
                {t("annotations.retry")}
              </button>
            ) : null}
          </div>
        )}
        {discard && (
          <div className="space-y-2 border-t border-vs-line pt-3">
            <p>{t("annotations.unsaved")}</p>
            <button type="button" className={secondaryButton} onClick={onClose}>
              {t("annotations.discard")}
            </button>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => setDiscard(false)}
            >
              {t("annotations.cancel")}
            </button>
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
