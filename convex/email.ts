import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Transactional email for the DJs library.
 *
 * Convex has no mail of its own, so this posts to Resend. Everything is
 * optional: with no RESEND_API_KEY set the app behaves exactly as before and
 * the send is skipped with a log line, rather than failing a rip request
 * because email isn't configured yet.
 *
 * Needs on the Convex dashboard:
 *   RESEND_API_KEY   - from resend.com
 *   WOKENET_FROM     - e.g. "WOKENET <noreply@wokenet.putz.sh>" (domain must
 *                      be verified in Resend; Clerk's sender doesn't carry over)
 *   WOKENET_ORIGIN   - e.g. "https://wokenet.putz.sh", for links back
 */

const ORIGIN = () => process.env.WOKENET_ORIGIN ?? "https://wokenet.putz.sh";

/** Shared shell so both emails look like they came from the same place. */
function wrap(heading: string, body: string, cta?: { label: string; href: string }): string {
  return `<!doctype html>
<html><body style="margin:0;background:#111113;padding:32px 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
  <div style="max-width:520px;margin:0 auto;background:#17171a;border:1px solid #2a2a2e;border-radius:10px;padding:28px">
    <div style="color:#FF6600;font-size:20px;font-weight:700;letter-spacing:1px">WOKENET</div>
    <h1 style="color:#ededef;font-size:19px;margin:20px 0 10px">${heading}</h1>
    <p style="color:#b0b0b8;font-size:14px;line-height:1.6;margin:0">${body}</p>
    ${
      cta
        ? `<p style="margin:24px 0 0"><a href="${cta.href}" style="display:inline-block;background:#FF6600;color:#fff;text-decoration:none;font-size:14px;padding:10px 18px;border-radius:6px">${cta.label}</a></p>`
        : ""
    }
    <p style="color:#6b6b73;font-size:12px;margin:24px 0 0">You're getting this because you asked WOKENET to rip something.</p>
  </div>
</body></html>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email] RESEND_API_KEY not set; skipping "${subject}" to ${to}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.WOKENET_FROM ?? "WOKENET <noreply@wokenet.putz.sh>",
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    // Never throw: a failed email must not fail the rip it belongs to.
    console.error(`[email] send failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}

/** Sent as soon as a rip is queued. */
export const sendRipQueued = internalAction({
  args: { to: v.string(), url: v.string(), ahead: v.optional(v.number()) },
  handler: async (_ctx, { to, url, ahead }) => {
    const n = ahead ?? 0;
    const place =
      n === 0
        ? "Nothing else is waiting, so it should start within the minute."
        : `There ${n === 1 ? "is" : "are"} <span style="color:#ededef">${n}</span>
           request${n === 1 ? "" : "s"} ahead of yours. They're worked through one at a
           time, oldest first, so yours starts once those are done.`;

    await send(
      to,
      "Your rip request is queued",
      wrap(
        "Request received",
        `We've queued <span style="color:#ededef">${escapeHtml(url)}</span>.<br><br>
         The ripping itself runs on a Mac mini at the house rather than on the website
         &mdash; SoundCloud rips need tools a web server can't run. The mini checks for
         new requests every 30 seconds.<br><br>
         ${place}<br><br>
         You'll get another email when the tracks are in the library. If the mini is off
         or offline, your request waits in the queue rather than failing.`,
      ),
    );
  },
});

/** Sent when the ripper finishes a request. */
export const sendRipReady = internalAction({
  args: {
    to: v.string(),
    url: v.string(),
    trackCount: v.optional(v.number()),
    message: v.optional(v.string()),
    /** Titles SoundCloud kept throttling; worth submitting again later. */
    rateLimited: v.optional(v.array(v.string())),
  },
  handler: async (_ctx, { to, url, trackCount, message, rateLimited }) => {
    const n = trackCount ?? 0;

    // Name them rather than just counting them, so it's obvious what to
    // re-submit. Long lists are trimmed so the mail stays readable.
    const stuck = rateLimited ?? [];
    const SHOWN = 12;
    const missed = stuck.length
      ? `<br><br><span style="color:#ededef">${stuck.length} track${
          stuck.length === 1 ? "" : "s"
        } SoundCloud kept rate-limiting:</span>
         <br><span style="color:#b0b0b8">${stuck
           .slice(0, SHOWN)
           .map((t) => `&bull; ${escapeHtml(t)}`)
           .join("<br>")}</span>
         ${
           stuck.length > SHOWN
             ? `<br><span style="color:#6b6b73">&hellip;and ${stuck.length - SHOWN} more</span>`
             : ""
         }
         <br><br><span style="color:#6b6b73">Submitting the same link again picks up only
         what's missing &mdash; anything already in the library is skipped.</span>`
      : "";
    await send(
      to,
      n > 0 ? `${n} track${n === 1 ? "" : "s"} ready on WOKENET` : "Your rip finished",
      wrap(
        n > 0 ? "Your tracks are ready" : "Your rip finished",
        n > 0
          ? `<span style="color:#ededef">${n} track${n === 1 ? "" : "s"}</span> from
             ${escapeHtml(url)} ${n === 1 ? "is" : "are"} now in the library.
             ${message ? `<br><br><span style="color:#6b6b73">${escapeHtml(message)}</span>` : ""}
             ${missed}`
          : `Nothing came through for ${escapeHtml(url)}.
             ${message ? `<br><br><span style="color:#6b6b73">${escapeHtml(message)}</span>` : ""}
             ${missed}`,
        { label: "Open the library", href: `${ORIGIN()}/djs` },
      ),
    );
  },
});

/** Titles and URLs are user-supplied, so never interpolate them raw. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
