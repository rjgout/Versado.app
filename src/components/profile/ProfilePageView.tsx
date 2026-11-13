"use client";
import Footer from "@/components/Footer";
import type { ReactNode } from "react";

/** De bestaande profielshell, gedeeld door web en de lokale native bundel. */
export default function ProfilePageView({ title, children, overview = false }: { title?: string; children: ReactNode; overview?: boolean }) {
  return (
    <div data-profile-page className="page-fill mx-auto flex w-full max-w-3xl flex-col gap-10">
      <div className="flex flex-col gap-4 sm:gap-5">
        {title && <h1 tabIndex={-1} className="sr-only">{title}</h1>}
        {children}
      </div>
      {overview && (
        <div className="mt-auto">
          <Footer variant="inline" />
        </div>
      )}
    </div>
  );
}
