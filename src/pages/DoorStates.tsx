import { Flex, Text, Heading, Card, Badge } from "@radix-ui/themes";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { memo, useState, useEffect } from "react";
import { CenterSpinner } from "../utils/spinner";
import { getRelativeTime } from "../utils/time";

export const DoorStates = memo(() => {
  const doorStates = useQuery(api.doorStates.getAllDoorStates);

  // Force re-render every minute to update relative times.
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!doorStates) return <CenterSpinner />;

  return (
    <Flex direction="column" p="6" align="center" width="100%" height="100%">
      <Heading size="6" mb="4">
        Door States
      </Heading>

      {doorStates.length === 0 ? (
        <Text color="gray">No door sensors have reported yet.</Text>
      ) : (
        <Flex direction="column" gap="3" width="100%" maxWidth="500px">
          {doorStates.map((door) => (
            <Card key={door._id} size="2">
              <Flex direction="row" justify="between" align="center">
                <Flex direction="column" gap="1">
                  <Text weight="bold" size="4">
                    {door.doorId}
                  </Text>
                  <Text color="gray" size="2">
                    Last activity: {getRelativeTime(door.timestamp)}
                  </Text>
                  <Text color="gray" size="1">
                    {new Date(door.timestamp).toLocaleString()}
                  </Text>
                </Flex>

                <Badge size="2" color={door.isOpen ? "green" : "blue"} variant="soft">
                  {door.isOpen ? "Open" : "Closed"}
                </Badge>
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
    </Flex>
  );
});
