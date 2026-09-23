import { Flex } from "@radix-ui/themes";
import { api } from "../../convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { memo, useCallback, useMemo } from "react";
import { COLOR_HEX } from "../utils/colors";
import { useAuthStatus } from "../utils/useAuthStatus";
import { PersonBoard, PersonRowData } from "./Putzopticon";

// Dead rows shade from the site's red (no kills) to a deep red (the most kills among the dead).
const DEAD_LIGHT = [1, 3, 5].map((i) => parseInt(COLOR_HEX.red.slice(i, i + 2), 16));
const DEAD_DARK = [0x4a, 0x0b, 0x08];
const deadColor = (t: number) =>
  `rgb(${DEAD_LIGHT.map((c, i) => Math.round(c + (DEAD_DARK[i] - c) * t)).join(", ")})`;

type Players = FunctionReturnType<typeof api.assassins.getPlayers>;

// Alive (green with kills, most first; orange without), then dead (red, most recent first).
const toRows = ({ alive, dead }: Players) => {
  const status = alive.length === 1 ? "WINNER" : "ALIVE";
  const maxDeadKills = Math.max(1, ...dead.map((p) => p.kills));

  return [
    ...[...alive]
      .sort((a, b) => b.kills - a.kills) // Stable, so ties stay in name order.
      .map((p) => ({
        key: p._id,
        name: p.name,
        color: p.kills ? "green" : "yellow", // COLOR_HEX calls its orange "yellow".
        label: `${status} (${p.kills ? `${p.kills} KILL${p.kills === 1 ? "" : "S"}` : "NO KILLS"})`,
      })),
    ...dead.map((p) => ({
      key: p._id,
      name: p.name,
      ...(p.killer
        ? { color: deadColor(p.kills / maxDeadKills), label: `KILLED BY ${p.killer.toUpperCase()}` }
        : // Disqualified players look like UNKNOWN on the Putzopticon.
          { color: "dimgray", label: "DISQUALIFIED", dimmed: true }),
    })),
  ] satisfies PersonRowData[];
};

// Row-sized proportional strip: alive with kills, alive without, and dead (killed or disqualified).
const BreakdownBar = memo(({ alive, dead }: Players) => {
  const total = alive.length + dead.length;
  const killers = alive.filter((p) => p.kills > 0).length;
  const segments = [
    { label: "WITH KILLS", count: killers, color: COLOR_HEX.green },
    { label: "NO KILLS", count: alive.length - killers, color: COLOR_HEX.yellow },
    { label: "DEAD", count: dead.length, color: COLOR_HEX.red },
  ].filter((s) => s.count > 0);

  return (
    // Inset within its cell, with equal space above and below, so it doesn't crowd the rows.
    <Flex height="100%" align="center" style={{ containerType: "size" }}>
      <Flex height="70%" width="100%" gap="2px">
        {segments.map((s) => (
          <Flex
            key={s.label}
            align="center"
            justify="center"
            px="2"
            style={{
              flex: `${s.count} 1 0`,
              minWidth: "fit-content", // Tiny slices stay readable.
              backgroundColor: s.color,
              fontSize: "40cqh",
              fontWeight: "bold",
              whiteSpace: "nowrap",
            }}
          >
            {s.count} {s.label} · {Math.round((100 * s.count) / total)}%
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
});

// The Putzopticon, but for the hall's game of Assassins.
export const Assassins = memo(() => {
  const { user } = useAuthStatus();
  const players = useQuery(api.assassins.getPlayers);
  const rows = useMemo(() => players && toRows(players), [players]);

  const recordKill = useMutation(api.assassins.recordKill);
  const undoKill = useMutation(api.assassins.undoKill);

  // Admins click a living player to record who killed them, or a dead one to undo.
  const onRowClick = useCallback(
    (id: string) => {
      if (!players) return;

      const dead = players.dead.find((p) => p._id === id);
      if (dead) {
        if (confirm(`Undo ${dead.name}'s death?`)) undoKill({ victimId: dead._id }).catch(alert);
        return;
      }

      const victim = players.alive.find((p) => p._id === id)!;
      const input = prompt(`Who killed ${victim.name}? (or "GM" to disqualify)`)?.trim();
      if (!input) return;

      const killer =
        input.toLowerCase() === "gm"
          ? null
          : players.alive.find(
              (p) => p._id !== victim._id && p.name.toLowerCase() === input.toLowerCase()
            );
      if (killer === undefined) return alert(`No living player named "${input}".`);

      const question = killer ? `${killer.name} killed ${victim.name}?` : `Disqualify ${victim.name}?`;
      if (confirm(question))
        recordKill({ victimId: victim._id, killerId: killer?._id ?? null }).catch(alert);
    },
    [players, recordKill, undoKill]
  );

  return (
    <PersonBoard
      rows={rows}
      lastCell={players && <BreakdownBar {...players} />}
      onRowClick={user?.isAdmin ? onRowClick : undefined}
    />
  );
});
