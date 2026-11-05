import { nativeRoute } from "./navigation";
/** Course/step URLs are never rewritten to Foundation chapter completion. */
export function nativeTodayDestination(href: string, coursesEnabled = false): { href: string; phase: null } | { href: null; phase: "B3" | "B4" | "B5" } {
  const route = nativeRoute(href);
  if (coursesEnabled && route && /^\/courses(?:\/[A-Za-z0-9_-]{1,128}(?:\/pad)?)?$/.test(route)) return {href:route,phase:null};
  if (route && ["/dashboard", "/content", "/profile", "/privacy", "/cookies", "/disclaimer", "/contact"].includes(route)) return { href: route, phase: null };
  return { href: null, phase: /^\/(?:courses|lesson|study-lesson|reading-lesson|reading|kids|intro|podcast)(?:\/|$)/.test(href) ? "B3" : /^\/(?:kompas|streak|achievements)(?:\/|$)/.test(href) ? "B4" : "B5" };
}
