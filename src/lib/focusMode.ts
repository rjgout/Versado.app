/**
 * Routes waarop de gebruiker niet aan het browsen is, maar een activiteit
 * uitvoert. De shell gebruikt deze ene lijst zodat header en ondernavigatie
 * niet per feature met losse verberg-classes hoeven te worden beheerd.
 */
const FOCUS_ROUTES = [
  /^\/lesson\/[^/]+$/,
  /^\/reading-lesson\/[^/]+$/,
  /^\/intro\/[^/]+$/,
  /^\/kids\/[^/]+$/,
  /^\/fsy\/[^/]+$/,
  /^\/podcast\/[^/]+\/[^/]+$/,
  /^\/word-search\/[^/]+$/,
  /^\/scrabble\/[^/]+$/,
  /^\/chapter-guess\/solo\/[^/]+$/,
  /^\/live\/[^/]+$/,
  /^\/alleskenner\/alleen\/[^/]+$/,
  /^\/alleskenner\/seizoen\/[^/]+$/,
  /^\/word-game$/,
  /^\/jigsaw$/,
  /^\/mysteries\/001a\/play$/,
  /^\/mysteries\/001b\/play$/,
  /^\/mysteries\/001c\/play$/,
  /^\/mysteries\/002a\/play$/,
  /^\/mysteries\/002b\/play$/,
  /^\/mysteries\/002c\/play$/,
] as const;

const IMMERSIVE_ROUTES = [
  /^\/snelle-zendeling\/run\/[^/]+$/,
] as const;

export type ShellMode = "normal" | "focus" | "immersive";

export function isFocusRoute(pathname: string): boolean {
  return FOCUS_ROUTES.some((pattern) => pattern.test(pathname));
}

export function isImmersiveRoute(pathname: string): boolean {
  return IMMERSIVE_ROUTES.some((pattern) => pattern.test(pathname));
}

export function shellModeForRoute(pathname: string): ShellMode {
  if (isImmersiveRoute(pathname)) return "immersive";
  if (isFocusRoute(pathname)) return "focus";
  return "normal";
}
