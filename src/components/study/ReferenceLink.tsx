"use client";
import { createContext, useContext } from "react";
export const ReferenceActionsContext = createContext<
  ((id: string, label: string, element: HTMLElement) => void) | null
>(null);
export default function ReferenceLink({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const open = useContext(ReferenceActionsContext);
  return open ? (
    <button
      type="button"
      data-reference-key={id}
      className="inline min-h-12 max-w-full text-left font-semibold text-vs-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-2"
      onClick={(e) => open(id, label, e.currentTarget)}
    >
      {label}
    </button>
  ) : (
    <span className="underline decoration-dotted">{label}</span>
  );
}
