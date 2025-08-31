import { Flex } from "@radix-ui/themes";
import { Routes, Route, Navigate } from "react-router";
import { Header } from "./components/Header";
import { Putzopticon } from "./pages/Putzopticon";
import { Putz360 } from "./pages/Putz360";
import { AuthedHome } from "./pages/AuthedHome";
import { Unauthorized } from "./pages/Unauthorized";
import { AdminPanel } from "./pages/AdminPanel";
import { memo } from "react";
import { CenterSpinner } from "./utils/spinner";
import { useAuthStatus } from "./utils/useAuthStatus";

const App = memo(() => {
  const { user, isAuthLoading, isUserReady } = useAuthStatus();

  return (
    <Flex direction="column" width="100%" height="100dvh">
      <Header />

      <Flex direction="column" width="100%" height="100%" overflowY="scroll">
        {isAuthLoading ? (
          <CenterSpinner />
        ) : isUserReady ? (
          user!.affiliation === "PUTZ" ? (
            <Routes>
              <Route path="/" element={<AuthedHome />} />
              <Route path="/putzopticon" element={<Putzopticon />} />
              <Route path="/putz360" element={<Putz360 />} />
              {user!.isAdmin && <Route path="/adminpanel" element={<AdminPanel />} />}
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
