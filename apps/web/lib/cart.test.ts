import { describe, expect, it } from "vitest";
import { addToCart, cartIsFull, isProductId, parseCart, serializeCart, setQuantities } from "./cart.ts";

describe("parseCart", () => {
  it("keeps well-formed product:quantity pairs, the first of each product", () =>
    expect(parseCart("8165:2,42:1,8165:5,x:1,7:0,9:100,10:1.5")).toEqual([
      { productId: "8165", quantity: 2 },
      { productId: "42", quantity: 1 },
    ]));
  it("is empty without a value", () => expect(parseCart(undefined)).toEqual([]));
  it("keeps at most 50 products", () => expect(parseCart(Array.from({ length: 60 }, (_, i) => `${i + 1}:1`).join(","))).toHaveLength(50));
  // "007" and "7" would be the same product twice.
  it("drops product ids with leading zeros", () => expect(parseCart("007:1,0:1,7:2")).toEqual([{ productId: "7", quantity: 2 }]));
  it("round-trips", () => expect(serializeCart(parseCart("8165:2,42:1"))).toBe("8165:2,42:1"));
});

describe("addToCart", () => {
  it("adds a new product at the end and adds to an existing one, up to 99", () => {
    const cart = [{ productId: "1", quantity: 2 }];
    expect(addToCart(cart, "2", 3)).toEqual([{ productId: "1", quantity: 2 }, { productId: "2", quantity: 3 }]);
    expect(addToCart(cart, "1", 98)).toEqual([{ productId: "1", quantity: 99 }]);
  });

  it("leaves a full cart unchanged for a new product, but still adds to one already in it", () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ productId: String(i + 1), quantity: 1 }));
    expect(cartIsFull(full, "51")).toBe(true);
    expect(cartIsFull(full, "1")).toBe(false);
    expect(addToCart(full, "51", 1)).toBe(full);
  });
});

describe("setQuantities", () => {
  it("updates quantities and removes products set to 0 or left out", () => {
    const cart = [{ productId: "1", quantity: 2 }, { productId: "2", quantity: 1 }, { productId: "3", quantity: 1 }];
    expect(setQuantities(cart, { "1": 5, "2": 0 })).toEqual([{ productId: "1", quantity: 5 }]);
  });
});

describe("isProductId", () => {
  it.each([["8165", true], ["007", false], ["0", false], ["", false], ["12a", false], ["1".repeat(19), false]])("%s → %s", (id, ok) =>
    expect(isProductId(id)).toBe(ok));
});
