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

export const ingestLockState = httpAction(async (ctx, req) => {
  if (!process.env.LOCK_SENSOR_SECRET) {
    console.error("Set LOCK_SENSOR_SECRET on the Convex dashboard to enable ingestion!");
    return new Response("LOCK_SENSOR_SECRET not set on Convex!", { status: 500 });
  }

  if (req.headers.get("x-webhook-secret") !== process.env.LOCK_SENSOR_SECRET)
    return new Response("LOCK_SENSOR_SECRET mismatch.", { status: 401 });

  let body: { bathroomId?: string; isLocked?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }

  if (typeof body.bathroomId !== "string" || typeof body.isLocked !== "boolean") {
    return new Response("Missing or invalid bathroomId (string) or isLocked (boolean).", { status: 400 });
  }

  await ctx.runMutation(internal.bathrooms.updateLockState, {
    bathroomId: body.bathroomId,
    isLocked: body.isLocked,
    timestamp: Date.now(),
  });

  console.log(`Bathroom updated: ${body.bathroomId} is now ${body.isLocked ? "LOCKED" : "UNLOCKED"}`);

  return new Response(null, { status: 200 });
});

const router = httpRouter();

router.route({
  pathPrefix: "/ingest-dad-saying/",
  method: "POST",
  handler: ingestDadSaying,
});

router.route({
  pathPrefix: "/ingest-lock-state/",
  method: "POST",
  handler: ingestLockState,
});

export default router;
