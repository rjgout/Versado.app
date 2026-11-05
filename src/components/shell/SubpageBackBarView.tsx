"use client";

import { ArrowLeft } from "lucide-react";
import { useT } from "@/components/I18nProvider";

/** De bestaande terugbalk; route-/geschiedenisregels komen van de adapter. */
export default function SubpageBackBarView({ title, subtitle, onBack }: { title: string; subtitle?: string | null; onBack: () => void }) {
  const t = useT();
  return (
    <div data-subpage-back-bar className="border-b border-vs-line bg-vs-elevated">
      <div className="mx-auto flex max-w-5xl min-w-0 items-center gap-1 px-4 py-1">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("common.back")}
          className="group -ml-3 flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded-xl pr-2 text-left transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-vs-fg-2 transition group-hover:text-vs-fg" aria-hidden>
            <ArrowLeft className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-extrabold text-vs-fg">{title}</span>
            {subtitle && <span className="block truncate text-xs font-semibold text-vs-fg-2">{subtitle}</span>}
          </span>
        </button>
      </div>
    </div>
  );
}
