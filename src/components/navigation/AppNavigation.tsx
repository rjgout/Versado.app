"use client";

import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode, type ImgHTMLAttributes, type Ref } from "react";

export type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; replace?: boolean; prefetch?: boolean; ref?: Ref<HTMLAnchorElement>; onNavigate?: (event: { preventDefault(): void }) => void };
export type AppImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height" | "alt"> & { src: string; alt: string; width: number; height: number };
export interface AppNavigation {
  pathname: string;
  contentDeparture?(): string;
  push(href: string): void;
  replace(href: string): void;
  back(fallback?: string): void;
  canGoBack(): boolean;
  refresh(): void;
}
type NavigationAdapter = AppNavigation & { Link: ComponentType<AppLinkProps>; Image?: ComponentType<AppImageProps> };
const Context = createContext<NavigationAdapter | null>(null);

/** De gedeelde UI kent geen Next-router of native URL-schema. */
export function AppNavigationProvider({ adapter, children }: { adapter: NavigationAdapter; children: ReactNode }) {
  return <Context.Provider value={adapter}>{children}</Context.Provider>;
}
export function useAppNavigation(): AppNavigation {
  const adapter = useContext(Context);
  if (!adapter) throw new Error("AppNavigationProvider ontbreekt");
  return adapter;
}
export function AppLink(props: AppLinkProps) {
  const adapter = useContext(Context);
  if (!adapter) throw new Error("AppNavigationProvider ontbreekt");
  const Link = adapter.Link;
  return <Link {...props} />;
}

/** Eén mediapoort: web behoudt Next-optimalisatie, native gebruikt de lokale asset. */
export function AppImage(props: AppImageProps) {
  const adapter = useContext(Context);
  if (adapter?.Image) { const Image = adapter.Image; return <Image {...props} alt={props.alt} />; }
  // eslint-disable-next-line @next/next/no-img-element -- Lokale Capacitor-assets en providerloze previews.
  return <img {...props} alt={props.alt ?? ""} />;
}
