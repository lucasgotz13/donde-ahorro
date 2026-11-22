import type { Promotion } from "@donde-ahorro/core";
import { describe, expect, it } from "vitest";
import { dayLabel, describePromotion, parseConditions, parseDay, parsePaymentMethods, weekOf } from "./payments.ts";

describe("parsePaymentMethods", () => {
  it("keeps well-formed entity:medium pairs once", () =>
    expect(parsePaymentMethods("galicia:credit,mercado-pago:account-money,galicia:credit,bad,<x>:y,:credit")).toEqual([
      { entity: "galicia", medium: "credit" },
      { entity: "mercado-pago", medium: "account-money" },
    ]));
  it("is empty without a value", () => expect(parsePaymentMethods(undefined)).toEqual([]));
});

describe("parseConditions", () => {
  it("keeps well-formed ids once", () => expect(parseConditions("visa-nfc,visa-nfc,Bad Id,comunidad-coto")).toEqual(["visa-nfc", "comunidad-coto"]));
});

// S19: today by default, the next 7 days.
describe("days", () => {
  it("weekOf lists today and the next 6 days", () =>
    expect(weekOf("2026-11-29")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"]));

  it.each([
    [undefined, "2026-11-21"],
    ["2026-11-24", "2026-11-24"],
    ["2026-11-27", "2026-11-27"],
    ["2026-11-28", "2026-11-21"],
    ["2026-11-20", "2026-11-21"],
    ["mañana", "2026-11-21"],
  ])("parseDay(%s) is %s", (param, day) => expect(parseDay(param, "2026-11-21")).toBe(day));

  it.each([
    ["2026-11-21", "Hoy"],
    ["2026-11-22", "Mañana"],
    ["2026-11-24", "Mar 24"],
  ])("dayLabel(%s) is %s", (day, label) => expect(dayLabel(day, "2026-11-21")).toBe(label));
});

describe("describePromotion", () => {
  const names = {
    entities: { galicia: "Banco Galicia" },
    media: { credit: "Tarjeta de crédito", qr: "Pago con QR" },
    conditions: { "comunidad-coto": "Comunidad Coto", "visa-nfc": "Visa con NFC (pago con el celular)" },
  };
  const promo = (fields: Partial<Promotion>): Promotion => ({
    id: "p", chainId: "coto", kind: "refund", percent: 25, entity: null, paymentMedium: null, weekdays: [], cap: null,
    channel: "in-store", validFrom: "2026-11-01", validTo: "2026-11-30", legalText: "", ...fields,
  });

  it.each<[Partial<Promotion>, string]>([
    [{ entity: "galicia", paymentMedium: "credit", cap: { amount: 1_000_000, period: "month" } }, "25% de reintegro con Banco Galicia, tarjeta de crédito. Tope $10.000 por mes."],
    [{ kind: "discount", percent: 15, conditions: ["comunidad-coto"] }, "15% de descuento con Comunidad Coto."],
    [{ paymentMedium: "qr", cap: "unknown" }, "25% de reintegro con pago con QR. Tope sin informar."],
    [{ kind: "discount", percent: 10, cap: { amount: 500_000, period: "transaction" } }, "10% de descuento con cualquier medio de pago. Tope $5.000 por compra."],
    [{ entity: "galicia", cap: { amount: 300_000, period: "week" } }, "25% de reintegro con Banco Galicia. Tope $3.000 por semana."],
  ])("%j", (fields, text) => expect(describePromotion(promo(fields), names)).toBe(text));
});
