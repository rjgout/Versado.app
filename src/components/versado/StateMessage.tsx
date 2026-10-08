import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Eén vorm voor laden, leeg en fout in de hulpmiddelen. Laden is rustig en
 * wordt aangekondigd, een fout is een waarschuwing (role="alert") met een
 * herstelactie, en een lege staat legt uit wat er aan de hand is en wat de
 * volgende stap is.
 */
export default function StateMessage({
  kind,
  title,
  text,
  icon: Icon,
  action,
}: {
  kind: "loading" | "empty" | "error";
  title: string;
  text?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  const tone = kind === "error" ? "text-vs-danger" : "text-vs-fg-3";
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center" role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"}>
      {kind === "loading" ? (
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-vs-line-strong border-t-vs-accent motion-reduce:animate-none" aria-hidden />
      ) : (
        Icon && <Icon className={`h-8 w-8 ${tone}`} aria-hidden />
      )}
      <p className={`font-bold ${kind === "error" ? "text-vs-danger" : "text-vs-fg"}`}>{title}</p>
      {text && <p className="max-w-sm text-sm text-vs-fg-3">{text}</p>}
      {action}
    </div>
  );
}
