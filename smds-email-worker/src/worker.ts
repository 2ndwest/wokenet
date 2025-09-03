import {
  ExecutionContext,
  ExportedHandler,
  ForwardableEmailMessage,
} from "@cloudflare/workers-types";

type Env = {
  WEBHOOK_SECRET: string;
  CONVEX_INGEST_URL: string;
};

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    try {
      const res = await fetch(env.CONVEX_INGEST_URL, {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          "x-webhook-secret": env.WEBHOOK_SECRET,
        },
        // Send the raw RFC822 as text: parsing/stripping happens in Convex.
        body: await new Response(message.raw as any).text(),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.warn("Convex ingest failed", res.status, res.statusText, txt);
      }
    } catch (err) {
      console.error("Email worker error", err);
    }
  },
} satisfies ExportedHandler<Env>;
