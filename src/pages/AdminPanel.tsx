import { Badge, Box, Flex, Heading, Select, Switch, Table, Text } from "@radix-ui/themes";
import { memo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

import { Affiliation, AFFILIATION_VALIDATOR } from "../../convex/schema";
import { CenterSpinner } from "../utils/spinner";

export const AdminPanel = memo(() => {
  const users = useQuery(api.users.listUsers);

  const updateUser = useMutation(api.users.updateUser);

  return (
    <Flex direction="column" align="center" p="4" width="100%" height="100%">
      <Box minWidth={{ initial: "100%", lg: "750px" }} mb="4">
        <Heading size="8" mb="4">
          Users
        </Heading>

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
      </Box>
    </Flex>
  );
});
