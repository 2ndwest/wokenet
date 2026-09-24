import {
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  Heading,
  IconButton,
  Popover,
  SegmentedControl,
  Text,
  TextField,
} from "@radix-ui/themes";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Doc } from "../../convex/_generated/dataModel";
import { getRelativeTime, toMins, useRerender } from "../utils/time";
import { CenterSpinner } from "../utils/spinner";
import { COLOR_HEX } from "../utils/colors";
import { BookedIcon, ClockIcon, SortIcon, WarningIcon } from "../utils/icons";
import BUILDING_COORDS from "../utils/building_coords.json";

type When = "now" | "today" | "tomorrow";
type Sort = "building" | "longest";
type Window = Doc<"classroomAvailability">["open"][number];

// A room as seen at the chosen time: free until `window.end`, or booked if there's no `window`.
type RoomAt = Doc<"classroomAvailability"> & { window?: Window };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// A room not refreshed in this long is stale. The availability scraper refreshes each room every
// ~6 hours, so this means a missed refresh.
const STALE_AFTER = 8 * HOUR;
const TICK = 30_000; // How often times and bars move along with the clock.
// Bars show a rolling window around the chosen time, mostly looking ahead.
const TIMELINE_BEFORE = 1 * HOUR;
const TIMELINE_AFTER = 3 * HOUR;
const GROTESK = { fontFamily: "Non Natural Grotesk", fontWeight: 700 }; // For room and building names.
const LECTURE_HALL_SEATS = 60;
// Every row lays out the same, so their timelines line up down the list.
const NAME_WIDTH = "120px";
const TIME_LEFT_WIDTH = "56px";
const GRID_COLUMNS = { initial: "1", md: "2", lg: "3" } as const;
const GRID_GAP_X = { initial: "0", md: "6" } as const;

const isLectureHall = (r: { capacity?: number }) => (r.capacity ?? 0) >= LECTURE_HALL_SEATS;

// Amber, like "under 30 minutes", but only ever on the warning icon.
const REPORTED_COLOR = COLOR_HEX.yellow;
const reportedBy = (count: number) =>
  `${count} ${count === 1 ? "person" : "people"} had trouble with this room`;

// A small "LH" chip marking lecture halls next to their room number.
const LectureHallTag = ({ title }: { title?: string }) => (
  <Text
    title={title}
    style={{
      ...GROTESK,
      fontSize: "11px",
      lineHeight: "17px",
      padding: "0 4px",
      backgroundColor: "var(--gray-4)",
      borderRadius: "var(--radius-1)",
      color: "var(--gray-11)",
    }}
  >
    LH
  </Text>
);

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

// "4:30 PM", or "9:00 AM tomorrow" when it's on a later day than `at`. Midnight counts as the day before.
const formatUntil = (ms: number, at: number) => {
  const d = new Date(ms);
  const time =
    d.getHours() === 0 && d.getMinutes() === 0
      ? "midnight"
      : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((startOfDay(ms - 1) - startOfDay(at)) / (24 * HOUR));
  if (days === 0) return time;
  if (days === 1) return `${time} tomorrow`;
  return `${time} ${new Date(ms - 1).toLocaleDateString([], { weekday: "short" })}`;
};

const withWindow = (r: Doc<"classroomAvailability">, at: number): RoomAt => ({
  ...r,
  window: r.open.find((w) => w.start <= at && at < w.end),
});

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
type RoomRowProps = {
  room: RoomAt;
  at: number;
  reported: boolean;
  reportCount: number; // How many people have reported it.
  onSelect: (room: string) => void;
};

// Tapping one opens its details sheet. Rooms you've reported are faded.
const RoomRow = memo(({ room, at, reported, reportCount, onSelect }: RoomRowProps) => {
  const free = !!room.window;

  return (
    <Flex
      align="center"
      gap="3"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(room.room)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(room.room)}
      style={{
        height: "calc(var(--space-6) * 1.25)", // 25% taller than the search box.
        borderBottom: "1px solid var(--gray-4)",
        opacity: free ? 1 : 0.6,
        cursor: "pointer",
      }}
    >
      <Flex align="center" gap="2" style={{ width: NAME_WIDTH, flexShrink: 0 }}>
        <Text
          size="4"
          title={reported ? "You reported this room" : undefined}
          style={{ ...GROTESK, whiteSpace: "nowrap", color: reported ? "var(--gray-9)" : undefined }}
        >
          {room.room}
        </Text>
        {isLectureHall(room) && <LectureHallTag title={`${room.capacity} seats`} />}
      </Flex>
      <Box flexGrow="1">
        <Timeline open={room.open} at={at} />
      </Box>
      <Flex align="center" justify="end" gap="1" style={{ width: TIME_LEFT_WIDTH, flexShrink: 0 }}>
        {reportCount > 0 && (
          <Flex title={reportedBy(reportCount)} style={{ color: REPORTED_COLOR }}>
            <WarningIcon size={12} />
          </Flex>
        )}
        <Text size="2" style={{ color: free ? colorFor(room.window!, at) : COLOR_HEX.red }}>
          {free ? formatDuration(room.window!.end - at) : "N/A"}
        </Text>
      </Flex>
    </Flex>
  );
});

type RoomGridProps = {
  rooms: RoomAt[];
  at: number;
  myReports: Map<string, string>; // Room -> your note on it.
  reportCounts: Map<string, number>; // Room -> how many people reported it.
  onSelect: (room: string) => void;
};

const RoomGrid = memo(({ rooms, at, myReports, reportCounts, onSelect }: RoomGridProps) => {
  // Rooms freeing up or getting booked slide in and out instead of jumping the list.
  const [autoAnimate] = useAutoAnimate();

  return (
    // Wider screens tile the rows into columns so the timelines don't stretch too far.
    <Grid ref={autoAnimate} columns={GRID_COLUMNS} gapX={GRID_GAP_X}>
      {rooms.map((room) => (
        <RoomRow
          key={room.room}
          room={room}
          at={at}
          reported={myReports.has(room.room)}
          reportCount={reportCounts.get(room.room) ?? 0}
          onSelect={onSelect}
        />
      ))}
    </Grid>
  );
});

// A room's details: when it's free, its seats, and reporting it as unusable (undone with one tap).
const RoomDetails = ({
  room,
  at,
  myNote,
  reportCount,
}: {
  room: RoomAt;
  at: number;
  myNote?: string;
  reportCount: number;
}) => {
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);
  const report = useMutation(api.classroomReports.reportClassroom);
  const unreport = useMutation(api.classroomReports.unreportClassroom);
  const next = room.open.find((w) => w.start > at);

  // Phones only raise the keyboard for a focus made during the tap itself, so render the box and
  // focus it right here instead of on the next render.
  const startReport = () => {
    flushSync(() => setReporting(true));
    noteRef.current?.focus();
  };

  const send = () => {
    if (note.trim()) report({ room: room.room, note }).catch(alert);
  };

  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="1">
        <Flex align="center" gap="2">
          <Dialog.Title size="7" mb="0" style={GROTESK}>
            {room.room}
          </Dialog.Title>
          {isLectureHall(room) && <LectureHallTag />}
        </Flex>
        <Text size="3" style={{ color: room.window ? colorFor(room.window, at) : COLOR_HEX.red }}>
          {room.window
            ? `Free until ${formatUntil(room.window.end, at)}`
            : next
              ? `Booked until ${formatUntil(next.start, at)}`
              : "Booked through tomorrow"}
        </Text>
        <Text size="2" color="gray">
          {room.capacity !== undefined ? `${room.capacity} seats` : "Seats unknown"} ·{" "}
          <Text color={Date.now() - room.updatedAt > STALE_AFTER ? "red" : undefined}>
            Updated {getRelativeTime(room.updatedAt)}
          </Text>
        </Text>
        {reportCount > 0 && (
          <Flex align="center" gap="1" style={{ color: REPORTED_COLOR }}>
            <WarningIcon size={14} />
            <Text size="2">{reportedBy(reportCount)}</Text>
          </Flex>
        )}
      </Flex>

      <Timeline open={room.open} at={at} />

      {myNote ? (
        <Flex align="center" justify="between" gap="3">
          <Text size="2" color="gray">
            Reported. Thanks!
          </Text>
          <Button
            variant="soft"
            color="gray"
            onClick={() => unreport({ room: room.room }).catch(alert)}
          >
            Undo
          </Button>
        </Flex>
      ) : reporting ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Flex gap="2">
            <TextField.Root
              ref={noteRef}
              size="3"
              placeholder="What's wrong with it?"
              enterKeyHint="send"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ flexGrow: 1 }}
            />
            <Button type="submit" size="3" variant="soft">
              Send
            </Button>
          </Flex>
        </form>
      ) : (
        <Button
          variant="soft"
          color="gray"
          style={{ alignSelf: "flex-start" }}
          onClick={startReport}
        >
          Report a problem
        </Button>
      )}
    </Flex>
  );
};

// How much of the bottom of the screen the on-screen keyboard covers. iOS lays it over fixed elements
// instead of shrinking the page, so the sheet lifts itself by this much.
const useKeyboardInset = () => {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
};

// A sheet floating near the bottom on phones (see .classroom-sheet in index.css), where thumbs can
// reach it, and a small dialog on wider screens. Tapping outside closes it.
const RoomSheet = memo(
  ({
    room,
    at,
    open,
    onOpenChange,
    myNote,
    reportCount,
  }: {
    room?: RoomAt;
    at: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    myNote?: string;
    reportCount: number;
  }) => {
    const keyboardInset = useKeyboardInset();

    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Content
          className="classroom-sheet"
          size="3"
          maxWidth={{ initial: "100%", xs: "380px" }}
          aria-describedby={undefined}
          style={{ "--keyboard-inset": `${keyboardInset}px` } as React.CSSProperties}
        >
          {/* Keyed so the report step starts over for each room. */}
          {room && (
            <RoomDetails
              key={room.room}
              room={room}
              at={at}
              myNote={myNote}
              reportCount={reportCount}
            />
          )}
        </Dialog.Content>
      </Dialog.Root>
    );
  }
);

// An icon button for an on/off filter, filled in when on.
const ToggleButton = ({
  on,
  onToggle,
  label,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) => (
  <IconButton variant={on ? "solid" : "surface"} aria-label={label} aria-pressed={on} onClick={onToggle}>
    {children}
  </IconButton>
);

// Which MIT rooms are free now (or at a chosen time today/tomorrow), from the availability scraper.
export const Classrooms = memo(() => {
  useRerender(TICK);
  const now = Math.floor(Date.now() / TICK) * TICK;

  const rooms = useQuery(api.classroomAvailability.getClassroomAvailability);

  const [when, setWhen] = useState<When>("now");
  const [time, setTime] = useState(() => `${String((new Date().getHours() + 1) % 24).padStart(2, "0")}:00`);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("building");
  const [showBooked, setShowBooked] = useState(false);
  const [showLectureHalls, setShowLectureHalls] = useState(false);

  // The room whose sheet is open, kept while it animates closed.
  const [selected, setSelected] = useState<string>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const onSelect = useCallback((room: string) => {
    setSelected(room);
    setSheetOpen(true);
  }, []);

  const myReports = useQuery(api.classroomReports.getMyReports);
  const reportCountsList = useQuery(api.classroomReports.getReportCounts);
  const reportCounts = useMemo(
    () => new Map(reportCountsList?.map(({ room, count }) => [room, count])),
    [reportCountsList]
  );

  const myReportNotes = useMemo(
    () => new Map(myReports?.map(({ room, note }) => [room, note])),
    [myReports]
  );

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
      .map((r) => withWindow(r, at))
      .filter((r) => (r.window || showBooked) && (showLectureHalls || !isLectureHall(r)))
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
  }, [rooms, query, searched, at, sort, showBooked, showLectureHalls]);

  const buildings = useMemo(() => {
    const groups = new Map<string, RoomAt[]>();
    for (const room of shown) groups.set(room.building, [...(groups.get(room.building) ?? []), room]);
    return [...groups];
  }, [shown]);

  const selectedRoom = useMemo(() => {
    const room = rooms?.find((r) => r.room === selected);
    return room && withWindow(room, at);
  }, [rooms, selected, at]);

  if (!rooms) return <CenterSpinner />;

  const updatedAt = Math.max(0, ...rooms.map((r) => r.updatedAt));
  const staleCount = rooms.filter((r) => now - r.updatedAt > STALE_AFTER).length;
  const staleRooms = staleCount === 1 ? "1 room hasn't" : `${staleCount} rooms haven't`;
  const staleTitle = `${staleRooms} been refreshed in over ${STALE_AFTER / HOUR} hours`;

  return (
    <Flex direction="column" width="100%" p="5" align="center">
      <Flex direction="column" width="100%" style={{ maxWidth: 1300 }} gap="5" pb="5">
        <Flex direction="column" gap="1">
          <Heading size="8">Classrooms</Heading>
          <Text size="2" color={now - updatedAt > STALE_AFTER ? "red" : "gray"}>
            {rooms.length === 0
              ? "No classroom data yet."
              : `Updated ${getRelativeTime(updatedAt)}${staleCount > 0 ? "" : "."}`}
            {staleCount > 0 && (
              <Text color="red" title={staleTitle}>
                {" "}
                · {staleCount} stale
              </Text>
            )}
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

          {/* Filled in when sorted some way other than by building. */}
          <Popover.Root>
            <Popover.Trigger>
              <IconButton variant={sort === "building" ? "surface" : "solid"} aria-label="Sort">
                <SortIcon />
              </IconButton>
            </Popover.Trigger>
            <Popover.Content size="1" align="end">
              <SegmentedControl.Root value={sort} onValueChange={(v) => setSort(v as Sort)}>
                <SegmentedControl.Item value="building">By building</SegmentedControl.Item>
                <SegmentedControl.Item value="longest">By time available</SegmentedControl.Item>
              </SegmentedControl.Root>
            </Popover.Content>
          </Popover.Root>

          <ToggleButton
            on={showBooked}
            onToggle={() => setShowBooked((b) => !b)}
            label="Show booked rooms"
          >
            <BookedIcon />
          </ToggleButton>

          {/* Lecture halls (60+ seats) are hidden by default. */}
          <ToggleButton
            on={showLectureHalls}
            onToggle={() => setShowLectureHalls((b) => !b)}
            label="Show lecture halls"
          >
            <Text size="2" style={GROTESK}>
              LH
            </Text>
          </ToggleButton>
        </Flex>

        {/* Sorting by longest mixes buildings, unless a building search keeps them grouped. */}
        {sort === "longest" && !searched ? (
          <RoomGrid
            rooms={shown}
            at={at}
            myReports={myReportNotes}
            reportCounts={reportCounts}
            onSelect={onSelect}
          />
        ) : (
          buildings.map(([building, rooms]) => (
            <Flex key={building} direction="column" gap="2">
              <Heading size="5" style={GROTESK}>
                Building {building}
              </Heading>
              <RoomGrid
                rooms={rooms}
                at={at}
                myReports={myReportNotes}
                reportCounts={reportCounts}
                onSelect={onSelect}
              />
            </Flex>
          ))
        )}
      </Flex>

      <RoomSheet
        room={selectedRoom}
        at={at}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        myNote={selected ? myReportNotes.get(selected) : undefined}
        reportCount={selected ? (reportCounts.get(selected) ?? 0) : 0}
      />
    </Flex>
  );
});
