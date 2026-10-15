// Toegang tot de Lofzangen-proef. Bewust een kleine, pure functie zodat de regel getest kan worden.
//  - ontwikkeling (NODE_ENV !== "production"): elke ingelogde gebruiker;
//  - productie: standaard voor beheerders via de contentkiezer; andere gebruikers krijgen 404.
//  - noodstop: HYMNS_POC=0 blokkeert de proef ook voor beheerders.

export type PocAccess = "allow" | "login" | "hidden";

export function hymnsPocAccess(input: { production: boolean; flag: string | undefined; loggedIn: boolean; isAdmin: boolean }): PocAccess {
  if (input.production && input.flag === "0") return "hidden";
  if (!input.loggedIn) return "login";
  if (input.production && !input.isAdmin) return "hidden";
  return "allow";
}
