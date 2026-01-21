import { Flex, Text, Heading, Card, Badge } from "@radix-ui/themes";
import { api } from "../../convex/_generated/api";
import { useQuery } from "convex/react";
import { memo } from "react";
import { CenterSpinner } from "../utils/spinner";
import { getRelativeTime, useRerender } from "../utils/time";

export const Bathrooms = memo(() => {
  const bathrooms = useQuery(api.bathrooms.getBathrooms);

  useRerender(15_000); // To update relative times.

  if (!bathrooms) return <CenterSpinner />;

  return (
    <Flex direction="column" p="6" align="center" width="100%" height="100%">
      <Heading size="6" mb="4">
        Bathrooms
      </Heading>

      {bathrooms.length === 0 ? (
        <Text color="gray">No bathroom sensors have reported yet.</Text>
      ) : (
        <Flex direction="column" gap="3" width="100%" maxWidth="500px">
          {bathrooms.map((bathroom) => (
            <Card key={bathroom._id} size="2">
              <Flex direction="row" justify="between" align="center">
                <Flex direction="column" gap="1">
                  <Text weight="bold" size="4">
                    {bathroom.doorId}
                  </Text>
                  <Text color="gray" size="2">
                    Last activity: {getRelativeTime(bathroom.timestamp)}
                  </Text>
                  <Text color="gray" size="1">
                    {new Date(bathroom.timestamp).toLocaleString()}
                  </Text>
                </Flex>

                <Badge size="2" color={bathroom.isOccupied ? "red" : "green"} variant="soft">
                  {bathroom.isOccupied ? "Occupied" : "Vacant"}
                </Badge>
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
    </Flex>
  );
});
