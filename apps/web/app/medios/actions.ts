"use server";

import { getPaymentCatalog } from "@donde-ahorro/db/queries";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "../../lib/db.ts";
import { selectedConditions, selectedPaymentMethods } from "../../lib/selection.ts";
import { CONDITIONS_COOKIE, METHODS_COOKIE, parseConditions, parsePaymentMethods, serializePaymentMethods } from "../../lib/payments.ts";

/** Saves the payment methods and conditions on this device (S18, S20); none clears them. */
async function save(methodValues: string[], conditionValues: string[]) {
  const methods = parsePaymentMethods(methodValues.join(","));
  const conditions = parseConditions(conditionValues.join(","));
  const store = await cookies();
  const options = { maxAge: 365 * 24 * 3600, sameSite: "lax", path: "/", httpOnly: true } as const;
  if (methods.length) store.set(METHODS_COOKIE, serializePaymentMethods(methods), options);
  else store.delete(METHODS_COOKIE);
  if (conditions.length) store.set(CONDITIONS_COOKIE, conditions.join(","), options);
  else store.delete(CONDITIONS_COOKIE);
  redirect(`/medios?guardados=${methods.length + conditions.length}`);
}

/** The checked payment methods. */
export async function savePaymentMethods(formData: FormData) {
  await save(formData.getAll("method").map(String), formData.getAll("condition").map(String));
}

/** Every entity of the catalog with every medium, plus the saved ones; saved programs are kept. */
export async function saveAllPaymentMethods() {
  const [{ entities, media }, saved, conditions] = await Promise.all([getPaymentCatalog(sql), selectedPaymentMethods(), selectedConditions()]);
  const all = entities.flatMap((e) => media.map((m) => `${e.id}:${m.id}`));
  await save([...all, ...saved.map((m) => `${m.entity}:${m.medium}`)], conditions);
}
