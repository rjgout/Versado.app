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
  /^\/snelle-zendeling\/run\/[^/]+$/,
  /^\/mysteries\/001a\/play$/,
] as const;

export function isFocusRoute(pathname: string): boolean {
  return FOCUS_ROUTES.some((pattern) => pattern.test(pathname));
}
