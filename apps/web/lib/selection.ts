import { cookies } from "next/headers";
import type { PaymentMethod } from "@donde-ahorro/core";
import { BRANCHES_COOKIE, parseBranchIds } from "./branches.ts";
import { CART_COOKIE, parseCart, type CartItem } from "./cart.ts";
import { CONDITIONS_COOKIE, METHODS_COOKIE, parseConditions, parsePaymentMethods } from "./payments.ts";

/** The branches the user chose on this device (S3, S20); empty means all of CABA. */
export async function selectedBranchIds(): Promise<string[]> {
  return parseBranchIds((await cookies()).get(BRANCHES_COOKIE)?.value);
}

/** The payment methods the user said they have (S18); empty means only promotions open to everyone. */
export async function selectedPaymentMethods(): Promise<PaymentMethod[]> {
  return parsePaymentMethods((await cookies()).get(METHODS_COOKIE)?.value);
}

/** The eligibility conditions the user meets (memberships, Visa NFC). */
export async function selectedConditions(): Promise<string[]> {
  return parseConditions((await cookies()).get(CONDITIONS_COOKIE)?.value);
}

/** The cart on this device (S17). */
export async function selectedCart(): Promise<CartItem[]> {
  return parseCart((await cookies()).get(CART_COOKIE)?.value);
}
