import {
  Checkbox,
  CheckboxGroup,
  Flex,
  Grid,
  Heading,
  IconButton,
  Popover,
  Separator,
  Text,
  TextField,
} from "@radix-ui/themes";
import { memo, useMemo, useState } from "react";
import RESTROOMS from "../utils/restrooms.json";
import { useGeolocation } from "../utils/useGeolocation";
import { byName, coordsOf, distance, searchedBuilding } from "../utils/buildings";
import { Tag } from "../components/RoomList";
import { GROTESK } from "../utils/fonts";
import { RestroomIcon } from "../utils/icons";
import { getCookie, setCookie } from "../utils/cookies";

type Kind = "men" | "women" | "all-gender";
type Restroom = {
  room: string;
  building: string; // Wings are folded in, e.g. "14" for room "14N-133".
  kind: Kind;
  single?: boolean; // A single-stall restroom.
};

// MIT Facilities' restroom lists (gismaps.mit.edu/reports/restrooms, Feb 2025), plus newer restrooms that MIT space
// accounting has but the lists don't yet (e.g. W41's), leaving out dorms and grad housing. All-gender means space
// accounting's "public lavatory", the same as MIT's restroom directory. Single stalls are estimated from floor area:
// under 90 sq ft, where single-user restrooms cluster (multi-stall ones are mostly 120 sq ft and up). Building 45's
// areas come from the directory's room outlines, since space accounting doesn't have it yet.
const ALL = RESTROOMS as Restroom[];
const BUILDINGS = new Set(ALL.map((r) => r.building));

const KINDS: Kind[] = ["all-gender", "women", "men"];
const KIND_LABEL: Record<Kind, string> = { men: "Men", women: "Women", "all-gender": "All-gender" };

// Which restrooms you chose to list are remembered in a cookie, as the kinds plus "single" if only single stalls, e.g.
// "all-gender,women,single". Until you choose, every kind, any number of stalls.
type Filter = { kinds: Kind[]; singleOnly: boolean };
const FILTER_COOKIE = "bathroomFilter";
const savedFilter = (): Filter => {
  const saved = getCookie(FILTER_COOKIE)?.split(",");
  if (!saved) return { kinds: KINDS, singleOnly: false };
  return { kinds: KINDS.filter((kind) => saved.includes(kind)), singleOnly: saved.includes("single") };
};

const GRID_COLUMNS = { initial: "1", md: "2", lg: "3" } as const;
const GRID_GAP_X = { initial: "0", md: "6" } as const;

// A thin divided row: room on the left, and what kind it is on the right.
const RestroomRow = memo(({ restroom }: { restroom: Restroom }) => (
  <Flex
    align="center"
    gap="3"
    style={{ height: "calc(var(--space-6) * 1.25)", borderBottom: "1px solid var(--gray-4)" }}
  >
    <Text size="4" style={{ ...GROTESK, whiteSpace: "nowrap", flexGrow: 1 }}>
      {restroom.room}
    </Text>
    <Flex gap="1" flexShrink="0">
      {restroom.single && <Tag title="Estimated from floor area">Single stall</Tag>}
      <Tag>{KIND_LABEL[restroom.kind]}</Tag>
    </Flex>
  </Flex>
));

// Where MIT's public restrooms are, nearest first if the viewer shares their location.
export const Bathrooms = memo(() => {
  const here = useGeolocation();
  const [search, setSearch] = useState("");
  const [{ kinds, singleOnly }, setFilter] = useState(savedFilter);
  const choose = (chosen: Filter) => {
    setFilter(chosen);
    setCookie(FILTER_COOKIE, [...chosen.kinds, ...(chosen.singleOnly ? ["single"] : [])].join(","));
  };

  const query = search.replace(/\s/g, "").toUpperCase();
  const searched = query ? searchedBuilding(query, BUILDINGS) : undefined;

  const buildings = useMemo(() => {
    // Searching works like on Classrooms: a building ("W41") puts its restrooms first, more ("W41-2") narrows to
    // those rooms first, and the nearest buildings follow. Other searches just match room names.
    const matches = (r: Restroom) =>
      !query ||
      (searched
        ? query === searched
          ? r.building === searched
          : r.room.toUpperCase().startsWith(query)
        : r.room.toUpperCase().includes(query));
    const tier = (r: Restroom) => (matches(r) ? 0 : r.building === searched ? 1 : 2);
    const origin = searched ? coordsOf(searched) : query ? undefined : here;

    const shown = ALL.filter(
      (r) => (searched || matches(r)) && kinds.includes(r.kind) && (!singleOnly || r.single)
    ).sort(
      (a, b) =>
        (searched ? tier(a) - tier(b) : 0) ||
        distance(origin, a.building) - distance(origin, b.building) ||
        byName(a.building, b.building) ||
        byName(a.room, b.room)
    );

    const groups = new Map<string, Restroom[]>();
    for (const r of shown) groups.set(r.building, [...(groups.get(r.building) ?? []), r]);
    return [...groups];
  }, [query, searched, here, kinds, singleOnly]);

  return (
    <Flex direction="column" width="100%" p="5" align="center">
      <Flex direction="column" width="100%" style={{ maxWidth: 1300 }} gap="5" pb="5">
        <Flex direction="column" gap="1">
          <Heading size="8">Bathrooms</Heading>
          <Text size="2" color="gray">
            Updated 10/1/26 · May be inaccuracies!
          </Text>
        </Flex>

        <Flex gap="2" align="center">
          <TextField.Root
            placeholder="Search buildings"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flexGrow: 1 }}
          />

          {/* Filled in when some restrooms are left out. */}
          <Popover.Root>
            <Popover.Trigger>
              <IconButton
                variant={kinds.length === KINDS.length && !singleOnly ? "surface" : "solid"}
                aria-label="Which restrooms"
              >
                <RestroomIcon />
              </IconButton>
            </Popover.Trigger>
            <Popover.Content size="1" align="end">
              <Flex direction="column" gap="3">
                <CheckboxGroup.Root
                  value={kinds}
                  onValueChange={(v) => choose({ kinds: v as Kind[], singleOnly })}
                >
                  {KINDS.map((kind) => (
                    <CheckboxGroup.Item key={kind} value={kind}>
                      {KIND_LABEL[kind]}
                    </CheckboxGroup.Item>
                  ))}
                </CheckboxGroup.Root>
                <Separator size="4" />
                <Text as="label" size="2">
                  <Flex gap="2" align="center">
                    <Checkbox
                      checked={singleOnly}
                      onCheckedChange={(checked) => choose({ kinds, singleOnly: checked === true })}
                    />
                    Single stall only
                  </Flex>
                </Text>
              </Flex>
            </Popover.Content>
          </Popover.Root>
        </Flex>

        {buildings.length === 0 && <Text color="gray">No bathrooms match.</Text>}
        {buildings.map(([building, restrooms]) => (
          <Flex key={building} direction="column" gap="2">
            <Heading size="5" style={GROTESK}>
              Building {building}
            </Heading>
            <Grid columns={GRID_COLUMNS} gapX={GRID_GAP_X}>
              {restrooms.map((r) => (
                <RestroomRow key={r.room} restroom={r} />
              ))}
            </Grid>
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
});
