/**
 * Weergaveklasse van een afbeelding in een studieles. Alleen presentatie: de bronafbeelding, het bijschrift en de
 * bronverwijzing blijven onaangeroerd. De klasse volgt de structuur van de bron (waaraan het beeld in het document
 * hangt) en pas daarna de afmetingen; afmetingen alleen bepalen nooit het type.
 */
export type FigureKind = "NARRATIVE" | "SMALL" | "ICON" | "POSTER";
export interface FigureShape {
  id: string;
  width: number;
  height: number;
  hasCaption: boolean;
}
/** Expliciete, controleerbare uitzonderingen op de afgeleide klasse (bronblok-id → klasse). */
export const FIGURE_KIND_OVERRIDES: Readonly<Record<string, FigureKind>> = {};

export function classifyFigure(figure: FigureShape): FigureKind {
  const override = FIGURE_KIND_OVERRIDES[figure.id];
  if (override) return override;
  // Posterbeeld van een video in de bron.
  if (/-poster$/.test(figure.id)) return "POSTER";
  const ratio = figure.width / figure.height;
  const square = ratio > 0.8 && ratio < 1.25;
  // Beeld dat aan een kop hangt ("img-b-title3-0"): een kleine onderwerpillustratie, nooit een schilderij.
  if (/^img-b-/.test(figure.id)) return "SMALL";
  // Klein vierkant beeld zonder bijschrift: een pictogram.
  if (square && figure.width <= 200 && !figure.hasCaption) return "ICON";
  if (figure.width <= 200) return "SMALL";
  return "NARRATIVE";
}

/** Maximale breedte (CSS) en of vergroten zinvol is. De hoogte wordt via de verhouding begrensd. */
export function figureLayout(kind: FigureKind, figure: FigureShape) {
  const ratio = figure.width / figure.height;
  switch (kind) {
    case "ICON":
      return { maxWidth: "4.5rem", maxViewport: 0, enlarge: false };
    case "SMALL":
      return { maxWidth: "13rem", maxViewport: 0, enlarge: figure.width >= 160 };
    case "POSTER":
      return { maxWidth: "28rem", maxViewport: 0, enlarge: false };
    default:
      // Op een telefoon nooit hoger dan 60% van het zichtbare scherm; breedte volgt uit de beeldverhouding.
      return { maxWidth: "36rem", maxViewport: Math.round(60 * ratio * 100) / 100, enlarge: true };
  }
}
