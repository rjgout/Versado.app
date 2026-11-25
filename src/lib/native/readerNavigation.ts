import type { NativeReaderKind } from "./readerContract";
const id = "[A-Za-z0-9_-]{1,128}";
export function nativeReaderRoute(
  path: string,
): { courseId: string; kind: NativeReaderKind; targetId: string } | null {
  const match = new RegExp(
    `^/courses/(${id})/read/(steps|chapters)/(${id})$`,
  ).exec(path);
  return match
    ? {
        courseId: match[1],
        kind: match[2] as NativeReaderKind,
        targetId: match[3],
      }
    : null;
}
/** Alleen de twee bestaande padlinks; querystrings worden nooit algemeen native routes. */
export function nativeReaderDestination(href: string, courseId: string) {
  if (!new RegExp(`^${id}$`).test(courseId)) return null;
  const step = new RegExp(`^/reading-lesson/(${id})$`).exec(href);
  if (step) return `/courses/${courseId}/read/steps/${step[1]}`;
  const chapter = new RegExp(`^/lesson/(${id})\\?cursus=(${id})$`).exec(href);
  return chapter && chapter[2] === courseId
    ? `/courses/${courseId}/read/chapters/${chapter[1]}`
    : null;
}
