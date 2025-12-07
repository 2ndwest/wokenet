import { Flex } from "@radix-ui/themes";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { memo } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { CenterSpinner } from "../utils/spinner";

const COLOR_ORDER = ["green", "orange", "purple", "blue", "gray", "red", "dimgray"];

export const Putzopticon = memo(() => {
  const data = useQuery(api.locations.getLocations);

  const [autoAnimate] = useAutoAnimate();

  return (
    <Flex
      ref={autoAnimate}
      direction="column"
      width="100%"
      height="100%"
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
                index={index}
              />
            );
          })
      ) : (
        <CenterSpinner />
      )}
    </Flex>
  );
});

export const PersonRow = memo(
  ({
    name,
    color,
    label,
    height,
    index = 0,
  }: {
    name: string;
    color: string;
    label: string;
    height: string;
    index?: number;
  }) => {
    // Suppress unused variable warning for now
    void index;

    return (
      <Flex
        direction="row"
        height={height}
        width="100%"
        style={{
          // Can't use opacity it messes with the AutoAnimate.
          filter: label === "UNKNOWN" ? "brightness(0.3)" : "none",
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
