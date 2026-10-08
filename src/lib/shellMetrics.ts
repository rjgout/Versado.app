// Pure regels van de app-shell (docs/LAYOUT.md): wanneer is de vaste
// bovenbalk te groot om vast te blijven staan, en wanneer is het
// schermtoetsenbord open. Geen DOM- of Next-imports, zodat ze getest kunnen
// worden; het meten zelf staat in src/components/shell/ShellMetrics.tsx.

/**
 * Een vaste bovenbalk die meer dan dit deel van de zichtbare hoogte inneemt
 * (bij zeer grote tekst, wanneer de header over meerdere regels loopt) blijft
 * niet langer vast staan maar scrolt met de pagina mee. Zo blijft er altijd
 * ruimte voor de inhoud, zonder de tekst kleiner te maken.
 */
export const TALL_HEADER_RATIO = 0.34;

export function isHeaderTall(headerPx: number, viewportPx: number): boolean {
  return viewportPx > 0 && headerPx / viewportPx > TALL_HEADER_RATIO;
}

/** Vanaf deze tekstschaal (1 = standaard) maken decoratieve beelden plaats voor de tekst. */
export const LARGE_TEXT_SCALE = 1.4;

export function isLargeText(scale: number): boolean {
  return scale >= LARGE_TEXT_SCALE;
}

/** Een element waarin je typt (en waarvoor dus een schermtoetsenbord opent). */
export interface EditableLike {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  readOnly?: boolean;
}

const NON_TEXT_INPUT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"]);

export function isEditableElement(element: EditableLike | null | undefined): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toUpperCase();
  if (tag === "TEXTAREA") return !element.readOnly;
  if (tag === "SELECT") return false;
  if (tag === "INPUT") return !element.readOnly && !NON_TEXT_INPUT.has((element.type ?? "text").toLowerCase());
  return false;
}

/**
 * Is het schermtoetsenbord open? Alleen als je in een tekstveld staat én het
 * zichtbare gebied duidelijk kleiner is dan de grootste hoogte die we zagen
 * (iOS krimpt de visuele viewport, Android de hele viewport). Zonder tekstveld
 * is een kleinere hoogte gewoon een inklappende adresbalk, geen toetsenbord.
 */
export function isKeyboardOpen(input: { editableFocused: boolean; visibleHeight: number; maxHeight: number }): boolean {
  return input.editableFocused && input.maxHeight > 0 && input.visibleHeight < input.maxHeight * 0.8;
}
