import { describe, expect, it } from "vitest";
import { isAllowedByRobots } from "./robots.ts";

const robots = `
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /checkout
Disallow: /api/private
Allow: /api/private/promos
`;

// S22: respect robots.txt.
describe("isAllowedByRobots", () => {
  it("applies the `*` group", () => {
    expect(isAllowedByRobots(robots, "/api/promos")).toBe(true);
    expect(isAllowedByRobots(robots, "/checkout/cart")).toBe(false);
  });

  it("lets the longest matching rule win", () => {
    expect(isAllowedByRobots(robots, "/api/private/x")).toBe(false);
    expect(isAllowedByRobots(robots, "/api/private/promos?a=1")).toBe(true);
  });

  it("allows everything without rules", () => {
    expect(isAllowedByRobots("", "/anything")).toBe(true);
  });
});
