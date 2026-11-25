"use client";

import type { ReactNode } from "react";
import { AppLink, useAppNavigation } from "@/components/navigation/AppNavigation";
import { useT } from "@/components/I18nProvider";

/** Dezelfde profielingang; avatar-ophalen blijft in de platformdata-adapter. */
export default function HeaderAvatarView({ avatar }: { avatar: ReactNode }) {
  const t = useT();
  const active = useAppNavigation().pathname.startsWith("/profile");
  return <AppLink href="/profile" data-kompas-target="profile" aria-label={t("nav.profile")} aria-current={active ? "page" : undefined}
    className={`vs-motion flex h-10 w-10 items-center justify-center rounded-full transition ring-offset-2 ring-offset-vs-elevated hover:ring-2 hover:ring-vs-line-strong ${active ? "ring-2 ring-vs-accent" : ""}`}>
    {avatar}
  </AppLink>;
}
