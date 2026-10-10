/** Kleine, pure cataloguslaag zodat de keuzepagina nooit ongemerkt de rest
 * van de bestaande content wegfiltert. Alleen de huidige pagina rendert
 * thumbnails; de volledige catalogus blijft wel doorzoekbaar. */
export const PUZZLE_CATALOG_PAGE_SIZE = 24;

export function filterPuzzleCatalog<T>(items: readonly T[], query: string, searchable: (item: T) => string) {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? items.filter((item) => searchable(item).toLocaleLowerCase().includes(needle)) : [...items];
}

export function puzzleCatalogPage<T>(items: readonly T[], page: number, size = PUZZLE_CATALOG_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const currentPage = Math.min(Math.max(0, page), pages - 1);
  return { pages, currentPage, items: items.slice(currentPage * size, (currentPage + 1) * size) };
}
