import { describe, expect, it } from "vitest";
import { cheapestSteps, staleness } from "./history.ts";

// S9: keep the last known price, say how old it is, and mark it stale after 7 days.
describe("staleness", () => {
  it.each([
    ["2026-11-21", 0, false],
    ["2026-11-20", 1, false],
    ["2026-11-14", 7, false],
    ["2026-11-13", 8, true],
  ])("last seen %s is %i days old, stale: %s", (lastSeen, days, stale) =>
    expect(staleness(lastSeen, "2026-11-21")).toEqual({ days, stale }),
  );
});

// S2 (c): price history as the cheapest price among a chain's branches, as steps.
describe("cheapestSteps", () => {
  it("returns no steps without periods", () => expect(cheapestSteps([])).toEqual([]));

  it("follows the cheapest open period and merges equal neighbours", () => {
    const steps = cheapestSteps([
      { price: 1000, validFrom: "2026-11-01", validTo: "2026-11-05" },
      { price: 900, validFrom: "2026-11-03", validTo: "2026-11-08" },
      { price: 1200, validFrom: "2026-11-05", validTo: null },
      { price: 900, validFrom: "2026-11-08", validTo: null },
    ]);
    expect(steps).toEqual([
      { from: "2026-11-01", price: 1000 },
      { from: "2026-11-03", price: 900 },
    ]);
  });

  it("raises the step when the cheapest period ends", () => {
    expect(
      cheapestSteps([
        { price: 800, validFrom: "2026-11-01", validTo: "2026-11-04" },
        { price: 1000, validFrom: "2026-11-01", validTo: null },
      ]),
    ).toEqual([
      { from: "2026-11-01", price: 800 },
      { from: "2026-11-04", price: 1000 },
    ]);
  });

  it("leaves a gap when no branch had a price", () => {
    expect(
      cheapestSteps([
        { price: 800, validFrom: "2026-11-01", validTo: "2026-11-03" },
        { price: 850, validFrom: "2026-11-06", validTo: null },
      ]),
    ).toEqual([
      { from: "2026-11-01", price: 800 },
      { from: "2026-11-03", price: null },
      { from: "2026-11-06", price: 850 },
    ]);
  });
});
