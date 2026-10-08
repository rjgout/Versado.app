import type { ReactNode } from "react";

/**
 * Brede tabellen scrollen binnen hun eigen vak en maken de pagina nooit breder.
 * Het vak is focusbaar zodat ook toetsenbordgebruikers kunnen scrollen.
 */
export default function AdminTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-vs-line outline-none focus-visible:ring-2 focus-visible:ring-vs-accent">
      {children}
    </div>
  );
}
