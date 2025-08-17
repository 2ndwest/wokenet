import { Flex } from "@radix-ui/themes";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { memo } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { CenterSpinner } from "../utils/spinner";

export const PersonRow = memo(
  ({
    name,
    color,
    status,
    height,
  }: {
    name: string;
    color: string;
    status: string;
    height: string;
  }) => {
    return (
      <Flex
        direction="row"
        height={height}
        width="100%"
        style={{
          // Can't use opacity it messes with the AutoAnimate.
          filter: status === "UNKNOWN" ? "brightness(0.25)" : "none",
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
          <span style={{ fontSize: "85cqh" }}>{name}</span>
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
          <span style={{ fontSize: "80cqh" }}>{status}</span>
        </Flex>
      </Flex>
    );
  }
);

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
      px="2"
      py="0.4%"
      overflow="hidden"
    >
      {data ? (
        data
          .map(({ location, name }) => {
            const [status, color] =
              location === "IN HOUSING"
                ? ["IN HOUSING", "green"]
                : location === "ON CAMPUS"
                  ? ["ON CAMPUS", "var(--orange-9)"]
                  : location === "OFF CAMPUS"
                    ? ["OFF CAMPUS", "red"]
                    : ["UNKNOWN", "blue"];

            return {
              name,
              color,
              status,
            };
          })
          .sort((a, b) => {
            const colorOrder = ["green", "var(--orange-9)", "red", "blue"];
            const aOrder = colorOrder.indexOf(a.color);
            const bOrder = colorOrder.indexOf(b.color);
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.name.localeCompare(b.name);
          })
          .map((row) => {
            return (
              <PersonRow
                key={row.name}
                name={row.name}
                color={row.color}
                status={row.status}
                height="100%" // Let the CSS engine deal with this.
              />
            );
          })
      ) : (
        <CenterSpinner />
      )}
    </Flex>
  );
});
