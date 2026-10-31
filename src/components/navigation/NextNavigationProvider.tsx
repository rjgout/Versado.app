"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { AppNavigationProvider, type AppLinkProps, type AppImageProps } from "./AppNavigation";

function NextAppLink(props: AppLinkProps) { return <Link {...props} />; }
function NextAppImage(props: AppImageProps) { return <Image {...props} alt={props.alt} />; }
/** Alleen deze adapter importeert Next; de webrouter behoudt zijn Link/prefetch. */
export default function NextNavigationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname(), router = useRouter();
  const adapter = useMemo(() => ({
    pathname, Link: NextAppLink, Image: NextAppImage,
    push: (href: string) => router.push(href), replace: (href: string) => router.replace(href),
    back: () => router.back(), canGoBack: () => window.history.length > 1, refresh: () => router.refresh(),
  }), [pathname, router]);
  return <AppNavigationProvider adapter={adapter}>{children}</AppNavigationProvider>;
}
