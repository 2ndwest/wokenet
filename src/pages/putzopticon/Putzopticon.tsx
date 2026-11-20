import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { Flex, Heading, Text } from "@radix-ui/themes";
import { api } from "../../../convex/_generated/api";
import { CenterSpinner } from "../../utils/spinner";
import { useIdleCursor } from "../../utils/useIdleCursor";
import { PersonRows, SMDSMarquee } from "./PersonRows";
import { toPersonRows } from "./rows";
import { LEAVE_MS, TourMap } from "./TourMap";
import { HOME, buildStops, hexOf, locate, nextStop, type Located, type Person, type Point, type Stop } from "./stops";
import "./putzopticon.css";

// /putzopticon: the board (marquee and name/location rows) in the top half, over a map that tours
// where everyone is. At each stop the camera eases in on one color's people and names them; their
// rows light up with the usual refresh flash while the rest sit back.

const DWELL_MS = 6000; // lingering at each stop
const FAR_FLIGHT_MS = 5200; // to or from a far-away stop
// Nearby hops take longer the further they go: a building over is ~2.4 s, across campus ~3.3 s.
const nearFlightMs = (km: number) => Math.round(Math.min(4000, Math.max(2200, 2200 + 1200 * Math.log10(1 + km / 0.25))));
const centerOf = (stop: Stop | null): Point => {
  if (!stop?.people.length) return HOME;
  const n = stop.people.length;
  return {
    x: stop.people.reduce((sum, p) => sum + p.point.x, 0) / n,
    y: stop.people.reduce((sum, p) => sum + p.point.y, 0) / n,
  };
};
const OPENING_MS = 1200; // on the shot of everyone nearby, before the first stop
const FLASH_MS = 750; // the board's refresh flash

export function Putzopticon() {
  const data = useQuery(api.locations.getLocations);
  const tooWide = useSyncExternalStore(subscribeToWide, () => matchMedia(TOO_WIDE).matches);
  if (tooWide) return <ShrinkWindow />;
  if (!data) return <CenterSpinner />;
  return <PutzMapBoard people={data} />;
}

// The view is laid out for the hall's portrait TV (9:16, about 0.56 wide per unit tall) and phones,
// so anything wider than 3:5 gets asked to narrow down rather than a stretched, many-column board.
const TOO_WIDE = "(min-aspect-ratio: 3/5)";
const subscribeToWide = (onChange: () => void) => {
  const media = matchMedia(TOO_WIDE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

const ShrinkWindow = () => (
  <Flex p="6" direction="column" align="center" justify="center" width="100%" height="100%">
    <Heading size="8" align="center">
      SCREEN TOO WIDE
    </Heading>
    <br />
    <Text align="center" size="4">
      This page is meant to be viewed on a TV or other vertical display.
    </Text>
  </Flex>
);

// The day and time (Eastern, like the marquee's blackouts), for the empty slot at the bottom of a
// ragged last column: a block across the whole slot in the current stop's color (like the progress
// bar), the time in the pills' type.
// Reads "NOV 28 3:42 PM".
const CLOCK_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const CLOCK_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const clockText = () => {
  const now = new Date();
  return `${CLOCK_DATE.format(now)} ${CLOCK_TIME.format(now)}`.toUpperCase();
};

const ClockCell = memo(({ color }: { color?: string }) => {
  const [text, setText] = useState(clockText);
  useEffect(() => {
    const interval = setInterval(() => setText(clockText()), 10_000);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="putz-map-clock" style={color ? { backgroundColor: color, color: "inherit" } : undefined}>
      {/* Berkeley Mono glyphs are 0.6em wide. */}
      <span className="putz-caps" style={{ fontSize: `min(64cqh, ${(86 / (text.length * 0.6)).toFixed(2)}cqw)` }}>
        {text}
      </span>
    </div>
  );
});

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const subscribeToMotion = (onChange: () => void) => {
  const media = matchMedia(REDUCED_MOTION);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

// However many columns keep the rows nearest their usual proportions in the space there is (the
// marquee counts as a row, as on the board).
const pickColumns = (count: number, width: number, height: number) => {
  let best = { columns: 2, score: Infinity };
  for (let columns = 1; columns <= 6 && width > 0 && height > 0; columns++) {
    const aspect = width / columns / (height / (Math.ceil(count / columns) + 1));
    const score = Math.abs(Math.log(aspect / 8));
    if (score < best.score) best = { columns, score };
  }
  return best.columns;
};

type Visit = {
  n: number;
  stop: Stop | null; // null: the opening shot
  located: Located[]; // who's where, as of setting off (live updates wait for the next stop)
  flightMs: number;
  arrived: boolean;
  dwelling: boolean;
};

const PutzMapBoard = memo(
  ({ people }: { people: Person[] }) => {
    useIdleCursor();
    const reducedMotion = useSyncExternalStore(subscribeToMotion, () => matchMedia(REDUCED_MOTION).matches);

    const rows = useMemo(() => toPersonRows(people), [people]);
    const located = useMemo(() => locate(people), [people]);
    const stops = useMemo(() => buildStops(located), [located]);

    const [visit, setVisit] = useState<Visit>(() => ({
      n: 0,
      stop: null,
      located,
      flightMs: 0,
      arrived: true,
      dwelling: false,
    }));
    const latest = useRef({ stops, located, reducedMotion });
    const visitRef = useRef(visit);
    visitRef.current = visit;
    useLayoutEffect(() => {
      latest.current = { stops, located, reducedMotion };
    });

    // Off to `target`, or else the next stop along.
    const go = useCallback(
      (target?: Stop) =>
        setVisit((current) => {
          const { stops, located, reducedMotion } = latest.current;
          const stop = target ?? nextStop(stops, current.stop) ?? null;
          const n = current.n + 1;
          // Nowhere to go, or nowhere new: stay put for another dwell.
          if (!stop || stop.key === current.stop?.key) {
            return { n, stop, located, flightMs: 0, arrived: true, dwelling: true };
          }
          const far = stop.far || !!current.stop?.far;
          const [a, b] = [centerOf(current.stop), centerOf(stop)];
          const km = Math.hypot(b.x - a.x, b.y - a.y);
          const flightMs = reducedMotion ? 0 : far ? FAR_FLIGHT_MS : nearFlightMs(km);
          return { n, stop, located, flightMs, arrived: false, dwelling: false };
        }),
      []
    );

    // Moving on starts with a short beat where the names leave and the dots settle back (the map
    // draws it), and only then the flight, so nothing is still on screen as the camera whips away.
    const [leaving, setLeaving] = useState(false);
    const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    useEffect(() => () => clearTimeout(leaveTimer.current), []);
    const depart = useCallback(
      (target?: Stop) => {
        const { stops, reducedMotion } = latest.current;
        clearTimeout(leaveTimer.current);
        const next = target ?? nextStop(stops, visitRef.current.stop);
        if (reducedMotion || !visitRef.current.stop || !next || next.key === visitRef.current.stop.key) {
          setLeaving(false);
          go(target);
          return;
        }
        setLeaving(true);
        leaveTimer.current = setTimeout(() => {
          setLeaving(false);
          go(target);
        }, LEAVE_MS);
      },
      [go]
    );

    // The tour's clock: fly, linger, move on. The map says when it has as good as landed (names up,
    // rows flash), a little before the flight's last, barely moving stretch is over.
    const arrive = useCallback(
      (n: number) => setVisit((current) => (current.n === n && !current.arrived ? { ...current, arrived: true } : current)),
      []
    );
    useEffect(() => {
      const after = (ms: number, then: () => void) => {
        const timeout = setTimeout(then, ms);
        return () => clearTimeout(timeout);
      };
      if (visit.n === 0) return after(OPENING_MS, () => go());
      if (!visit.dwelling) {
        return after(visit.flightMs, () =>
          setVisit((current) => (current.n === visit.n ? { ...current, arrived: true, dwelling: true } : current))
        );
      }
      return after(DWELL_MS, () => depart());
    }, [visit.n, visit.dwelling, visit.flightMs, go, depart]);

    // Rows at the stop start pulsing as the camera sets off, and flash as it gets there.
    const litKeys = useMemo(() => visit.stop ? new Set(visit.stop.people.map((p) => p.providerId)) : undefined, [visit.stop]);
    const [flash, setFlash] = useState(false);
    useEffect(() => {
      if (!visit.arrived || !visit.stop || visit.flightMs === 0) return;
      setFlash(true);
      const timeout = setTimeout(() => setFlash(false), FLASH_MS);
      return () => {
        clearTimeout(timeout);
        setFlash(false);
      };
    }, [visit.arrived, visit.stop, visit.flightMs]);

    // Tapping someone's row sends the map to them.
    const visitPerson = useCallback(
      (key: string) => {
        const stop = latest.current.stops.find((s) => s.people.some((p) => p.providerId === key));
        if (stop) depart(stop);
      },
      [depart]
    );

    const roster = useRef<HTMLElement>(null);
    const [rosterSize, setRosterSize] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
      const element = roster.current!;
      const measure = () => setRosterSize({ width: element.clientWidth, height: element.clientHeight });
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }, []);
    const columns = pickColumns(rows.length, rosterSize.width, rosterSize.height);
    const rowsPerColumn = Math.max(1, Math.ceil(rows.length / columns));

    return (
      <div className="putz-map-view">
        <section ref={roster} className="putz-map-roster" aria-label="Where everyone is">
          <SMDSMarquee height={`${100 / (rowsPerColumn + 1)}%`} />
          <PersonRows
            rows={rows}
            columns={columns}
            rowsPerColumn={rowsPerColumn}
            litKeys={litKeys}
            flash={flash}
            onRowClick={visitPerson}
            // A ragged last column gets the time in its first empty slot.
            lastCell={rows.length % columns !== 0 ? <ClockCell color={visit.stop ? hexOf(visit.stop.color) : undefined} /> : undefined}
          />
        </section>
        <section className="putz-map-stage" aria-label="Map tour">
          {visit.stop && (
            // Drains as the camera travels (easing like it), then fills while it lingers.
            <div
              key={`${visit.n}-${visit.dwelling}`}
              className="putz-tour-progress"
              data-phase={visit.dwelling ? "dwell" : "flying"}
              style={{
                backgroundColor: hexOf(visit.stop.color),
                animationDuration: `${visit.dwelling ? DWELL_MS : visit.flightMs}ms`,
              }}
            />
          )}
          <TourMap
            located={visit.located}
            stop={visit.stop}
            visit={visit.n}
            flightMs={visit.flightMs}
            arrived={visit.arrived}
            leaving={leaving}
            onArrive={arrive}
          />
        </section>
      </div>
    );
  }
);
