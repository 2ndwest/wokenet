import { Flex } from "@radix-ui/themes";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { memo, useEffect, useState, useMemo, createElement } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { CenterSpinner } from "../utils/spinner";

const COLOR_ORDER = ["green", "orange", "purple", "blue", "gray", "red", "dimgray"];

const SCAN_ANIMATION_DURATION = 750; // ms
const SCAN_FREQUENCY = 200; // ms
const SMDS_MARQUEE_COUNT = 10; // Number of SMDS quotes to show in marquee

export const Putzopticon = memo(() => {
  const data = useQuery(api.locations.getLocations);

  const [autoAnimate] = useAutoAnimate();

  // Track which people are currently being "scanned" for location refresh effect.
  const [scanningIndices, setScanningIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!data || data.length === 0) return;

    const interval = setInterval(() => {
      // Pick a random person.
      const randomIndex = Math.floor(Math.random() * data.length);

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
  }, [data]);

  return (
    <Flex direction="column" width="100%" height="100%" overflow="hidden">
      <SMDSMarquee height={`${100 / (data ? data.length + 1 : 1)}%`} />

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
        {data ? (
          data
            .map(({ label, color, name }) => {
              return {
                name,
                color,
                label,
              };
            })
            .sort((a, b) => {
              // Sort by, in order:
              // 1) color (using COLOR_ORDER)
              // 2) label (alphabetically)
              // 3) name (alphabetically)
              const aOrder = COLOR_ORDER.indexOf(a.color);
              const bOrder = COLOR_ORDER.indexOf(b.color);
              if (aOrder !== bOrder) return aOrder - bOrder;
              const labelCompare = a.label.localeCompare(b.label);
              if (labelCompare !== 0) return labelCompare;
              return a.name.localeCompare(b.name);
            })
            .map((row, index) => {
              return (
                <PersonRow
                  key={row.name}
                  name={row.name}
                  color={row.color}
                  label={row.label}
                  height="100%" // Let the CSS engine deal with this.
                  isScanning={scanningIndices.has(index)}
                />
              );
            })
        ) : (
          <CenterSpinner />
        )}
      </Flex>
    </Flex>
  );
});

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
            backgroundColor: color,
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

  const latestQuotes = useMemo(() => {
    if (!sayings || sayings.length === 0) return [];
    return sayings.slice(0, SMDS_MARQUEE_COUNT);
  }, [sayings]);

  if (latestQuotes.length === 0) return null;

  return (
    <Flex
      width="100%"
      height={height}
      flexShrink="0"
      align="center"
      overflow="hidden"
      style={{
        containerType: "size",
        backgroundColor: "rgba(255, 102, 0, 0.15)",
        borderTop: "1px solid rgba(255, 102, 0, 0.3)",
        borderBottom: "1px solid rgba(255, 102, 0, 0.3)",
      }}
    >
      <Marquee scrollamount={4}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            fontFamily: "Mondwest",
            fontSize: "60cqh",
          }}
        >
          {latestQuotes.map((quote, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "1em",
                paddingRight: "3em",
                color: "rgba(255, 102, 0, 0.9)",
              }}
            >
              <span style={{ fontStyle: "italic", color: "white" }}>"{quote.quote}"</span>
              <span style={{ opacity: 0.5 }}>— {quote.quoted}</span>
            </span>
          ))}
        </span>
      </Marquee>
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
