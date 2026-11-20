import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Theme } from "@radix-ui/themes";
import { NavButtons } from "../src/components/Header";

afterEach(() => vi.unstubAllGlobals());

const navigation = (affiliation: "PUTZ" | "NONE" | undefined, isAdmin = false) => renderToStaticMarkup(
  <Theme><MemoryRouter initialEntries={["/kitchen-cameras"]}><NavButtons affiliation={affiliation} isAdmin={isAdmin} /></MemoryRouter></Theme>
);

describe("native Wokenet camera navigation", () => {
  it("uses the same active native navigation link as existing pages", () => {
    const markup = navigation("PUTZ");
    expect(markup).toContain('href="/kitchen-cameras"');
    expect(markup).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/kitchen-cameras"/);
    expect(markup).toContain("Kitchen cameras");
    expect(markup).toContain('href="/classrooms"');
    expect(markup).not.toMatch(/<a[^>]*>\s*<button/);
  });
  it("does not leave a navigable camera link behind a disabled button", () => {
    for (const affiliation of [undefined, "NONE"] as const) {
      const markup = navigation(affiliation);
      expect(markup).not.toContain('href="/kitchen-cameras"');
      expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Kitchen cameras<\/button>/);
      expect(markup).toContain('href="/classrooms"');
    }
  });
  it("keeps the existing administrator navigation", () => {
    expect(navigation("PUTZ", true)).toContain('href="/adminpanel"');
    expect(navigation("PUTZ", false)).not.toContain('href="/adminpanel"');
  });
});
