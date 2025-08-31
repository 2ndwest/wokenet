import { Button, Flex, Heading, Spinner, IconButton } from "@radix-ui/themes";
import { NavLink, useLocation } from "react-router";
import { HamburgerIcon, PTZIcon } from "../utils/icons";
import { memo, useEffect, useState } from "react";
import { UserButton } from "@clerk/clerk-react";
import type { Affiliation } from "../../convex/schema";
import { useAuthStatus } from "../utils/useAuthStatus";

export const Header = memo(() => {
  const { user, isAuthLoading, isUserReady } = useAuthStatus();

  const [menuOpen, setMenuOpen] = useState(false);

  // When we navigate to a new page, close the menu if it's open.
  const location = useLocation();
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  return (
    <>
      <Flex
        align="center"
        justify={{
          initial: !isUserReady && !isAuthLoading ? "center" : "between",
          sm: "between",
        }}
        px="3"
        py="2"
        style={{
          maxHeight: "50px",
          minHeight: "50px",
          borderBottom: "1px solid var(--gray-3)",
        }}
      >
        {/* Hamburger menu (only on mobile) */}
        {isUserReady && (
          <Flex align="center" display={{ initial: "flex", sm: "none" }}>
            <IconButton variant="ghost" radius="full" onClick={() => setMenuOpen((v) => !v)}>
              <HamburgerIcon open={menuOpen} />
            </IconButton>
          </Flex>
        )}

        <NavLink to="/" style={{ textDecoration: "none" }}>
          <Flex gap="3" align="center" height="100%">
            <PTZIcon height="28px" fill="var(--accent-9)" />
            <Heading
              style={{
                fontSize: "39px",
                paddingBottom: "1px",
                color: "var(--gray-12)",
              }}
            >
              WOKENET
            </Heading>
          </Flex>
        </NavLink>

        {/* Nav buttons (only on desktop) */}
        <Flex gap="3" align="center" display={{ initial: "none", sm: "flex" }}>
          <NavButtons affiliation={user?.affiliation} isAdmin={!!user?.isAdmin} />
        </Flex>

        {isAuthLoading ? (
          <Flex width="28px" height="28px" align="center" justify="center">
            <Spinner />
          </Flex>
        ) : isUserReady ? (
          <Flex width="28px" height="28px">
            <UserButton />
          </Flex>
        ) : null}
      </Flex>

      {/* Mobile menu (only on mobile after clicking hamburger) */}
      <Flex
        direction="row"
        wrap="wrap"
        align="center"
        justify="center"
        gap="2"
        display={{ initial: menuOpen ? "flex" : "none", sm: "none" }}
        style={{
          position: "fixed",
          top: "50px",
          left: 0,
          right: 0,
          zIndex: 99999999999,
          backgroundColor: "var(--gray-1)",
          boxShadow: "0 12px 24px rgba(0, 0, 0, 0.22), 0 4px 10px rgba(0, 0, 0, 0.18)",
          borderBottom: "1px solid var(--gray-3)",
        }}
        p="3"
      >
        <NavButtons affiliation={user?.affiliation} isAdmin={!!user?.isAdmin} />
      </Flex>
    </>
  );
});

export const NavButtons = memo(
  ({ affiliation, isAdmin }: { affiliation: Affiliation | undefined; isAdmin: boolean }) => {
    return (
      <>
        <NavButton disabled={affiliation !== "PUTZ"} to="/putz360">
          Putz360
        </NavButton>
        {isAdmin && <NavButton to="/adminpanel">Admin Panel</NavButton>}
      </>
    );
  }
);

export const NavButton = memo(
  ({ to, disabled, children }: { to: string; disabled?: boolean; children: React.ReactNode }) => {
    return (
      <NavLink to={to}>
        {({ isActive }) => (
          <Button
            style={{ height: "24px" }}
            radius="full"
            variant={isActive ? "solid" : "surface"}
            disabled={disabled}
          >
            {children}
          </Button>
        )}
      </NavLink>
    );
  }
);
