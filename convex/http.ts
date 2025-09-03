import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import PostalMime from "postal-mime";
import { stripQuotes } from "./utils/strings";

export const ingestDadSaying = httpAction(async (ctx, req) => {
  if (!process.env.SMDS_WEBHOOK_SECRET)
    return new Response("SMDS_WEBHOOK_SECRET not set on Convex!", { status: 500 });

  if (req.headers.get("x-webhook-secret") !== process.env.SMDS_WEBHOOK_SECRET)
    return new Response("SMDS_WEBHOOK_SECRET mismatch.", { status: 401 });

  const parsed = await PostalMime.parse(await req.text());

  if (parsed.inReplyTo) {
    console.log("Got email in reply to:", parsed.inReplyTo, "(ignoring)");
  } else {
    // Only insert root-level emails, not replies.
    await ctx.runMutation(internal.shitMyDadSays.insertSaying, {
      timestamp: parsed.date ? new Date(parsed.date).getTime() : Date.now(),
      sender: parsed.from?.name.trim() ?? "(missing sender)",
      quoted: parsed.subject?.trim().toLowerCase() ?? "(missing subject)",
      quote: stripQuotes(parsed.text?.trim() ?? "(no quote)"),
    });
  }

  return new Response(null, { status: 200 });
});

const router = httpRouter();

router.route({
  pathPrefix: "/ingest-dad-saying/",
  method: "POST",
  handler: ingestDadSaying,
});

export default router;
