import type { Point } from "./stops";

export type Camera = { x: number; y: number; scale: number }; // world point at the view's center; px per km
export type Size = { width: number; height: number };
export type Insets = { top: number; right: number; bottom: number; left: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export const boundsOf = (points: Point[]): Bounds => ({
  minX: Math.min(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxX: Math.max(...points.map((p) => p.x)),
  maxY: Math.max(...points.map((p) => p.y)),
});

export const toScreen = (camera: Camera, size: Size, point: Point): Point => ({
  x: size.width / 2 + (point.x - camera.x) * camera.scale,
  y: size.height / 2 + (point.y - camera.y) * camera.scale,
});

// What a camera sees.
export const viewBounds = (camera: Camera, size: Size): Bounds => ({
  minX: camera.x - size.width / 2 / camera.scale,
  minY: camera.y - size.height / 2 / camera.scale,
  maxX: camera.x + size.width / 2 / camera.scale,
  maxY: camera.y + size.height / 2 / camera.scale,
});

// The camera that fits `bounds` into the view less `insets`, zoomed in no closer than `maxScale`.
export const frameBounds = (bounds: Bounds, size: Size, insets: Insets, maxScale: number): Camera => {
  const width = Math.max(1, size.width - insets.left - insets.right);
  const height = Math.max(1, size.height - insets.top - insets.bottom);
  const scale = Math.min(
    maxScale,
    width / Math.max(bounds.maxX - bounds.minX, 1e-9),
    height / Math.max(bounds.maxY - bounds.minY, 1e-9)
  );
  return {
    x: (bounds.minX + bounds.maxX) / 2 - (insets.left - insets.right) / 2 / scale,
    y: (bounds.minY + bounds.maxY) / 2 - (insets.top - insets.bottom) / 2 / scale,
    scale,
  };
};

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
// The camera's easing: ease in and out (cubic), so a flight builds up, sweeps across and settles in
// without the long crawl at the end that an ease-out spends barely moving.
export const easeFlight = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

// A flight between two cameras along van Wijk and Nuij's smooth zoom-and-pan path (the one MapLibre's
// flyTo takes): pull back as far as the hop needs, cross, and settle in. Returns the camera at
// progress s in 0..1; easing is the caller's.
// rho sets how high the flight pulls back: 1.42 is MapLibre's default, higher sweeps out further.
export const flightPath = (from: Camera, to: Camera, size: Size, rho = 2): ((s: number) => Camera) => {
  const span = Math.max(size.width, size.height);
  const w0 = span / from.scale; // the view's width in km, before and after
  const w1 = span / to.scale;
  const u1 = Math.hypot(to.x - from.x, to.y - from.y);
  const rho2 = rho * rho;
  const at = (u: number, widthRatio: number): Camera => ({
    x: from.x + (to.x - from.x) * u,
    y: from.y + (to.y - from.y) * u,
    scale: from.scale / widthRatio,
  });

  if (u1 < 1e-9) {
    // Straight in or out (or nowhere at all).
    if (Math.abs(Math.log(w1 / w0)) < 1e-9) return () => to;
    return (s) => (s >= 1 ? to : at(s, Math.exp(Math.log(w1 / w0) * s)));
  }

  // asinh keeps this exact for the long hops (MIT to California is ~5,000x in zoom).
  const r = (descent: boolean) =>
    -Math.asinh(
      (w1 * w1 - w0 * w0 + (descent ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (descent ? w1 : w0) * rho2 * u1)
    );
  const r0 = r(false);
  const length = (r(true) - r0) / rho;
  return (s) => {
    if (s >= 1) return to;
    const t = r0 + rho * length * s;
    return at((w0 * (Math.cosh(r0) * Math.tanh(t) - Math.sinh(r0))) / rho2 / u1, Math.cosh(r0) / Math.cosh(t));
  };
};
