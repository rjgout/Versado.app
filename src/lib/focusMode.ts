/**
 * Routes waarop de gebruiker niet aan het browsen is, maar een activiteit
 * uitvoert. De shell gebruikt deze ene lijst zodat header en ondernavigatie
 * niet per feature met losse verberg-classes hoeven te worden beheerd.
 */
const FOCUS_ROUTES = [
  /^\/content$/,
  // Mijn studiemap: accountbreed overzicht dat bij de contentkiezer hoort, geen activiteit.
  /^\/study-folder$/,
  // Het leerpad van Stap voor stap (READING_LESSONS): een eigen route, want /courses/<id> is van alle cursustypes.
  // Een overzicht om uit te kiezen, geen activiteit (zie isActivityRoute).
  /^\/courses\/[^/]+\/pad$/,
  // Het archief van "Kom dan en volg Mij": eerdere lessen per jaargang, hetzelfde type overzicht als het leerpad.
  /^\/courses\/[^/]+\/archief$/,
  // Ook de persoonlijke-studieroutes (weekoverzicht en stap) horen bij dezelfde Focusroute; geen eigen shellmodus.
  /^\/study-lesson\/[^/]+\/[^/]+(?:\/stappen(?:\/[^/]+)?)?$/,
  /^\/scripture\/[^/]+$/,
  // De avatar-editor is een zelfstandige bewerkflow: alleen de centrale
  // terugbalk blijft zichtbaar, zodat de vaste opslagactie niet concurreert
  // met de globale mobiele navigatie.
  /^\/profile\/avatar$/,
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
  // Lofzangen (live meezingen): tekst centraal, alleen de terugbalk blijft.
  /^\/dev\/lofzangen$/,
  // Afgeschermd technisch dorpsprototype: route blijft Focus, het actieve canvas
  // vraagt via de bestaande override tijdelijk Immersive aan.
  /^\/dev\/versado-dorp$/,
  /^\/dorp(?:\/(?:groups|visit)\/[^/]+)?$/,
  /^\/jigsaw$/,
  // Legpuzzel Samen en Tegen elkaar: dezelfde fullscreen werktafel als Solo.
  /^\/jigsaw\/(samen|wedstrijd)\/[^/]+$/,
  // Alle vooraf ontworpen Het Mysterie-varianten delen dezelfde focus-shell.
  // Het routepatroon voorkomt dat ieder nieuw mystery handmatig moet worden
  // toegevoegd en voorkomt dat latere varianten terugvallen op de normale app-shell.
  /^\/mysteries\/\d{3}[a-z]\/play$/,
] as const;

const IMMERSIVE_ROUTES = [
  /^\/snelle-zendeling\/run\/[^/]+$/,
  /^\/snelle-zendeling\/samen\/[^/]+$/,
] as const;

/**
 * Activiteiten die hun eigen resultaatkaart tonen maar bewust de normale
 * shell houden. Ze veranderen niets aan header of bottomnav; ze tellen alleen
 * mee voor `isActivityRoute`.
 */
const ACTIVITY_IN_NORMAL_SHELL = [
  /^\/practice$/,
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

/**
 * Een scherm dat binnen een Focus-route tijdelijk een speelviewport is (bijvoorbeeld het actieve legpuzzelbord
 * op een route die ook een catalogus of resultaatstap heeft) vraagt Immersive aan via `shellModeOverride.ts`.
 * Dit is geen vierde modus: de aanvraag kan alleen een Focus-route naar Immersive verheffen. Normale routes en
 * routes die al Immersive zijn veranderen er nooit door, zodat een scherm de shell niet buiten zijn eigen
 * activiteit kan beïnvloeden. Puur en getest in tests/focus-mode.test.ts.
 */
export function resolveShellMode(routeMode: ShellMode, immersiveRequested: boolean): ShellMode {
  return immersiveRequested && routeMode === "focus" ? "immersive" : routeMode;
}

/**
 * Is de gebruiker nu in een activiteit, inclusief het resultaatscherm en de
 * stap "verder gaan" naar een volgende activiteit? Secundaire vieringen
 * (bijvoorbeeld de reeksviering) wachten tot deze waarde false is, zodat de
 * resultaatkaart van de activiteit nooit wordt verdrongen.
 */
export function isActivityRoute(pathname: string): boolean {
  if (pathname === "/content" || pathname === "/study-folder" || /^\/courses\/[^/]+\/(?:pad|archief)$/.test(pathname)) return false;
  return isFocusRoute(pathname) || isImmersiveRoute(pathname) || ACTIVITY_IN_NORMAL_SHELL.some((pattern) => pattern.test(pathname));
}
