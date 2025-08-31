import { createContext, useContext, useEffect, useState, ReactNode, useMemo } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Doc } from "../../convex/_generated/dataModel";

interface AuthState {
  user: Doc<"users"> | null;
  isAuthLoading: boolean;
  isUserReady: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();

  const setupUser = useMutation(api.users.setupUser);
  const [user, setUser] = useState<Doc<"users"> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setUser(null);
      return;
    }
    setupUser()
      .then((user) => {
        setUser(user);
      })
      .catch((error) => {
        console.error("Error setting up user:", error);
        setUser(null);
      });
    return () => setUser(null);
  }, [isAuthenticated, setupUser]);

  const authState: AuthState = useMemo(
    () => ({
      user,
      isAuthLoading: isLoading || (isAuthenticated && user === null),
      isUserReady: isAuthenticated && user !== null,
    }),
    [user, isLoading, isAuthenticated]
  );

  return <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>;
}

export function useAuthStatus() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuthStatus must be used within an AuthProvider");
  return context;
}
