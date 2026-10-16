"use client";
import { useT } from "@/components/I18nProvider";
import { createContext, useContext } from "react";
export const ReferenceActionsContext = createContext<
  ((id: string, label: string, element: HTMLElement) => void) | null
>(null);
export const BlockedReferencesContext = createContext<readonly string[]>([]);
export default function ReferenceLink({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const t = useT();
  const open = useContext(ReferenceActionsContext);
  const blocked = useContext(BlockedReferencesContext);
  return open && !blocked.includes(id) ? (
    <button
      type="button"
      data-reference-key={id}
      className="inline min-h-12 max-w-full text-left font-semibold text-vs-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-2"
      onClick={(e) => open(id, label, e.currentTarget)}
    >
      {label}
    </button>
  ) : (
    <span
      data-blocked-reference={blocked.includes(id) ? id : undefined}
      title={
        blocked.includes(id) ? t("referencePreview.unavailable") : undefined
      }
      className="underline decoration-dotted"
    >
      {label}
    </span>
  );
}
