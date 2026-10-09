import type { ProfileCharacterFrame } from "@/lib/profileCharacterFraming";

/** Hetzelfde bronraster blijft staan; dit is alleen de CSS-camera-instelling. */
export function profileCameraOriginX(frame: ProfileCharacterFrame): number {
  return frame.head[0] / frame.source[0];
}

/**
 * Plaatst de bovenrand van het zichtbare personage onder de viewportrand bij
 * inzoomen. Daardoor blijft ook haar of hoofdbedekking volledig zichtbaar,
 * zonder een tweede busteafbeelding of layoutverschuiving.
 */
export function profileCameraOriginY(
  frame: ProfileCharacterFrame,
  safeTop = 0.06,
): number {
  const zoom = frame.zoom;
  if (zoom <= 1) return frame.head[1] / frame.source[1];
  const visibleTop = frame.visible[1] / frame.source[1];
  return (safeTop - visibleTop * zoom) / (1 - zoom);
}
