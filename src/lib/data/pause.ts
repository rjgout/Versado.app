// Pause uit de bestaande globale browser/native-laag, geen featurelisteners.
const listeners = new Set<() => void>();
export function subscribeDataPause(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function notifyDataPause() {
  for (const listener of listeners) listener();
}
