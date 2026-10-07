// De ene prijsregel voor Genees: winkel en in-game noodkoop gebruiken exact deze
// functie, zodat er nooit twee prijsimplementaties naast elkaar bestaan.
// Puur en zonder imports: ook bruikbaar in client components.

export const GENEES_BASE_PRICE_XP = 100;
export const GENEES_PRICE_STEP_XP = 25;

/**
 * Prijs van de volgende Genees: 100 XP plus 25 XP voor elke Genees die je op
 * dat moment op voorraad hebt. Alleen de HUIDIGE voorraad telt, niet hoeveel
 * je ooit kocht of speelde: gebruik je er drie, dan wordt de volgende weer
 * goedkoper. Er is bewust geen maximumprijs.
 */
export function geneesPriceXp(stock: number): number {
  if (!Number.isSafeInteger(stock) || stock < 0) throw new RangeError("Genees-voorraad moet een geheel getal van 0 of meer zijn.");
  return GENEES_BASE_PRICE_XP + stock * GENEES_PRICE_STEP_XP;
}
