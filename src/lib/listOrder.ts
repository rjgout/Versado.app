// Kleine, gedeelde helpers voor de persoonlijke sleepvolgorde van cursussen
// (/courses) en spelletjes (/live) — zie /api/list-order en het
// UserListOrder-model. Bewust geen "use client": applyPersonalOrder wordt ook
// op de server gebruikt (Vandaag), en de fetch-helpers roep je alleen vanuit
// de browser aan.

export type ListKey = "courses" | "games" | "today-continue";

/** Past een eerder opgeslagen volgorde toe; nieuwe/onbekende items komen achteraan, in hun oorspronkelijke volgorde. */
export function applyPersonalOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  if (order.length === 0) return items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  }
  return [...ordered, ...byId.values()];
}

export interface ListState {
  /** Zichtbare items, in de gekozen volgorde. */
  order: string[];
  /** Door de gebruiker verborgen items (alleen bij spellen). */
  hidden: string[];
}

export async function fetchListState(listKey: ListKey): Promise<ListState> {
  const res = await fetch(`/api/list-order?listKey=${listKey}`).catch(() => null);
  if (!res?.ok) return { order: [], hidden: [] };
  const data = await res.json().catch(() => null);
  return { order: data?.order ?? [], hidden: data?.hidden ?? [] };
}

export async function fetchListOrder(listKey: ListKey): Promise<string[]> {
  return (await fetchListState(listKey)).order;
}

/**
 * Fire-and-forget opslaan — de UI is al direct bijgewerkt (optimistisch),
 * dit hoeft niets terug te geven. Zonder `hiddenKeys` blijft wat verborgen
 * was verborgen; met `hiddenKeys` is dat de nieuwe verborgen set.
 */
export function saveListOrder(listKey: ListKey, itemKeys: string[], hiddenKeys?: string[]): void {
  fetch("/api/list-order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listKey, itemKeys, hiddenKeys }),
  }).catch(() => {});
}

/** Verbergt één item zonder een eventueel opgeslagen volgorde te wijzigen. */
export async function hideListItem(listKey: ListKey, itemKey: string): Promise<void> {
  const res = await fetch("/api/list-order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listKey, hideKeys: [itemKey] }),
  });
  if (!res.ok) throw new Error("Kon de kaart niet verbergen.");
}
