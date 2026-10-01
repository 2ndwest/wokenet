import { IconButton, Text } from "@radix-ui/themes";
import { GROTESK } from "../utils/fonts";

// Shared bits of the room lists (Classrooms, Bathrooms).

// A small chip next to a room number, e.g. "LH" for lecture halls.
export const Tag = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <Text
    title={title}
    style={{
      ...GROTESK,
      fontSize: "11px",
      lineHeight: "17px",
      padding: "0 4px",
      whiteSpace: "nowrap",
      backgroundColor: "var(--gray-4)",
      borderRadius: "var(--radius-1)",
      color: "var(--gray-11)",
    }}
  >
    {children}
  </Text>
);

// An icon button for an on/off filter, filled in when on.
export const ToggleButton = ({
  on,
  onToggle,
  label,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) => (
  <IconButton variant={on ? "solid" : "surface"} aria-label={label} aria-pressed={on} onClick={onToggle}>
    {children}
  </IconButton>
);
