import { Badge, Box, Button, Card, Flex, Grid, Heading, IconButton, SegmentedControl, Separator, Text } from "@radix-ui/themes";
import { memo, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatTimestamp } from "../utils/time";
import { Id } from "../../convex/_generated/dataModel";

type SortMode = "recent" | "top";

const UpvoteButton = ({
  sayingId,
  voteCount,
  hasVoted,
  size = "sm",
}: {
  sayingId: Id<"shitMyDadSays">;
  voteCount: number;
  hasVoted: boolean;
  size?: "sm" | "lg";
}) => {
  const toggleVote = useMutation(api.shitMyDadSays.toggleVote);
  const [isVoting, setIsVoting] = useState(false);

  const handleVote = async () => {
    setIsVoting(true);
    try {
      await toggleVote({ sayingId });
    } finally {
      setIsVoting(false);
    }
  };

  if (size === "lg") {
    return (
      <Button
        variant={hasVoted ? "solid" : "soft"}
        color={hasVoted ? "orange" : "gray"}
        onClick={handleVote}
        disabled={isVoting}
        style={{ cursor: "pointer" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4L3 9h3v4h4V9h3L8 4z" />
        </svg>
        {voteCount}
      </Button>
    );
  }

  return (
    <Flex align="center" gap="1">
      <IconButton
        size="1"
        variant={hasVoted ? "solid" : "soft"}
        color={hasVoted ? "orange" : "gray"}
        onClick={handleVote}
        disabled={isVoting}
        style={{ cursor: "pointer" }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4L3 9h3v4h4V9h3L8 4z" />
        </svg>
      </IconButton>
      <Text size="2" color={hasVoted ? "orange" : "gray"} weight={hasVoted ? "bold" : "regular"}>
        {voteCount}
      </Text>
    </Flex>
  );
};

export const ShitMyDadSays = memo(() => {
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const sayings = useQuery(api.shitMyDadSays.getSayings, { sortBy: sortMode });

  const { latest, rest } = useMemo(() => {
    const list = sayings ?? [];
    if (list.length === 0) return { latest: undefined, rest: [] };
    return { latest: list[0], rest: list.slice(1) };
  }, [sayings]);

  return (
    <Flex direction="column" width="100%" height="100%" p="5" align="center">
      <Flex direction="column" width="100%" style={{ maxWidth: 1100 }} gap="5" pb="5">
        <Flex justify="between" align="center" wrap="wrap" gap="3">
          <Heading size="8">Shit My Dad Says:</Heading>
          <SegmentedControl.Root
            value={sortMode}
            onValueChange={(v) => setSortMode(v as SortMode)}
          >
            <SegmentedControl.Item value="recent">Recent</SegmentedControl.Item>
            <SegmentedControl.Item value="top">Top Rated</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>

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

                  <Flex align="center" justify="between" gap="3" wrap="wrap">
                    <Flex align="center" gap="3" wrap="wrap">
                      {sortMode === "recent" && (
                        <>
                          <Badge color="orange" variant="soft">
                            Latest
                          </Badge>
                          <Separator orientation="vertical" />
                        </>
                      )}
                      {sortMode === "top" && (
                        <>
                          <Badge color="orange" variant="soft">
                            #1
                          </Badge>
                          <Separator orientation="vertical" />
                        </>
                      )}
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
                    <UpvoteButton
                      sayingId={latest._id}
                      voteCount={latest.voteCount ?? 0}
                      hasVoted={latest.hasVoted}
                      size="lg"
                    />
                  </Flex>
                </Flex>
              </Card>
            )}

            {rest.length > 0 && (
              <>
                <Box pt="2">
                  <Heading size="5">{sortMode === "top" ? "Runner-ups:" : "Previous:"}</Heading>
                </Box>

                <Grid columns={{ initial: "1", sm: "2", md: "2", lg: "3" }} gap="4" width="100%">
                  {rest.map((item, index) => (
                    <Card key={item._id} style={{ position: "relative" }}>
                      <Flex direction="column" gap="2" pr="6">
                        <Text size="3" style={{ lineHeight: 1.5 }}>
                          "{item.quote}"
                        </Text>
                        <Flex direction="column" gap="1">
                          <Text size="2" color="gray">
                            Quoted: {item.quoted}
                          </Text>
                          <Text size="2" color="gray">
                            From: {item.sender}
                          </Text>
                          <Text size="2" color="gray">
                            {formatTimestamp(item.timestamp)}
                          </Text>
                        </Flex>
                      </Flex>
                      <Box style={{ position: "absolute", bottom: "var(--card-padding)", right: "var(--card-padding)" }}>
                        <UpvoteButton
                          sayingId={item._id}
                          voteCount={item.voteCount ?? 0}
                          hasVoted={item.hasVoted}
                        />
                      </Box>
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
