import { describe, expect, it } from "vitest";
import { listUsers } from "../convex/users";

const run = (listUsers as unknown as { _handler: (ctx: unknown, args: object) => Promise<unknown> })._handler;
const member = (email: string, affiliation = "PUTZ") => ({ email, affiliation, name: email });
const ctx = (email: string | null, users = [member("a@mit.edu"), member("b@mit.edu")]) => ({
  auth: { getUserIdentity: async () => email ? { email } : null },
  db: { query: () => ({
    withIndex: (_name: string, select: (q: unknown) => unknown) => {
      let selected: unknown;
      select({ eq: (_field: string, value: unknown) => { selected = value; } });
      return { unique: async () => users.find(user => user.email === selected) ?? null };
    },
    collect: async () => users,
  }) },
});

// The Pi calls this existing query with the viewer's Clerk token. Keep its
// membership guard covered even though this PR adds no Convex function.
describe("existing directory query used for camera membership", () => {
  it("denies signed-out callers", async () => {
    await expect(run(ctx(null), {})).rejects.toThrow("UNAUTHENTICATED");
  });
  it("denies a missing user and non-PUTZ callers despite other members", async () => {
    await expect(run(ctx("unknown@mit.edu"), {})).rejects.toThrow("USER_NOT_FOUND");
    await expect(run(ctx("a@mit.edu", [member("a@mit.edu", "NONE"), member("b@mit.edu")]), {}))
      .rejects.toThrow("NOT_PUTZ");
  });
  it("allows ordinary current PUTZ members without an admin or DJ profile", async () => {
    await expect(run(ctx("a@mit.edu"), {})).resolves.toEqual([member("a@mit.edu"), member("b@mit.edu")]);
    await expect(run(ctx("b@mit.edu"), {})).resolves.toHaveLength(2);
  });
  it("reevaluates membership on the next query after revocation", async () => {
    const users = [member("a@mit.edu"), member("b@mit.edu")];
    const context = ctx("a@mit.edu", users);
    await expect(run(context, {})).resolves.toHaveLength(2);
    users[0].affiliation = "NONE";
    await expect(run(context, {})).rejects.toThrow("NOT_PUTZ");
  });
});
