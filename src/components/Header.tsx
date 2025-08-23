import { Button, Flex, Heading, Spinner } from "@radix-ui/themes";
import { NavLink } from "react-router";
import { PTZIcon } from "../utils/icons";
import { memo } from "react";
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
    return (
      <Flex
        align="center"
        justify="between"
        px="3"
        py="2"
        style={{
          height: "50px",
          borderBottom: "1px solid var(--gray-3)",
        }}
      >
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

        <Flex gap="3" align="center">
          <NavButton disabled={affiliation !== "PUTZ"} to="/putzopticon">
            Putzopticon
          </NavButton>
          <NavButton disabled={affiliation !== "PUTZ"} to="/putz360">
            Putz360
          </NavButton>
          {isAdmin && <NavButton to="/adminpanel">Admin Panel</NavButton>}
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
