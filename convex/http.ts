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

export const ingestDoorState = httpAction(async (ctx, req) => {
  if (!process.env.DOOR_SENSOR_SECRET) {
    console.error("Set DOOR_SENSOR_SECRET on the Convex dashboard to enable ingestion!");
    return new Response("DOOR_SENSOR_SECRET not set on Convex!", { status: 500 });
  }

  if (req.headers.get("x-webhook-secret") !== process.env.DOOR_SENSOR_SECRET)
    return new Response("DOOR_SENSOR_SECRET mismatch.", { status: 401 });

  let body: { doorId?: string; isOpen?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }

  if (typeof body.doorId !== "string" || typeof body.isOpen !== "boolean") {
    return new Response("Missing or invalid doorId (string) or isOpen (boolean).", { status: 400 });
  }

  await ctx.runMutation(internal.bathrooms.updateBathroom, {
    doorId: body.doorId,
    isOpen: body.isOpen,
    timestamp: Date.now(),
  });

  console.log(`Bathroom updated: ${body.doorId} is now ${body.isOpen ? "OPEN" : "CLOSED"}`);

  return new Response(null, { status: 200 });
});

const router = httpRouter();

router.route({
  pathPrefix: "/ingest-dad-saying/",
  method: "POST",
  handler: ingestDadSaying,
});

router.route({
  pathPrefix: "/ingest-door-state/",
  method: "POST",
  handler: ingestDoorState,
});

export default router;
