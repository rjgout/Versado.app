// De parkeertimer: een los neergelegde groep (zonder snap) mag 1,5 seconde blijven liggen voordat de tafel ruimte
// maakt. Eén enkele, annuleerbare timer per tafel (nooit een timer per groep of per interactie), een epoch waarmee een
// lopende opruimronde ziet dat de speler intussen weer iets doet, en een expliciete `dispose` bij unmount.

export const PARKING_DELAY_MS = 1500;
const MAX_PARKED = 6;

export type ParkingReadiness = "go" | "wait" | "stop";

export interface ParkingEnv {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface ParkingOptions {
  delayMs?: number;
  env?: ParkingEnv;
  /** "go": opruimen mag nu; "wait": de speler is bezig (slepen, zoomen, lopende actie): over 1,5 s opnieuw kijken; "stop": sessie voorbij, helemaal niets meer doen. */
  ready(): ParkingReadiness;
  /** Ruim op, nieuwste groep eerst. `stale()` wordt waar zodra de speler weer iets doet of de timer verdwijnt: stop dan na de huidige stap. */
  settle(groupIds: readonly string[], stale: () => boolean): void | Promise<void>;
}

export interface Parking {
  /** Een groep is neergelegd zonder verbinding of verankering. */
  park(groupId: string): void;
  /** De speler pakt deze groep weer op: niet meer geparkeerd. */
  unpark(groupId: string): void;
  /** Camera, zoom, nieuwe sleep of toetsen: schuift het opruimen een volle periode op. */
  interact(): void;
  cancel(): void;
  dispose(): void;
  readonly parked: readonly string[];
  readonly armed: boolean;
}

export function createParking(options: ParkingOptions): Parking {
  const delay = options.delayMs ?? PARKING_DELAY_MS;
  const env: ParkingEnv = options.env ?? { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  let handle: unknown = null; let parked: string[] = []; let epoch = 0; let disposed = false;

  const disarm = () => { if (handle !== null) { env.clearTimeout(handle); handle = null; } };
  const arm = () => { disarm(); if (disposed || !parked.length) return; handle = env.setTimeout(fire, delay); };
  function fire() {
    handle = null; if (disposed || !parked.length) return;
    const state = options.ready();
    if (state === "stop") { parked = []; epoch++; return; }
    if (state === "wait") { arm(); return; }
    const ids = [...parked].reverse(); parked = []; const mine = ++epoch;
    // Een fout of afwijzing in de opruimronde mag nooit een nieuwe timer of een onopgeloste belofte achterlaten.
    try { const result = options.settle(ids, () => disposed || epoch !== mine); if (result && typeof (result as Promise<void>).catch === "function") (result as Promise<void>).catch(() => undefined); } catch { /* geen opruiming is beter dan een kapotte tafel */ }
  }
  return {
    park(groupId) { if (disposed) return; epoch++; parked = [...parked.filter((id) => id !== groupId), groupId].slice(-MAX_PARKED); arm(); },
    unpark(groupId) { if (!parked.includes(groupId)) return; parked = parked.filter((id) => id !== groupId); if (!parked.length) disarm(); },
    interact() { epoch++; if (parked.length) arm(); },
    cancel() { epoch++; parked = []; disarm(); },
    dispose() { disposed = true; epoch++; parked = []; disarm(); },
    get parked() { return parked; },
    get armed() { return handle !== null; },
  };
}
