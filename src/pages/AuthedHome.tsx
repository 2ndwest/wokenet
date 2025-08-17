import { Flex, Text, Link, Heading } from "@radix-ui/themes";
import { PTZIcon } from "../utils/icons";
import { memo } from "react";

export const AuthedHome = memo(() => {
  return (
    <Flex direction="column" p="6" align="center" justify="center" width="100%" height="100%">
      <Heading size="8" align="center">
        Welcome to <Text weight="bold">WOKENET</Text>.
      </Heading>

      <br />

      <Text align="center" size="4">
        Various <PTZIcon height="0.8em" fill="var(--accent-9)" /> related services are available
        here.
        <br />
        <br />
        Use the menu bar above to navigate. Source available on{" "}
        <Link style={{ color: "var(--accent-9)" }} href="https://github.com/2ndwest/wokenet">
          Github
        </Link>
        .
      </Text>
    </Flex>
  );
});
