import { Flex } from "@radix-ui/themes";
import { Routes, Route, Navigate } from "react-router";
import { Header } from "./components/Header";
import { Putzopticon } from "./pages/Putzopticon";
import { Putz360 } from "./pages/Putz360";
import { AuthedHome } from "./pages/AuthedHome";
import { Unauthorized } from "./pages/Unauthorized";
import { AdminPanel } from "./pages/AdminPanel";
import { memo, useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { CenterSpinner } from "./utils/spinner";
import { api } from "../convex/_generated/api";
import type { Affiliation } from "../convex/schema";

export function useAuthStatus() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  const setupUser = useMutation(api.users.setupUser);
  const [affiliation, setAffiliation] = useState<Affiliation | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!isAuthenticated) return;
    setupUser().then(({ affiliation, isAdmin }) => {
      setAffiliation(affiliation);
      setIsAdmin(isAdmin);
    });
    return () => setAffiliation(null);
  }, [isAuthenticated]);

  return {
    affiliation: affiliation ?? "NONE",
    isAdmin,
    isAuthLoading: isLoading || (isAuthenticated && affiliation === null),
    isAuthenticated: isAuthenticated && affiliation !== null,
  };
}

const App = memo(() => {
  const { isAuthLoading, isAuthenticated, affiliation, isAdmin } = useAuthStatus();

  return (
    <Flex direction="column" width="100%" height="100vh">
      <Header
        authenticated={isAuthenticated}
        isAuthLoading={isAuthLoading}
        affiliation={affiliation}
        isAdmin={isAdmin}
      />

      <Flex direction="column" width="100%" height="100%" overflowY="scroll">
        {isAuthLoading ? (
          <CenterSpinner />
        ) : isAuthenticated ? (
          affiliation === "PUTZ" ? (
            <Routes>
              <Route path="/" element={<AuthedHome />} />
              <Route path="/putzopticon" element={<Putzopticon />} />
              <Route path="/putz360" element={<Putz360 />} />
              {isAdmin && <Route path="/adminpanel" element={<AdminPanel />} />}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          ) : (
            // Signed in, not putz:
            <Routes>
              <Route path="/" element={<Unauthorized authenticated={true} />} />
              {/* In case we want to support public pages, we can add them here. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )
        ) : (
          // Signed out:
          <Unauthorized authenticated={false} />
        )}
      </Flex>
    </Flex>
  );
});

export default App;
