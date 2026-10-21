"use client";

import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from "react";

export type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; replace?: boolean };
export interface AppNavigation {
  pathname: string;
  push(href: string): void;
  replace(href: string): void;
  back(fallback?: string): void;
  canGoBack(): boolean;
  refresh(): void;
}
type NavigationAdapter = AppNavigation & { Link: ComponentType<AppLinkProps> };
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
