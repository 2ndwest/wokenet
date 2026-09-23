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

// Alive (green with kills, most first; gray without), then dead (red, most recent first).
const toRows = ({ alive, dead }: FunctionReturnType<typeof api.assassins.getPlayers>) => {
  const status = alive.length === 1 ? "WINNER" : "ALIVE";
  const maxDeadKills = Math.max(1, ...dead.map((p) => p.kills));

  return [
    ...[...alive]
      .sort((a, b) => b.kills - a.kills) // Stable, so ties stay in name order.
      .map((p) => ({
        key: p._id,
        name: p.name,
        color: p.kills ? "green" : "gray",
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

  return <PersonBoard rows={rows} onRowClick={user?.isAdmin ? onRowClick : undefined} />;
});
