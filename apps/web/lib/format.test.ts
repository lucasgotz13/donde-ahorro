import { describe, expect, it } from "vitest";
import { freshnessLabel, priceParts, priceText, sentenceCase, tidy, titleCase, todayInArgentina } from "./format.ts";

describe("priceParts", () => {
  it.each([
    [240050, { whole: "2.400", cents: "50" }],
    [100, { whole: "1", cents: "00" }],
    [5, { whole: "0", cents: "05" }],
    [123456789, { whole: "1.234.567", cents: "89" }],
  ])("%i cents", (cents, parts) => expect(priceParts(cents)).toEqual(parts));

  it("reads as text for screen readers and titles", () => expect(priceText(240050)).toBe("$2.400,50"));
});

// S9: "actualizado hace N días"; stale after 7 days.
describe("freshnessLabel", () => {
  it.each([
    ["2026-11-21", "actualizado hoy"],
    ["2026-11-20", "actualizado ayer"],
    ["2026-11-14", "actualizado hace 7 días"],
    ["2026-11-13", "actualizado hace 8 días"],
  ])("%s", (lastSeen, label) => expect(freshnessLabel(lastSeen, "2026-11-21")).toBe(label));
});

describe("sentenceCase", () => {
  it("lowercases SEPA descriptions and capitalizes the first letter", () =>
    expect(sentenceCase("DULCE DE LECHE LA SERENISIMA POT 400 GRM")).toBe("Dulce de leche la serenisima pot 400 grm"));
});

it("todayInArgentina uses the Buenos Aires calendar", () =>
  expect(todayInArgentina(new Date("2026-11-21T02:00:00Z"))).toBe("2026-11-20"));

it("titleCase capitalizes every word of a SEPA brand", () => {
  expect(titleCase("LA SERENISIMA")).toBe("La Serenisima");
  expect(titleCase("COCA-COLA")).toBe("Coca-Cola");
  expect(titleCase("ÑANDÚ")).toBe("Ñandú");
});

it("tidy retitles all-caps SEPA text and leaves mixed case alone", () => {
  expect(tidy("CL BEIRO 3146")).toBe("Cl Beiro 3146");
  expect(tidy("Av. Donato Alvarez 1351")).toBe("Av. Donato Alvarez 1351");
});
