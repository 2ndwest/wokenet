import { Badge, Box, Card, Flex, Grid, Heading, Separator, Text } from "@radix-ui/themes";
import { memo, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatTimestamp } from "../utils/time";

export const ShitMyDadSays = memo(() => {
  const sayings = useQuery(api.shitMyDadSays.getSayings);

  const { latest, rest } = useMemo(() => {
    const list = sayings ?? [];
    if (list.length === 0) return { latest: undefined, rest: [] };
    return { latest: list[0], rest: list.slice(1) };
  }, [sayings]);

  return (
    <Flex direction="column" width="100%" height="100%" p="5" align="center">
      <Flex direction="column" width="100%" style={{ maxWidth: 1100 }} gap="5">
        <Heading size="8">Shit My Dad Says:</Heading>

        {sayings === undefined ? (
          <Text size="3" color="gray">
            Loading…
          </Text>
        ) : sayings.length === 0 ? (
          <Text size="3" color="gray">
            No quotes yet.
          </Text>
        ) : (
          <>
            {latest && (
              <Card
                style={{
                  border: "1px solid var(--gray-4)",
                  background:
                    "radial-gradient(1200px 300px at -5% 0%, rgba(255, 102, 0, 0.12), transparent), linear-gradient(180deg, rgba(255,255,255,0.02), transparent)",
                  boxShadow:
                    "0 20px 50px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.03), 0 1px 0 rgba(255,255,255,0.05)",
                }}
              >
                <Flex direction="column" gap="3">
                  <Text
                    size="6"
                    style={{
                      fontSize: "clamp(22px, 4.6vw, 44px)",
                      lineHeight: 1.2,
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    “{latest.quote}”
                  </Text>

                  <Flex align="center" gap="3" wrap="wrap">
                    <Badge color="orange" variant="soft">
                      Latest
                    </Badge>
                    <Separator orientation="vertical" />
                    <Text size="3" color="gray">
                      Quoted: {latest.quoted}
                    </Text>
                    <Separator orientation="vertical" />
                    <Text size="3" color="gray">
                      From: {latest.sender}
                    </Text>
                    <Separator orientation="vertical" />
                    <Text size="3" color="gray">
                      {formatTimestamp(latest.timestamp)}
                    </Text>
                  </Flex>
                </Flex>
              </Card>
            )}

            {rest.length > 0 && (
              <>
                <Box pt="2">
                  <Heading size="5">Previous:</Heading>
                </Box>

                <Grid columns={{ initial: "1", sm: "2", md: "2", lg: "3" }} gap="4" width="100%">
                  {rest.map((item) => (
                    <Card key={item._id}>
                      <Flex direction="column" gap="2">
                        <Text size="3" style={{ lineHeight: 1.5 }}>
                          “{item.quote}”
                        </Text>
                        <Flex align="center" gap="2" wrap="wrap">
                          <Text size="2" color="gray">
                            Quoted: {item.quoted}
                          </Text>
                          <Separator orientation="vertical" />
                          <Text size="2" color="gray">
                            From: {item.sender}
                          </Text>
                          <Separator orientation="vertical" />
                          <Text size="2" color="gray">
                            {formatTimestamp(item.timestamp)}
                          </Text>
                        </Flex>
                      </Flex>
                    </Card>
                  ))}
                </Grid>
              </>
            )}
          </>
        )}
      </Flex>
    </Flex>
  );
});
