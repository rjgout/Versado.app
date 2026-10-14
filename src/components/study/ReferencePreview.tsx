"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  onMore: () => Promise<void>;
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
    [retry, setRetry] = useState(0);
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
      body: JSON.stringify({ action: "preview", ...request }),
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [request, sessionKey, retry]);
  async function more() {
    if (busy) return;
    setBusy(true);
    setMoreError(null);
    try {
      await onMore();
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
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-vs-line px-4 py-3">
        <h2 id={title} className="min-w-0 flex-1 line-clamp-3 text-lg font-extrabold">
          {label}
        </h2>
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
        {result?.kind === "internal" && (
          <>
            <p className="mb-4 text-sm font-semibold text-vs-fg-2">
              {result.title} · {result.language} · {result.editionKey}
            </p>
            {result.preview.kind === "scripture" ? (
              <div className="space-y-3" lang={result.language}>
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
          <p role="alert" className="mt-4 text-sm">
            {t(
              moreError === "save"
                ? "referencePreview.saveFailed"
                : moreError === "conflict"
                  ? "referencePreview.selectionConflict"
                  : "referencePreview.moreUnknown",
            )}
          </p>
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
