import { nativeRoute } from "./navigation";
/** Course/step URLs are never rewritten to Foundation chapter completion. */
export function nativeTodayDestination(href: string): { href: string; phase: null } | { href: null; phase: "B3" | "B4" | "B5" } {
  const route = nativeRoute(href);
  if (route && ["/dashboard", "/content", "/profile", "/privacy", "/cookies", "/disclaimer", "/contact"].includes(route)) return { href: route, phase: null };
  return { href: null, phase: /^\/(?:courses|lesson|study-lesson|reading-lesson|reading|kids|intro|podcast)(?:\/|$)/.test(href) ? "B3" : /^\/(?:kompas|streak|achievements)(?:\/|$)/.test(href) ? "B4" : "B5" };
}
