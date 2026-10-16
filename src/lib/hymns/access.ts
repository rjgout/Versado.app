// Pure toegangsbeslissing: technische noodstop → sessie → beheerbare zichtbaarheid.
export type PocAccess = "allow" | "login" | "hidden";
export function hymnsPocAccess(input: { flag: string | undefined; loggedIn: boolean; isAdmin: boolean; visibleToUsers: boolean }): PocAccess {
  if (input.flag === "0") return "hidden";
  if (!input.loggedIn) return "login";
  return input.isAdmin || input.visibleToUsers ? "allow" : "hidden";
}
