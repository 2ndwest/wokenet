import { Badge, Box, Flex, Heading, Select, Switch, Table, Text, Button } from "@radix-ui/themes";
import { memo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

import { Affiliation, AFFILIATION_VALIDATOR } from "../../convex/schema";
import { CenterSpinner } from "../utils/spinner";
import { formatTimestamp } from "../utils/time";

export const AdminPanel = memo(() => {
  const users = useQuery(api.users.listUsers);

  const updateUser = useMutation(api.users.updateUser);
  const createUser = useMutation(api.users.createUser);

  return (
    <Flex direction="column" align="center" p="4" width="100%" height="100%">
      <Box minWidth={{ initial: "100%", lg: "750px" }} pb="4">
        <Flex justify="between" align="center" mb="4">
          <Heading size="8">Users</Heading>
          <Button
            onClick={() => {
              const kerb = prompt("Kerb (without @mit.edu)")?.trim();
              if (!kerb) return;
              const name = prompt("Name")?.trim();
              if (!name) return;
              createUser({ kerb, name }).catch(alert);
            }}
          >
            New user
          </Button>
        </Flex>

        {users ? (
          <Table.Root variant="surface">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Affiliation</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Admin</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {users.map((user) => (
                <Table.Row key={user._id} align="center">
                  <Table.RowHeaderCell>{user.name}</Table.RowHeaderCell>
                  <Table.Cell>
                    <Text>{user.email}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Select.Root
                      value={user.affiliation}
                      onValueChange={(value) => {
                        updateUser({
                          userId: user._id,
                          affiliation: value as Affiliation,
                        }).catch(alert);
                      }}
                    >
                      <Select.Trigger />
                      <Select.Content>
                        {AFFILIATION_VALIDATOR.members.map((m) => (
                          <Select.Item key={m.value} value={m.value}>
                            {m.value}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </Table.Cell>
                  <Table.Cell>
                    <Switch
                      mr="3"
                      checked={user.isAdmin}
                      onCheckedChange={(checked) => {
                        updateUser({ userId: user._id, isAdmin: checked }).catch(alert);
                      }}
                    />
                    {user.isAdmin ? (
                      <Badge color="green">Admin</Badge>
                    ) : (
                      <Badge color="gray">User</Badge>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        ) : (
          <CenterSpinner />
        )}

        <AssassinsAdmin />
      </Box>
    </Flex>
  );
});

const GAME_MASTER = "GAME_MASTER"; // Select value for disqualifications (no killer).

const AssassinsAdmin = memo(() => {
  const players = useQuery(api.assassins.getPlayers);

  const recordKill = useMutation(api.assassins.recordKill);
  const undoKill = useMutation(api.assassins.undoKill);

  const [killer, setKiller] = useState("");
  const [victim, setVictim] = useState("");

  if (!players) return <CenterSpinner />;
  const { alive, dead } = players;

  return (
    <Box mt="8">
      <Heading size="8" mb="4">
        Assassins
      </Heading>

      <Flex gap="3" align="center" wrap="wrap" mb="4">
        <Select.Root value={killer} onValueChange={setKiller}>
          <Select.Trigger placeholder="Killer" />
          <Select.Content>
            <Select.Item value={GAME_MASTER}>Game Master (disqualify)</Select.Item>
            {alive.map((p) => (
              <Select.Item key={p._id} value={p._id}>
                {p.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Text>killed</Text>
        <Select.Root value={victim} onValueChange={setVictim}>
          <Select.Trigger placeholder="Victim" />
          <Select.Content>
            {alive
              .filter((p) => p._id !== killer)
              .map((p) => (
                <Select.Item key={p._id} value={p._id}>
                  {p.name}
                </Select.Item>
              ))}
          </Select.Content>
        </Select.Root>
        <Button
          disabled={!killer || !victim}
          onClick={() => {
            recordKill({
              victimId: victim as Id<"users">,
              killerId: killer === GAME_MASTER ? null : (killer as Id<"users">),
            })
              .then(() => {
                setKiller("");
                setVictim("");
              })
              .catch(alert);
          }}
        >
          Record kill
        </Button>
      </Flex>

      <Table.Root variant="surface">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Dead</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Killed by</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>When</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {dead.map((p) => (
            <Table.Row key={p._id} align="center">
              <Table.RowHeaderCell>{p.name}</Table.RowHeaderCell>
              <Table.Cell>{p.killer ?? "Game Master"}</Table.Cell>
              <Table.Cell>{formatTimestamp(p.timestamp)}</Table.Cell>
              <Table.Cell>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => {
                    if (confirm(`Undo ${p.name}'s death?`)) undoKill({ victimId: p._id }).catch(alert);
                  }}
                >
                  Undo
                </Button>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
});
