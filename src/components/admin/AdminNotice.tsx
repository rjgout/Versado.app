import type { ReactNode } from "react";

/** Status-, succes- en foutmelding in een beheerblok; fouten zijn een alert, de rest een status. */
export default function AdminNotice({ kind, children }: { kind: "error" | "success" | "info" | "warning"; children: ReactNode }) {
  const tone = {
    error: "bg-vs-danger-soft text-vs-danger",
    success: "bg-vs-accent-soft text-vs-accent",
    info: "bg-vs-subtle text-vs-fg-2",
    warning: "bg-vs-warning-soft text-vs-warning",
  }[kind];
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-sm font-semibold ${tone}`}>
      {children}
    </p>
  );
}
