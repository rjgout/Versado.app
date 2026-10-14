// Toegang tot de Lofzangen-proef. Bewust een kleine, pure functie zodat de regel getest kan worden.
//  - ontwikkeling (NODE_ENV !== "production"): elke ingelogde gebruiker;
//  - productie: alleen met HYMNS_POC=1 én voor beheerders. Anders bestaat de pagina niet (404), zodat een
//    toevallige bezoeker niet eens ziet dat er een proef is.

export type PocAccess = "allow" | "login" | "hidden";

export function hymnsPocAccess(input: { production: boolean; flag: string | undefined; loggedIn: boolean; isAdmin: boolean }): PocAccess {
  if (input.production && input.flag !== "1") return "hidden";
  if (!input.loggedIn) return "login";
  if (input.production && !input.isAdmin) return "hidden";
  return "allow";
}
