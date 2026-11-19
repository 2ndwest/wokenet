import { Flex, Grid } from "@radix-ui/themes";
import { api } from "../../../convex/_generated/api";
import { useQuery } from "convex/react";
import { memo, useEffect, useState, useMemo, createElement } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { COLOR_HEX } from "../../utils/colors";
import { toMins } from "../../utils/time";
import "./putzopticon.css";

// The Putzopticon's board: the SMDS marquee and the name/location rows above the map.

const SCAN_ANIMATION_DURATION = 750; // ms
const SCAN_FREQUENCY = 200; // ms
const SMDS_MARQUEE_COUNT = 100; // n most recent smds

// Blackout periods for SMDS marquee (eastern time, 24h format)
const SMDS_BLACKOUTS: [string, string, string][] = [
  ["09:00", "14:00", "¡Buenos días Nataly! Gracias por mantener limpio a Putz."],
  ["23:30", "01:30", "Good evening night watch! Thank you for helping keep us safe."],
  ["03:00", "06:00", "Good morning night watch! Thank you for helping keep us safe."],
];

const getSMDSBlackoutMessage = (): string | null => {
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  for (const [startStr, endStr, message] of SMDS_BLACKOUTS) {
    const [start, end] = [toMins(startStr), toMins(endStr)];
    const isInRange = end < start ? now >= start || now < end : now >= start && now < end;
    if (isInRange) return message;
  }
  return null;
};

export type PersonRowData = {
  key: string;
  name: string;
  color: string;
  label: string;
  dimmed?: boolean;
};

type RowsProps = {
  rows: PersonRowData[];
  columns: number;
  rowsPerColumn: number;
  lastCell?: React.ReactNode; // Optional row-sized cell placed after the rows (bottom right).
  onRowClick?: (key: string) => void;
  // Rows outside `litKeys` sit back, and `flash` sets off the lit ones like a refresh.
  litKeys?: ReadonlySet<string>;
  flash?: boolean;
};

export const PersonRows = memo(({ rows, columns, rowsPerColumn, lastCell, onRowClick, litKeys, flash = false }: RowsProps) => {
  // Track which people are currently being "scanned" for location refresh effect.
  const [scanningIndices, setScanningIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (rows.length === 0) return;

    const interval = setInterval(() => {
      // Pick a random person.
      const randomIndex = Math.floor(Math.random() * rows.length);

      // Add them to the scanning set.
      setScanningIndices((prev) => new Set(prev).add(randomIndex));

      // Remove them from the set after animation completes.
      setTimeout(() => {
        setScanningIndices((prev) => {
          const next = new Set(prev);
          next.delete(randomIndex);
          return next;
        });
      }, SCAN_ANIMATION_DURATION);
    }, SCAN_FREQUENCY);

    return () => clearInterval(interval);
  }, [rows]);

  const [autoAnimate] = useAutoAnimate();
  // Every row makes its name column wide enough for the board's longest name at full size.
  const longestName = useMemo(() => Math.max(1, ...rows.map((row) => row.name.length)), [rows]);

  return (
    // Fills each column top to bottom, then moves on to the next.
    <Grid
      ref={autoAnimate}
      flow="column"
      rows={`repeat(${rowsPerColumn}, 1fr)`}
      columns={`repeat(${columns}, 1fr)`}
      width="100%"
      flexGrow="1"
      gapX="4"
      gapY="0.4%"
      px="8px"
      py="8px"
      overflow="hidden"
      position="relative"
    >
      {rows.map((row, index) => (
        <PersonRow
          key={row.key} // Names can collide (two Aidens), so key on something unique.
          id={row.key}
          name={row.name}
          color={row.color}
          label={row.label}
          dimmed={row.dimmed}
          nameFit={longestName}
          muted={litKeys && !litKeys.has(row.key)}
          height="100%" // Let the CSS engine deal with this.
          isScanning={scanningIndices.has(index) || (flash && !!litKeys?.has(row.key))}
          onClick={onRowClick}
        />
      ))}
      {lastCell}
    </Grid>
  );
});

// Caps a font size so the text spans at most `fill`% of its box's width, given the font's widest
// average glyph (in em). Height alone can't size text: a long label in a short, narrow row wraps.
const fitWidth = (chars: number, glyphEm: number, fill: number) =>
  `${(fill / (Math.max(chars, 1) * glyphEm)).toFixed(2)}cqw`;

export const PersonRow = memo(
  ({
    id,
    name,
    color,
    label,
    height,
    dimmed = false,
    isScanning = false,
    nameFit = name.length,
    muted,
    onClick,
  }: {
    id: string;
    name: string;
    color: string;
    label: string;
    height: string;
    dimmed?: boolean;
    isScanning?: boolean;
    nameFit?: number; // Characters the name column should fit at full size (the board's longest name).
    muted?: boolean; // Away from the map's current stop.
    onClick?: (id: string) => void;
  }) => {
    return (
      <Flex
        direction="row"
        height={height}
        width="100%"
        onClick={onClick && (() => onClick(id))}
        style={{
          containerType: "size", // The name column sizes itself against the row's height.
          cursor: onClick ? "pointer" : undefined,
          // Can't use opacity it messes with the AutoAnimate.
          filter: dimmed ? "brightness(0.3)" : muted ? "brightness(0.45)" : "none",
          transition: muted === undefined ? undefined : "filter 600ms ease-out",
          animation:
            isScanning && !dimmed && !muted
              ? `locationRefresh ${SCAN_ANIMATION_DURATION}ms ease-out`
              : "none",
        }}
      >
        <Flex
          height="100%"
          flexShrink="0"
          align="center"
          style={{
            // Wide enough for the longest name at full height (Mondwest is ~0.65em a glyph and the
            // name is 85% of the row's height), taking room from the pill rather than shrinking
            // names. Never less than the classic 40%, never more than 58%.
            width: `clamp(40cqw, ${((nameFit * 0.65 * 85) / 0.95).toFixed(1)}cqh, 58cqw)`,
            containerType: "size", // So we can use cqh units
            fontFamily: "Mondwest",
            fontWeight: "bold",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <span style={{ fontSize: `min(85cqh, 25cqw, ${fitWidth(nameFit, 0.65, 95)})` }}>{name}</span>
        </Flex>

        <Flex
          height="100%"
          flexGrow="1"
          minWidth="0"
          direction="row"
          justify="center"
          align="center"
          style={{
            containerType: "size", // So we can use cqh units
            backgroundColor: COLOR_HEX[color] ?? color,
            borderRadius: "2px",
            fontWeight: "bold",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {/* Berkeley Mono glyphs are 0.6em wide. */}
          <span className="putz-caps" style={{ fontSize: `min(80cqh, 14cqw, ${fitWidth(label.length, 0.6, 92)})` }}>
            {label}
          </span>
        </Flex>
      </Flex>
    );
  }
);

export const SMDSMarquee = memo(({ height }: { height: string }) => {
  const sayings = useQuery(api.shitMyDadSays.getSayings, { sortBy: undefined });

  const shuffledSayings = useMemo(() => {
    if (!sayings || sayings.length === 0) return [];
    const shuffled = [...sayings].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, SMDS_MARQUEE_COUNT);
  }, [sayings]);

  // Null if not in a blackout period.
  const [blackoutMessage, setBlackoutMessage] = useState(getSMDSBlackoutMessage);

  // Update blackout message every couple of minutes.
  useEffect(() => {
    const interval = setInterval(() => {
      setBlackoutMessage(getSMDSBlackoutMessage());
    }, 5 * 60_000); // 5 minutes

    return () => clearInterval(interval);
  }, []);

  if (shuffledSayings.length === 0 && !blackoutMessage) return null;

  return (
    <Flex
      width="100%"
      height={height}
      flexShrink="0"
      align="center"
      justify="center"
      overflow="hidden"
      style={{
        containerType: "size",
        backgroundColor: "rgba(var(--banner-rgb), 0.15)",
        borderTop: "1px solid rgba(var(--banner-rgb), 0.3)",
        borderBottom: "1px solid rgba(var(--banner-rgb), 0.3)",
      }}
    >
      {blackoutMessage ? (
        <span
          style={{
            fontFamily: "Mondwest",
            fontSize: "60cqh",
            textAlign: "center",
          }}
        >
          {blackoutMessage}
        </span>
      ) : (
        <Marquee scrollamount={4}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              fontFamily: "Mondwest",
              fontSize: "60cqh",
            }}
          >
            {shuffledSayings.map((quote, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "1em",
                  paddingRight: "3em",
                }}
              >
                <span style={{ fontStyle: "italic", color: "white" }}>"{quote.quote}"</span>
                <span style={{ color: "rgba(var(--banner-rgb), 0.75)" }}>— {quote.quoted}</span>
              </span>
            ))}
          </span>
        </Marquee>
      )}
    </Flex>
  );
});

const Marquee = ({
  children,
  scrollamount,
}: {
  children: React.ReactNode;
  scrollamount?: number;
}) =>
  createElement(
    "marquee",
    { scrollamount, style: { display: "flex", alignItems: "center" } },
    children
  );
