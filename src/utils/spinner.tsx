import { Flex, Spinner } from "@radix-ui/themes";
import { memo } from "react";

export const CenterSpinner = memo(() => {
  return (
    <Flex width="100%" height="100%" align="center" justify="center">
      <Spinner />
    </Flex>
  );
});
