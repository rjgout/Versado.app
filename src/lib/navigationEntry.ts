/** Platformneutrale sleutel voor het bestaande scrollcoördinatiepunt. */
export function currentEntryKey(): string {
 const native = window.history.state;
 if (native?.versadoNative === 1 && Number.isSafeInteger(native.index)) return `native:${native.index}`;
 const key = (window as unknown as { navigation?: { currentEntry?: { key?: string } } }).navigation?.currentEntry?.key;
 return key ? `k:${key}` : `u:${window.location.pathname}${window.location.search}`;
}
