"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/I18nProvider";

/**
 * Optioneel: een eigen titel en knoptekst, en `destructive` voor een
 * onomkeerbare actie (rode bevestigknop). Zonder opties: "Bevestigen".
 */
export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** Top-layer/focus voor de nieuwe beheerpublicatieflow; oude aanroepen behouden hun UI. */
  native?: boolean;
  /** Informatieve melding met één sluitknop; geen bevestigde mutatie. */
  notice?: boolean;
}

interface PendingConfirmation extends ConfirmOptions {
  message: string;
  resolve: (confirmed: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const pendingRef = useRef<PendingConfirmation | null>(null);
  pendingRef.current = pending;

  const close = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    current.resolve(confirmed);
    setPending(null);
  }, []);

  const confirm = useCallback((message: string, options?: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, message, resolve });
    });
  }, []);

  useEffect(() => {
    if (!pending || pending.native) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close(false);
    }
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending?.native ? (
        <NativeConfirmation pending={pending} onClose={close} />
      ) : (
        pending && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
            onClick={() => close(false)}
          >
            <div
              className="card w-full max-w-sm !p-5 shadow-xl animate-pop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h2
                id="confirm-dialog-title"
                className="text-lg font-extrabold text-slate-800 dark:text-slate-100"
              >
                {pending.title ?? t("common.confirm")}
              </h2>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
                {pending.message}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className="btn-secondary !px-3 !py-2"
                  onClick={() => close(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  className={`btn-primary !px-3 !py-2 ${pending.destructive ? "!bg-red-600 hover:!bg-red-500 !shadow-[0_4px_0_0_theme(colors.red.800)]" : ""}`}
                  onClick={() => close(true)}
                >
                  {pending.confirmLabel ?? t("common.confirm")}
                </button>
              </div>
            </div>
          </div>
        )
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (
  message: string,
  options?: ConfirmOptions,
) => Promise<boolean> {
  const context = useContext(ConfirmContext);
  if (!context)
    throw new Error("useConfirm moet binnen ConfirmProvider worden gebruikt");
  return context.confirm;
}

function NativeConfirmation({
  pending,
  onClose,
}: {
  pending: PendingConfirmation;
  onClose: (confirmed: boolean) => void;
}) {
  const t = useT(),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const before =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby="native-confirm-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not([disabled])",
          ),
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose(false);
      }}
      className="m-auto max-h-[calc(100dvh-2rem-var(--vs-safe-area-top)-var(--vs-safe-area-bottom))] w-[calc(100%-1rem-var(--vs-safe-area-left)-var(--vs-safe-area-right))] max-w-md flex-col overflow-hidden rounded-2xl border border-vs-line bg-vs-elevated p-3 text-vs-fg open:flex shadow-xl backdrop:bg-slate-950/45"
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain" data-confirm-message>
        <h2 id="native-confirm-title" className="text-lg font-extrabold">
          {pending.title ?? t("common.confirm")}
        </h2>
        <p className="mt-3 text-sm text-vs-fg-2 [overflow-wrap:anywhere]">
          {pending.message}
        </p>
      </div>
      <div className="mt-4 flex shrink-0 flex-col gap-3">
        {!pending.notice && <>
        <button
          type="button"
          className="btn-secondary min-h-12 w-full !px-2 !tracking-normal [word-break:normal] [overflow-wrap:normal]"
          onClick={() => onClose(false)}
        >
          {t("common.cancel")}
        </button>
        </>}
        <button
          type="button"
          className="btn-primary min-h-12 w-full !px-2 !tracking-normal [word-break:normal] [overflow-wrap:normal]"
          onClick={() => onClose(true)}
        >
          {pending.confirmLabel ?? t("common.confirm")}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
