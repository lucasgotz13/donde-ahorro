import { describe, expect, it } from "vitest";
import { distanceLabel, parseBranchIds, parseGeoref } from "./branches.ts";

describe("parseBranchIds", () => {
  it("keeps well-formed SEPA branch ids once, in order", () =>
    expect(parseBranchIds("12-1-1,9-3-1,12-1-1, x ,<script>,15-1-200")).toEqual(["12-1-1", "9-3-1", "15-1-200"]));
  it("is empty without a value", () => expect(parseBranchIds(undefined)).toEqual([]));
  it("keeps at most 50", () =>
    expect(parseBranchIds(Array.from({ length: 60 }, (_, i) => `1-1-${i}`).join(","))).toHaveLength(50));
});

describe("distanceLabel", () => {
  it.each([
    [0, "a 0 m"],
    [347, "a 350 m"],
    [999, "a 1,0 km"],
    [2270, "a 2,3 km"],
    [15400, "a 15 km"],
  ])("%i m", (meters, label) => expect(distanceLabel(meters)).toBe(label));
});

describe("parseGeoref", () => {
  it("reads the first address", () =>
    expect(
      parseGeoref({
        direcciones: [{ nomenclatura: "AV RIVADAVIA 5000, Comuna 6, Ciudad Autónoma de Buenos Aires", ubicacion: { lat: -34.6183, lon: -58.4365 } }],
      }),
    ).toEqual({ lat: -34.6183, lng: -58.4365, label: "AV RIVADAVIA 5000" }));

  it("is undefined without a located address", () => {
    expect(parseGeoref({ direcciones: [] })).toBeUndefined();
    expect(parseGeoref({ direcciones: [{ nomenclatura: "X", ubicacion: { lat: null, lon: null } }] })).toBeUndefined();
  });
});
