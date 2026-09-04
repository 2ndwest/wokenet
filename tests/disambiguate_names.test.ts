import { describe, it, expect } from "vitest";
import { disambiguateNames } from "../convex/locations";

describe("disambiguateNames", () => {
  it("leaves unique names alone", () => {
    const m = disambiguateNames([
      { providerId: "1", name: "Bri", lastName: "Smith" },
      { providerId: "2", name: "Kit" },
    ]);
    expect(m.get("1")).toBe("Bri");
    expect(m.get("2")).toBe("Kit");
  });

  it("adds a last initial when first names collide", () => {
    const m = disambiguateNames([
      { providerId: "1", name: "Aiden", lastName: "Smith" },
      { providerId: "2", name: "Aiden", lastName: "Jones" },
      { providerId: "3", name: "Nico" },
    ]);
    expect(m.get("1")).toBe("Aiden S.");
    expect(m.get("2")).toBe("Aiden J.");
    expect(m.get("3")).toBe("Nico");
  });

  it("falls back to the full last name when initials also collide", () => {
    const m = disambiguateNames([
      { providerId: "1", name: "Aiden", lastName: "Smith" },
      { providerId: "2", name: "Aiden", lastName: "Sanchez" },
    ]);
    expect(m.get("1")).toBe("Aiden Smith");
    expect(m.get("2")).toBe("Aiden Sanchez");
  });

  it("keeps the bare name when no last name is known", () => {
    const m = disambiguateNames([
      { providerId: "1", name: "Aiden" },
      { providerId: "2", name: "Aiden", lastName: "Jones" },
    ]);
    expect(m.get("1")).toBe("Aiden");
    expect(m.get("2")).toBe("Aiden J.");
  });
});
