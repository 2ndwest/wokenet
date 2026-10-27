import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import PostalMime from "postal-mime";
import { stripQuotes, stripOutlookSignature } from "./utils/strings";

export const ingestDadSaying = httpAction(async (ctx, req) => {
  if (!process.env.SMDS_WEBHOOK_SECRET) {
    console.error("Set SMDS_WEBHOOK_SECRET on the Convex dashboard to enable ingestion!");
    return new Response("SMDS_WEBHOOK_SECRET not set on Convex!", { status: 500 });
  }

  if (req.headers.get("x-webhook-secret") !== process.env.SMDS_WEBHOOK_SECRET)
    return new Response("SMDS_WEBHOOK_SECRET mismatch.", { status: 401 });

  const parsed = await PostalMime.parse(await req.text());

  console.log("Parsed email:", parsed);

  if (parsed.to?.[0]?.address === "shit-my-dad-says@mit.edu") {
    if (parsed.inReplyTo) {
      console.log("Email in reply to:", parsed.inReplyTo, "(reply, ignoring)");
    } else {
      // Only insert root-level emails, not replies.
      await ctx.runMutation(internal.shitMyDadSays.insertSaying, {
        timestamp: parsed.date ? new Date(parsed.date).getTime() : Date.now(),
        sender: parsed.from?.name.trim() ?? "(missing sender)",
        quoted: parsed.subject?.trim().toLowerCase() ?? "(missing subject)",
        quote: stripQuotes(
          stripOutlookSignature((parsed.text ?? "").trim()).trim() || "(no quote)"
        ),
      });
    }
    console.log("Full parsed email contents:", JSON.stringify(parsed, null, 2));
  } else {
    console.log("Email addressed to:", parsed.to?.[0]?.address, "(improper, ignoring)");
  }

  return new Response(null, { status: 200 });
});

export const ingestClassroomAvailability = httpAction(async (ctx, req) => {
  if (!process.env.CLASSROOMS_WEBHOOK_SECRET) {
    console.error("Set CLASSROOMS_WEBHOOK_SECRET on the Convex dashboard to enable ingestion!");
    return new Response("CLASSROOMS_WEBHOOK_SECRET not set on Convex!", { status: 500 });
  }

  if (req.headers.get("x-webhook-secret") !== process.env.CLASSROOMS_WEBHOOK_SECRET)
    return new Response("CLASSROOMS_WEBHOOK_SECRET mismatch.", { status: 401 });

  const { classrooms, tracked } = (await req.json()) as {
    classrooms: Array<{
      room: string;
      building: string;
      capacity?: number;
      updatedAt: number; // When the availability scraper fetched this room's bookings (ms).
      open: Array<{ start: number; end: number }>;
    }>;
    tracked: string[];
  };

  await ctx.runMutation(internal.classroomAvailability.updateClassroomAvailability, {
    classrooms,
    tracked,
  });

  return new Response(null, { status: 200 });
});

/**
 * Endpoints for the DJ rip helper.
 *
 * Serverless can't run yt-dlp or ffmpeg, so a script on a DJ's own machine
 * polls for rip requests, does the work, and posts results back. It can't hold
 * a Clerk session, so it authenticates with a shared secret the same way the
 * email and classroom ingests do.
 */
const ripperSecretOk = (req: Request): Response | null => {
  if (!process.env.DJ_RIPPER_SECRET) {
    console.error("Set DJ_RIPPER_SECRET on the Convex dashboard to enable the DJ rip helper!");
    return new Response("DJ_RIPPER_SECRET not set on Convex!", { status: 500 });
  }
  if (req.headers.get("x-webhook-secret") !== process.env.DJ_RIPPER_SECRET)
    return new Response("DJ_RIPPER_SECRET mismatch.", { status: 401 });
  return null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Hand the helper the next queued rip, marking it claimed. */
export const claimRip = httpAction(async (ctx, req) => {
  const bad = ripperSecretOk(req);
  if (bad) return bad;

  const { claimedBy } = (await req.json()) as { claimedBy?: string };
  const claimed = await ctx.runMutation(internal.djs.claimNextRipRequest, {
    claimedBy: (claimedBy ?? "unknown").toLowerCase(),
  });

  return json(claimed ?? null);
});

/** An upload URL for pushing a ripped file into Convex file storage. */
export const ripUploadUrl = httpAction(async (ctx, req) => {
  const bad = ripperSecretOk(req);
  if (bad) return bad;
  return json({ uploadUrl: await ctx.runMutation(internal.djs.generateRipperUploadUrl, {}) });
});

/** Register an uploaded file as a library track. */
export const ripTrack = httpAction(async (ctx, req) => {
  const bad = ripperSecretOk(req);
  if (bad) return bad;

  const body = (await req.json()) as Parameters<
    typeof ctx.runMutation<typeof internal.djs.insertRippedTrack>
  >[1];

  // Skip anything already in the library, so re-running a rip is harmless.
  if (body.sourceUrl) {
    const existing = await ctx.runQuery(internal.djs.findTrackBySourceUrl, {
      sourceUrl: body.sourceUrl,
    });
    if (existing) {
      await ctx.runMutation(internal.djs.fileRippedTrack, { dj: body.dj, trackId: existing._id });
      return json({ trackId: existing._id, skipped: true });
    }
  }

  const trackId = await ctx.runMutation(internal.djs.insertRippedTrack, body);
  await ctx.runMutation(internal.djs.fileRippedTrack, { dj: body.dj, trackId });
  return json({ trackId });
});

/** Create a playlist from the CLI, selecting tracks by genre or filename. */
export const ripPlaylist = httpAction(async (ctx, req) => {
  const bad = ripperSecretOk(req);
  if (bad) return bad;

  const body = (await req.json()) as Parameters<
    typeof ctx.runMutation<typeof internal.djs.createPlaylistFrom>
  >[1];

  return json(await ctx.runMutation(internal.djs.createPlaylistFrom, body));
});

/** What's already in the library, so an import can skip duplicates. */
export const ripFilenames = httpAction(async (ctx, req) => {
  const bad = ripperSecretOk(req);
  if (bad) return bad;
  return json({ filenames: await ctx.runQuery(internal.djs.listFilenames, {}) });
});

/** Attach cover art to an already-ingested track, matched by filename. */
export const ripCover = httpAction(async (ctx, req) => {
  const bad = ripperSecretOk(req);
  if (bad) return bad;

  const body = (await req.json()) as Parameters<
    typeof ctx.runMutation<typeof internal.djs.setCoverByFilename>
  >[1];

  return json(await ctx.runMutation(internal.djs.setCoverByFilename, body));
});

/** Mark a rip request finished (or failed, with a reason). */
export const finishRip = httpAction(async (ctx, req) => {
  const bad = ripperSecretOk(req);
  if (bad) return bad;

  const body = (await req.json()) as Parameters<
    typeof ctx.runMutation<typeof internal.djs.finishRipRequest>
  >[1];

  await ctx.runMutation(internal.djs.finishRipRequest, body);
  return new Response(null, { status: 200 });
});

/** A progress note while a rip is still running. */
export const ripProgress = httpAction(async (ctx, req) => {
  const bad = ripperSecretOk(req);
  if (bad) return bad;

  const body = (await req.json()) as Parameters<
    typeof ctx.runMutation<typeof internal.djs.noteRipProgress>
  >[1];

  const result = await ctx.runMutation(internal.djs.noteRipProgress, body);
  return Response.json(result);
});

const router = httpRouter();

router.route({ path: "/dj-rip/claim", method: "POST", handler: claimRip });
router.route({ path: "/dj-rip/upload-url", method: "POST", handler: ripUploadUrl });
router.route({ path: "/dj-rip/track", method: "POST", handler: ripTrack });
router.route({ path: "/dj-rip/cover", method: "POST", handler: ripCover });
router.route({ path: "/dj-rip/filenames", method: "POST", handler: ripFilenames });
router.route({ path: "/dj-rip/playlist", method: "POST", handler: ripPlaylist });
router.route({ path: "/dj-rip/progress", method: "POST", handler: ripProgress });
router.route({ path: "/dj-rip/finish", method: "POST", handler: finishRip });

router.route({
  pathPrefix: "/ingest-dad-saying/",
  method: "POST",
  handler: ingestDadSaying,
});

router.route({
  path: "/ingest-classroom-availability",
  method: "POST",
  handler: ingestClassroomAvailability,
});

export default router;
