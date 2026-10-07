export interface BoardGeometry {
  imageWidth: number;
  imageHeight: number;
  bounds: { left: number; top: number; right: number; bottom: number };
  rows: number;
  columns: number;
  cellWidthNormalized: number;
  cellHeightNormalized: number;
  footAnchorInCell: { x: number; y: number };
  footAnchorPixels: { x: number; y: number };
  maxVisibleCharacterHeight: number;
  /** Alleen gebruikt wanneer het manifest de echte alpha-bounds bevat. */
  visibleCharacterHeightPixels?: number;
}

/**
 * Een handmatig ontworpen bord kan een ruimer technisch speelveld in het
 * manifest hebben dan de feitelijke zandvlakte. De celverdeling blijft altijd
 * rechthoekig en gelijkmatig; alleen de buitenrand wordt gekalibreerd.
 */
export function calibrateBoardGeometry(
  geometry: BoardGeometry,
  bounds: BoardGeometry["bounds"]
): BoardGeometry {
  return {
    ...geometry,
    bounds,
    cellWidthNormalized: (bounds.right - bounds.left) / geometry.columns,
    cellHeightNormalized: (bounds.bottom - bounds.top) / geometry.rows,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function numberAt(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function normalized(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value > 1 ? value / 100 : value;
}

/**
 * Leest de geometrie uit het meegeleverde manifest. De kleine varianten in
 * nesting maken de adapter tolerant voor beschrijvende metadata, maar er is
 * bewust geen UI-fallback: het manifest blijft de runtimebron van waarheid.
 */
export function parseBoardManifest(input: unknown): BoardGeometry | null {
  const root = object(input);
  const board = object(root?.board);
  const grid = object(root?.grid) ?? object(board?.grid);
  const nativeResolution = Array.isArray(root?.nativeResolution) ? root?.nativeResolution : null;
  const assets = Array.isArray(root?.assets)
    ? root.assets.map(object).filter((value): value is Record<string, unknown> => value !== null)
    : Object.values(object(root?.assets) ?? {}).map(object).filter((value): value is Record<string, unknown> => value !== null);
  const firstCharacterAsset = assets.find((asset) => asset.filename !== "board.png" && (asset.footAnchorPixels || asset.feetBaselinePixel || asset.visibleHeight)) ?? assets.find((asset) => asset.filename !== "board.png") ?? assets[0];
  const character = object(root?.character) ?? object(root?.characters) ?? object(board?.character);
  const placement = object(root?.characterPlacement) ?? object(root?.placement) ?? object(board?.characterPlacement);
  const bounds = object(root?.logicalPlayfield) ?? object(root?.logicalBounds) ?? object(root?.playfield) ?? object(root?.logicalPlayArea) ?? object(board?.logicalPlayfield) ?? object(board?.playfield) ?? object(grid?.bounds) ?? object(grid?.boundsNormalized);
  const anchor = object(root?.footAnchorWithinCell) ?? object(root?.footAnchor) ?? object(grid?.footAnchor) ?? object(grid?.feetWithinCell) ?? object(root?.characterFootAnchor) ?? object(character?.footAnchorWithinCell) ?? object(placement?.footAnchorWithinCell) ?? object(placement?.footAnchor);
  const feetWithinCell = Array.isArray(grid?.feetWithinCell) ? grid.feetWithinCell : null;
  const anchorPixelsRaw = root?.footAnchorPixels ?? character?.footAnchorPixels ?? placement?.footAnchorPixels ?? placement?.anchorPixels ?? firstCharacterAsset?.footAnchorPixels;
  const anchorPixels = Array.isArray(anchorPixelsRaw)
    ? { x: numberAt(anchorPixelsRaw[0]), y: numberAt(anchorPixelsRaw[1]) }
    : object(anchorPixelsRaw) ?? object(root?.characterFootAnchorPixels);
  const visibleBounds = object(root?.visibleBounds) ?? object(root?.characterVisibleBounds) ?? object(character?.visibleBounds);

  const imageWidth = numberAt(board?.width, root?.boardWidth, nativeResolution?.[0]) ?? NaN;
  const imageHeight = numberAt(board?.height, root?.boardHeight, nativeResolution?.[1]) ?? NaN;
  const geometry: BoardGeometry = {
    imageWidth,
    imageHeight,
    bounds: {
      left: normalized(numberAt(bounds?.left)) ?? NaN,
      top: normalized(numberAt(bounds?.top)) ?? NaN,
      right: normalized(numberAt(bounds?.right)) ?? NaN,
      bottom: normalized(numberAt(bounds?.bottom)) ?? NaN,
    },
    rows: numberAt(grid?.rows) ?? NaN,
    columns: numberAt(grid?.columns, grid?.cols) ?? NaN,
    cellWidthNormalized: normalized(numberAt(grid?.cellWidthNormalized, root?.cellWidthNormalized)) ?? NaN,
    cellHeightNormalized: normalized(numberAt(grid?.cellHeightNormalized, root?.cellHeightNormalized)) ?? NaN,
    footAnchorInCell: {
      x: numberAt(anchor?.x, feetWithinCell?.[0]) ?? NaN,
      y: numberAt(anchor?.y, feetWithinCell?.[1]) ?? NaN,
    },
    footAnchorPixels: {
      // De nieuwe board-manifests herhalen de gestandaardiseerde character-
      // canvasmetadata niet. De bestaande transparante assets delen één
      // voetenbaseline; gebruik die alleen als manifestmetadata ontbreekt.
      x: numberAt(anchorPixels?.x) ?? imageWidth / 2,
      y: numberAt(anchorPixels?.y, firstCharacterAsset?.feetBaselinePixel) ?? imageHeight * (1149 / 1254),
    },
    maxVisibleCharacterHeight: normalized(numberAt(root?.maxVisibleCharacterHeight, root?.maxVisibleCharacterHeightRatio, character?.maxVisibleCharacterHeight, character?.maxVisibleHeight, placement?.maxVisibleCharacterHeight, placement?.maxVisibleHeight, board?.maxVisibleCharacterHeight, grid?.maximumCharacterHeightCellFraction)) ?? NaN,
    visibleCharacterHeightPixels: numberAt(visibleBounds?.height, root?.visibleCharacterHeightPixels, character?.visibleCharacterHeightPixels, firstCharacterAsset?.visibleHeightPixels, firstCharacterAsset?.visibleHeight)
      ?? (!Array.isArray(root?.assets) && object(root?.assets) ? imageHeight * (1050 / 1254) : undefined),
  };
  const values = [
    geometry.imageWidth, geometry.imageHeight, geometry.bounds.left, geometry.bounds.top,
    geometry.bounds.right, geometry.bounds.bottom, geometry.rows, geometry.columns,
    geometry.cellWidthNormalized, geometry.cellHeightNormalized,
    geometry.footAnchorInCell.x, geometry.footAnchorInCell.y,
    geometry.footAnchorPixels.x, geometry.footAnchorPixels.y,
    geometry.maxVisibleCharacterHeight,
  ];
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (geometry.rows < 1 || geometry.columns < 1 || geometry.bounds.right <= geometry.bounds.left || geometry.bounds.bottom <= geometry.bounds.top) return null;
  return geometry;
}
