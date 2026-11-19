// Which restrooms the Bathrooms page lists, and how that choice is remembered.

export type Kind = "men" | "women" | "all-gender";
export const KINDS: Kind[] = ["all-gender", "women", "men"];

// How much of a kind to list: none of it, only its single stalls, or all of it. (Nobody wants a kind's multi-stall
// restrooms but not its single stalls, so there's no level for that.)
export type Level = "none" | "single" | "all";
export type Filter = Record<Kind, Level>;

export const EVERYTHING: Filter = { "all-gender": "all", women: "all", men: "all" };

export const isListed = (filter: Filter, restroom: { kind: Kind; single?: boolean }) =>
  filter[restroom.kind] === "all" || (filter[restroom.kind] === "single" && restroom.single === true);

// The filter is remembered in a cookie as the kinds listed, with ":single" after those down to their single stalls,
// e.g. "all-gender,women:single". Until you choose, everything.
//
// Cookies saved before each kind had its own level are still around. Those list the kinds, then "single" if only
// single stalls were listed, e.g. "all-gender,women,single", which put every kind in it down to its single stalls.
export const parseFilter = (cookie: string | undefined): Filter => {
  if (cookie === undefined) return EVERYTHING;
  const saved = cookie.split(",");
  const singleOnly = saved.includes("single");
  const level = (kind: Kind): Level => {
    if (saved.includes(`${kind}:single`)) return "single";
    if (!saved.includes(kind)) return "none";
    return singleOnly ? "single" : "all";
  };
  return { "all-gender": level("all-gender"), women: level("women"), men: level("men") };
};

export const serializeFilter = (filter: Filter) =>
  KINDS.filter((kind) => filter[kind] !== "none")
    .map((kind) => (filter[kind] === "single" ? `${kind}:single` : kind))
    .join(",");
