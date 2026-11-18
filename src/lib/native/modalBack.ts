/** De systeemterugknop sluit eerst een open modaal venster en navigeert pas daarna. Het web sluit zijn vensters met
 * Escape; dezelfde handeling geldt hier voor elk venster dat zich als modaal aandient (`<dialog open>` of
 * `role="dialog" aria-modal="true"`), zodat terug nooit de pagina onder een open venster verlaat. */
type ModalRoot = { querySelector(selector: string): unknown; querySelectorAll(selector: string): ArrayLike<unknown> };
type Closable = { dispatchEvent(event: Event): boolean; close?: () => void };

const escape = () => new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });

/** Geeft true terug als er een modaal venster was (dan is de terugactie daarmee afgehandeld). */
export function dismissTopmostModal(root: ModalRoot, createEscape: () => Event = escape): boolean {
  const dialog = root.querySelector("dialog[open]") as (Closable & { close: () => void }) | null;
  if (dialog) {
    const event = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    if (!event.defaultPrevented) dialog.close();
    return true;
  }
  const modals = root.querySelectorAll('[role="dialog"][aria-modal="true"]');
  const top = modals.length ? (modals[modals.length - 1] as Closable) : null;
  if (!top) return false;
  top.dispatchEvent(createEscape());
  return true;
}
