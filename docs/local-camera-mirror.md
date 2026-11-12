# Local Wokenet mirror

This development-only mirror runs the actual App, Header, routes, Radix theme,
BerkeleyMono font and shared camera viewer. Camera requests can read the actual
Pi through an existing local SSH forward. All other account/data providers are
isolated preview fixtures; mutations never contact production. Automatic location
refresh is a local no-op, and write actions fail explicitly.
The banner identifies this distinction. It is not a production Clerk login test.

The live site's Clerk instance uses production keys restricted to its real
domain. Do not put those keys into localhost, disable origin checks, change the
system hosts file or install a trusted local root certificate to make a preview.

Start the existing authenticated Pi forward first (in the deployment workspace,
`KitchenCam.ps1 -Mode Review`). Then, from this Wokenet checkout:

```powershell
node scripts/mirror/run.mjs --pi-origin http://127.0.0.1:8788 `
  --user reviewer --password-file C:/private/existing-reviewer-password.txt
```

Open http://127.0.0.1:5173/kitchen-cameras . The password file stays on this
computer, is read only by the local server and is never sent in a frontend
configuration, URL, bundle, browser storage or log. `/camera-api` is accepted
by the frontend only in development. The proxy is GET-only, allows only camera
read endpoints, rejects other origins/hosts, refuses redirects and strips any
browser credential before applying the existing local Pi credential upstream.
The listener is restricted to loopback; do not expose this preview on a LAN.

The Pi keeps recording independently of this server. An offline camera remains
offline in the mirror; it is not replaced with generated live footage. Archived
recordings can be reviewed when captures are unavailable. Synthetic fixtures
used by automated playback tests are separate and labelled.

The actual application navigation/settings work normally. Fixture routes for
automated UI checks are `?mirror-role=other`, `?mirror-role=signed-out`,
`?mirror-role=loading` and `?mirror-role=admin`; default is a preview Putz member.
They do not grant production membership or change anyone's Wokenet account.

Run `node --test scripts/mirror/proxy-checks.mjs` for proxy boundary tests and
`node tests/nativeNavigation.browser.cjs` with Playwright available for assembled
navigation checks. The ordinary `pnpm build` uses `src/main.tsx` and contains none
of the mirror entry, mock providers or private Pi credentials.
