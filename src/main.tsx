import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

import "./index.css";

// Auto refresh on new deployments.
let buildId: string;
setInterval(async () => {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    const d = await r.json();
    if (buildId && d.buildId !== buildId) location.reload();
    buildId = d.buildId;
  } catch {}
}, 30_000);

import "@radix-ui/themes/styles.css";
import { Theme } from "@radix-ui/themes";

import { BrowserRouter } from "react-router";

import { dark } from "@clerk/themes";
import { ConvexReactClient } from "convex/react";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { AuthProvider } from "./utils/useAuthStatus";
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Theme appearance="dark" accentColor="orange" grayColor="slate" radius="small" scaling="95%">
      <ClerkProvider
        publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
        appearance={{
          baseTheme: dark,
          variables: {
            fontFamily: "BerkeleyMono",
            colorBackground: "#111113", // var(--color-background)
            colorPrimary: "#FF6600", // var(--accent-9)
          },
        }}
      >
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <AuthProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </AuthProvider>
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </Theme>
  </StrictMode>
);
