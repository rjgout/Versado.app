/** Eén coördinatiepunt; alleen NavigationScroll voert window.scrollTo uit. */
export type ScrollIntent = "history" | "explicit" | "position";
export interface ScrollContext {
  key: string;
  history: boolean;
  interacted: boolean;
  restoring: boolean;
}
let context: ScrollContext = {
  key: "",
  history: false,
  interacted: false,
  restoring: false,
};
let handler: ((target: () => number | null) => void) | null = null;
let pending: {
  key: string;
  intent: ScrollIntent;
  target: () => number | null;
  deliberate: boolean;
  y: number;
} | null = null;
const listeners = new Set<() => void>();
function drainPending() {
  if (!pending || !handler || !context.key) return;
  const request = pending;
  pending = null;
  if (
    request.intent === "position" &&
    typeof window !== "undefined" &&
    Math.abs(window.scrollY - request.y) > 2
  )
    return;
  if (
    canRestoreScroll(context, request.key, request.intent, request.deliberate)
  )
    handler(request.target);
}
const emit = () => {
  for (const listener of listeners) listener();
};
export function canRestoreScroll(
  state: ScrollContext,
  key: string,
  intent: ScrollIntent,
  deliberate = false,
) {
  if (state.key !== key) return false;
  if (deliberate && intent === "explicit") return true;
  if (state.interacted) return false;
  return intent === "history" || !state.history;
}
export function beginScrollEntry(key: string, history: boolean) {
  context = { key, history, interacted: false, restoring: false };
  emit();
  drainPending();
}
export function noteScrollInteraction() {
  pending = null;
  context = { ...context, interacted: true };
  emit();
}
export function scrollRestoreContext() {
  return context;
}
export function subscribeScrollRestore(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setScrollRestoring(restoring: boolean) {
  context = { ...context, restoring };
  emit();
}
export function registerScrollRestorer(next: NonNullable<typeof handler>) {
  handler = next;
  drainPending();
  return () => {
    if (handler === next) handler = null;
  };
}
export function requestScrollRestore(
  key: string,
  intent: ScrollIntent,
  target: () => number | null,
  deliberate = false,
) {
  if (!handler || !context.key) {
    pending = {
      key,
      intent,
      target,
      deliberate,
      y: typeof window === "undefined" ? 0 : window.scrollY,
    };
    return true;
  }
  if (!canRestoreScroll(context, key, intent, deliberate)) return false;
  handler(target);
  return true;
}

/** Reload van een reader vraagt de serverpositie; alleen back/forward is historie. */
export function restoreEntryScroll(
  navigationType: string,
  studyReader: boolean,
) {
  return (
    navigationType === "back_forward" ||
    (navigationType === "reload" && !studyReader)
  );
}
