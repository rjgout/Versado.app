import type { ReactNode } from "react";
import PageIntro from "@/components/versado/PageIntro";

/** Kop van een beheerpagina; de terugknop komt uit SubpageBackBar, dus hier staat alleen de titel. */
export default function AdminPageHeader({ title, text, aside }: { title: string; text?: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 flex-1">
        <PageIntro title={title} text={text} />
      </div>
      {aside}
    </div>
  );
}
