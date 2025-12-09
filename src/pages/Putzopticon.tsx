import { Flex } from "@radix-ui/themes";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { memo, useEffect, useState, useMemo, createElement } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { CenterSpinner } from "../utils/spinner";
import { COLOR_ORDER, COLOR_HEX } from "../utils/colors";
import { toMins } from "../utils/time";

const SCAN_ANIMATION_DURATION = 750; // ms
const SCAN_FREQUENCY = 200; // ms
const SMDS_MARQUEE_COUNT = 100; // n most recent smds

// Blackout periods for SMDS marquee (eastern time, 24h format)
const SMDS_BLACKOUTS: [string, string, string][] = [
  ["09:00", "13:00", "Good morning and afternoon Olair! Putz is grateful for your hard work."],
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

export const Putzopticon = memo(() => {
  const data = useQuery(api.locations.getLocations);

  return (
    <Flex direction="column" width="100%" height="100%" overflow="hidden">
      <SMDSMarquee height={`${100 / (data ? data.length + 1 : 1)}%`} />

      {data ? <PersonRows data={data} /> : <CenterSpinner />}
    </Flex>
  );
});

const PersonRows = memo(
  ({
    data,
  }: {
    data: NonNullable<ReturnType<typeof useQuery<typeof api.locations.getLocations>>>;
  }) => {
    const sortedData = useMemo(
      () =>
        data
          .map(({ label, color, name }) => ({ name, color, label }))
          .sort((a, b) => {
            // Sort by, in order:
            // 1) color (using COLOR_ORDER)
            // 2) label length (alternating longer/shorter first per color)
            // 3) label (alphabetically)
            // 4) name (alphabetically)
            const aOrder = COLOR_ORDER.indexOf(a.color);
            const bOrder = COLOR_ORDER.indexOf(b.color);
            if (aOrder !== bOrder) return aOrder - bOrder;
            // Alternate: even color indices sorted longer
            // first, odd color indices sorted shorter first.
            const longerFirst = aOrder % 2 === 0;
            const labelLengthCompare = longerFirst
              ? b.label.length - a.label.length
              : a.label.length - b.label.length;
            if (labelLengthCompare !== 0) return labelLengthCompare;
            const labelCompare = a.label.localeCompare(b.label);
            if (labelCompare !== 0) return labelCompare;
            return a.name.localeCompare(b.name);
          }),
      [data]
    );

    // Track which people are currently being "scanned" for location refresh effect.
    const [scanningIndices, setScanningIndices] = useState<Set<number>>(new Set());

    useEffect(() => {
      if (sortedData.length === 0) return;

      const interval = setInterval(() => {
        // Pick a random person.
        const randomIndex = Math.floor(Math.random() * sortedData.length);

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
    }, [sortedData]);

    const [autoAnimate] = useAutoAnimate();

    return (
      <Flex
        ref={autoAnimate}
        direction="column"
        width="100%"
        flexGrow="1"
        gap="0.4%"
        px="8px"
        py="8px"
        overflow="hidden"
      >
        {sortedData.map((row, index) => (
          <PersonRow
            key={row.name}
            name={row.name}
            color={row.color}
            label={row.label}
            height="100%" // Let the CSS engine deal with this.
            isScanning={scanningIndices.has(index)}
          />
        ))}
      </Flex>
    );
  }
);

export const PersonRow = memo(
  ({
    name,
    color,
    label,
    height,
    isScanning = false,
  }: {
    name: string;
    color: string;
    label: string;
    height: string;
    isScanning?: boolean;
  }) => {
    const isUnknown = label === "UNKNOWN";

    return (
      <Flex
        direction="row"
        height={height}
        width="100%"
        style={{
          // Can't use opacity it messes with the AutoAnimate.
          filter: isUnknown ? "brightness(0.3)" : "none",
          animation:
            isScanning && !isUnknown
              ? `locationRefresh ${SCAN_ANIMATION_DURATION}ms ease-out`
              : "none",
        }}
      >
        <Flex
          height="100%"
          width="40%"
          align="center"
          style={{
            containerType: "size", // So we can use cqh units
            fontFamily: "Mondwest",
            fontWeight: "bold",
          }}
        >
          <span style={{ fontSize: "min(85cqh, 25cqw)" }}>{name}</span>
        </Flex>

        <Flex
          height="100%"
          width="60%"
          direction="row"
          justify="center"
          align="center"
          pb="0.1em"
          style={{
            containerType: "size", // So we can use cqh units
            backgroundColor: COLOR_HEX[color] ?? color,
            fontWeight: "bold",
          }}
        >
          <span style={{ fontSize: "min(80cqh, 14cqw)" }}>{label}</span>
        </Flex>
      </Flex>
    );
  }
);

const SMDSMarquee = memo(({ height }: { height: string }) => {
  const sayings = useQuery(api.shitMyDadSays.getSayings);

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
        backgroundColor: "rgba(255, 102, 0, 0.15)",
        borderTop: "1px solid rgba(255, 102, 0, 0.3)",
        borderBottom: "1px solid rgba(255, 102, 0, 0.3)",
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
                <span style={{ color: "rgba(255, 102, 0, 0.75)" }}>— {quote.quoted}</span>
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
