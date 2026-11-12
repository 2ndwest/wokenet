import { useAuth } from "@clerk/clerk-react";
import { Callout, Flex, Heading } from "@radix-ui/themes";
import { useEffect, useRef } from "react";
import { mountReview } from "../camera-review.js";
import { cameraEndpoint, cameraTransport } from "../utils/cameraPortal";
import "../camera-review.css";
import cameraConfig from "../kitchen-camera-config.json";

export function KitchenCameras() {
  const { getToken } = useAuth();
  const root = useRef<HTMLDivElement>(null);
  const endpoint = cameraEndpoint(import.meta.env.DEV
    ? import.meta.env.VITE_CAMERA_ORIGIN ?? cameraConfig.cameraOrigin
    : cameraConfig.cameraOrigin, import.meta.env.DEV);
  useEffect(() => {
    if (!root.current || !endpoint) return;
    const pending = new AbortController();
    const dispose = mountReview(root.current, cameraTransport(endpoint,
      () => getToken({ template: "convex" }), pending.signal));
    return () => { pending.abort(); dispose(); };
  }, [getToken, endpoint]);
  if (!endpoint) return (
    <Flex direction="column" gap="4" p={{ initial: "4", sm: "6" }} width="100%" style={{ maxWidth: 1120, margin: "0 auto" }}>
      <Heading size="6">Kitchen cameras</Heading>
      <Callout.Root role="status" color="gray">
        <Callout.Text>Camera review is not available yet. Contact the kitchen steward.</Callout.Text>
      </Callout.Root>
    </Flex>
  );
  return <div ref={root} />;
}
