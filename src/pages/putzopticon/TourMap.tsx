import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  drawBasemap,
  loadBasemap,
  streetDetail,
  type Paths,
} from "./basemap";
import { easeFlight, easeOutCubic, flightPath, toScreen, type Camera, type Size } from "./camera";
import { baseUnit, planVisit, type Tag } from "./layout";
import { hexOf, type Located, type Point, type Stop } from "./stops";

// The top half of /putzopticon: the grayscale basemap on a canvas, everyone as a dot in their
// pill color, and the current stop's people named in columns of tags beside it. The camera eases out
// to each stop along a zoom-and-pan arc; far-away stops keep Putz in frame.

const GROW_MS = 450; // the stop's dots swelling (and its names fading in) on arrival
const FADE_MS = 200; // the last stop's names leaving
// The beat before a flight: names fade and the stop's dots shrink and dim, then the camera goes.
export const LEAVE_MS = 300;
const IDLE_ALPHA = 0.5; // everyone not at the stop
// Between flights the camera keeps creeping in, so a stop never sits dead still: up to DRIFT (6%)
// closer, easing off over DRIFT_MS, until the next flight takes it from wherever it got to.
const DRIFT = 0.06;
const DRIFT_MS = 5000;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

// How far into a flight (as a share of its time) the camera is as good as there: within a couple of
// pixels of its final framing anywhere in view. Ease-out spends its last stretch barely moving, so
// names can go up then without sliding instead of waiting out the whole glide.
const settledAt = (path: (s: number) => Camera, to: Camera, size: Size) => {
  for (let t = 0.3; t < 1; t += 0.01) {
    const at = path(easeFlight(t));
    const zoom = Math.abs(1 - at.scale / to.scale);
    const dx = Math.abs((to.x - at.x) * at.scale) + (zoom * size.width) / 2;
    const dy = Math.abs((to.y - at.y) * at.scale) + (zoom * size.height) / 2;
    if (Math.max(dx, dy) < 2) return t;
  }
  return 1;
};

// A name's width at 1px in the tags' font (bold Mondwest, like the board's names), measured once.
const nameWidths = new Map<string, number>();
let ruler: HTMLSpanElement | undefined;
const nameWidth = (name: string) => {
  let width = nameWidths.get(name);
  if (width === undefined) {
    if (!ruler) {
      ruler = document.createElement("span");
      ruler.style.cssText =
        "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font:bold 100px Mondwest";
      document.body.append(ruler);
    }
    ruler.textContent = name;
    width = ruler.getBoundingClientRect().width / 100;
    nameWidths.set(name, width);
  }
  return width;
};

type Shown = { tags: (Tag & { name: string })[]; camera: Camera; unit: number; serial: number };
type Scene = {
  size: Size;
  paths?: Paths;
  located: Located[];
  stop: Stop | null;
  arrived: boolean;
  leaving: boolean;
  shown: Shown | null;
};
type Motion = {
  camera: Camera | null; // as last drawn
  path: ((s: number) => Camera) | null; // the flight under way, if any
  start: number;
  duration: number;
  arrivedAt: number;
  departedAt: number;
  leftAt: number;
  base: Camera | null; // where the camera settled, which the drift creeps in from
  baseAt: number;
  drifts: boolean; // off under reduced motion
  raf: number;
};

const dotRadii = (unit: number) => ({ idle: Math.max(2.5, unit * 0.11), lit: Math.max(4, unit * 0.2) });

// Plain discs, no outlines: the stop's people in its color, everyone else a dim version of theirs.
const dot = (context: CanvasRenderingContext2D, { x, y }: Point, radius: number, color: string, alpha: number) => {
  context.globalAlpha = alpha;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.globalAlpha = 1;
};

// From just off a dot to just short of its tag (the same gap at both ends): out of the dot at 45°,
// then level into the name.
// When the tag sits too high or low to reach at 45°, one straight (steeper) line instead.
const LEADER_SLOPE = Math.tan((45 * Math.PI) / 180);
const leader = (tag: Tag, unit: number, dotRadius: number) => {
  // At least 5px even when a crowded stop shrinks the tags (and with them `unit`).
  const gap = Math.max(5, 0.3 * unit);
  const end = { x: tag.x - tag.side * gap, y: tag.y };
  const dx = end.x - tag.dotX;
  const dy = end.y - tag.dotY;
  const run = Math.abs(dy) / LEADER_SLOPE;
  const bend = run < Math.abs(dx) ? { x: tag.dotX + Math.sign(dx) * run, y: end.y } : end;
  // Start the same gap off the dot's edge, measured along the line. When the tag is about level with
  // its dot, the 45° leg is shorter than that (or nothing at all), so the line starts on the level leg.
  let skip = dotRadius + gap;
  const points = [{ x: tag.dotX, y: tag.dotY }, bend, end];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (skip < length) {
      const t = skip / length;
      const start = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      return [start, ...points.slice(i + 1)].map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    }
    skip -= length;
  }
  return ""; // the tag is closer than the two gaps: no line
};

// One frame. Returns whether anything is still moving.
const paint = (
  canvas: HTMLCanvasElement,
  layer: HTMLElement | null,
  scene: Scene,
  motion: Motion,
  now: number
): boolean => {
  const context = canvas.getContext("2d");
  const { size, stop, shown } = scene;
  if (!context || !size.width || !size.height || !motion.camera) return false;

  let flying = false;
  if (motion.path) {
    const t = motion.duration > 0 ? clamp01((now - motion.start) / motion.duration) : 1;
    motion.camera = motion.path(easeFlight(t));
    if (t < 1) flying = true;
    else {
      motion.path = null;
      motion.base = motion.camera;
      motion.baseAt = now;
    }
  }
  const drifting = !motion.path && !!motion.base && motion.drifts;
  if (drifting) {
    const creep = 1 + DRIFT * (1 - Math.exp(-(now - motion.baseAt) / DRIFT_MS));
    motion.camera = { ...motion.base!, scale: motion.base!.scale * creep };
  }
  const camera = motion.camera!;

  const density = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(size.width * density);
  const height = Math.round(size.height * density);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(density, 0, 0, density, 0, 0);

  const detail = streetDetail(camera, size);
  drawBasemap(context, size, camera, scene.paths, detail);

  // The name tags are laid out for the camera at their stop; they ride along from there (the last
  // stop's, as they fade out on the way to the next).
  let k = 1;
  let tx = 0;
  let ty = 0;
  if (shown) {
    const { camera: at } = shown;
    k = camera.scale / at.scale;
    tx = size.width / 2 + (at.x - camera.x) * camera.scale - (size.width / 2) * k;
    ty = size.height / 2 + (at.y - camera.y) * camera.scale - (size.height / 2) * k;
    if (layer) layer.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
  }
  const since = now - motion.arrivedAt;

  const unit = baseUnit(size);
  const radius = dotRadii(unit);
  const at = (point: Point) => toScreen(camera, size, point);
  const lit = new Set(stop?.people.map((p) => p.providerId));
  for (const person of scene.located) {
    if (!lit.has(person.providerId)) dot(context, at(person.point), radius.idle, hexOf(person.color), IDLE_ALPHA);
  }
  // The stop's dots brighten over the first half of the flight in, swell on arrival, and shrink and
  // dim back to everyone else's as it's left, so nothing pops.
  const leave = scene.leaving ? easeOutCubic(clamp01((now - motion.leftAt) / LEAVE_MS)) : 0;
  const grow = scene.arrived ? easeOutCubic(clamp01(since / GROW_MS)) * (1 - leave) : 0;
  const bright = scene.arrived
    ? 1 - leave
    : motion.duration > 0
      ? easeOutCubic(clamp01((now - motion.departedAt) / (motion.duration / 2)))
      : 1;
  for (const person of stop?.people ?? []) {
    const alpha = IDLE_ALPHA + (1 - IDLE_ALPHA) * bright;
    dot(context, at(person.point), radius.idle + (radius.lit - radius.idle) * grow, hexOf(person.color), alpha);
  }

  if (scene.leaving) return true;
  if (scene.arrived) return flying || drifting || since < GROW_MS;
  return flying || drifting || bright < 1 || now - motion.departedAt < FADE_MS;
};

// A stop's names and leaders. Top to bottom, 40 ms apart: each dotted line draws out from its dot,
// then its name fades in, sliding the last few pixels toward it.
const Tags = ({ shown, size, dotRadius }: { shown: Shown; size: Size; dotRadius: number }) => {
  const order = new Map([...shown.tags].sort((a, b) => a.y - b.y).map((tag, i) => [tag.id, i]));
  const lines = shown.tags.filter((tag) => tag.more === undefined);
  const mask = (i: number) => `putz-leader-${shown.serial}-${i}`;
  return (
    <>
      <svg className="putz-tour-leaders" width={size.width} height={size.height}>
        <defs>
          {lines.map((tag, i) => (
            // The reveal: a solid copy of the line, dashed to its own length and slid on.
            <mask key={tag.id} id={mask(i)} maskUnits="userSpaceOnUse" x={0} y={0} width={size.width} height={size.height}>
              <polyline
                className="putz-tour-leader-reveal"
                points={leader(tag, shown.unit, dotRadius)}
                pathLength={1}
                style={{ "--i": order.get(tag.id) } as CSSProperties}
              />
            </mask>
          ))}
        </defs>
        {lines.map((tag, i) => (
          <polyline
            key={tag.id}
            className="putz-tour-leader"
            points={leader(tag, shown.unit, dotRadius)}
            mask={`url(#${mask(i)})`}
          />
        ))}
      </svg>
      {shown.tags.map((tag) => (
        <div
          key={tag.id}
          className="putz-tour-tag"
          data-side={tag.side < 0 ? "left" : "right"}
          style={{ left: tag.x, top: tag.y, "--i": order.get(tag.id) } as CSSProperties}
        >
          {tag.name}
        </div>
      ))}
    </>
  );
};

export const TourMap = memo(
  ({
    located,
    stop,
    visit,
    flightMs,
    arrived,
    leaving,
    onArrive,
  }: {
    located: Located[]; // everyone on the map
    stop: Stop | null; // where the camera is headed (null: the opening shot of everyone nearby)
    visit: number; // bumps every departure
    flightMs: number;
    arrived: boolean; // the stop's names and dots light up
    leaving: boolean; // the beat before the next flight: names out, dots back down
    onArrive: (visit: number) => void; // the camera has as good as landed
  }) => {
    const frameRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<Size>({ width: 0, height: 0 });
    const [paths, setPaths] = useState<Paths>();
    const [failed, setFailed] = useState(false);
    const [fontsReady, setFontsReady] = useState(false);

    useLayoutEffect(() => {
      const element = frameRef.current!;
      const measure = () =>
        setSize((current) =>
          current.width === element.clientWidth && current.height === element.clientHeight
            ? current
            : { width: element.clientWidth, height: element.clientHeight }
        );
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      let live = true;
      loadBasemap().then(
        (loaded) => {
          if (live) setPaths(loaded);
        },
        () => {
          if (live) setFailed(true);
        }
      );
      // Tags are laid out from measured names, so wait for the font.
      document.fonts
        .load("bold 100px Mondwest")
        .catch(() => undefined)
        .then(() => {
          if (!live) return;
          nameWidths.clear();
          setFontsReady(true);
        });
      return () => {
        live = false;
      };
    }, []);

    const unit = baseUnit(size);
    const ready = size.width > 0 && size.height > 0 && fontsReady;
    const plan = useMemo(
      () =>
        ready
          ? planVisit({ size, stop, located, nameWidth })
          : null,
      [ready, size, stop, located]
    );


    // Names go up on arrival and stay up (riding the camera as they fade) until the next stop's do.
    const [shown, setShown] = useState<Shown | null>(null);
    const serial = useRef(0);
    useLayoutEffect(() => {
      if (!arrived || !plan) return;
      const people = new Map(stop?.people.map((p) => [p.providerId, p]));
      setShown({
        serial: ++serial.current, // remounts the tags, so their entrance plays again
        camera: plan.camera,
        unit: plan.unit,
        tags: plan.tags.map((tag) => {
          const person = people.get(tag.id);
          return { ...tag, name: person?.name ?? `+${tag.more}` };
        }),
      });
    }, [arrived, plan, stop]);

    const motion = useRef<Motion>({
      camera: null,
      path: null,
      start: 0,
      duration: 0,
      arrivedAt: -Infinity,
      departedAt: -Infinity,
      leftAt: -Infinity,
      base: null,
      baseAt: 0,
      drifts: true,
      raf: 0,
    });
    const scene = useRef<Scene>({ size, located, stop, arrived, leaving, shown });

    const kick = useCallback(() => {
      const m = motion.current;
      if (m.raf) return;
      const frame = (now: number) => {
        m.raf = 0;
        const canvas = canvasRef.current;
        if (canvas && paint(canvas, layerRef.current, scene.current, m, now)) {
          m.raf = requestAnimationFrame(frame);
        }
      };
      m.raf = requestAnimationFrame(frame);
    }, []);
    useEffect(() => {
      const m = motion.current;
      return () => cancelAnimationFrame(m.raf);
    }, []);

    useLayoutEffect(() => {
      const now = performance.now();
      if (arrived) motion.current.arrivedAt = now;
      else motion.current.departedAt = now;
    }, [arrived]);
    useLayoutEffect(() => {
      if (leaving) motion.current.leftAt = performance.now();
    }, [leaving]);

    // A new visit flies from wherever the camera is; anything else (first frame, a resize, reduced
    // motion) cuts straight to the framing. Either way, say when it's there.
    const flown = useRef<number>(null);
    const landed = useRef<number>(null);
    const arrive = useRef(onArrive);
    useLayoutEffect(() => {
      arrive.current = onArrive;
    });
    useLayoutEffect(() => {
      if (!plan) return;
      const m = motion.current;
      const fresh = flown.current !== visit;
      flown.current = visit;
      m.drifts = flightMs > 0;
      if (fresh && m.camera && flightMs > 0) {
        m.path = flightPath(m.camera, plan.camera, size);
        m.start = performance.now();
        m.duration = flightMs;
        m.base = null;
      } else {
        m.path = null;
        m.camera = plan.camera;
        m.base = plan.camera;
        m.baseAt = performance.now();
      }
      if (landed.current === visit) return;
      const wait = m.path ? settledAt(m.path, plan.camera, size) * flightMs : 0;
      const timeout = setTimeout(() => {
        landed.current = visit;
        arrive.current(visit);
      }, wait);
      return () => clearTimeout(timeout);
    }, [plan, visit, flightMs, size]);

    // Every render: hand the canvas the latest and draw (it keeps going while anything moves).
    useLayoutEffect(() => {
      scene.current = { size, paths, located, stop, arrived, leaving, shown };
      const canvas = canvasRef.current;
      if (canvas && paint(canvas, layerRef.current, scene.current, motion.current, performance.now())) {
        kick();
      }
    });

    const radius = dotRadii(unit);
    return (
      <div ref={frameRef} className="putz-tour" style={{ "--u": `${unit}px` } as CSSProperties}>
        <canvas ref={canvasRef} aria-hidden="true" />
        <div
          ref={layerRef}
          className="putz-tour-tags"
          data-shown={arrived && !leaving && !!shown?.tags.length}
          style={shown ? ({ "--u": `${shown.unit}px` } as CSSProperties) : undefined}
          aria-hidden="true"
        >
          {shown && <Tags key={shown.serial} shown={shown} size={size} dotRadius={radius.lit} />}
        </div>
        {failed && (
          <p className="putz-tour-error" role="status">
            Map unavailable
          </p>
        )}
      </div>
    );
  }
);
