import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { interactiveCard } from "@/components/versado/styles";

/** Ingang naar een beheergroep op de admin-hoofdpagina: icoon, titel, uitleg en echte statussen. */
export default function AdminCategoryCard({
  href,
  icon: Icon,
  title,
  description,
  stats,
  attention,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** Alleen echte gegevens: [label, waarde]. */
  stats?: { label: string; value: ReactNode }[];
  /** Iets dat aandacht vraagt (bijv. nieuwe feedback); krijgt een opvallender label. */
  attention?: string;
}) {
  return (
    <Link href={href} className={`group flex h-full min-h-24 items-start gap-4 p-4 ${interactiveCard}`}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-vs-accent-soft text-vs-accent" aria-hidden>
        <Icon className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-extrabold text-vs-fg">{title}</span>
          {attention && <span className="rounded-full bg-vs-warning-soft px-2 py-0.5 text-xs font-bold text-vs-warning">{attention}</span>}
        </span>
        <span className="mt-0.5 block text-sm text-vs-fg-2">{description}</span>
        {stats && stats.length > 0 && (
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-1">
                <dd className="font-extrabold text-vs-fg">{stat.value}</dd>
                <dt className="font-medium text-vs-fg-3">{stat.label}</dt>
              </div>
            ))}
          </dl>
        )}
      </span>
      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-vs-fg-3 transition group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
    </Link>
  );
}
