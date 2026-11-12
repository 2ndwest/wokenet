# Kitchen camera review

This route uses Wokenet's existing Putz navigation and current Clerk identity.
For the requested all-member policy, the Pi calls the existing `users:listUsers`
query, which requires `requirePutz`;
set `wokenet_access=putz` on the Pi. Both ends require current Putz membership;
signed-out and non-Putz accounts are denied. No individual email list is needed
in this mode. No new Convex environment flag is needed. A visible navigation
item is not authorization.

Set `cameraOrigin` in `src/kitchen-camera-config.json` to the approved permanent
camera HTTPS origin (no trailing slash or path), and deploy the frontend through
the normal pipeline. No new Convex function or backend deployment is required. Configure
the Pi with the exact wokenet origin and Convex deployment URL. No device keys,
passwords, bearer tokens or footage belong in this public configuration.
The prepared origin is `https://putz-kitchen-cameras.freemyip.com`, backed by
the Pi's automatic DNS updates and trusted certificate renewal. The hostname
can stay unchanged when MIT assigns a permanent address. An empty origin keeps
the page unconfigured.
Only development builds accept a `VITE_CAMERA_ORIGIN` override for the mirror.
The browser sends short-lived tokens only in Authorization headers and footage
does not pass through Convex storage. API failures remain fail-closed.
After Convex authenticates the exact bearer token and returns a successful user
directory, the Pi reads that token's email and requires exactly one matching
directory entry with current Putz membership. It never grants access merely
because another listed user is Putz. Responses are streamed with a 1 MiB limit;
the directory is not saved or cached. The existing query's membership guard has
regression coverage. Changes to its access policy or response may require a Pi
update; errors deny camera access.

The camera host must be reachable from both the browser and the Pi's authorized
Convex route; this PR does not create DNS, certificates, a tunnel or a network
permission. The permanent path is trusted Pi HTTPS independent of the laptop. A separate
loopback-only read-only mirror is documented in [local-camera-mirror.md](local-camera-mirror.md).
Shared-space recording consent, an approved field of view, pause/deletion access
and viewer grants are operational prerequisites. This PR does not activate any
camera or enable recording.

The viewer opens live on a responding camera when possible. History → Latest
recording opens the most recent saved interval when a camera is offline. Go live returns to
the newest received frame; pause freezes viewing while recording continues.
The history timeline supports time-based scrubbing, buffered playback, frame and
ten-second stepping, full screen and 0.5–8× speeds. Time-lapse plays captured
frames at up to six frames per second; it does not increase capture rate. Turn
off Skip gaps over 10s for original receive-time spacing. Space toggles play,
arrows step, J/K seek ten seconds, and L returns live.

The default view keeps only camera buttons, video, timeline and basic controls.
Choose History → Choose time… for custom dates, or expand Camera info for frame
stepping, gap skipping, capture rates and a Time-lapse action. Click the video to play/pause.
Pressing play after pausing live resumes live; camera changes preserve review time.

The shared viewer inherits the site's BerkeleyMono font and Radix theme tokens,
including light/dark and orange/purple preferences. Switching themes updates
the timeline while preserving the active camera and playback state. Its CSS is
scoped to the viewer; the standalone Pi shell supplies its own default styling.

Live requests wait for new committed JPEGs, avoiding archive scans and extra
encoding. Nearby recorded frames are prefetched into a bounded memory cache.
Requests recover after transient failures, and access denial clears images and
cache. The UI shows frame age, actual capture FPS and camera health alerts; a
weak/unreachable link is not proof of distance. Sparse capture and radio outages
remain visible gaps. The scene-change trigger is not guaranteed person detection.

Paused cameras retain access to their recordings. When live frames stop, the
viewer labels the last image LAST RECORDING, retries for a fresh frame and
returns to LIVE only when one arrives. Recorder connection failures show camera
state as unknown, rather than claiming each camera is offline. These UI checks
do not establish reliable physical camera transport.


Production operator: deploy the frontend using the existing site pipeline.
The camera feature changes no Convex source or schema. The older optional
`pnpm deploy:camera --help` helper remains available for a guarded existing
Convex target and commands. The helper is plan-only without `--apply`, requires
matching production settings and a private deployment-specific key, and verifies
the existing remote Clerk issuer before deployment. It deploys Convex and builds
`dist`, not Vercel. This helper is optional: reuse the existing deployment pipeline.
No new provider credentials or camera environment settings are needed for
this feature. The helper's Convex deployment is unnecessary for this frontend
change; do not run it just to add the camera page.
The Pi delivery includes `integration/DEPLOY-WOKENET.md` with the observed
GitHub/Vercel chain, required settings, MIT reservation/TLS and final acceptance.
