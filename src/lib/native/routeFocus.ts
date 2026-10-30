/** Kondig de lokale route aan zonder de centraal herstelde leespositie te wijzigen. */
export function focusNativeRouteHeading(root: Document = document): (() => void) | undefined {
  const heading = root.querySelector<HTMLElement>('.native-foundation h1[tabindex="-1"]');
  // Alleen een niet-interactieve routekop mag de gerichte native outline-uitzondering krijgen.
  if (!heading || heading.matches('[role], [contenteditable]') || heading.querySelector('a, button, input, select, textarea, [tabindex], [contenteditable]')) return;
  const clear = () => {
    heading.removeAttribute('data-native-route-focus');
    heading.removeEventListener('blur', clear);
  };
  heading.setAttribute('data-native-route-focus', '');
  heading.addEventListener('blur', clear, { once: true });
  heading.focus({ preventScroll: true });
  return clear;
}
