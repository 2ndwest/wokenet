import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import { memo, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { formatRuntime } from "../../convex/utils/movies";

type NominationId = Id<"movieNominations">;

type Movie = {
  imdbId: string;
  title: string;
  year?: string;
  poster?: string;
  runtimeMinutes?: number;
  genres: string[];
};

const VOTER_KEY = "movieMondayVoterId";

/**
 * Nobody signs in to vote, so a ballot belongs to a random id kept in this
 * browser. If storage is unavailable the id lasts until the tab closes.
 */
const loadVoterId = (): string => {
  try {
    const saved = localStorage.getItem(VOTER_KEY);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem(VOTER_KEY, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
};

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const Poster = ({ movie, width }: { movie: Movie; width: string }) => (
  <Box
    flexShrink="0"
    style={{
      width,
      aspectRatio: "2 / 3",
      borderRadius: "var(--radius-3)",
      overflow: "hidden",
      background: "var(--gray-3)",
    }}
  >
    {movie.poster ? (
      <img
        src={movie.poster}
        alt=""
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    ) : (
      <Flex width="100%" height="100%" align="center" justify="center" p="2">
        <Text size="1" color="gray" align="center">
          No poster
        </Text>
      </Flex>
    )}
  </Box>
);

/** "1994 · 2h 22m", whichever parts are known. */
const yearAndLength = (movie: Movie) =>
  [movie.year, movie.runtimeMinutes ? formatRuntime(movie.runtimeMinutes) : undefined]
    .filter(Boolean)
    .join(" · ");

const TitleLink = ({ movie, size }: { movie: Movie; size: "2" | "3" | "6" }) => (
  <Text size={size} weight="bold" asChild>
    <a
      href={`https://www.imdb.com/title/${movie.imdbId}/`}
      target="_blank"
      rel="noreferrer"
      style={{ color: "inherit", textDecoration: "none" }}
    >
      {movie.title}
    </a>
  </Text>
);

const Confirm = ({
  trigger,
  title,
  description,
  action,
  destructive,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  action: string;
  /** Red for what can't be taken back. */
  destructive?: boolean;
  onConfirm: () => void;
}) => (
  <AlertDialog.Root>
    <AlertDialog.Trigger>{trigger}</AlertDialog.Trigger>
    <AlertDialog.Content maxWidth="420px">
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description size="2">{description}</AlertDialog.Description>
      <Flex gap="3" mt="4" justify="end">
        <AlertDialog.Cancel>
          <Button variant="soft" color="gray">
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action>
          <Button color={destructive ? "red" : undefined} onClick={onConfirm}>
            {action}
          </Button>
        </AlertDialog.Action>
      </Flex>
    </AlertDialog.Content>
  </AlertDialog.Root>
);

export const MovieMonday = memo(() => {
  const [voterId] = useState(loadVoterId);
  const round = useQuery(api.movieMonday.getRound, { voterId });
  const history = useQuery(api.movieMonday.getHistory);

  const nominate = useAction(api.movieMonday.nominate);
  const castBallot = useMutation(api.movieMonday.castBallot);
  const closeVoting = useMutation(api.movieMonday.closeVoting);
  const reopenVoting = useMutation(api.movieMonday.reopenVoting);
  const clearRound = useMutation(api.movieMonday.clearRound);

  const [link, setLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The ranking as just edited, shown until the server has caught up.
  const [pendingRanking, setPendingRanking] = useState<NominationId[] | null>(null);

  const byId = useMemo(
    () => new Map((round?.nominations ?? []).map((n) => [n._id, n])),
    [round?.nominations],
  );
  const ranking = (pendingRanking ?? round?.myRanking ?? []).filter((id) => byId.has(id));
  const isClosed = !!round?.closed;

  const submit = async () => {
    if (!link.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await nominate({ url: link });
      if (result.ok) setLink("");
      else setError(result.error);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const saveRanking = async (next: NominationId[]) => {
    setPendingRanking(next);
    setError(null);
    try {
      const result = await castBallot({ voterId, ranking: next });
      if (!result.ok) setError(result.error);
    } catch {
      setError("Couldn't save your ranking. Try again.");
    } finally {
      setPendingRanking(null);
    }
  };

  const move = (index: number, by: -1 | 1) => {
    const next = [...ranking];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    void saveRanking(next);
  };

  const winner = round?.closed?.winner
    ? byId.get(round.closed.winner as NominationId)
    : undefined;

  return (
    <Flex direction="column" width="100%" height="100%" p="5" align="center">
      <Flex direction="column" width="100%" style={{ maxWidth: 1100 }} gap="5" pb="5">
        <Flex justify="between" align="center" wrap="wrap" gap="3">
          <Heading size="8">Movie Monday</Heading>

          {round && (
            <Flex gap="2" align="center">
              {isClosed ? (
                <Button variant="soft" onClick={() => void reopenVoting({})}>
                  Reopen voting
                </Button>
              ) : (
                <Confirm
                  trigger={
                    <Button variant="soft" disabled={round.nominations.length === 0}>
                      Close voting
                    </Button>
                  }
                  title="Close voting?"
                  description="Voting and nominations stop and the winner is announced to everyone. You can reopen voting afterwards."
                  action="Close voting"
                  onConfirm={() => void closeVoting({})}
                />
              )}
              <Confirm
                trigger={
                  <Button variant="soft" color="red" disabled={round.nominations.length === 0}>
                    Clear
                  </Button>
                }
                title="Clear this week?"
                description="Every nomination and every vote for this week is deleted, for everyone. This can't be undone."
                action="Clear everything"
                destructive
                onConfirm={() => void clearRound({})}
              />
            </Flex>
          )}
        </Flex>

        {round === undefined ? (
          <Text size="3" color="gray">
            Loading…
          </Text>
        ) : (
          <>
            {round.closed && (
              <Card style={{ border: "1px solid var(--accent-7)" }}>
                {winner ? (
                  <Flex gap="4" align="start" wrap="wrap">
                    <Poster movie={winner} width="120px" />
                    <Flex direction="column" gap="2" flexGrow="1" style={{ minWidth: 220 }}>
                      <Text size="2" color="gray">
                        Voting is closed. This week's winner:
                      </Text>
                      <TitleLink movie={winner} size="6" />
                      <Text size="2" color="gray">
                        {yearAndLength(winner)}
                      </Text>
                      <Flex direction="column" gap="1" mt="2">
                        {round.closed.rounds.map((r, i) => (
                          <Text size="1" color="gray" key={i}>
                            Round {i + 1}:{" "}
                            {Object.entries(r.counts)
                              .sort((a, b) => b[1] - a[1])
                              .map(([id, n]) => `${byId.get(id as NominationId)?.title ?? "?"} ${n}`)
                              .join(", ")}
                            {r.eliminated &&
                              `. ${byId.get(r.eliminated as NominationId)?.title ?? "?"} is out.`}
                          </Text>
                        ))}
                      </Flex>
                    </Flex>
                  </Flex>
                ) : (
                  <Text size="3">Voting is closed, and nobody voted, so there's no winner.</Text>
                )}
              </Card>
            )}

            {!isClosed && (
              <Flex direction="column" gap="2">
                <Flex gap="2" wrap="wrap">
                  <Box flexGrow="1" style={{ minWidth: 220 }}>
                    <TextField.Root
                      placeholder="Paste an IMDb link, e.g. imdb.com/title/tt0111161"
                      value={link}
                      onChange={(e) => setLink(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submit();
                      }}
                    />
                  </Box>
                  <Button onClick={() => void submit()} disabled={!link.trim()} loading={submitting}>
                    Nominate
                  </Button>
                </Flex>
              </Flex>
            )}

            {error && (
              <Text size="2" color="red">
                {error}
              </Text>
            )}

            {!isClosed && ranking.length > 0 && (
              <Card>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold">
                    Your ranking
                  </Text>
                  {ranking.map((id, i) => {
                    const movie = byId.get(id)!;
                    return (
                      <Flex key={id} align="center" gap="2">
                        <Text size="2" color="gray" style={{ width: 20 }}>
                          {i + 1}.
                        </Text>
                        <Text size="2" style={{ flexGrow: 1, minWidth: 0 }} truncate>
                          {movie.title}
                        </Text>
                        <IconButton
                          size="1"
                          variant="soft"
                          color="gray"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          aria-label={`Move ${movie.title} up`}
                        >
                          ↑
                        </IconButton>
                        <IconButton
                          size="1"
                          variant="soft"
                          color="gray"
                          disabled={i === ranking.length - 1}
                          onClick={() => move(i, 1)}
                          aria-label={`Move ${movie.title} down`}
                        >
                          ↓
                        </IconButton>
                        <IconButton
                          size="1"
                          variant="soft"
                          color="gray"
                          onClick={() => void saveRanking(ranking.filter((r) => r !== id))}
                          aria-label={`Remove ${movie.title} from your ranking`}
                        >
                          ✕
                        </IconButton>
                      </Flex>
                    );
                  })}
                  <Text size="1" color="gray">
                    Saved as you go. If your first choice is knocked out, your vote moves to the
                    next one down.
                  </Text>
                </Flex>
              </Card>
            )}

            <Flex direction="column" gap="3">
              <Flex justify="between" align="baseline" wrap="wrap" gap="2">
                <Heading size="4">This week's nominations</Heading>
                <Text size="2" color="gray">
                  {round.ballotCount} {round.ballotCount === 1 ? "person has" : "people have"} voted
                </Text>
              </Flex>

              {round.nominations.length === 0 ? (
                <Text size="3" color="gray">
                  Nothing nominated yet.
                </Text>
              ) : (
                <Box
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                    gap: "var(--space-4)",
                  }}
                >
                  {round.nominations.map((movie) => {
                    const place = ranking.indexOf(movie._id);
                    return (
                      <Flex key={movie._id} direction="column" gap="2">
                        <Poster movie={movie} width="100%" />
                        <Flex direction="column" gap="1" flexGrow="1">
                          <TitleLink movie={movie} size="2" />
                          <Text size="1" color="gray">
                            {yearAndLength(movie)}
                          </Text>
                          <Flex gap="1" wrap="wrap">
                            {movie.genres.map((g) => (
                              <Badge key={g} color="gray" size="1">
                                {g}
                              </Badge>
                            ))}
                          </Flex>
                          {movie.watchedAt !== null && (
                            <Badge color="amber" size="1" style={{ alignSelf: "start" }}>
                              Watched before · {formatDate(movie.watchedAt)}
                            </Badge>
                          )}
                        </Flex>
                        {!isClosed && (
                          <Button
                            size="1"
                            variant={place === -1 ? "soft" : "solid"}
                            onClick={() =>
                              void saveRanking(
                                place === -1
                                  ? [...ranking, movie._id]
                                  : ranking.filter((r) => r !== movie._id),
                              )
                            }
                          >
                            {place === -1 ? "Add to my ranking" : `Ranked #${place + 1} · remove`}
                          </Button>
                        )}
                      </Flex>
                    );
                  })}
                </Box>
              )}
            </Flex>

            <Flex direction="column" gap="3">
              <Heading size="4">Watched so far</Heading>
              {history === undefined ? (
                <Text size="2" color="gray">
                  Loading…
                </Text>
              ) : (
                <Flex direction="column" gap="2">
                  {history.map((movie) => (
                    <Flex key={movie._id} gap="3" align="center">
                      <Poster movie={movie} width="40px" />
                      <Flex direction="column" style={{ minWidth: 0 }}>
                        <TitleLink movie={movie} size="2" />
                        <Text size="1" color="gray">
                          {[formatDate(movie.watchedAt), yearAndLength(movie)]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </Flex>
                    </Flex>
                  ))}
                </Flex>
              )}
            </Flex>
          </>
        )}
      </Flex>
    </Flex>
  );
});
