import {
  Box,
  Flex,
  Grid,
  Heading,
  IconButton,
  Popover,
  SegmentedControl,
  Text,
  TextField,
} from "@radix-ui/themes";
import { memo, useMemo, useState } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Doc } from "../../convex/_generated/dataModel";
import { getRelativeTime, toMins, useRerender } from "../utils/time";
import { CenterSpinner } from "../utils/spinner";
import { COLOR_HEX } from "../utils/colors";
import { ClockIcon, EyeIcon, SortIcon } from "../utils/icons";
import BUILDING_COORDS from "../utils/building_coords.json";

type When = "now" | "today" | "tomorrow";
type Sort = "building" | "longest";
type Window = Doc<"classroomAvailability">["open"][number];

// A room as seen at the chosen time: free until `window.end`, or booked if there's no `window`.
type RoomAt = { room: string; building: string; open: Window[]; window?: Window };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STALE_AFTER = 3 * HOUR; // nickbot pushes about hourly.
const TICK = 30_000; // How often times and bars move along with the clock.
// Bars show a rolling window around the chosen time, mostly looking ahead.
const TIMELINE_BEFORE = 1 * HOUR;
const TIMELINE_AFTER = 3 * HOUR;
const GROTESK = { fontFamily: "Non Natural Grotesk", fontWeight: 700 }; // For room and building names.

// Midnight at the start of `ms`'s day, shifted by `days`.
const startOfDay = (ms: number, days = 0) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
};

const atTime = (dayStart: number, hours: number, minutes = 0) =>
  new Date(dayStart).setHours(hours, minutes, 0, 0);

// "45m" under an hour, otherwise hours to one decimal, e.g. "1.5h" or "28.3h".
const formatDuration = (ms: number) => {
  const mins = Math.round(ms / MINUTE);
  if (mins < 60) return `${mins}m`;
  return `${Number((mins / 60).toFixed(1))}h`;
};

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// [lat, lng] per building, pulled once from MIT's campus map (whereis.mit.edu).
const COORDS: Record<string, number[] | undefined> = BUILDING_COORDS;

// Rough distance between two buildings. Ones missing from the map (e.g. NE46) count as farthest.
const distance = (a: string, b: string) => {
  const [p, q] = [COORDS[a], COORDS[b]];
  if (!p || !q) return Infinity;
  return Math.hypot(p[0] - q[0], (p[1] - q[1]) * Math.cos((p[0] * Math.PI) / 180));
};

// The building a search is for: "W41" or "W41-2" -> "W41". Wings fold in like the data: "14N-1" -> "14".
const searchedBuilding = (query: string, buildings: Set<string>) => {
  const head = query.split("-")[0];
  const unwinged = head.replace(/^(\d+)[NSEW]$/, "$1");
  return [head, unwinged].find((b) => buildings.has(b) || COORDS[b]);
};

// How long an open stretch lasts from the chosen time: under 30m yellow, under an hour blue, else green.
const colorFor = (w: Window, at: number) => {
  const left = w.end - Math.max(w.start, at);
  return left < 30 * MINUTE ? COLOR_HEX.yellow : left < HOUR ? "var(--blue-9)" : "var(--green-9)";
};

// The current open stretch is bright, later ones dimmer, and past ones a dim green.
const windowColor = (w: Window, at: number) => {
  if (w.end <= at) return "color-mix(in srgb, var(--green-9) 30%, var(--color-background))";
  const color = colorFor(w, at);
  return w.start > at ? `color-mix(in srgb, ${color} 55%, var(--color-background))` : color;
};

// Open windows from an hour before to 3 hours after the chosen time (the tick), over red booked time.
const Timeline = memo(({ open, at }: { open: Window[]; at: number }) => {
  const from = at - TIMELINE_BEFORE;
  const to = at + TIMELINE_AFTER;
  const pct = (ms: number) => (100 * (Math.min(Math.max(ms, from), to) - from)) / (to - from);

  return (
    <div
      style={{
        position: "relative",
        height: "8px",
        backgroundColor: COLOR_HEX.red, // Same red as Cambridge on the Putzopticon.
        borderRadius: "var(--radius-1)",
      }}
    >
      {open
        .filter((w) => w.end > from && w.start < to)
        .map((w) => (
          <div
            key={w.start}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${pct(w.start)}%`,
              width: `${pct(w.end) - pct(w.start)}%`,
              backgroundColor: windowColor(w, at),
              transition: "left 1s linear, width 1s linear", // Glide as the clock ticks.
            }}
          />
        ))}
      <div
        style={{
          position: "absolute",
          top: "-3px",
          bottom: "-3px",
          left: `calc(${pct(at)}% - 1px)`,
          width: "2px",
          backgroundColor: "var(--gray-12)",
        }}
      />
    </div>
  );
});

// A thin divided row: room on the left, its timeline in the middle, and time left on the right.
const RoomRow = memo(({ room, at }: { room: RoomAt; at: number }) => {
  const free = !!room.window;

  return (
    <Flex
      align="center"
      gap="3"
      style={{
        height: "calc(var(--space-6) * 1.25)", // 25% taller than the search box.
        borderBottom: "1px solid var(--gray-4)",
        opacity: free ? 1 : 0.6,
      }}
    >
      <Text size="4" style={{ width: "96px", flexShrink: 0, ...GROTESK }}>
        {room.room}
      </Text>
      <Box flexGrow="1">
        <Timeline open={room.open} at={at} />
      </Box>
      <Text
        size="2"
        align="right"
        style={{
          width: "56px",
          flexShrink: 0,
          color: free ? colorFor(room.window!, at) : COLOR_HEX.red,
        }}
      >
        {free ? formatDuration(room.window!.end - at) : "N/A"}
      </Text>
    </Flex>
  );
});

const RoomGrid = memo(({ rooms, at }: { rooms: RoomAt[]; at: number }) => {
  // Rooms freeing up or getting booked slide in and out instead of jumping the list.
  const [autoAnimate] = useAutoAnimate();

  return (
    // Wider screens tile the rows into columns so the timelines don't stretch too far.
    <Grid
      ref={autoAnimate}
      columns={{ initial: "1", md: "2", lg: "3" }}
      gapX={{ initial: "0", md: "6" }}
    >
      {rooms.map((room) => (
        <RoomRow key={room.room} room={room} at={at} />
      ))}
    </Grid>
  );
});

// Which MIT rooms are free now (or at a chosen time today/tomorrow), from nickbot's room sweeps.
export const Classrooms = memo(() => {
  useRerender(TICK);
  const now = Math.floor(Date.now() / TICK) * TICK;

  const rooms = useQuery(api.classroomAvailability.getClassroomAvailability);

  const [when, setWhen] = useState<When>("now");
  const [time, setTime] = useState(() => `${String((new Date().getHours() + 1) % 24).padStart(2, "0")}:00`);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("building");
  const [showBooked, setShowBooked] = useState(false);

  const at =
    when === "now"
      ? now
      : atTime(startOfDay(now, when === "today" ? 0 : 1), Math.floor(toMins(time) / 60), toMins(time) % 60);

  const query = search.replace(/\s/g, "").toUpperCase();

  const searched = useMemo(
    () => (rooms && query ? searchedBuilding(query, new Set(rooms.map((r) => r.building))) : undefined),
    [rooms, query]
  );

  const shown = useMemo(() => {
    if (!rooms) return [];

    // Searching a building ("W41") puts all its rooms first; with more ("W41-2"), just those rooms,
    // then the rest of the building. Either way, the nearest buildings follow. Other searches just
    // match room names.
    const matches = (r: { room: string; building: string }) =>
      !query ||
      (searched
        ? query === searched
          ? r.building === searched
          : r.room.toUpperCase().startsWith(query)
        : r.room.toUpperCase().includes(query));
    const tier = (r: RoomAt) => (matches(r) ? 0 : r.building === searched ? 1 : 2);

    return rooms
      .filter((r) => searched || matches(r))
      .map((r): RoomAt => ({
        ...r,
        window: r.open.find((w) => w.start <= at && at < w.end),
      }))
      .filter((r) => r.window || showBooked)
      .sort(
        (a, b) =>
          (searched
            ? tier(a) - tier(b) ||
              distance(searched, a.building) - distance(searched, b.building) ||
              byName(a.building, b.building)
            : 0) ||
          (sort === "longest"
            ? (b.window?.end ?? 0) - (a.window?.end ?? 0) || byName(a.room, b.room)
            : byName(a.building, b.building) || byName(a.room, b.room))
      );
  }, [rooms, query, searched, at, sort, showBooked]);

  const buildings = useMemo(() => {
    const groups = new Map<string, RoomAt[]>();
    for (const room of shown) groups.set(room.building, [...(groups.get(room.building) ?? []), room]);
    return [...groups];
  }, [shown]);

  if (!rooms) return <CenterSpinner />;

  const updatedAt = Math.max(0, ...rooms.map((r) => r.updatedAt));

  return (
    <Flex direction="column" width="100%" p="5" align="center">
      <Flex direction="column" width="100%" style={{ maxWidth: 1300 }} gap="5" pb="5">
        <Flex direction="column" gap="1">
          <Heading size="8">Classrooms</Heading>
          <Text size="2" color={now - updatedAt > STALE_AFTER ? "red" : "gray"}>
            {rooms.length === 0 ? "No classroom data yet." : `Updated ${getRelativeTime(updatedAt)}.`}
          </Text>
        </Flex>

        <Flex gap="2" align="center">
          <TextField.Root
            placeholder="Search buildings, e.g. 26"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flexGrow: 1 }}
          />

          {/* Filled in when showing some time other than now. */}
          <Popover.Root>
            <Popover.Trigger>
              <IconButton variant={when === "now" ? "surface" : "solid"} aria-label="Pick a time">
                <ClockIcon />
              </IconButton>
            </Popover.Trigger>
            <Popover.Content size="1" align="end">
              <Flex direction="column" gap="2">
                <SegmentedControl.Root value={when} onValueChange={(v) => setWhen(v as When)}>
                  <SegmentedControl.Item value="now">Now</SegmentedControl.Item>
                  <SegmentedControl.Item value="today">Today</SegmentedControl.Item>
                  <SegmentedControl.Item value="tomorrow">Tomorrow</SegmentedControl.Item>
                </SegmentedControl.Root>
                {when !== "now" && (
                  <TextField.Root
                    type="time"
                    step={900}
                    value={time}
                    onChange={(e) => e.target.value && setTime(e.target.value)}
                  />
                )}
              </Flex>
            </Popover.Content>
          </Popover.Root>

          {/* Filled in when sorted by longest free instead of grouped by building. */}
          <IconButton
            variant={sort === "longest" ? "solid" : "surface"}
            aria-label="Sort by longest free"
            onClick={() => setSort((s) => (s === "longest" ? "building" : "longest"))}
          >
            <SortIcon />
          </IconButton>

          {/* Filled in when booked rooms are shown too. */}
          <IconButton
            variant={showBooked ? "solid" : "surface"}
            aria-label="Show booked rooms"
            onClick={() => setShowBooked((b) => !b)}
          >
            <EyeIcon height="18px" fill="currentColor" />
          </IconButton>
        </Flex>

        {/* Sorting by longest mixes buildings, unless a building search keeps them grouped. */}
        {sort === "longest" && !searched ? (
          <RoomGrid rooms={shown} at={at} />
        ) : (
          buildings.map(([building, rooms]) => (
            <Flex key={building} direction="column" gap="2">
              <Heading size="5" style={GROTESK}>
                Building {building}
              </Heading>
              <RoomGrid rooms={rooms} at={at} />
            </Flex>
          ))
        )}
      </Flex>
    </Flex>
  );
});
