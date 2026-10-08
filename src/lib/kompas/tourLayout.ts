// De plaatsing van een rondleidingskaart en de markering van het doel. Puur,
// zodat de regels voor vaste headers, de onderbalk en kleine schermen getest
// kunnen worden zonder browser.

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Insets {
  /** Onderkant van de vaste bovenbalk (header, terugbalk, spelers) inclusief safe area. */
  top: number;
  /** Hoogte van wat onderaan vastzit (onderbalk, safe area). */
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const TOUR_MARGIN = 12;
export const TOUR_GUTTER = 16;
export const TOUR_PADDING = 6;

/** Het zichtbare vlak waarin een doel en de kaart passen. */
export function visibleArea(viewport: Viewport, insets: Insets): { top: number; bottom: number } {
  return { top: insets.top + TOUR_MARGIN, bottom: viewport.height - insets.bottom - TOUR_MARGIN };
}

/**
 * Hoeveel de pagina moet scrollen (positief = omlaag) om het doel zichtbaar te
 * krijgen met ruimte voor de kaart. Een vast doel (in de header of onderbalk)
 * scrolt nooit mee en vraagt dus nooit om scrollen.
 */
export function scrollDeltaFor(target: Rect, viewport: Viewport, insets: Insets, cardHeight: number, fixed: boolean): number {
  if (fixed) return 0;
  const area = visibleArea(viewport, insets);
  const available = area.bottom - area.top;
  if (target.height + cardHeight + TOUR_MARGIN > available) {
    // Te groot voor doel én kaart: de bovenkant van het doel onder de bovenbalk, de kaart ligt als blad eroverheen.
    return target.top - area.top;
  }
  const bottom = target.top + target.height;
  const inView = target.top >= area.top && bottom <= area.bottom;
  const roomBelow = area.bottom - bottom - TOUR_MARGIN;
  const roomAbove = target.top - area.top - TOUR_MARGIN;
  if (inView && (roomBelow >= cardHeight || roomAbove >= cardHeight)) return 0;
  // Doel en kaart samen in het midden van het zichtbare vlak.
  const desiredTop = area.top + (available - (target.height + TOUR_MARGIN + cardHeight)) / 2;
  return target.top - desiredTop;
}

export type TourPlacement = "above" | "below" | "sheet";

export interface TourLayout {
  /** De markering rond het doel, begrensd tot het scherm. */
  highlight: Rect;
  placement: TourPlacement;
  /** maxHeight: de kaart scrolt zelf als de tekst (groter lettertype, lange vertaling) niet in het zichtbare vlak past. */
  card: { top: number; left: number; width: number; maxHeight: number };
}

/**
 * Waar de markering en de kaart komen. De kaart staat onder of boven het doel,
 * waar de meeste ruimte is, nooit achter de bovenbalk of onderbalk en nooit
 * buiten het scherm. Past het niet (een groot doel op een klein scherm), dan
 * staat de kaart als blad onderaan het zichtbare vlak, over het doel heen.
 */
export function computeTourLayout(input: {
  target: Rect;
  viewport: Viewport;
  insets: Insets;
  card: { width: number; height: number };
  fixed: boolean;
}): TourLayout {
  const { target, viewport, insets, fixed } = input;
  const area = visibleArea(viewport, insets);
  const cardWidth = Math.min(input.card.width, viewport.width - 2 * TOUR_GUTTER);
  const maxHeight = Math.max(area.bottom - area.top, 0);
  const cardHeight = Math.min(input.card.height, maxHeight);

  // Een vast doel (header) mag in de bovenbalk liggen; een gewoon doel wordt tot het zichtbare vlak begrensd.
  const clipTop = fixed ? 0 : insets.top;
  const clipBottom = fixed ? viewport.height : viewport.height - insets.bottom;
  const top = Math.max(target.top - TOUR_PADDING, clipTop);
  const bottom = Math.min(target.top + target.height + TOUR_PADDING, clipBottom);
  const left = Math.max(target.left - TOUR_PADDING, 0);
  const right = Math.min(target.left + target.width + TOUR_PADDING, viewport.width);
  const highlight: Rect = { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };

  // Een vast doel in de bovenbalk (of onderbalk) ligt naast de balken waar de kaart nooit achter mag staan:
  // de kaart begint dan net onder de hele bovenbalk, of eindigt net boven de onderbalk.
  const belowStart = Math.max(highlight.top + highlight.height + TOUR_MARGIN, area.top);
  const aboveEnd = Math.min(highlight.top - TOUR_MARGIN, area.bottom);
  const below = area.bottom - belowStart;
  const above = aboveEnd - area.top;
  const centerX = highlight.left + highlight.width / 2;
  const cardLeft = Math.min(Math.max(centerX - cardWidth / 2, TOUR_GUTTER), viewport.width - TOUR_GUTTER - cardWidth);

  let placement: TourPlacement;
  if (below >= cardHeight && (below >= above || above < cardHeight)) placement = "below";
  else if (above >= cardHeight) placement = "above";
  else placement = "sheet";

  let cardTop: number;
  if (placement === "below") cardTop = belowStart;
  else if (placement === "above") cardTop = aboveEnd - cardHeight;
  else cardTop = Math.max(area.bottom - cardHeight, area.top);
  return { highlight, placement, card: { top: cardTop, left: cardLeft, width: cardWidth, maxHeight } };
}
