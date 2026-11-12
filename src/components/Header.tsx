import {
  Button,
  Dialog,
  Flex,
  Heading,
  IconButton,
  SegmentedControl,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { NavLink, useLocation } from "react-router";
import { HamburgerIcon, PTZIcon } from "../utils/icons";
import { memo, useEffect, useState } from "react";
import { SignInButton, UserButton } from "@clerk/clerk-react";
import type { Affiliation } from "../../convex/schema";
import { useAuthStatus } from "../utils/useAuthStatus";
import {
  useDisplaySettings,
  type Accent,
  type Appearance,
} from "../utils/useDisplaySettings";

/** Half-filled circle, the usual shorthand for appearance settings. */
const DisplayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5V13.5a5.5 5.5 0 010-11z" />
  </svg>
);

/** Light/dark and accent, kept out of the database so it applies instantly. */
const DisplaySettingsDialog = memo(
  ({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) => {
    const { appearance, accent, setAppearance, setAccent } = useDisplaySettings();

    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Content maxWidth="400px">
          <Dialog.Title>Display</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">
            Applies to this browser only.
          </Dialog.Description>

          <Flex direction="column" gap="4">
            <Flex direction="column" gap="2">
              <Text size="2" weight="bold">
                Appearance
              </Text>
              <SegmentedControl.Root
                value={appearance}
                onValueChange={(v) => setAppearance(v as Appearance)}
              >
                <SegmentedControl.Item value="light">Light</SegmentedControl.Item>
                <SegmentedControl.Item value="dark">Dark</SegmentedControl.Item>
                <SegmentedControl.Item value="system">System</SegmentedControl.Item>
              </SegmentedControl.Root>
              <Text size="1" color="gray">
                System follows whatever your device is set to, and switches with it.
              </Text>
            </Flex>

            <Flex direction="column" gap="2">
              <Text size="2" weight="bold">
                Theme
              </Text>
              <SegmentedControl.Root
                value={accent}
                onValueChange={(v) => setAccent(v as Accent)}
              >
                <SegmentedControl.Item value="orange">Orange</SegmentedControl.Item>
                <SegmentedControl.Item value="purple">Purple</SegmentedControl.Item>
              </SegmentedControl.Root>
            </Flex>
          </Flex>

          <Flex justify="end" mt="4">
            <Dialog.Close>
              <Button size="1" variant="soft" color="gray">
                Done
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    );
  },
);

export const Header = memo(() => {
  const { user, isAuthLoading, isUserReady } = useAuthStatus();
  const [displayOpen, setDisplayOpen] = useState(false);

  // On mobile, start with menu open on the home page
  const [menuOpen, setMenuOpen] = useState(() => {
    return window.location.pathname === "/";
  });

  // When we navigate to a new page, close the
  // menu if it's open (except on the home page)
  const location = useLocation();
  useEffect(() => {
    if (location.pathname !== "/") setMenuOpen(false);
  }, [location.pathname]);
  return (
    <>
      <Flex
        role="banner"
        align="center"
        justify="between"
        px="3"
        py="2"
        style={{
          maxHeight: "50px",
          minHeight: "50px",
          borderBottom: "1px solid var(--gray-3)",
          flexShrink: 0,
        }}
      >
        {/* Hamburger menu (only on mobile) */}
        {!isAuthLoading && (
          <Flex align="center" display={{ initial: "flex", lg: "none" }}>
            <IconButton id="navigation-toggle" aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen} aria-controls="mobile-navigation"
              variant="ghost" radius="full" onClick={() => setMenuOpen((v) => !v)}>
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
        <Flex role="navigation" aria-label="Primary" gap="3" align="center" display={{ initial: "none", lg: "flex" }}>
          <NavButtons affiliation={user?.affiliation} isAdmin={!!user?.isAdmin} />
        </Flex>

        {isAuthLoading ? (
          <Flex width="28px" height="28px" align="center" justify="center">
            <Spinner />
          </Flex>
        ) : isUserReady ? (
          <Flex width="28px" height="28px">
            <UserButton>
              <UserButton.MenuItems>
                <UserButton.Action
                  label="Display"
                  labelIcon={<DisplayIcon />}
                  onClick={() => setDisplayOpen(true)}
                />
              </UserButton.MenuItems>
            </UserButton>
          </Flex>
        ) : (
          <SignInButton>
            <Button size="1" radius="full" variant="soft">
              Sign in
            </Button>
          </SignInButton>
        )}

        <DisplaySettingsDialog open={displayOpen} onOpenChange={setDisplayOpen} />
      </Flex>

      {/* Mobile menu (only on mobile after clicking hamburger) */}
      <Flex
        id="mobile-navigation"
        role="navigation"
        aria-label="Mobile"
        onClick={(event) => { if ((event.target as Element).closest("a[href]")) setMenuOpen(false); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setMenuOpen(false);
            document.getElementById("navigation-toggle")?.focus();
          }
        }}
        direction="row"
        wrap="wrap"
        align="center"
        justify="center"
        gap="2"
        display={{ initial: !isAuthLoading && menuOpen ? "flex" : "none", lg: "none" }}
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
        <NavButton disabled={affiliation !== "PUTZ"} to="/smds">
          SMDS
        </NavButton>
        <NavButton disabled={affiliation !== "PUTZ"} to="/assassins">
          Assassins
        </NavButton>
        <NavButton to="/classrooms">
          Classrooms
        </NavButton>
        <NavButton to="/bathrooms">
          Bathrooms
        </NavButton>
        <NavButton disabled={affiliation !== "PUTZ"} to="/djs">
          DJs
        </NavButton>
        <NavButton disabled={affiliation !== "PUTZ"} to="/kitchen-cameras">Kitchen cameras</NavButton>
        {isAdmin && <NavButton to="/adminpanel">Admin Panel</NavButton>}
      </>
    );
  },
);

export const NavButton = memo(
  ({ to, disabled, children }: { to: string; disabled?: boolean; children: React.ReactNode }) => {
    if (disabled) return <Button style={{ height: "24px" }} radius="full" variant="surface" disabled>{children}</Button>;
    return <NavLink to={to} style={{ textDecoration: "none" }}>
      {({ isActive }) => <Button asChild style={{ height: "24px" }} radius="full" variant={isActive ? "solid" : "surface"}>
        <span>{children}</span>
      </Button>}
    </NavLink>;
  },
);
