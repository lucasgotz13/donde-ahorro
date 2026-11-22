"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CONDITIONS_COOKIE, MAX_PAYMENT_METHODS, METHODS_COOKIE, parseConditions, parsePaymentMethods, serializePaymentMethods } from "../../lib/payments.ts";

/** Saves the checked payment methods and conditions on this device (S18, S20); none checked clears them. */
export async function savePaymentMethods(formData: FormData) {
  const methods = parsePaymentMethods(formData.getAll("method").join(","));
  const conditions = parseConditions(formData.getAll("condition").join(","));
  const store = await cookies();
  const options = { maxAge: 365 * 24 * 3600, sameSite: "lax", path: "/", httpOnly: true } as const;
  if (methods.length) store.set(METHODS_COOKIE, serializePaymentMethods(methods), options);
  else store.delete(METHODS_COOKIE);
  if (conditions.length) store.set(CONDITIONS_COOKIE, conditions.join(","), options);
  else store.delete(CONDITIONS_COOKIE);
  // More checked than fit in the cookie (only possible once the catalog outgrows the limit): say so instead of dropping them silently.
  const cut = new Set(formData.getAll("method")).size > MAX_PAYMENT_METHODS;
  redirect(`/medios?guardados=${methods.length + conditions.length}${cut ? "&recortados=1" : ""}`);
}
