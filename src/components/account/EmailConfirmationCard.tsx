import type { ReactNode } from "react";

/** Bestaande web-uitkomstkaart; ook lokaal zonder Next/serverafhankelijkheid. */
export default function EmailConfirmationCard({ status, title, children }: { status: "confirmed" | "already" | "expired" | "invalid"; title: string; children: ReactNode }) {
  const success = status === "confirmed" || status === "already";
  return <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
    {status === "confirmed" && <div className="text-5xl" aria-hidden>✅</div>}
    <h1 tabIndex={-1} className={`text-xl font-extrabold ${success ? "text-brand-800 dark:text-brand-300" : "text-red-600 dark:text-red-400"}`}>{title}</h1>
    {children}
  </div>;
}
