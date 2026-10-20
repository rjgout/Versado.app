import { MAX_RADIUS, projectedWorldBounds } from "./geometry";

export type DorpCamera = { x: number; y: number; zoom: number };
export type CameraInsets = { top: number; right: number; bottom: number; left: number };

export const MAX_CAMERA_ZOOM = 1.4;
export const NORMAL_CAMERA_ZOOM = 0.36;
export const DETAIL_CAMERA_ZOOM = 1;

export function clampCameraZoom(value: number, minimum: number, maximum = MAX_CAMERA_ZOOM): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function fitCameraToRadius(
  width: number,
  height: number,
  radius: number,
  insets: CameraInsets = { top: 16, right: 16, bottom: 16, left: 16 },
): DorpCamera {
  const bounds = projectedWorldBounds(radius);
  const availableWidth = Math.max(1, width - insets.left - insets.right);
  const availableHeight = Math.max(1, height - insets.top - insets.bottom);
  const zoom = Math.min(
    MAX_CAMERA_ZOOM,
    availableWidth / (bounds.maxX - bounds.minX),
    availableHeight / (bounds.maxY - bounds.minY),
  );
  const desiredCenterX = insets.left + availableWidth / 2;
  const desiredCenterY = insets.top + availableHeight / 2;
  const worldCenterX = (bounds.minX + bounds.maxX) / 2;
  const worldCenterY = (bounds.minY + bounds.maxY) / 2;
  return {
    x: worldCenterX + (width / 2 - desiredCenterX) / zoom,
    y: worldCenterY + (height / 2 - desiredCenterY) / zoom,
    zoom,
  };
}

export function worldViewRadius(radius: number): number {
  return Math.max(radius + 12, Math.ceil(radius * 1.35));
}

export function minimumCameraZoom(width: number, height: number, insets?: CameraInsets, radius = MAX_RADIUS): number {
  return fitCameraToRadius(width, height, worldViewRadius(radius), insets).zoom;
}

export function screenToWorld(camera: DorpCamera, width: number, height: number, screenX: number, screenY: number) {
  return {
    x: (screenX - width / 2) / camera.zoom + camera.x,
    y: (screenY - height / 2) / camera.zoom + camera.y,
  };
}

export function zoomCameraAroundPoint(
  camera: DorpCamera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  nextZoom: number,
): DorpCamera {
  const anchor = screenToWorld(camera, width, height, screenX, screenY);
  return {
    x: anchor.x - (screenX - width / 2) / nextZoom,
    y: anchor.y - (screenY - height / 2) / nextZoom,
    zoom: nextZoom,
  };
}

export function createRenderScheduler(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
  draw: () => void,
) {
  let handle: number | null = null;
  return {
    request() {
      if (handle !== null) return;
      handle = requestFrame(() => { handle = null; draw(); });
    },
    drawNow() {
      if (handle !== null) cancelFrame(handle);
      handle = null;
      draw();
    },
    cancel() {
      if (handle !== null) cancelFrame(handle);
      handle = null;
    },
  };
}
