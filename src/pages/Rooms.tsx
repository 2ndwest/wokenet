import { Box, Card, Flex, Grid, Heading, SegmentedControl, Text, TextField } from "@radix-ui/themes";
import { memo, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Doc } from "../../convex/_generated/dataModel";
import { getRelativeTime, toMins, useRerender } from "../utils/time";
import { CenterSpinner } from "../utils/spinner";

type When = "now" | "today" | "tomorrow";
type Sort = "building" | "longest";
type Window = Doc<"roomAvailability">["open"][number];

// A room as seen at the chosen time: either free (until `window.end`) or booked (until `next?.start`).
type RoomAt = { room: string; building: string; open: Window[]; window?: Window; next?: Window };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STALE_AFTER = 3 * HOUR; // nickbot pushes about hourly.
const TIMELINE_START_HOUR = 7; // Overnight "open" windows are just unbooked, so start bars at 7am.

// Midnight at the start of `ms`'s day, shifted by `days`.
const startOfDay = (ms: number, days = 0) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
};

const atTime = (dayStart: number, hours: number, minutes = 0) =>
  new Date(dayStart).setHours(hours, minutes, 0, 0);

const formatTime = (ms: number) => {
  const d = new Date(ms);
  if (d.getHours() === 0 && d.getMinutes() === 0) return "midnight";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

// "3:00 PM", or "9:00 AM tomorrow" when it's on a later day than `at`. Midnight counts as the day before.
const formatRelativeTime = (ms: number, at: number) => {
  const days = Math.round((startOfDay(ms - 1) - startOfDay(at)) / (24 * HOUR));
  if (days === 0) return formatTime(ms);
  if (days === 1) return `${formatTime(ms)} tomorrow`;
  return `${formatTime(ms)} ${new Date(ms - 1).toLocaleDateString([], { weekday: "short" })}`;
};

const formatDuration = (ms: number) => {
  const mins = Math.round(ms / MINUTE);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// Open (green) windows across 7am–midnight of the chosen day, with a tick at the chosen time.
const Timeline = memo(({ open, at }: { open: Window[]; at: number }) => {
  const from = atTime(startOfDay(at), TIMELINE_START_HOUR);
  const to = startOfDay(at, 1);
  const pct = (ms: number) => (100 * (Math.min(Math.max(ms, from), to) - from)) / (to - from);

  return (
    <div
      style={{
        position: "relative",
        height: "8px",
        backgroundColor: "var(--gray-5)",
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
              backgroundColor: "var(--green-9)",
            }}
          />
        ))}
      {at >= from && (
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
      )}
    </div>
  );
});

const RoomDetails = memo(({ room, at }: { room: RoomAt; at: number }) => {
  const free = !!room.window;

  return (
    <Card style={{ opacity: free ? 1 : 0.6 }}>
      <Flex direction="column" gap="2">
        <Flex justify="between" align="baseline" gap="2">
          <Text size="4" weight="bold">
            {room.room}
          </Text>
          {free && (
            <Text size="2" color="green">
              {room.window!.end >= startOfDay(at, 1)
                ? "rest of day"
                : formatDuration(room.window!.end - at)}
            </Text>
          )}
        </Flex>
        <Text size="2" color={free ? undefined : "gray"}>
          {free
            ? `Free until ${formatRelativeTime(room.window!.end, at)}`
            : room.next
              ? `Booked, free at ${formatRelativeTime(room.next.start, at)}`
              : "Booked for the rest of the day"}
        </Text>
        <Timeline open={room.open} at={at} />
      </Flex>
    </Card>
  );
});

const RoomCard = memo(({ room, at }: { room: RoomAt; at: number }) => {
  const free = !!room.window;

  return (
    <>
      {/* Phones get thin rows: room on the left, its timeline on the right. */}
      <Flex
        display={{ initial: "flex", xs: "none" }}
        align="center"
        gap="3"
        px="3"
        style={{
          height: "calc(var(--space-6) * 1.25)", // 25% taller than the search box.
          backgroundColor: "var(--gray-2)",
          border: "1px solid var(--gray-4)",
          borderRadius: "var(--radius-2)",
          opacity: free ? 1 : 0.6,
        }}
      >
        <Text size="3" weight="bold" style={{ width: "96px", flexShrink: 0 }}>
          {room.room}
        </Text>
        <Box flexGrow="1">
          <Timeline open={room.open} at={at} />
        </Box>
      </Flex>

      <Box display={{ initial: "none", xs: "block" }}>
        <RoomDetails room={room} at={at} />
      </Box>
    </>
  );
});

const RoomGrid = memo(({ rooms, at }: { rooms: RoomAt[]; at: number }) => (
  <Grid columns={{ initial: "1", xs: "2", md: "3", lg: "4" }} gap={{ initial: "1", xs: "3" }}>
    {rooms.map((room) => (
      <RoomCard key={room.room} room={room} at={at} />
    ))}
  </Grid>
));

// Which MIT rooms are free now (or at a chosen time today/tomorrow), from nickbot's room sweeps.
export const Rooms = memo(() => {
  useRerender(MINUTE);
  const now = Math.floor(Date.now() / MINUTE) * MINUTE;

  const rooms = useQuery(api.roomAvailability.getRoomAvailability);

  const [when, setWhen] = useState<When>("now");
  const [time, setTime] = useState(() => `${String((new Date().getHours() + 1) % 24).padStart(2, "0")}:00`);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("building");

  const at =
    when === "now"
      ? now
      : atTime(startOfDay(now, when === "today" ? 0 : 1), Math.floor(toMins(time) / 60), toMins(time) % 60);

  const query = search.trim().toUpperCase();

  const shown = useMemo(() => {
    if (!rooms) return [];
    return (
      rooms
        .filter((r) => !query || r.room.toUpperCase().includes(query))
        .map((r): RoomAt => ({
          ...r,
          window: r.open.find((w) => w.start <= at && at < w.end),
          next: r.open.find((w) => w.start > at),
        }))
        // Booked rooms only show up when searched for, so you can check on a specific one.
        .filter((r) => r.window || query)
        .sort((a, b) =>
          sort === "longest"
            ? (b.window?.end ?? 0) - (a.window?.end ?? 0) || byName(a.room, b.room)
            : byName(a.building, b.building) || byName(a.room, b.room)
        )
    );
  }, [rooms, query, at, sort]);

  const buildings = useMemo(() => {
    const groups = new Map<string, RoomAt[]>();
    for (const room of shown) groups.set(room.building, [...(groups.get(room.building) ?? []), room]);
    return [...groups];
  }, [shown]);

  if (!rooms) return <CenterSpinner />;

  const updatedAt = Math.max(0, ...rooms.map((r) => r.updatedAt));
  const freeCount = shown.filter((r) => r.window).length;

  return (
    <Flex direction="column" width="100%" p="5" align="center">
      <Flex direction="column" width="100%" style={{ maxWidth: 1300 }} gap="5" pb="5">
        <Flex direction="column" gap="1">
          <Heading size="8">Open Rooms:</Heading>
          <Text size="2" color={now - updatedAt > STALE_AFTER ? "red" : "gray"}>
            {rooms.length === 0 ? "No room data yet." : `Updated ${getRelativeTime(updatedAt)}.`}{" "}
            Bars show 7 AM to midnight.
          </Text>
        </Flex>

        <Flex gap="3" wrap="wrap" align="center">
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

          <TextField.Root
            placeholder="Search rooms (e.g. 32-1, W41)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flexGrow: 1, minWidth: "200px" }}
          />

          <SegmentedControl.Root value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SegmentedControl.Item value="building">By building</SegmentedControl.Item>
            <SegmentedControl.Item value="longest">Free longest</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>

        <Text size="3" color="gray">
          {freeCount} room{freeCount === 1 ? "" : "s"} free{" "}
          {when === "now" ? "right now" : `at ${formatTime(at)} ${when}`}
          {query && ` matching "${search.trim()}"`}.
        </Text>

        {sort === "longest" ? (
          <RoomGrid rooms={shown} at={at} />
        ) : (
          buildings.map(([building, rooms]) => (
            <Flex key={building} direction="column" gap="2">
              <Heading size="5">Building {building}</Heading>
              <RoomGrid rooms={rooms} at={at} />
            </Flex>
          ))
        )}
      </Flex>
    </Flex>
  );
});
