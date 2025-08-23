import { Flex } from "@radix-ui/themes";
import { api } from "../../convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Circle, Popup, Tooltip } from "react-leaflet";

import "leaflet/dist/leaflet.css";
import { CenterSpinner } from "../utils/spinner";

const LOCATION_RADIUS_THRESHOLD = 30;

export const Putz360 = memo(() => {
  const locations = useQuery(api.locations.getLocations);
  const validLocations = useMemo(() => {
    if (!locations) return [];
    return locations.filter((loc) => loc.latitude !== -1 && loc.longitude !== -1);
  }, [locations]);

  const [refetching, setRefetching] = useState(false);
  const refetchLocations = useMutation(api.locations.refetchLocations);
  const refreshLocations = useCallback(async () => {
    setRefetching(true);
    await refetchLocations();
    // To prevent a brief flash that looks unintentional.
    await new Promise((resolve) => setTimeout(resolve, 250));
    setRefetching(false);
  }, [refetchLocations]);

  // Auto-refresh locations every 5 seconds.
  useEffect(() => {
    refreshLocations();
    const interval = setInterval(refreshLocations, 5000);
    return () => clearInterval(interval);
  }, [refreshLocations]);

  if (!locations) return <CenterSpinner />;

  return (
    <Flex direction="column" width="100%" height="100vh" style={{ position: "relative" }}>
      <Flex width="100%" height="100%">
        <MapContainer
          bounds={[
            [42.35902, -71.089305],
            [42.361621, -71.087837],
          ]}
          style={{ height: "100%", width: "100%" }}
          zoomControl={true}
          scrollWheelZoom={true}
          doubleClickZoom={true}
          dragging={true}
        >
          {/* Base Map Layer */}
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {/* User Location Markers */}
          {validLocations
            .sort((a, b) => b.accuracy - a.accuracy) // So the most accurate locations are on top.
            .map((location) => {
              const radius = Math.min(location.accuracy, LOCATION_RADIUS_THRESHOLD);

              return (
                <Circle
                  key={location.providerId}
                  center={[location.latitude, location.longitude]}
                  radius={radius}
                  pathOptions={{
                    color: location.color,
                    weight: 2,
                    opacity: 0.8,

                    fillColor: location.color,
                    fillOpacity: 0.4,
                    ...(location.accuracy > LOCATION_RADIUS_THRESHOLD
                      ? {
                          dashArray: "5, 5",
                        }
                      : {}),
                  }}
                >
                  <Popup>
                    <strong>{location.name}</strong>
                    <br />
                    <span style={{ fontSize: "0.9em", opacity: 0.8 }}>
                      {location.label}{" "}
                      <span style={{ fontSize: "0.8em", opacity: 0.7 }}>
                        ±{Math.round(location.accuracy)}m
                      </span>
                    </span>

                    <br />
                    <span style={{ fontSize: "0.8em", opacity: 0.7 }}>
                      Last updated:{" "}
                      {(() => {
                        const date = new Date(location.timestamp);

                        // If the date is today, just show the time.
                        // Otherwise, show the date and the time.
                        return date.toDateString() === new Date().toDateString()
                          ? date.toLocaleTimeString()
                          : date.toLocaleString();
                      })()}
                    </span>
                  </Popup>
                  <Tooltip
                    permanent={true}
                    direction="center"
                    offset={[0, 0]}
                    className="location-label-tooltip"
                  >
                    <div
                      style={{
                        fontSize: "10px",
                        fontWeight: "bold",
                        color: "black",
                        textShadow: "0 0 2px white",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {location.name}
                    </div>
                  </Tooltip>
                </Circle>
              );
            })}
        </MapContainer>
      </Flex>

      {/* User Count */}
      <Flex
        onClick={refreshLocations}
        justify="center"
        align="center"
        style={{
          position: "absolute",
          bottom: "10px",
          left: "10px",
          background: "var(--accent-9)",

          cursor: "pointer",

          padding: "8px 16px",
          borderRadius: "20px",
          border: "1px solid rgba(0, 0, 0, 0.1)",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",

          zIndex: 1000,

          color: "white",
          fontSize: "0.9rem",
        }}
      >
        {refetching ? "Refetching..." : `${validLocations.length} / ${locations.length} located`}
      </Flex>
    </Flex>
  );
});
