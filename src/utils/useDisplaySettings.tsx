import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";

/**
 * Per-person display settings: light/dark/system, and which accent the site
 * uses. Stored in localStorage rather than the database so it applies before
 * auth resolves and doesn't need a round trip.
 *
 * Defaults match what wokenet looked like before this existed (dark, orange),
 * so an untouched browser sees no change.
 */

export type Appearance = "light" | "dark" | "system";
export type Accent = "orange" | "purple";

const APPEARANCE_KEY = "wokenet:appearance";
const ACCENT_KEY = "wokenet:accent";

type DisplaySettings = {
  appearance: Appearance;
  accent: Accent;
  /** What `system` currently resolves to, so consumers don't re-query. */
  resolved: "light" | "dark";
  setAppearance: (a: Appearance) => void;
  setAccent: (a: Accent) => void;
};

const DisplayContext = createContext<DisplaySettings | undefined>(undefined);

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    // Private browsing, or storage disabled.
    return fallback;
  }
}

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(() =>
    read(APPEARANCE_KEY, ["light", "dark", "system"] as const, "dark"),
  );
  const [accent, setAccentState] = useState<Accent>(() =>
    read(ACCENT_KEY, ["orange", "purple"] as const, "orange"),
  );

  // Track the OS preference so "system" follows it live.
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" =
    appearance === "system" ? (systemDark ? "dark" : "light") : appearance;

  // The PWA status bar and the page background live in index.css, outside the
  // Radix theme, so they're driven by a data attribute on <html>.
  useEffect(() => {
    document.documentElement.dataset.appearance = resolved;
    document.documentElement.dataset.accent = accent;
  }, [resolved, accent]);

  const value = useMemo<DisplaySettings>(
    () => ({
      appearance,
      accent,
      resolved,
      setAppearance: (a) => {
        setAppearanceState(a);
        try {
          localStorage.setItem(APPEARANCE_KEY, a);
        } catch {
          // Not fatal -- the choice just won't survive a reload.
        }
      },
      setAccent: (a) => {
        setAccentState(a);
        try {
          localStorage.setItem(ACCENT_KEY, a);
        } catch {
          // As above.
        }
      },
    }),
    [appearance, accent, resolved],
  );

  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

export function useDisplaySettings() {
  const ctx = useContext(DisplayContext);
  if (!ctx) throw new Error("useDisplaySettings must be used within a DisplayProvider");
  return ctx;
}
