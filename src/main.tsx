import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

import "./index.css";

// Auto refresh on new deployments.
let buildId: string;
setInterval(async () => {
  try {
    const d = await (await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" })).json();
    if (buildId && d.buildId !== buildId) location.reload();
    buildId = d.buildId;
  } catch {}
}, 60_000);

// Refresh every 30 minutes just in case.
setInterval(() => {
  location.reload();
}, 30 * 60_000);

import "@radix-ui/themes/styles.css";
import { Theme } from "@radix-ui/themes";

import { BrowserRouter } from "react-router";

import { dark } from "@clerk/themes";
import { ConvexReactClient } from "convex/react";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { AuthProvider } from "./utils/useAuthStatus";
import { DisplayProvider, useDisplaySettings } from "./utils/useDisplaySettings";
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

/** Clerk takes a hex, Radix takes a name -- keep the two in step here. */
const ACCENT_HEX: Record<string, string> = {
  orange: "#FF6600",
  purple: "#8E4EC6",
};

/**
 * Everything below the display settings, so the Radix theme and Clerk's own
 * widgets follow the person's light/dark and accent choices together.
 */
const Root = () => {
  const { resolved, accent } = useDisplaySettings();
  const isDark = resolved === "dark";

  return (
    <Theme appearance={resolved} accentColor={accent} grayColor="slate" radius="small" scaling="95%">
      <ClerkProvider
        publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
        appearance={{
          baseTheme: isDark ? dark : undefined,
          variables: {
            fontFamily: "BerkeleyMono",
            colorBackground: isDark ? "#111113" : "#FFFFFF",
            colorPrimary: ACCENT_HEX[accent] ?? ACCENT_HEX.orange,
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
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DisplayProvider>
      <Root />
    </DisplayProvider>
  </StrictMode>
);
