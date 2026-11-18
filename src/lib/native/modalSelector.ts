/**
 * Alles wat in de WebView boven de pagina ligt en bediening afvangt. De native balk is een aparte
 * laag boven de WebView en moet daar dus voor wijken. `[data-kompas-tour]` staat ook tijdens de
 * eerste layout/wachttijd van een rondleiding al in de DOM, nog vóór `aria-modal` er is.
 */
export const MODAL_SELECTOR = 'dialog[open], [aria-modal="true"], [data-kompas-tour]';
