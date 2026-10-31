import { PRIMARY_NAV } from "@/lib/navigation";
import { nativeRoute } from "./navigation";

// Alleen Vandaag is als primaire lokale bestemming geïmplementeerd. Geen
// placeholders voor Leren/Spelen/Vrienden; volgende functie-PR's activeren die.
export const NATIVE_PRIMARY_NAV = PRIMARY_NAV.filter(item => item.id === "today" && nativeRoute(item.href) !== null);

/** Configuratie alleen is nog geen vrijgave van de native Apple-login-UI. */
export function nativeAppleLoginUIAvailable(capable: boolean, features: readonly string[]): boolean {
  return capable && features.includes("apple-sign-in-ui-v1");
}
