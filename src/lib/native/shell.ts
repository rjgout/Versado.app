import { PRIMARY_NAV } from "@/lib/navigation";
import { nativeRoute } from "./navigation";

// Alleen werkelijk ondersteunde lokale bestemmingen; capability en tickettransport
// worden samen gecontroleerd voordat de volledige spelcatalogus zichtbaar is.
export const NATIVE_PRIMARY_NAV = PRIMARY_NAV.filter(item => item.id === "today" && nativeRoute(item.href) !== null);

export function nativePrimaryNav(features: readonly string[]) {
 const ids=["today",...(features.includes("courses-overview-v1")?["learn"]:[]),...(features.includes("games-v1")&&features.includes("realtime-ticket-v1")?["play"]:[])];
 return PRIMARY_NAV.filter(item=>ids.includes(item.id));
}

/** Configuratie alleen is nog geen vrijgave van de native Apple-login-UI. */
export function nativeAppleLoginUIAvailable(capable: boolean, features: readonly string[]): boolean {
  return capable && features.includes("apple-sign-in-ui-v1");
}
