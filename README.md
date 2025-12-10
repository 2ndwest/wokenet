# wokenet

putz web services monorepo

## quickstart

1. Install: Node 18+ (or 20), `pnpm`, `convex` CLI (`npm i -g convex`).
2. Wokenet uses Convex for the db and Clerk for auth. You'll need accounts for both.
3. Login to/create a convex account (`convex login` and follow the instructions). Create a new project called `wokenet`.
4. [Create a Clerk account](https://dashboard.clerk.com) if you don't already have one, and make a new application, also called `wokenet`.
5. Copy env template: `cp .env.example .env.local`.
6. Go to your Clerk app to get your frontend api url and publishable key (Application -> Configure -> API keys). Set them to `VITE_CLERK_FRONTEND_API_URL` and `VITE_CLERK_PUBLISHABLE_KEY` respectively.
7. Setup a JWT template for your Convex project. Go to Application -> Configure -> Sessions -> JWT templates, click "Add new template", title it `convex`, and use the Convex template. Click save.
8. Open your Convex project and get the development key (in the dropdown next to the project dropdown, of the form `{adjective}-{animal}-###}`). Use that to populate the `CONVEX_DEPLOYMENT` environment variable (`dev:...`)
9. Install deps: `pnpm install`.
10. Run Convex backend: `pnpm convex:dev`. If it says you need to add an environment key, click the link and do that. Leave this running.
11. In another terminal, run the frontend: `pnpm dev` → open http://localhost:5173 and create an account.
12. By default, this user won't be authorized to view any of the pages. Fix this by modifying your user in the Convex table to have `affiliation` `"PUTZ"` and `isAdmin` `true`. You should now have wokenet up and running locally
13. If you want to test with live location data, ask t11s.

## adding locations

1. Go to [https://geojson.io](https://geojson.io/#map=9.94/42.3382/-71.112) to construct your polygons.
2. Once you're done, copy the coordinates and put them in convex/utils/location_labels.json
3. Test it by setting `VITE_SHOW_REGIONS=true` and spinning up wokenet. Your region should show up where you expect it.
