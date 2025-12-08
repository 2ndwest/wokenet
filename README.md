# wokenet

monorepo for t11s' putz-related web services

## Quick start

1) Install: Node 18+ (or 20), `pnpm`, `convex` CLI (`npm i -g convex`).
2) Wokenet uses Convex for the db and Clerk for auth. You'll need accounts for both.
3) Login to/create a convex account (`convex login` and follow the instructions). Create a new project called `wokenet`.
4) [Create a Clerk account](https://dashboard.clerk.com) if you don't already have one, and make a new application, also called `wokenet`.
5) Copy env template: `cp .env.example .env.local`.
6) Go to your Clerk app to get your Frontend API Url and publishable key (Application -> Configure -> API keys). Set them to `VITE_CLERK_FRONTEND_API_URL` and `VITE_CLERK_PUBLISHABLE_KEY` respectively.
7) Setup a JWT template for your Convex project. Go to Application -> Configure -> Sessions -> JWT templates, click "Add new template", title it `convex`, and use the Convex template. Click save.
7) Open your Convex project and get the development key (in the dropdown next to the project dropdown, of the form `{adjective}-{animal}-###}`). Use that to populate the `CONVEX_DEPLOYMENT` environment variable (`dev:...`)
8) Install deps: `pnpm install`.
9) Run Convex backend: `pnpm convex:dev`. If it says you need to add an environment key, click the link and do that. Leave this running.
10) In another terminal, run the frontend: `pnpm dev` → open http://localhost:5173 and create an account.
11) By default, this user won't be authorized to view any of the pages. Fix this by modifying your user in the Convex table to have `affiliation` `"PUTZ"` and `isAdmin` `true`. You should now have wokenet up and running locally
12) If you wanna use test it with live location data talk to ben idk.