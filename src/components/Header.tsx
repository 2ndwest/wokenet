import { Button, Flex, Heading, Spinner, IconButton } from "@radix-ui/themes";
import { NavLink } from "react-router";
import { HamburgerIcon, PTZIcon } from "../utils/icons";
import { memo, useState } from "react";
import { UserButton } from "@clerk/clerk-react";
import type { Affiliation } from "../../convex/schema";

export const Header = memo(
  ({
    authenticated,
    isAuthLoading,
    affiliation,
    isAdmin,
  }: {
    authenticated: boolean;
    isAuthLoading: boolean;
    affiliation: Affiliation;
    isAdmin: boolean;
  }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    return (
      <>
        <Flex
          align="center"
          justify="between"
          px="3"
          py="2"
          style={{
            maxHeight: "50px",
            minHeight: "50px",
            borderBottom: "1px solid var(--gray-3)",
          }}
        >
          {/* Hamburger menu (only on mobile) */}
          <Flex align="center" display={{ initial: "flex", sm: "none" }}>
            <IconButton variant="ghost" radius="full" onClick={() => setMenuOpen((v) => !v)}>
              <HamburgerIcon open={menuOpen} />
            </IconButton>
          </Flex>

          <NavLink to="/" style={{ textDecoration: "none", marginRight: "12px" }}>
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
            <NavButtons affiliation={affiliation} isAdmin={isAdmin} />
          </Flex>

          {isAuthLoading ? (
            <Flex width="28px" height="28px" align="center" justify="center">
              <Spinner />
            </Flex>
          ) : authenticated ? (
            <Flex width="28px" height="28px">
              <UserButton />
            </Flex>
          ) : null}
        </Flex>

        {/* Mobile menu (only on mobile after clicking hamburger) */}
        <Flex
          direction="column"
          gap="2"
          display={menuOpen ? "flex" : "none"}
          style={{
            borderBottom: "1px solid var(--gray-3)",
            zIndex: 99999999999,
          }}
          p="3"
        >
          <NavButtons affiliation={affiliation} isAdmin={isAdmin} />
        </Flex>
      </>
    );
  }
);

export const NavButtons = memo(
  ({ affiliation, isAdmin }: { affiliation: Affiliation; isAdmin: boolean }) => {
    return (
      <>
        <NavButton disabled={affiliation !== "PUTZ"} to="/putzopticon">
          Putzopticon
        </NavButton>
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
