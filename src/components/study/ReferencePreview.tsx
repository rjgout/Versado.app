"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { clearReferenceTrips } from "@/lib/references/returnContext";
import { X, ExternalLink } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { fetchJson, ApiRequestError } from "@/lib/data/fetchJson";
import type {
  ReferenceRequest,
  ReferenceResolution,
} from "@/lib/references/contract";
import RichContentBlocks from "./RichContentBlocks";
export default function ReferencePreview({
  request,
  label,
  sessionKey,
  onClose,
  onMore,
  returnFocus,
}: {
  request: ReferenceRequest;
  label: string;
  sessionKey: string;
  onClose: () => void;
  onMore: (passageIndex?: number) => Promise<void>;
  returnFocus: HTMLElement | null;
}) {
  const t = useT(),
    dialog = useRef<HTMLDialogElement>(null),
    title = useId();
  const [result, setResult] = useState<ReferenceResolution | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [moreError, setMoreError] = useState<
      "save" | "conflict" | "unknown" | null
    >(null),
    [retry, setRetry] = useState(0),
    [passageIndex, setPassageIndex] = useState(0),
    [choices, setChoices] = useState<Array<{ index: number; title: string }>>(
      [],
    );
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
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
    const controller = new AbortController();
    void fetchJson<ReferenceResolution>("/api/study-references", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Reading-Session": sessionKey,
      },
      body: JSON.stringify({ action: "preview", ...request, passageIndex }),
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult(data);
          setChoices(data.kind === "internal" ? (data.passages ?? []) : []);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [request, sessionKey, retry, passageIndex]);
  async function more() {
    if (busy) return;
    setBusy(true);
    setMoreError(null);
    try {
      await onMore(passageIndex);
    } catch (error) {
      setMoreError(
        error instanceof ApiRequestError && error.status === 409
          ? "conflict"
          : error instanceof Error &&
              error.message === "READING_POSITION_NOT_SAVED"
            ? "save"
            : "unknown",
      );
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={title}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 z-50 m-auto flex max-h-[calc(100dvh-2rem-var(--vs-safe-area-top)-var(--vs-safe-area-bottom))] w-[calc(100%-2rem-var(--vs-safe-area-left)-var(--vs-safe-area-right))] max-w-xl flex-col overflow-hidden rounded-3xl border border-vs-line bg-vs-elevated p-0 text-vs-fg shadow-xl backdrop:bg-slate-950/45"
    >
      <header className="flex flex-row-reverse flex-wrap shrink-0 items-center justify-between gap-3 border-b border-vs-line px-4 py-3">
        <button
          autoFocus
          type="button"
          disabled={busy}
          className="flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-full text-vs-fg-2 focus-visible:ring-2 focus-visible:ring-vs-accent"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <X size={22} aria-hidden />
        </button>
        <h2
          id={title}
          className="min-w-0 grow basis-[9rem] line-clamp-3 text-lg font-extrabold"
        >
          {label}
        </h2>
      </header>
      <div
        className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4"
        data-reference-preview
      >
        {error && (
          <div className="space-y-3">
            <p role="alert">{t("referencePreview.failed")}</p>
            <button
              className="btn-secondary min-h-12"
              type="button"
              onClick={() => {
                setResult(null);
                setError(false);
                setRetry((v) => v + 1);
              }}
            >
              {t("studyReader.retry")}
            </button>
          </div>
        )}
        {!result && !error && <p role="status">{t("common.loading")}</p>}
        {result?.kind === "unavailable" && (
          <p role="status">{t("referencePreview.unavailable")}</p>
        )}
        {result?.kind === "external" && (
          <div className="space-y-4">
            <p>{t("referencePreview.externalNotice")}</p>
            {result.language === "en" && (
              <p
                data-reference-source-language="en"
                className="text-sm text-vs-fg-2"
              >
                {t("referencePreview.sourceEnglish")}
              </p>
            )}
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary inline-flex min-h-12 gap-2"
            >
              <ExternalLink size={20} aria-hidden />
              {t("referencePreview.external")}
            </a>
          </div>
        )}
        {result?.kind === "hymn" && (
          <div className="space-y-4" data-reference-hymn={result.number}>
            <p className="text-sm font-semibold text-vs-fg-2">
              {t("referencePreview.hymnLabel", { n: result.number })} · {result.title}
            </p>
            <Link href={result.href} prefetch={false} className="btn-primary inline-flex min-h-12 gap-2">
              {t("referencePreview.openHymn")}
            </Link>
            <p>
              <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-vs-accent underline underline-offset-2">
                <ExternalLink size={18} aria-hidden />
                {t("referencePreview.external")}
              </a>
            </p>
          </div>
        )}
        {choices.length > 0 && (
          <fieldset className="mb-4 min-w-0 space-y-2" disabled={busy}>
            <legend className="mb-2 font-semibold">
              {t("referencePreview.passages")}
            </legend>
            <div
              lang={result?.kind === "internal" ? result.language : undefined}
              className="flex max-h-40 flex-wrap gap-2 overflow-y-auto"
              data-reference-passages
            >
              {choices.map((p) => (
                <button
                  key={p.index}
                  type="button"
                  aria-pressed={p.index === passageIndex}
                  className={`min-h-12 max-w-full whitespace-normal rounded-xl border px-3 py-2 text-left text-sm ${p.index === passageIndex ? "border-vs-accent bg-vs-accent-soft font-bold" : "border-vs-line bg-vs-surface"}`}
                  onClick={() => {
                    setMoreError(null);
                    setError(false);
                    setResult(null);
                    setPassageIndex(p.index);
                  }}
                >
                  {p.title}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {result?.kind === "internal" && (
          <>
            <p className="mb-4 text-sm font-semibold text-vs-fg-2">
              {result.title} · {result.language} · {result.editionKey}
            </p>
            {result.preview.kind === "scripture" ? (
              <div className="space-y-3" lang={result.language}>
                {result.preview.truncated && (
                  <p
                    className="rounded-xl bg-vs-surface px-3 py-2 text-sm text-vs-fg-2"
                    data-reference-preview-truncated
                  >
                    {t("referencePreview.truncated")}
                  </p>
                )}
                {result.preview.verses.map((v) => (
                  <p key={v.number} className="leading-relaxed">
                    <sup className="mr-2 font-bold text-vs-accent">
                      {v.number}
                    </sup>
                    {v.text}
                  </p>
                ))}
              </div>
            ) : (
              <RichContentBlocks
                document={result.preview.document}
                media={result.preview.media}
              />
            )}
          </>
        )}
        {moreError && (
          <div className="mt-4 space-y-2">
            <p role="alert" className="text-sm">
              {t(
                moreError === "save"
                  ? "referencePreview.saveFailed"
                  : moreError === "conflict"
                    ? "referencePreview.selectionConflict"
                    : "referencePreview.moreUnknown",
              )}
            </p>
            <Link
              href="/content"
              onClick={clearReferenceTrips}
              className="btn-secondary inline-flex min-h-12"
            >
              {t("contentSwitcher.picker.title")}
            </Link>
          </div>
        )}
        {result?.kind === "internal" && (
          <footer className="mt-4 border-t border-vs-line pt-3">
            <button
              type="button"
              disabled={busy}
              className="btn-primary min-h-12 w-full"
              onClick={() => void more()}
            >
              {busy ? t("common.loading") : t("referencePreview.more")}
            </button>
            <p className="mt-2 text-sm text-vs-fg-2">
              {t("referencePreview.readonly")}
            </p>
          </footer>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
