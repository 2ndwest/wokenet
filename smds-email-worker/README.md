# Shit My Dad Says Cloudflare Email Worker

This Cloudflare Worker receives incoming emails from Cloudflare Email Routing and posts them to the Convex webhook that writes into `shitMyDadSays`.

## Configure

- Convex: set `SMDS_WEBHOOK_SECRET` (long random string) and note your webhook URL:
  - `https://<your>.convex.site/ingest-dad-saying`
- Cloudflare Worker secrets (same values):
  - `WEBHOOK_SECRET`: must match `SMDS_WEBHOOK_SECRET`
  - `CONVEX_INGEST_URL`: the Convex webhook URL

## Deploy

```bash
pnpm install   # or npm i
pnpm run deploy  # or npx wrangler deploy
```

Then wire an address in Cloudflare Email Routing to this Worker.

See: https://developers.cloudflare.com/email-routing/email-workers/enable-email-workers
