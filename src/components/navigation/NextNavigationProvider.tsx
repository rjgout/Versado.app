"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { AppNavigationProvider, type AppLinkProps } from "./AppNavigation";

function NextAppLink(props: AppLinkProps) { return <Link {...props} />; }
/** Alleen deze adapter importeert Next; de webrouter behoudt zijn Link/prefetch. */
export default function NextNavigationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname(), router = useRouter();
  const adapter = useMemo(() => ({
    pathname, Link: NextAppLink,
    push: (href: string) => router.push(href), replace: (href: string) => router.replace(href),
    back: () => router.back(), canGoBack: () => window.history.length > 1, refresh: () => router.refresh(),
  }), [pathname, router]);
  return <AppNavigationProvider adapter={adapter}>{children}</AppNavigationProvider>;
}
