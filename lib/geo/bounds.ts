import { KY_BOUNDS, projectKentucky } from "./project.ts";

export interface LonLatBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FULL_VIEW: ViewBox = { x: 0, y: 0, width: 800, height: 480 };

function collectRings(geometry: { type: string; coordinates: unknown }): number[][] {
  if (geometry.type === "Polygon") {
    return (geometry.coordinates as number[][][]).flat();
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][]).flat(2);
  }
  return [];
}

export function geometryBounds(geometry: { type: string; coordinates: unknown }): LonLatBounds | null {
  const rings = collectRings(geometry);
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const coord of rings) {
    const lon = coord[0];
    const lat = coord[1];
    if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (!Number.isFinite(west) || west > east || south > north) return null;
  return { west, east, south, north };
}

export function projectedBounds(
  geometry: { type: string; coordinates: unknown },
  width: number,
  height: number,
): ViewBox | null {
  const rings = collectRings(geometry);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const coord of rings) {
    const lon = coord[0];
    const lat = coord[1];
    if (lon == null || lat == null) continue;
    const point = projectKentucky(lon, lat, width, height);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || minX > maxX || minY > maxY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function padViewBox(box: ViewBox, padding: number, maxWidth = 800, maxHeight = 480): ViewBox {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  const right = Math.min(maxWidth, box.x + box.width + padding);
  const bottom = Math.min(maxHeight, box.y + box.height + padding);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function kentuckyViewBox(): ViewBox {
  return { ...FULL_VIEW };
}

export function viewBoxString(box: ViewBox): string {
  return `${box.x} ${box.y} ${box.width} ${box.height}`;
}

/** Keep the map frame’s aspect ratio so a county zoom does not collapse the SVG into a square. */
export function fitAspectViewBox(
  box: ViewBox,
  aspectWidth = 800,
  aspectHeight = 480,
  padding = 28,
): ViewBox {
  const padded = {
    x: box.x - padding,
    y: box.y - padding,
    width: Math.max(1, box.width + padding * 2),
    height: Math.max(1, box.height + padding * 2),
  };
  const target = aspectWidth / aspectHeight;
  const current = padded.width / padded.height;
  if (current > target) {
    const height = padded.width / target;
    return { x: padded.x, y: padded.y - (height - padded.height) / 2, width: padded.width, height };
  }
  const width = padded.height * target;
  return { x: padded.x - (width - padded.width) / 2, y: padded.y, width, height: padded.height };
}

export function scaleViewBox(box: ViewBox, scale: number): ViewBox {
  const safe = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const width = box.width / safe;
  const height = box.height / safe;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

export const MAP_ZOOM_MIN = 0.75;
export const MAP_ZOOM_FIT = 1;
export const MAP_ZOOM_MAX = 6;
export const MAP_ZOOM_STEP = 0.5;

export function clampMapZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MAP_ZOOM_FIT;
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, zoom));
}

export function fitsKentucky(bounds: LonLatBounds | null): boolean {
  if (!bounds) return false;
  return (
    bounds.west >= KY_BOUNDS.west - 0.4 &&
    bounds.east <= KY_BOUNDS.east + 0.4 &&
    bounds.south >= KY_BOUNDS.south - 0.4 &&
    bounds.north <= KY_BOUNDS.north + 0.4
  );
}
