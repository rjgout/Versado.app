import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { focusRing, surfaceCard } from "@/components/versado/styles";

/**
 * Eén beheerblok: een inklapbare kaart met titel, optionele uitleg en status.
 * Zonder hooks, dus bruikbaar in server- en clientcomponenten. `<details>` is
 * bewust de native bediening (toetsenbord en schermlezer werken vanzelf).
 * `tone="danger"` markeert een blok met ingrijpende acties, zodat het er
 * anders uitziet dan gewone instellingen.
 */
export default function AdminSection({
  title,
  description,
  badge,
  tone = "default",
  defaultOpen = false,
  id,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Korte echte status of telling naast de titel (al vertaald door de aanroeper). */
  badge?: ReactNode;
  tone?: "default" | "danger";
  defaultOpen?: boolean;
  id?: string;
  children: ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <details id={id} open={defaultOpen} className={`group min-w-0 scroll-mt-[calc(var(--header-offset,var(--header-default))+1rem)] ${surfaceCard} ${danger ? "!border-vs-danger/40" : ""}`}>
      <summary className={`flex min-h-14 cursor-pointer select-none list-none items-center gap-3 rounded-2xl px-4 py-3 [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <span className="min-w-0 flex-1">
          <span className={`block text-base font-extrabold ${danger ? "text-vs-danger" : "text-vs-fg"}`}>{title}</span>
          {description && <span className="mt-0.5 block text-xs font-medium text-vs-fg-2">{description}</span>}
        </span>
        {badge && <span className="shrink-0 rounded-full bg-vs-subtle px-2.5 py-1 text-xs font-bold text-vs-fg-2">{badge}</span>}
        <ChevronDown className="h-5 w-5 shrink-0 text-vs-fg-3 transition-transform motion-reduce:transition-none group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex min-w-0 flex-col gap-4 border-t border-vs-line p-4">{children}</div>
    </details>
  );
}
