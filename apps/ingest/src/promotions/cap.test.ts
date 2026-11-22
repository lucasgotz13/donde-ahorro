import { describe, expect, it } from "vitest";
import { parseCap } from "./cap.ts";

// S12: the cap is parsed by regex; `unknown` when the text has a cap that cannot be parsed.
describe("parseCap", () => {
  it.each([
    ["Tope de reintegro $10.000 por mes.", { amount: 1_000_000, period: "month" }],
    ["Tope de reintegro por semana: $ 15.000", { amount: 1_500_000, period: "week" }],
    ["TOPE DE DESCUENTO $8.500,50 POR TRANSACCIÓN", { amount: 850_050, period: "transaction" }],
    ["Tope de reintegro mensual de $20.000 por cuenta", { amount: 2_000_000, period: "month" }],
    ["tope semanal $5000", { amount: 500_000, period: "week" }],
    ["Tope $3.000 por día", { amount: 300_000, period: "day" }],
    ["Tope de $12.000 por compra", { amount: 1_200_000, period: "transaction" }],
  ])("%s", (text, cap) => expect(parseCap(text)).toEqual(cap));

  it("is null when the text has no cap", () => {
    expect(parseCap("25% de descuento con Banco Galicia")).toBeNull();
    expect(parseCap("Sin tope de reintegro")).toBeNull();
  });

  it("is unknown when a cap is mentioned but has no amount or period", () => {
    expect(parseCap("Tope de reintegro según categoría del cliente")).toBe("unknown");
    expect(parseCap("Tope de reintegro $10.000")).toBe("unknown");
  });
});
