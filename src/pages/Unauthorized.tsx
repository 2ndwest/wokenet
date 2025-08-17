import { SignInButton } from "@clerk/clerk-react";
import { Flex, Text, Heading } from "@radix-ui/themes";

import { memo } from "react";

export const Unauthorized = memo(({ authenticated }: { authenticated: boolean }) => {
  return (
    <Flex p="6" direction="column" align="center" justify="center" width="100%" height="100%">
      <Heading size="8" align="center">
        CLASSIFIED <Text style={{ color: "var(--accent-9)" }}>CODE ORANGE</Text>
      </Heading>

      <br />

      {!authenticated ? (
        <Text align="center" size="4">
          You must{" "}
          <SignInButton>
            <Text
              style={{ cursor: "pointer", color: "var(--accent-9)", textDecoration: "underline" }}
            >
              sign in
            </Text>
          </SignInButton>{" "}
          to continue.
        </Text>
      ) : (
        <Text align="center" size="4">
          You're not registered as a Putzen.
        </Text>
      )}
    </Flex>
  );
});
