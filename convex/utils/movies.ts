/** Helpers for Movie Monday nominations. Pure, so they can be unit tested. */

/** Pulls the title id out of an IMDb link (or a bare id): "tt0111161". */
export const parseImdbId = (input: string): string | null => {
  const match = input.trim().match(/(?:^|[/=\s])(tt\d{7,10})(?:$|[/?#\s])/i);
  return match ? match[1].toLowerCase() : null;
};

export type MovieDetails = {
  imdbId: string;
  title: string;
  year?: string;
  poster?: string;
  runtimeMinutes?: number;
  genres: string[];
};

const present = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" && value !== "N/A" ? value.trim() : undefined;

/**
 * Reads an OMDb "by id" response. OMDb writes missing fields as "N/A",
 * runtimes as "142 min" and genres as one comma-separated string.
 */
export const parseOmdbResponse = (
  imdbId: string,
  body: unknown,
): { ok: true; movie: MovieDetails } | { ok: false; error: string } => {
  const data = (body ?? {}) as Record<string, unknown>;
  const title = present(data.Title);
  if (data.Response !== "True" || !title) {
    return { ok: false, error: present(data.Error) ?? "Couldn't find that title." };
  }
  const runtime = present(data.Runtime)?.match(/^(\d+)\s*min/);
  return {
    ok: true,
    movie: {
      imdbId,
      title,
      year: present(data.Year),
      poster: present(data.Poster),
      runtimeMinutes: runtime ? Number(runtime[1]) : undefined,
      genres: (present(data.Genre) ?? "")
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean),
    },
  };
};

/** 142 -> "2h 22m". */
export const formatRuntime = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
};
